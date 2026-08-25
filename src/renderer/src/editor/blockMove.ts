import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

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
 *  Three rules, in order:
 *
 *  1. **A selection wins.** Select four lines and the grip moves those four —
 *     the explicit answer always beats the inferred one, and it is the only way
 *     to move part of a paragraph.
 *  2. **A fenced code block moves whole** (see `fenceAt`).
 *  3. **Otherwise the paragraph**: the run of non-blank lines around the cursor.
 *     A blank line is its own block, which is what lets an empty line be pushed
 *     around to open up space rather than being silently glued to a neighbour.
 *
 *  A table needs no rule of its own: Markdown tables cannot contain a blank
 *  line, so rule 3 already takes one whole. */
export function blockRange(state: EditorState): BlockRange {
  const doc = state.doc
  const sel = state.selection.main

  if (!sel.empty) {
    const first = doc.lineAt(sel.from)
    const last = doc.lineAt(sel.to)
    return { from: first.from, to: last.to }
  }

  const fence = fenceAt(state, sel.head)
  if (fence) {
    // Out to whole lines: the node starts at the ``` and ends at the closing
    // fence, but what moves is always entire lines.
    return { from: doc.lineAt(fence.from).from, to: doc.lineAt(fence.to).to }
  }

  const line = doc.lineAt(sel.head)
  if (isBlank(line.text)) return { from: line.from, to: line.to }

  let first = line.number
  let last = line.number
  while (first > 1 && !isBlank(doc.line(first - 1).text)) first--
  while (last < doc.lines && !isBlank(doc.line(last + 1).text)) last++
  return { from: doc.line(first).from, to: doc.line(last).to }
}

/** Whether a grip should be offered at all.
 *
 *  A note with one blank line in it has nothing to reorder, and a grip floating
 *  beside the only line there is reads as a control that does nothing. */
export function canMoveBlock(state: EditorState): boolean {
  return state.doc.lines > 1
}
