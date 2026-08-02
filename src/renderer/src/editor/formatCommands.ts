import { EditorSelection } from '@codemirror/state'
// Type-only: nothing here calls an EditorView static, and keeping it a type
// import means the commands can be exercised against a plain EditorState.
import type { EditorView } from '@codemirror/view'
import { mathInsert, toggleMarker, wrapRange, type MarkerKind, type MarkerMode } from './formatModel'

// Toolbar/keymap formatting. Bold/italic/strikethrough are plain Markdown;
// underline has no Markdown syntax so it uses inline HTML (<u>), the same as
// Obsidian. Math is a $$…$$ block. All operate on the live EditorView.

function toggleWrap(view: EditorView, open: string, close: string = open): void {
  const doc = view.state.doc.toString()
  view.dispatch(
    view.state.changeByRange((range) => {
      const r = wrapRange(doc, range.from, range.to, open, close)
      return {
        changes: { from: r.from, to: r.to, insert: r.insert },
        range: EditorSelection.range(r.selFrom, r.selTo)
      }
    })
  )
  view.focus()
}

export const bold = (view: EditorView): void => toggleWrap(view, '**')
export const italic = (view: EditorView): void => toggleWrap(view, '*')
export const underline = (view: EditorView): void => toggleWrap(view, '<u>', '</u>')
export const strike = (view: EditorView): void => toggleWrap(view, '~~')

/** Insert a $$…$$ math block; wraps the selection, or drops the cursor between $$$$. */
export function insertMath(view: EditorView): void {
  const { from, to } = view.state.selection.main
  const inner = view.state.doc.sliceString(from, to)
  const insert = mathInsert(inner)
  view.dispatch({
    changes: { from, to, insert },
    selection: inner ? { anchor: from + 2, head: from + 2 + inner.length } : { anchor: from + 2 }
  })
  view.focus()
}

export const inlineCode = (view: EditorView): void => toggleWrap(view, '`')

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

/** A 2-column GFM starter table, with the first header cell selected. */
export function table(view: EditorView): void {
  const br = view.state.lineBreak
  insertBlock(view, ['| Column | Column |', '| --- | --- |', '|  |  |'].join(br), 'Column')
}
