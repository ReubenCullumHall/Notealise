import {
  ChangeSet,
  type ChangeSpec,
  EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
  type TransactionSpec
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { isRaw } from './rawView'
import { formatEdit, markPairs, type MarkPair } from './markPairs'

// colorCommands.ts's two safety nets, for every OTHER inline style: `**bold**`,
// `*italic*`, `~~strike~~`, `` `code` `` and `<u>` / `<sup>` / `<sub>` / `<mark>`.
//
// Since 2026-09-25 their marks are never shown outside Markdown pro (Reuben:
// "never show the code version unless toggled on"). A hidden mark is atomic, so
// one Backspace beside it deletes the WHOLE `**` — and the other half, no longer
// paired, turns up in the note as raw text. Measured before this file existed:
// Backspace after bold left `Plain **styled words here` on screen. The rules
// below are colour's, unchanged, so every style behaves the same way:
//
//   - Backspace/Delete at a style's edge takes the style off (both marks).
//   - An edit that breaks a pair mends it: the half you did not delete stays.
//
// Plus one only markdown needs: `**words **` is not bold (CommonMark will not
// close a span on a space), so a space typed or left at the inside edge of a
// bold/italic/strike span is moved just outside it — and the next letter you
// type pulls it back in, so "hello world" typed in bold stays one bold span.
//
// And the "typing style" a shortcut sets with nothing selected (`typingField`):
// Bold with no selection used to write `****` into the note, visible until you
// typed. Now nothing is written until you type; the first character arrives
// already wrapped, so no half-made markup is ever on screen.

/** What the next character typed at `pos` should do, set by a style shortcut
 *  or by a space moving out of a span. Cleared by anything else. */
export type Typing =
  /** wrap the typed text: `before` + text + `after` (a style switched on, or off
   *  in the middle of a span). `holdSpaces`: spaces typed first stay plain and
   *  keep waiting — `** x**` would not be bold. */
  | { kind: 'wrap'; pos: number; before: string; after: string; holdSpaces: boolean; styles: string[] }
  /** put typed text at `to` instead — just outside a span, a style switched off
   *  at its edge. `pos` and `to` look like the same spot on screen. */
  | { kind: 'exit'; pos: number; to: number }
  /** a space was just moved out past a close mark at [closeFrom, closeTo): the
   *  next letter pulls the close mark after itself, rejoining the span. */
  | { kind: 'rejoin'; pos: number; closeFrom: number; closeTo: number }

export const setTyping = StateEffect.define<Typing | null>()

export const typingField = StateField.define<Typing | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setTyping)) return e.value
    // Any other edit or cursor move means you've gone on to something else.
    return tr.docChanged || tr.selection !== undefined ? null : value
  }
})

/** Runs FIRST (Prec.lowest — transaction filters run from the lowest precedence
 *  up): turns the character typed at a waiting position into its final shape,
 *  as one transaction, so the mends below never see the half-way state. */
const typingFilter = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    const t = tr.startState.field(typingField, false)
    if (!t || !tr.docChanged || isRaw(tr.startState)) return tr
    const sel = tr.startState.selection
    if (sel.ranges.length !== 1 || !sel.main.empty || sel.main.head !== t.pos) return tr
    let single = true
    let at = -1
    let del = 0
    let text = ''
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (at >= 0) single = false
      at = fromA
      del = toA - fromA
      text = inserted.toString()
    })
    if (!single) return tr

    // Backspace over a space that moved out: keep waiting, one step left.
    if (tr.isUserEvent('delete.backward') && t.kind === 'rejoin' && !text && del === 1 && at === t.pos - 1 && at >= t.closeTo) {
      return [tr, { effects: setTyping.of({ ...t, pos: at }) }]
    }
    if (!tr.isUserEvent('input.type') || del !== 0 || at !== t.pos || !text) return tr
    const spaces = /^\s+$/.test(text)
    const done = { userEvent: 'input.type', scrollIntoView: true, annotations: formatEdit.of(true), effects: setTyping.of(null) }

    if (t.kind === 'wrap') {
      if (spaces && t.holdSpaces) return [tr, { effects: setTyping.of({ ...t, pos: t.pos + text.length }) }]
      return {
        changes: { from: t.pos, insert: t.before + text + t.after },
        selection: { anchor: t.pos + t.before.length + text.length },
        ...done
      }
    }
    if (t.kind === 'exit') {
      return { changes: { from: t.to, insert: text }, selection: { anchor: t.to + text.length }, ...done }
    }
    // rejoin
    if (spaces) return [tr, { effects: setTyping.of({ ...t, pos: t.pos + text.length }) }]
    const close = tr.startState.doc.sliceString(t.closeFrom, t.closeTo)
    return {
      changes: [
        { from: t.closeFrom, to: t.closeTo },
        { from: t.pos, insert: text + close }
      ],
      selection: { anchor: t.pos - close.length + text.length },
      ...done
    }
  })
)

/** How far either side of an edit to look for a pair it may have broken. */
const SCAN = 2000

function pairAtEdge(state: EditorState, pos: number, dir: -1 | 1): MarkPair | null {
  const from = Math.max(0, pos - SCAN)
  const to = Math.min(state.doc.length, pos + SCAN)
  for (const p of markPairs(state, from, to)) {
    if (dir === -1 && (p.openTo === pos || p.closeTo === pos)) return p
    if (dir === 1 && (p.openFrom === pos || p.closeFrom === pos)) return p
  }
  return null
}

/** Same contract as colorCommands' `removeColorAtEdge`: a collapsed cursor at a
 *  style's edge, and Backspace/Delete removes both marks as one undoable step. */
const removeMarksAtEdge =
  (dir: -1 | 1) =>
  (view: EditorView): boolean => {
    // Markdown pro: the marks are on screen and yours to edit by hand.
    if (isRaw(view.state)) return false
    const sel = view.state.selection.main
    if (!sel.empty) return false
    // Just typed "hello " in bold and Backspaced the space: the cursor sits
    // after the hidden close mark, but you're deleting what you typed, not
    // asking for the bold to come off. Delete the last letter instead.
    const t = view.state.field(typingField, false)
    if (dir === -1 && t?.kind === 'rejoin' && sel.head === t.closeTo && t.pos === t.closeTo) {
      if (t.closeFrom === 0) return false
      view.dispatch({
        changes: { from: t.closeFrom - 1, to: t.closeFrom },
        selection: { anchor: t.closeFrom - 1 },
        userEvent: 'delete.backward'
      })
      return true
    }
    const pair = pairAtEdge(view.state, sel.head, dir)
    if (!pair) return false
    view.dispatch({
      changes: [
        { from: pair.closeFrom, to: pair.closeTo },
        { from: pair.openFrom, to: pair.openTo }
      ],
      // Stay at the same edge of the text: its end if you were at the end.
      selection: {
        anchor: sel.head >= pair.closeFrom ? pair.closeFrom - (pair.openTo - pair.openFrom) : pair.openFrom
      }
    })
    return true
  }

const WS = /\s/

/** colorCommands' `mendColorPairs`, for these pairs — read that one for why each
 *  branch is what it is (and why the mapping associativity is load-bearing).
 *  Only pairs that were whole BEFORE the edit are touched, so a stray mark the
 *  file already had stays visible and fixable. */
const mendMarkPairs = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  if (isRaw(tr.startState)) return tr
  // Only edits you make — typing, deleting, pasting, dragging text. Commands
  // (the style toggles, colour, undo) rewrite marks deliberately; see formatEdit.
  if (!tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.isUserEvent('move')) return tr
  if (tr.annotation(formatEdit)) return tr // typingFilter already shaped it
  const old = tr.startState
  const newDoc = tr.newDoc
  const changes: ChangeSpec[] = []
  const done = new Set<number>()
  // Where the cursor should end up if a space is moved out past a mark.
  let cursorAfter: number | null = null
  // (`as`: TS can't see the assignment inside the iterChangedRanges callback.)
  let moved = null as { closeFrom: number; closeTo: number } | null
  const head = tr.newSelection.main.empty ? tr.newSelection.main.head : -1
  tr.changes.iterChangedRanges((fromA, toA) => {
    const from = Math.max(0, fromA - SCAN)
    const to = Math.min(old.doc.length, toA + SCAN)
    for (const p of markPairs(old, from, to)) {
      if (done.has(p.openFrom)) continue
      done.add(p.openFrom)
      const openText = old.doc.sliceString(p.openFrom, p.openTo)
      const closeText = old.doc.sliceString(p.closeFrom, p.closeTo)
      const openFrom = tr.changes.mapPos(p.openFrom, 1)
      const openTo = tr.changes.mapPos(p.openTo, -1)
      const closeFrom = tr.changes.mapPos(p.closeFrom, 1)
      const closeTo = tr.changes.mapPos(p.closeTo, -1)
      const openAlive = newDoc.sliceString(openFrom, openTo) === openText
      const closeAlive = newDoc.sliceString(closeFrom, closeTo) === closeText
      const content = closeFrom > openTo ? newDoc.sliceString(openTo, closeFrom) : ''
      // For `*` `**` `~~` a span of nothing but spaces is not a span either.
      const contentSurvives = p.flanked ? content.trim() !== '' : content !== ''
      // Spaces at the inside edges, which unmake a `*` `**` `~~` span.
      let lead = 0
      let trail = 0
      if (p.flanked && contentSurvives) {
        while (WS.test(content[lead])) lead++
        while (WS.test(content[content.length - 1 - trail])) trail++
      }
      if (openAlive && closeAlive) {
        if (!contentSurvives) {
          // All-space content in a flanked span is the user mid-replace (the
          // selection was typed over with a space); leave it for the next key.
          if (!content) changes.push({ from: openFrom, to: closeTo })
          continue
        }
        // A space at the inside edge unmakes the span, so move it outside.
        if (trail) {
          const ws = content.slice(content.length - trail)
          changes.push({ from: closeFrom - trail, to: closeFrom }, { from: closeTo, insert: ws })
          if (head === closeFrom) {
            cursorAfter = closeTo
            moved = { closeFrom, closeTo }
          }
        }
        if (lead) {
          const ws = content.slice(0, lead)
          changes.push({ from: openFrom, insert: ws }, { from: openTo, to: openTo + lead })
        }
      } else if (openAlive) {
        // Put the lost mark back — inside any edge space, so it still closes.
        changes.push(contentSurvives ? { from: closeFrom - trail, insert: closeText } : { from: openFrom, to: openTo })
      } else if (closeAlive) {
        changes.push(contentSurvives ? { from: openTo + lead, insert: openText } : { from: closeFrom, to: closeTo })
      }
    }
  })
  if (!changes.length) return tr
  const spec: TransactionSpec = { changes, sequential: true }
  if (cursorAfter !== null) {
    // Land after the space that moved out, so the next letter typed lands there
    // too rather than back inside the span (which would rejoin the words).
    const cs = ChangeSet.of(changes, newDoc.length)
    const pos = cs.mapPos(cursorAfter, 1)
    spec.selection = { anchor: pos }
    // …but remember where the span ended, so the next LETTER typed rejoins it.
    if (moved) {
      spec.effects = setTyping.of({
        kind: 'rejoin',
        pos,
        closeFrom: cs.mapPos(moved.closeFrom, 1),
        closeTo: cs.mapPos(moved.closeTo, -1)
      })
    }
  }
  return [tr, spec]
})

export const markEditing: Extension = [
  typingField,
  typingFilter,
  mendMarkPairs,
  // Ahead of the default keymap, which would otherwise delete the atomic mark
  // before this ever sees the key.
  Prec.high(
    keymap.of([
      { key: 'Backspace', run: removeMarksAtEdge(-1) },
      { key: 'Delete', run: removeMarksAtEdge(1) }
    ])
  )
]
