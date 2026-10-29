import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state'

// Tab and Shift+Tab in a note (bug scan 2026-10-27). Neither key was bound, so
// the browser moved focus instead: Shift+Tab landed in the note's name box with
// the name selected — the next thing typed RENAMED the note — and Tab left the
// note so the typing went nowhere. Now, on list lines, Tab nests the line one
// level and Shift+Tab brings it back; anywhere else both keys are simply kept
// inside the note.

/** `- `, `* `, `+ `, `1. `, `1) `, with or without a `[ ]` checkbox after it. */
const LIST_LINE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/

/** How far one nesting step goes for this line: the width of its own marker
 *  and the space after it, which is what CommonMark needs for the line to sit
 *  inside the item above it (2 for `- `, 3 for `1. `). */
function stepFor(text: string): number | null {
  const m = LIST_LINE.exec(text)
  return m ? m[2].length + Math.min(m[3].length, 4) : null
}

/** The lines the selection touches, each once. */
function linesOf(state: EditorState): number[] {
  const seen = new Set<number>()
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number
    // A selection ending at the very start of a line doesn't take that line.
    const lastLine = state.doc.lineAt(r.to)
    const last = r.to > r.from && r.to === lastLine.from ? lastLine.number - 1 : lastLine.number
    for (let n = first; n <= Math.max(first, last); n++) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

/** The change Tab (`dir` 1) or Shift+Tab (`dir` -1) makes, or null when the
 *  selection isn't on list lines (the key is then just kept in the note). */
export function listIndentChange(state: EditorState, dir: 1 | -1): Transaction | null {
  const lines = linesOf(state).map((n) => state.doc.line(n))
  if (!lines.length || lines.some((l) => stepFor(l.text) === null)) return null
  const changes: { from: number; to?: number; insert?: string }[] = []
  for (const l of lines) {
    const step = stepFor(l.text) as number
    if (dir === 1) {
      changes.push({ from: l.from, insert: ' '.repeat(step) })
    } else {
      const lead = /^[ \t]*/.exec(l.text)![0]
      if (!lead) continue
      // A tab counts as one whole step; otherwise take up to `step` spaces.
      const take = lead[0] === '\t' ? 1 : Math.min(step, lead.length)
      changes.push({ from: l.from, to: l.from + take })
    }
  }
  if (!changes.length) return null
  const spec = state.changes(changes)
  return state.update({
    changes: spec,
    selection: EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.range(spec.mapPos(r.anchor, 1), spec.mapPos(r.head, 1))),
      state.selection.mainIndex
    ),
    userEvent: dir === 1 ? 'input.indent' : 'delete.dedent'
  })
}

interface ViewLike {
  state: EditorState
  dispatch: (tr: Transaction) => void
}

const run =
  (dir: 1 | -1) =>
  (view: ViewLike): boolean => {
    const tr = listIndentChange(view.state, dir)
    if (tr) view.dispatch(tr)
    return true // always handled: the key must never take focus out of the note
  }

/** Enter on an empty, un-nested list line (`- ` / `1. ` / `- [ ] ` and nothing
 *  else) ends the list: the marker goes, that line is left blank, and the cursor
 *  starts a fresh line below it. The blank line is what makes the next words
 *  their own paragraph — straight under the last bullet, Obsidian and GitHub
 *  read them as more of that bullet (Reuben, 2026-10-29). CodeMirror's own Enter
 *  left no gap, and under a ONE-item list added another bullet instead, so
 *  leaving took a third Enter (bug scan 2026-10-27). A nested empty line is left
 *  to CodeMirror, which steps it out one level. */
export function exitEmptyItem(state: EditorState): Transaction | null {
  const sel = state.selection.main
  if (state.selection.ranges.length !== 1 || !sel.empty) return null
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.to) return null
  if (!/^([-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]*)?$/.test(line.text)) return null
  return state.update({
    changes: { from: line.from, to: line.to, insert: state.lineBreak },
    selection: { anchor: line.from + state.lineBreak.length },
    userEvent: 'input'
  })
}

export const listIndentKeys = [
  { key: 'Tab', run: run(1) },
  { key: 'Shift-Tab', run: run(-1) }
]

/** Enter on an empty list line (`exitEmptyItem`). It has to be bound ABOVE the
 *  Markdown language's own Enter, which `markdown()` adds at high precedence —
 *  bound beside Tab it never ran, and the one-item-list fix did nothing in the
 *  app while its test passed (found 2026-10-29). extensions.ts wraps it in
 *  `Prec.highest`; this file stays free of @codemirror/view so it tests without
 *  a page. Declines (returns false) on every other line, so ordinary Enter,
 *  list continuation and the pickers are untouched. */
export const exitListKey = {
  key: 'Enter',
  run: (view: ViewLike): boolean => {
    const tr = exitEmptyItem(view.state)
    if (!tr) return false
    view.dispatch(tr)
    return true
  }
}
