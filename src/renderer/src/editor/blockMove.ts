import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { findToggles, toggleAtTitle } from './toggleModel'

const MATH_FENCE = /^\s*\$\$\s*$/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

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
/** A line that is nothing but a voice note, a video or a picture. Those go into
 *  a note on the line straight under the text, with no blank line between
 *  (voiceRecModel.ts `ownLineInsert`, attachInput.ts), so each is a block of its
 *  own — never glued to the paragraph beside it (Reuben, 2026-10-16: dragging a
 *  paragraph took the voice note under it too). */
export const isEmbedLine = (text: string): boolean =>
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
 *  Five rules, in order:
 *
 *  1. **A selection wins.** Select four lines and the grip moves those four —
 *     the explicit answer always beats the inferred one, and it is the only way
 *     to move part of a paragraph.
 *  2. **A toggle list moves whole** when the cursor is on its title.
 *  3. **A fenced code block moves whole** (see `fenceAt`).
 *  4. **Something that only makes sense whole moves whole** (`wholeBlockAt`):
 *     the properties at the top, a `$$` formula, a table, a quote, an HTML
 *     block, an underlined heading, a list item with the items nested under it.
 *  5. **Otherwise the line** (Reuben, 2026-11-06: "for ALL blocks there should
 *     be this" — until then a run of lines moved as one paragraph, with one
 *     grip at its top). A blank line is its own block, which is what lets an
 *     empty line be pushed around to open up space.
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
  const whole = wholeBlockAt(state, line.number)
  if (whole) return { from: doc.line(whole[0]).from, to: doc.line(whole[1]).to }
  // Otherwise the line itself (Reuben, 2026-11-06: "for ALL blocks there
  // should be this" — every line its own handle, a link on its own line too).
  return { from: line.from, to: line.to }
}

/** Syntax-tree blocks that only make sense whole: split one and it stops being
 *  that thing (half a table, a quote's first line without the rest). */
const WHOLE = new Set([
  'Table',
  'Blockquote',
  'HTMLBlock',
  'CommentBlock',
  'ProcessingInstructionBlock',
  'SetextHeading1',
  'SetextHeading2',
  'CodeBlock'
])

/** The first and last line numbers of the block line `n` must move with, or
 *  null when it moves alone. In order: the note's properties at the top
 *  (frontmatter), a `$$` formula, a table / quote / HTML block / underlined
 *  heading, and a list item — with the items nested under it, never its
 *  siblings. */
function wholeBlockAt(state: EditorState, n: number): [number, number] | null {
  const doc = state.doc
  const text = (i: number): string => doc.line(i).text

  // The properties block: `---` on line 1 down to its closing `---`.
  if (text(1).trim() === '---') {
    for (let i = 2; i <= doc.lines; i++) {
      if (/^(---|\.\.\.)\s*$/.test(text(i))) {
        if (n <= i) return [1, i]
        break
      }
    }
  }

  // A `$$` formula: the parser reads it as a paragraph, so it is counted here,
  // outside code fences, the way blocks.ts indexes them.
  let open: number | null = null
  let fence: string | null = null
  for (let i = 1; i <= doc.lines && i <= n + 2000; i++) {
    const t = text(i)
    const f = FENCE.exec(t)
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (open === null && f) {
      fence = f[1]
      continue
    }
    if (MATH_FENCE.test(t)) {
      if (open === null) open = i
      else {
        if (n >= open && n <= i) return [open, i]
        open = null
      }
      continue
    }
    if (open === null && i > n) break
  }
  if (open !== null && n >= open) return [open, doc.lines] // an unclosed one runs to the end

  // The syntax tree's answer for everything else.
  const at = doc.line(n)
  const inner = syntaxTree(state).resolveInner(at.from + (at.text.length - at.text.trimStart().length), 1)
  let item: { from: number; to: number } | null = null
  for (let node: typeof inner | null = inner; node; node = node.parent) {
    if (WHOLE.has(node.name)) return trimmed(state, node.from, node.to)
    // The innermost list item STARTING on this line is the one grabbed; on a
    // wrapped continuation line, the item it continues.
    if (node.name === 'ListItem' && (!item || doc.lineAt(node.from).number === n)) {
      if (!item || doc.lineAt(item.from).number !== n) item = { from: node.from, to: node.to }
    }
  }
  return item ? trimmed(state, item.from, item.to) : null
}

/** Line numbers of [from, to], blank lines off the end. */
function trimmed(state: EditorState, from: number, to: number): [number, number] {
  const doc = state.doc
  const first = doc.lineAt(from).number
  let last = doc.lineAt(to).number
  while (last > first && isBlank(doc.line(last).text)) last--
  return [first, last]
}

/** Whether a grip should be offered at all.
 *
 *  A note with one blank line in it has nothing to reorder, and a grip floating
 *  beside the only line there is reads as a control that does nothing. */
export function canMoveBlock(state: EditorState): boolean {
  // Any note with something in it: the grip also selects (a click) and links
  // (right-click), which a one-line note wants as much as any other.
  return state.doc.length > 0
}
