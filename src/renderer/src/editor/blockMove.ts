import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { findToggles, isToggleMarkup, toggleAtTitle } from './toggleModel'

// Which lines the line-grip picks up.
//
// Pure arithmetic over the document and the selection — no view, no DOM — so
// the awkward parts (where a paragraph stops, what a fence counts as) are
// decided here and testable without a browser, the same split `tabs/model.ts`
// uses for the pane layout. `lineMove.ts` renders the grip and `attachMove.ts`
// performs the drag; neither knows these rules.

/** A run of whole lines, as document offsets: `from` is the first line's start
 *  and `to` the last line's end, with no trailing newline. What `attachMove`
 *  cuts and re-inserts. */
export interface BlockRange {
  from: number
  to: number
}

const isBlank = (text: string): boolean => text.trim() === ''
/** Where a paragraph stops: a blank line, or a toggle list's markup line (a
 *  paragraph written straight under a title is still not part of the title). */
const isEdge = (text: string): boolean => isBlank(text) || isToggleMarkup(text) || isEmbedLine(text)
/** A line that is nothing but a voice note, a video or a picture. Those go into
 *  a note on the line straight under the text, with no blank line between
 *  (voiceRecModel.ts `ownLineInsert`, attachInput.ts), so each is a block of its
 *  own — never glued to the paragraph beside it (Reuben, 2026-10-16: dragging a
 *  paragraph took the voice note under it too). */
const isEmbedLine = (text: string): boolean =>
  /^\s*<(audio|video)\b[^>]*>\s*<\/\1>\s*$/i.test(text) || /^\s*!\[[^\]\n]*\]\([^)\n]*\)\s*$/.test(text)

/** The fenced code block containing `pos`, or null.
 *
 *  Asked of the syntax tree rather than by counting ``` fences by hand: the
 *  parser already knows where a fence opens and closes, including the awkward
 *  cases (a fence indented inside a list, a fence whose closing marker is
 *  missing and which therefore runs to the end of the note). Counting would
 *  have to reproduce all of that and would disagree with the renderer the first
 *  time it got one wrong.
 *
 *  This is the ONE construct the paragraph rule below cannot handle, because a
 *  fence may legally contain blank lines and a paragraph may not — so walking
 *  outwards from the cursor would stop halfway through somebody's code and let
 *  them drag half of it away. */
function fenceAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (let node = syntaxTree(state).resolveInner(pos, 0); node; node = node.parent as never) {
    if (node.name === 'FencedCode') return { from: node.from, to: node.to }
    if (!node.parent) return null
  }
  return null
}

/** The lines the grip on `pos`'s line would move.
 *
 *  Four rules, in order:
 *
 *  1. **A selection wins.** Select four lines and the grip moves those four —
 *     the explicit answer always beats the inferred one, and it is the only way
 *     to move part of a paragraph.
 *  2. **A toggle list moves whole** when the cursor is on its title.
 *  3. **A fenced code block moves whole** (see `fenceAt`).
 *  4. **Otherwise the paragraph**: the run of non-blank lines around the cursor.
 *     A blank line is its own block, which is what lets an empty line be pushed
 *     around to open up space rather than being silently glued to a neighbour.
 *
 *  A table needs no rule of its own: Markdown tables cannot contain a blank
 *  line, so rule 3 already takes one whole.
 *
 *  `at` is a line the POINTER is over rather than the cursor (the grip follows
 *  the pointer onto any line — Reuben, 2026-10-06: "a selector for every line").
 *  The rules are the same with that line standing in for the cursor's, except
 *  that a selection still wins when the pointer is on one of its lines: grab a
 *  line inside what you selected and the whole selection moves. */
export function blockRange(state: EditorState, at?: number): BlockRange {
  const doc = state.doc
  const sel = state.selection.main
  const inSelection =
    at === undefined || (!sel.empty && at >= doc.lineAt(sel.from).from && at <= doc.lineAt(sel.to).to)

  if (inSelection && !sel.empty) {
    const first = doc.lineAt(sel.from)
    const last = doc.lineAt(sel.to)
    return { from: first.from, to: last.to }
  }
  const head = inSelection ? sel.head : Math.min(Math.max(at as number, 0), doc.length)

  // A toggle list moves whole — title, everything inside it, and its end —
  // when you grab its title, open or shut (Notion's rule).
  const toggle = toggleAtTitle(findToggles(state), doc.lineAt(head).number)
  if (toggle) return { from: toggle.from, to: doc.line(toggle.endLine).to }

  const fence = fenceAt(state, head)
  if (fence) {
    // Out to whole lines: the node starts at the ``` and ends at the closing
    // fence, but what moves is always entire lines.
    return { from: doc.lineAt(fence.from).from, to: doc.lineAt(fence.to).to }
  }

  const line = doc.lineAt(head)
  if (isBlank(line.text) || isEmbedLine(line.text)) return { from: line.from, to: line.to }

  let first = line.number
  let last = line.number
  while (first > 1 && !isEdge(doc.line(first - 1).text)) first--
  while (last < doc.lines && !isEdge(doc.line(last + 1).text)) last++
  return { from: doc.line(first).from, to: doc.line(last).to }
}

/** Whether a grip should be offered at all.
 *
 *  A note with one blank line in it has nothing to reorder, and a grip floating
 *  beside the only line there is reads as a control that does nothing. */
export function canMoveBlock(state: EditorState): boolean {
  return state.doc.lines > 1
}
