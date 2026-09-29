import { completionStatus, pickedCompletion, startCompletion } from '@codemirror/autocomplete'
import { EditorState, StateEffect, StateField, Transaction, type ChangeSet, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { WikiLink } from '../../../shared/links'
import { relinkStep } from '../links/model'
import { linkEnv } from './linkEnv'

// Right-click a `[[link]]` to point it somewhere else (Reuben, 2026-09-29: "just
// to avoid having to go through and delete the link and create a new one"). No
// menu — right-clicking a link means this — the `[[` picker opens on the link
// itself, at the screen that fits the half that was clicked (`relinkStep`).
//
// The picker is driven by the text after `[[` (completions.ts), so while it is
// open the link really does read `[[Waves#` in the note. Two things keep that
// from ever showing up as damage:
//
//   • Escape, a click elsewhere, or anything else that closes the picker without
//     a choice puts the link back EXACTLY as it was.
//   • None of the in-between text reaches the undo history. When a new place is
//     picked, the change goes in as one step from the old link to the new one,
//     so one Cmd+Z gives the old link back — never `[[Waves#`.
//
// An alias survives: `[[Waves|the chapter]]` only has its `Waves` replaced.

interface Session {
  /** where the link's `[[` is */
  from: number
  /** the whole link as it was */
  original: string
  /** a row was chosen */
  picked: boolean
}

const begin = StateEffect.define<Session>()
const end = StateEffect.define<null>()

const session = StateField.define<Session | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(begin)) return e.value
      if (e.is(end)) return null
    }
    if (!value) return value
    // The whole document replaced — the pane has moved on to another note, or
    // this one was reloaded from disk. The link being re-pointed is not in this
    // text any more, so there is nothing to put back here (and the note it WAS
    // in never saw the half-made link: see `relinkOpen`).
    let whole = false
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA === 0 && toA === tr.startState.doc.length) whole = true
    })
    if (whole) return null
    const from = tr.changes.mapPos(value.from, 1)
    const picked = value.picked || tr.annotation(pickedCompletion) !== undefined
    return from === value.from && picked === value.picked ? value : { ...value, from, picked }
  }
})

/** Is a link being re-pointed right now? While it is, the note's text on
 *  screen holds a half-made link (`[[Waves#`), and CodeEditor does not pass it
 *  on to be saved — so switching notes, quitting, or the autosave mid-choice
 *  can only ever save the link as it was. */
export const relinkOpen = (state: EditorState): boolean => !!state.field(session, false)

/** A re-pointing just finished in this update — the text to save now is the
 *  finished one, even when this update changed nothing itself. */
export const relinkClosed = (startState: EditorState, state: EditorState): boolean =>
  relinkOpen(startState) && !relinkOpen(state)

/** Everything typed or stepped while the picker is open stays out of undo. */
const quiet = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.startState.field(session, false)) return tr
  if (tr.annotation(Transaction.addToHistory) === false) return tr
  return [tr, { annotations: Transaction.addToHistory.of(false) }]
})

/** The picker closed. A step closes and reopens it in one go, so look again
 *  once things settle before deciding it was really closed. */
const watch = EditorView.updateListener.of((u) => {
  if (!u.state.field(session, false) || completionStatus(u.state) !== null) return
  const view = u.view
  setTimeout(() => {
    // the pane may have closed in the meantime
    if (!view.dom.isConnected) return
    if (view.state.field(session, false) && completionStatus(view.state) === null) finish(view)
  }, 0)
})

/** Put the link back, and — if a new place was chosen — make the change again as
 *  one undo step. Also how a re-pointing still open is cancelled when another
 *  link is right-clicked (linkGestures.ts), which is why it hands back what it
 *  changed: the other link may have moved along the line. */
export function finish(view: EditorView): ChangeSet | null {
  const s = view.state.field(session, false)
  if (!s) return null
  const doc = view.state.doc
  const line = s.from <= doc.length ? doc.lineAt(s.from) : null
  const close = line && doc.sliceString(s.from, s.from + 2) === '[[' ? doc.sliceString(s.from, line.to).indexOf(']]') : -1
  if (close === -1) {
    // Somebody took the link apart by hand while choosing: leave their text.
    view.dispatch({ effects: end.of(null) })
    return null
  }
  const to = s.from + close + 2
  const now = doc.sliceString(s.from, to)
  const back = view.state.changes({ from: s.from, to, insert: s.original })
  view.dispatch({
    changes: back,
    selection: { anchor: s.from + s.original.length },
    effects: end.of(null),
    annotations: Transaction.addToHistory.of(false)
  })
  if (!s.picked || now === s.original) return back
  const again = view.state.changes({ from: s.from, to: s.from + s.original.length, insert: now })
  view.dispatch({ changes: again, selection: { anchor: s.from + now.length } })
  return back.compose(again)
}

/** Open the picker on `link` (document offsets). `part`: which half of it was
 *  right-clicked. */
export function startRelink(view: EditorView, link: WikiLink, part: 'target' | 'heading'): void {
  const env = view.state.field(linkEnv, false)
  if (!env || view.state.field(session, false)) return
  const typed = relinkStep(link, env.notes, env.path, part)
  const inner = view.state.sliceDoc(link.from + 2, link.to - 2)
  const bar = inner.indexOf('|')
  view.dispatch({
    changes: { from: link.from + 2, to: bar === -1 ? link.to - 2 : link.from + 2 + bar, insert: typed },
    selection: { anchor: link.from + 2 + typed.length },
    effects: begin.of({ from: link.from, original: view.state.sliceDoc(link.from, link.to), picked: false }),
    annotations: Transaction.addToHistory.of(false)
  })
  view.focus()
  startCompletion(view)
}

export const relink: Extension = [session, quiet, watch]
