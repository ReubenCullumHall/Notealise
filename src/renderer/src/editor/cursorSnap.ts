import { Prec } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { hiddenRunEnd } from './livePreview'
import { isRaw } from './rawView'
import { splitMarker } from './formatModel'
import { tagStartOf } from './blockTags'

// Keep the cursor on the VISIBLE side of hidden markup (Reuben, 2026-09-25:
// "never show the code… it should always not glitch like this").
//
// A hidden mark is invisible but still takes a position, so a cursor can sit on
// either side of it and look identical. Measured in the real app, two spots put
// you on the wrong side:
//
//   - clicking at the far end of a line, or pressing End, left the cursor
//     BEFORE a hidden `</u>` / `]]` / `</mark>` that ends it — so Enter carried
//     that closing mark down onto the next line, where it showed as raw text;
//   - Home on a quote, bullet or checklist line left it BEFORE the hidden `> ` /
//     `- ` — so the next letter typed broke the marker and it showed.
//
// Both are fixed by moving the cursor across the hidden run when it lands there
// by a click or a jump — never while you arrow left through the words.

/** Where a line's text starts, past its hidden block marker; null if its
 *  marker is visible or absent. Only a bullet's dot and a checkbox still hide
 *  their marker on the line you're on — a heading's `#` and a quote's `>` show
 *  there since 2026-09-27, so a click or Home before them must be able to land
 *  in front of them (to delete them). A numbered list's `1. ` is plain text. */
function textStart(lineText: string): number | null {
  const { indent, marker } = splitMarker(lineText)
  if (!marker || !/^[-*+] /.test(marker)) return null
  return indent.length + marker.length
}

const snap = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate): void {
      if (!u.selectionSet || isRaw(u.state)) return
      const tr = u.transactions.find((t) => t.isUserEvent('select'))
      if (!tr) return
      const sel = u.state.selection.main
      if (!sel.empty || u.state.selection.ranges.length !== 1) return
      const pos = sel.head
      const was = u.startState.selection.main.head
      const doc = u.state.doc
      const line = doc.lineAt(pos)
      const leftward = was > pos && doc.lineAt(was).number === line.number && !tr.isUserEvent('select.pointer')
      let to: number | null = null
      // A block's hidden link tag (` ^k3x9`, blockIds.ts) must go on ENDING the
      // line, so as far as the cursor is concerned the line ends where it starts.
      const tagAt = tagStartOf(u.state, line.from, line.text)
      const end = tagAt ?? line.to

      // Before the hidden block marker at the start of the line.
      const start = textStart(line.text)
      if (tagAt !== null && pos > tagAt) {
        // In or past the tag — a click at the line's far end, End, arrowing
        // up or down into it, or Left from the line below: back to where it
        // starts. (Right from there is `rightPastTag` below; End and Right both
        // arrive here at the line's end and can't be told apart.)
        to = tagAt
      } else if (start !== null && pos < line.from + start) {
        // Arrowing left out of the text: go on to the previous line, as if the
        // marker weren't there — otherwise you could never leave the line.
        to = leftward && line.number > 1 ? line.from - 1 : line.from + start
      } else if (!leftward && pos < end && hiddenRunEnd(u.view, pos) >= end) {
        // Before hidden marks that run to the end of the line (or to its tag).
        to = end
      }
      if (to === null || to === pos) return
      const view = u.view
      // An update may not dispatch; do it straight after.
      queueMicrotask(() => {
        if (view.state.selection.main.head === pos) view.dispatch({ selection: { anchor: to! } })
      })
    }
  }
)

/** Enter just before hidden marks that end the line (typing "under" inside a
 *  `<u>` and pressing Enter): start the new line AFTER them, so the closing mark
 *  stays with its opening one instead of dropping onto the next line. */
const enterPastMarks = Prec.high(
  keymap.of([
    {
      key: 'Enter',
      run: (view: EditorView): boolean => {
        if (isRaw(view.state)) return false
        const sel = view.state.selection
        if (sel.ranges.length !== 1 || !sel.main.empty) return false
        const pos = sel.main.head
        const line = view.state.doc.lineAt(pos)
        if (pos < line.to && hiddenRunEnd(view, pos) === line.to) {
          view.dispatch({ selection: { anchor: line.to } })
        }
        return false // on to the normal Enter, now from the right spot
      }
    }
  ])
)

/** Home (and the Mac's Cmd+Left) on a bullet or checklist line: land where the
 *  words start, after the hidden `- ` / `- [ ] `. Left to `snap` above, the jump
 *  to the line's very start read as "arrowing left out of the text" and the
 *  cursor went up to the previous line (found on Windows 2026-09-28, where Home
 *  is how you move along a line). Only a jump that would land inside the hidden
 *  marker is redirected, so Home on a wrapped line's later rows is untouched. */
const homeToText = (view: EditorView): boolean => {
  if (isRaw(view.state)) return false
  const sel = view.state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return false
  const line = view.state.doc.lineAt(sel.main.head)
  const start = textStart(line.text)
  if (start === null) return false
  if (view.moveToLineBoundary(sel.main, false).head >= line.from + start) return false
  view.dispatch({ selection: { anchor: line.from + start }, scrollIntoView: true, userEvent: 'select' })
  return true
}

const lineStartKeys = Prec.high(
  keymap.of([
    { key: 'Home', run: homeToText },
    { mac: 'Cmd-ArrowLeft', run: homeToText }
  ])
)

/** Joining a line onto one that ends in a block's hidden tag — Backspace at
 *  the start of the line below, or Delete just before the tag. Left to the
 *  normal keys, the tag would be glued to the words that followed it
 *  (`energy. ^k3x9Next`), stop being a tag and show up as text, and every link
 *  to that block would break. Instead the lines join and the tag moves to the
 *  end of the joined line, where it still ends the block. */
function joinKeepingTag(view: EditorView, forward: boolean): boolean {
  if (isRaw(view.state)) return false
  const sel = view.state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return false
  const { state } = view
  const doc = state.doc
  const pos = sel.main.head
  const here = doc.lineAt(pos)
  const upper = forward ? here : here.number > 1 ? doc.line(here.number - 1) : null
  if (!upper || upper.number >= doc.lines) return false
  if (!forward && pos !== here.from) return false
  const tagAt = tagStartOf(state, upper.from, upper.text)
  if (tagAt === null || (forward && pos !== tagAt)) return false
  const lower = doc.line(upper.number + 1)
  // Two tags on one line can't both end it; leave that rare case to the
  // ordinary keys rather than decide which block's links to break.
  if (tagStartOf(state, lower.from, lower.text) !== null) return false
  // Backspace at the start of a list item below: the ordinary keys take its
  // bullet or number off first, which is what that press is for — joining
  // comes on a later press, and lands here then. (Delete from above still
  // joins here: left to the ordinary keys, it would eat the tag instead.)
  if (!forward && /^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(lower.text)) return false
  view.dispatch({
    changes: [
      { from: tagAt, to: lower.from },
      { from: lower.to, insert: doc.sliceString(tagAt, upper.to) }
    ],
    selection: { anchor: tagAt },
    scrollIntoView: true,
    userEvent: forward ? 'delete.forward' : 'delete.backward'
  })
  return true
}

/** Right, with the cursor just before a hidden tag: on to the next line, as if
 *  the tag weren't there. Left alone, it would step over the tag to the line's
 *  end, and `snap` would put it straight back — a cursor that can't leave. */
function rightPastTag(view: EditorView): boolean {
  if (isRaw(view.state)) return false
  const sel = view.state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) return false
  const doc = view.state.doc
  const line = doc.lineAt(sel.main.head)
  if (tagStartOf(view.state, line.from, line.text) !== sel.main.head || line.number >= doc.lines) return false
  view.dispatch({ selection: { anchor: line.to + 1 }, scrollIntoView: true, userEvent: 'select' })
  return true
}

const tagJoins = Prec.high(
  keymap.of([
    { key: 'Backspace', run: (view) => joinKeepingTag(view, false) },
    { key: 'Delete', run: (view) => joinKeepingTag(view, true) },
    { key: 'ArrowRight', run: rightPastTag }
  ])
)

export const cursorSnap = [snap, enterPastMarks, lineStartKeys, tagJoins]
