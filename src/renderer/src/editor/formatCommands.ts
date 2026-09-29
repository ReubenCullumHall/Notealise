import { EditorSelection, type EditorState } from '@codemirror/state'
// Type-only: nothing here calls an EditorView static, and keeping it a type
// import means the commands can be exercised against a plain EditorState.
import type { EditorView } from '@codemirror/view'
import {
  mathInsert,
  splitMarker,
  toggleMarker,
  toggleStyle,
  wrapRange,
  type MarkerKind,
  type MarkerMode,
  type Range,
  type WrapResult
} from './formatModel'
import { formatEdit, markPairs, unsplittable, type MarkPair } from './markPairs'
import { colorPairs } from './colorTags'
import { setTyping, typingField, type Typing } from './markEditing'
import { isRaw } from './rawView'
import { emptyTable, serializeTable } from './tableModel'
import { mathText, openMathEdit, type MathKind } from './mathEdit'
import { findToggles, toggleAtTitle, unwrapSpec, wrappable, wrapSpec } from './toggleModel'

// Toolbar/keymap formatting. Bold/italic/strikethrough are plain Markdown;
// underline has no Markdown syntax so it uses inline HTML (<u>), the same as
// Obsidian. Math is a $$…$$ block. All operate on the live EditorView.

// `kind` is the style's name in markPairs (the syntax-tree node, or `tag:u`), so
// the toggle can find the spans already there instead of guessing from the text.
function toggleWrap(view: EditorView, kind: string, open: string, close: string = open): void {
  const { state } = view
  if (typingStyle(view, kind, open, close)) return
  const doc = state.doc.toString()
  const spec = state.changeByRange((range) => {
      let r: WrapResult | null = null
      if (!range.empty) {
        // Whole lines either side, so a span that starts before the selection
        // on the same line (or a <u> opened earlier in it) is found.
        const from = state.doc.lineAt(range.from).from
        const to = state.doc.lineAt(range.to).to
        const pairs = markPairs(state, from, to)
        const found = pairs.filter((p) => p.kind === kind)
        const { foreign, atoms } = obstacles(state, from, to, kind, pairs)
        r = toggleStyle(doc, range.from, range.to, open, close, found, FLANKED.has(kind), foreign, atoms)
        if (!r) return { range } // only spaces or line markers selected: nothing to style
      } else {
        r = wrapRange(doc, range.from, range.to, open, close)
      }
      return {
        changes: { from: r.from, to: r.to, insert: r.insert },
        range: EditorSelection.range(r.selFrom, r.selTo)
      }
    })
  view.dispatch({ ...spec, annotations: formatEdit.of(true) })
  view.focus()
}

/** What a style must work around between `from` and `to`: other styles' marks
 *  (it stops at them rather than tangling with them) and things it can only
 *  wrap whole (markPairs.ts's `unsplittable`). */
function obstacles(
  state: EditorState,
  from: number,
  to: number,
  kind: string,
  pairs: MarkPair[]
): { foreign: Range[]; atoms: Range[] } {
  const foreign: Range[] = []
  for (const p of pairs) {
    if (p.kind === kind || p.kind === 'InlineCode') continue // code is an atom, below
    foreign.push({ from: p.openFrom, to: p.openTo }, { from: p.closeFrom, to: p.closeTo })
  }
  for (const c of colorPairs(state, from, to)) {
    foreign.push({ from: c.openFrom, to: c.openTo }, { from: c.closeFrom, to: c.closeTo })
  }
  const atoms = unsplittable(state, from, to)
  if (kind !== 'InlineCode') return { foreign, atoms }
  // Code can't hold a link at all — inside backticks it would show as raw
  // `[text](url)` — so for code those are left out, not wrapped whole. (Other
  // code spans are this style's own, found as `found`.)
  const code = new Set(pairs.filter((p) => p.kind === 'InlineCode').map((p) => p.openFrom))
  return { foreign: [...foreign, ...atoms.filter((r) => !code.has(r.from))], atoms: [] }
}

const FLANKED = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough'])

/** A style shortcut with NOTHING selected (Reuben, 2026-09-25): writes nothing
 *  yet — it sets how the next character you type comes out (markEditing's
 *  `typingField`), the way a word processor's Bold button does. The old way
 *  wrote an empty `****` into the note, on screen until you typed into it.
 *  Returns false when this doesn't apply (a selection, several cursors,
 *  Markdown pro, or an editor without markEditing — the tests' plain state). */
function typingStyle(view: EditorView, kind: string, open: string, close: string): boolean {
  const { state } = view
  const sel = state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty || isRaw(state)) return false
  const current = state.field(typingField, false)
  if (current === undefined) return false
  const pos = sel.main.head
  const set = (t: Typing | null): true => {
    view.dispatch({ effects: setTyping.of(t) })
    view.focus()
    return true
  }

  // Already waiting here: this press adds or removes a style from the wait.
  if (current && current.pos === pos) {
    if (current.kind !== 'wrap') return set(null) // e.g. just moved a space out: stop the style there
    const has = current.styles.includes(kind)
    const styles = has ? current.styles.filter((k) => k !== kind) : [...current.styles, kind]
    return set(styles.length ? waitFor(styles) : null)
  }

  // Inside a span of this style: switching it off.
  const line = state.doc.lineAt(pos)
  const span = markPairs(state, line.from, line.to).find(
    (p) => p.kind === kind && p.openTo <= pos && pos <= p.closeFrom
  )
  if (span) {
    if (pos === span.closeFrom) return set({ kind: 'exit', pos, to: span.closeTo })
    if (pos === span.openTo) return set({ kind: 'exit', pos, to: span.openFrom })
    // In the middle: what you type next goes between a close and a re-open.
    return set({ kind: 'wrap', pos, before: close, after: open, holdSpaces: false, styles: [] })
  }
  return set(waitFor([kind]))

  function waitFor(styles: string[]): Typing {
    const marks = styles.map((k) => MARKS[k])
    return {
      kind: 'wrap',
      pos,
      before: marks.map((m) => m[0]).join(''),
      after: marks.map((m) => m[1]).reverse().join(''),
      holdSpaces: styles.some((k) => FLANKED.has(k)),
      styles
    }
  }
}

/** Each style's open and close marks, by its markPairs kind. */
const MARKS: Record<string, [string, string]> = {
  StrongEmphasis: ['**', '**'],
  Emphasis: ['*', '*'],
  Strikethrough: ['~~', '~~'],
  InlineCode: ['`', '`'],
  'tag:u': ['<u>', '</u>']
}

export const bold = (view: EditorView): void => toggleWrap(view, 'StrongEmphasis', '**')
export const italic = (view: EditorView): void => toggleWrap(view, 'Emphasis', '*')
export const underline = (view: EditorView): void => toggleWrap(view, 'tag:u', '<u>', '</u>')
export const strike = (view: EditorView): void => toggleWrap(view, 'Strikethrough', '~~')

/** Insert a $$…$$ maths block (wrapping the selection) and open the maths box
 *  on it, where you type the LaTeX and watch it draw on the line. In Markdown
 *  pro there is no box: the cursor lands between the $$ as it always did. */
export function insertMath(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to)
  if (isRaw(view.state)) {
    const insert = mathInsert(inner)
    view.dispatch({
      changes: { from, to, insert },
      selection: inner ? { anchor: from + 2, head: from + 2 + inner.length } : { anchor: from + 2 }
    })
    view.focus()
    return
  }
  const alone = aloneOnLine(view.state, from, to)
  // Several selected lines only survive as a fenced block — a one-line $$…$$
  // with a line break inside it is no longer maths to any renderer.
  const kind: MathKind = alone && inner.includes('\n') ? 'fenced' : 'display'
  openInBox(view, from, to, kind, kind === 'fenced' ? inner : inner.replace(/\s*\n\s*/g, ' '), alone)
}

/** Insert $…$ maths inside a sentence and open the maths box on it. Nothing is
 *  written until you type — an empty `$$` would read as a display block. */
export function insertInlineMath(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to).replace(/\s*\n\s*/g, ' ').trim()
  if (isRaw(view.state)) {
    const insert = `$${inner}$`
    view.dispatch({
      changes: { from, to, insert },
      selection: inner ? { anchor: from + 1, head: from + 1 + inner.length } : { anchor: from + 1 }
    })
    view.focus()
    return
  }
  openInBox(view, from, to, 'inline', inner, false)
}

/** Nothing but whitespace on the line either side of [from, to]. */
function aloneOnLine(state: EditorState, from: number, to: number): boolean {
  const a = state.doc.lineAt(from)
  const b = state.doc.lineAt(to)
  return !a.text.slice(0, from - a.from).trim() && !b.text.slice(to - b.from).trim()
}

/** Write the formula over [from, to] and open the box on it, in one step. The
 *  editor's cursor waits just past the formula; the box takes the keyboard
 *  (mathEditor.ts focuses it once it's on screen). */
function openInBox(view: EditorView, from: number, to: number, kind: MathKind, latex: string, alone: boolean): void {
  const insert = mathText(kind, latex)
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    effects: openMathEdit.of({ from, to: from + insert.length, latex, kind, alone })
  })
}

export const inlineCode = (view: EditorView): void => toggleWrap(view, 'InlineCode', '`')

// --- block-level commands ------------------------------------------------------
// Headings, lists and quotes rewrite whole lines rather than wrapping a range, so
// they work off the primary selection's line span (a toolbar click has one
// selection; multi-cursor line edits would overlap each other's changes).

/** Toggle a heading / list / quote marker across the selected lines. `mode` is
 *  `'set'` when the command was invoked by name from the "/" menu — see
 *  `MarkerMode`. */
export function toggleBlock(view: EditorView, kind: MarkerKind, mode: MarkerMode = 'toggle'): void {
  const { state } = view
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  const lines: string[] = []
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n).text)

  const next = toggleMarker(lines, kind, mode)
  const insert = next.join(state.lineBreak)
  // The cursor should stay put relative to the text it was in, so it moves by
  // however much its own line's marker grew or shrank.
  const delta = next[0].length - lines[0].length
  view.dispatch({
    changes: { from: first.from, to: last.to, insert },
    selection:
      from === to
        ? { anchor: Math.max(first.from, Math.min(from + delta, first.from + next[0].length)) }
        : { anchor: first.from, head: first.from + insert.length }
  })
  view.focus()
}

// There used to be a `heading(1)` / `bulletList` / `quote` wrapper per marker
// here. They were one-liners over `toggleBlock`, and once the command registry
// became the single place a block command is declared they were a second way to
// say the same thing — so the registry calls `toggleBlock(view, kind, mode)`
// directly and the wrappers are gone (CLAUDE.md rule 9).

/** Replace the selection with `text`, guaranteeing it starts on its own line and
 *  is followed by one. `select` is a substring of `text` to leave selected (so
 *  typing replaces the placeholder); otherwise the cursor lands at its end. */
function insertBlock(view: EditorView, text: string, select?: string): void {
  const { state } = view
  const { from, to } = state.selection.main
  const line = state.doc.lineAt(from)
  const lead = from > line.from ? state.lineBreak : '' // mid-line: break out of it first
  const trail = to < state.doc.lineAt(to).to ? state.lineBreak : ''
  const insert = lead + text + trail
  const base = from + lead.length
  const at = select ? text.indexOf(select) : -1
  const selection =
    select && at !== -1
      ? { anchor: base + at, head: base + at + select.length }
      : { anchor: base + text.length }
  view.dispatch({ changes: { from, to, insert }, selection })
  view.focus()
}

/** A fenced code block. A selection becomes its contents; otherwise the cursor
 *  lands on the empty line between the fences. */
export function codeBlock(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to)
  const br = view.state.lineBreak
  if (inner) insertBlock(view, '```' + br + inner + br + '```', inner)
  else {
    const line = view.state.doc.lineAt(from)
    const lead = from > line.from ? br : ''
    view.dispatch({
      changes: { from, to, insert: lead + '```' + br + br + '```' },
      selection: { anchor: from + lead.length + 4 }
    })
    view.focus()
  }
}

/** `[text](url)` — a selection becomes the label and the cursor lands on the
 *  URL, which is the half you still have to fill in. */
export function link(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to)
  const label = inner || 'text'
  const insert = `[${label}](url)`
  const urlAt = from + label.length + 3
  view.dispatch({
    changes: { from, to, insert },
    selection: inner
      ? { anchor: urlAt, head: urlAt + 3 }
      : { anchor: from + 1, head: from + 1 + label.length }
  })
  view.focus()
}

/** `[[Note name]]` — a link to another note in the vault. A selection becomes the
 *  target; otherwise you get empty brackets. Either way the cursor lands inside
 *  them, which is what the `[[` completion source watches for — so this command
 *  *is* the note picker rather than needing one of its own. */
export function wikiLink(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to)
  view.dispatch({
    changes: { from, to, insert: `[[${inner}]]` },
    // Just before the closing brackets: with a selection this leaves the typed
    // title ready to be corrected, and with none it is simply where you type.
    selection: { anchor: from + 2 + inner.length }
  })
  view.focus()
}

export const horizontalRule = (view: EditorView): void => insertBlock(view, '---')

/** A toggle list (toggleModel.ts). The line the cursor is on becomes its
 *  title, without any list or heading mark it had; further selected lines go
 *  inside it. On a toggle's title, the button takes the toggle away again and
 *  "/" leaves it be — the same set-vs-toggle split as the block commands. */
export function toggleList(view: EditorView, mode: MarkerMode = 'toggle'): void {
  const { state } = view
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from).number
  const last = state.doc.lineAt(to).number
  const t = toggleAtTitle(findToggles(state), first)
  if (t) {
    if (mode === 'toggle') view.dispatch(unwrapSpec(state, t, from - t.prefixEnd))
  } else {
    // A selection that would cut an existing toggle in half wraps only its
    // first line.
    const end = wrappable(state, first, last) ? last : first
    view.dispatch(wrapSpec(state, first, end, splitMarker(state.doc.line(first).text).body, 'end'))
  }
  view.focus()
}

/**
 * A starter table: 2×2 on screen — two columns, a header row and one body row.
 *
 * Empty cells, not "Column | Column": the table renders as a grid you click into
 * now, so placeholder words are text you have to delete rather than a hint. An
 * all-empty table IS still a valid GFM table — verified against the real
 * @lezer/markdown parser, not assumed, because an empty cell produces no
 * `TableCell` node and it was worth checking the block still parses at all.
 *
 * Markdown has no table without a header row, so "2×2" is the header plus one
 * row; the same reason the smallest table this app will shrink to is one header
 * cell.
 */
export function table(view: EditorView): void {
  const br = view.state.lineBreak
  // TWO trailing line breaks, and both are load-bearing.
  //
  // The first ends the table: the whole block renders as a widget, so a cursor
  // left at the end of its last row is *inside* the replaced range — invisible,
  // and the next character typed goes into the table rather than the note.
  //
  // The second is the blank line that ends the table as far as MARKDOWN is
  // concerned. Verified against the real parser: a non-blank line immediately
  // under a table is parsed as another ROW of it (GFM continues a table until a
  // blank line), so with only one break, typing the first word after inserting a
  // table would silently have appended it as a row.
  insertBlock(view, serializeTable(emptyTable(2, 1), br) + br + br)
}
