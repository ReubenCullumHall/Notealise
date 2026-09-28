// GFM tables as data, and back again. Pure — no DOM, no CodeMirror — so the part
// that can silently corrupt a note is unit-testable on its own.
//
// This exists because the table stopped being read-only. While a table was only
// ever *drawn*, a wrong reading showed a wrong table and nothing was lost. Now
// that editing a cell rewrites the block in the file, every round trip has to
// give back what it was given: the alignment row, escaped pipes, and cells the
// user never touched.
//
// THE SHAPE. A GFM table is a header row, a delimiter row that also carries each
// column's alignment, and zero or more body rows:
//
//     | Element | Symbol |
//     |:--------|-------:|      <- alignment lives HERE, nowhere else
//     | Sodium  | Na     |
//
// **Markdown has no table without a header row.** That is the format, not a
// choice this app made, and it is why "2×2" means a header plus one body row and
// why the smallest table is a single header cell.

/** A column's alignment. `null` is a plain `---` — no alignment stated, which is
 *  NOT the same as explicitly left (`:---`): rewriting one as the other changes
 *  the file for a user who never asked. */
export type Align = 'left' | 'center' | 'right' | null

export interface TableModel {
  header: string[]
  /** one per column, same length as `header` */
  align: Align[]
  rows: string[][]
  /** Each column's width in pixels, set by dragging the line between two
   *  columns. ABSENT on a table nobody has resized, and that absence means
   *  something: such a table fills the note and shares it out evenly, which is
   *  how every table looked before widths existed. Never written as an empty
   *  or default list — a table the user didn't resize gains no line. */
  widths?: number[]
}

/** The narrowest a delimiter cell may be and still parse: `---`. */
const MIN_RULE = 3

// --- column widths -----------------------------------------------------------
// Markdown has no way to say how wide a column is, so the widths go in an HTML
// comment on the line directly above the table (Reuben's pick, 2026-09-27):
//
//     <!-- widths: 140 90 220 -->
//     | Name | Age | Notes |
//
// A comment rather than anything cleverer in the table itself (rule 4): GitHub,
// VS Code and this app's own reading of the file all hide it, the table still
// parses as a table directly beneath it (checked against @lezer/markdown and
// marked), and it travels with the note — to Windows, to another app, and
// through undo. Obsidian shows it faintly while editing. Anything that doesn't
// match this exact shape is left alone as the user's own comment.

/** Narrowest a dragged column may get: room for a short word and its padding. */
export const MIN_WIDTH = 48
/** Width given to a column added to a table that already has widths. */
export const DEFAULT_WIDTH = 120

const WIDTHS_LINE = /^<!--\s*widths:\s*(\d+(?:\s+\d+)*)\s*-->\s*$/

/** The widths stated by a `<!-- widths: … -->` line, or null if the line is
 *  anything else — including a comment of the user's own that merely mentions
 *  widths. */
export function parseWidths(line: string): number[] | null {
  const m = WIDTHS_LINE.exec(line)
  return m ? m[1].split(/\s+/).map(Number) : null
}

/** Exactly `cols` widths: extras dropped, gaps filled. A file edited in another
 *  app can gain or lose a column without touching the comment above it. */
function fitWidths(widths: number[], cols: number): number[] {
  return Array.from({ length: cols }, (_, i) => widths[i] ?? DEFAULT_WIDTH)
}

/** `model` with `widths` carried through a column change — or left absent, so
 *  an unsized table stays unsized through every edit. */
const withWidths = (model: TableModel, widths: number[] | undefined): TableModel =>
  widths ? { ...model, widths } : model

/**
 * Split one table line into its cells.
 *
 * Splitting on `|` is not enough: `\|` is a literal pipe inside a cell, and
 * treating it as a boundary silently cuts a cell in half. The leading and
 * trailing empties either side of the outer pipes are dropped — `| a | b |` is
 * two cells, not four.
 */
export function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '\\|'
      i++
    } else if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  // A row normally opens and closes with `|`, giving an empty cell at each end.
  // Both are optional in GFM, so drop them only when they really are empty.
  if (cells.length && cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells
}

/** The alignments stated by a `|:---|---:|` row. */
export function parseAlign(delimiterRow: string): Align[] {
  return splitRow(delimiterRow).map((raw) => {
    const s = raw.trim()
    const left = s.startsWith(':')
    const right = s.endsWith(':')
    if (left && right) return 'center'
    if (left) return 'left'
    if (right) return 'right'
    return null
  })
}

/** A line break inside a cell, as written in the file. Other spellings (`<br/>`,
 *  `<BR />`) are read as one too, and written back in this form. */
const CELL_BREAK = '<br>'

/** Cell text as the user should see it: escapes undone, padding removed, and
 *  each `<br>` turned back into the line break it stands for. */
export function readCell(raw: string): string {
  return raw
    .replace(/\\\|/g, '|')
    .trim()
    .replace(/[ \t]*<br\s*\/?>[ \t]*/gi, '\n')
}

/**
 * Cell text as it goes into the file.
 *
 * Two things are not optional. A literal `|` must be escaped or it becomes a
 * column boundary and the table gains a cell on the next read. And a real line
 * break cannot exist inside a GFM cell at all — it would end the table mid-row
 * and turn the rest into paragraphs. So a line break (Shift+Enter, or a pasted
 * paragraph) is written as `<br>`: still one line in the file, and a line break
 * in GitHub, Obsidian and VS Code (rule 4 — inline HTML, not an invented mark).
 * Until 2026-09-28 it was flattened to a space instead.
 */
export function writeCell(text: string): string {
  return text
    .trim()
    .replace(/\|/g, '\\|')
    .replace(/[ \t]*\r?\n[ \t]*/g, CELL_BREAK)
}

/** How wide a cell prints. Escapes count: `\|` occupies two columns in the file,
 *  and padding computed off the unescaped text leaves the raw table ragged. */
const printWidth = (s: string): number => s.length

/**
 * Render the model as Markdown.
 *
 * Columns are padded to a common width. That is a deliberate choice now that raw
 * view is a feature people will actually look at: an unpadded table is unreadable
 * as source. The trade is that editing one cell can re-space the whole block, so
 * a table you had hand-aligned is re-aligned this app's way the first time you
 * touch it — the content is never altered, only the spacing between pipes.
 */
export function serializeTable(model: TableModel, lineBreak = '\n'): string {
  const cols = Math.max(1, model.header.length)
  const cell = (row: string[], i: number): string => writeCell(row[i] ?? '')

  const widths: number[] = []
  for (let i = 0; i < cols; i++) {
    let w = printWidth(cell(model.header, i))
    for (const row of model.rows) w = Math.max(w, printWidth(cell(row, i)))
    // The delimiter needs room for `---` plus a colon at each end it uses.
    const a = model.align[i] ?? null
    const ruleMin = MIN_RULE + (a === 'center' ? 2 : a ? 1 : 0)
    widths.push(Math.max(w, ruleMin))
  }

  /** Padded to sit the way its column is aligned. Purely cosmetic in the file —
   *  alignment is carried by the delimiter row, never by spaces — but raw view
   *  is a feature people read now, and a right-aligned column that looks
   *  left-aligned in the source is a small lie on every line. */
  const pad = (text: string, w: number, a: Align): string => {
    if (a === 'right') return text.padStart(w)
    if (a === 'center') {
      const left = Math.floor((w - text.length) / 2)
      return ' '.repeat(Math.max(0, left)) + text.padEnd(w - Math.max(0, left))
    }
    return text.padEnd(w)
  }

  const line = (cells: string[]): string =>
    '| ' + widths.map((w, i) => pad(cell(cells, i), w, model.align[i] ?? null)).join(' | ') + ' |'

  const rule = widths
    .map((w, i) => {
      const a = model.align[i] ?? null
      if (a === 'center') return ':' + '-'.repeat(w - 2) + ':'
      if (a === 'left') return ':' + '-'.repeat(w - 1)
      if (a === 'right') return '-'.repeat(w - 1) + ':'
      return '-'.repeat(w)
    })
    .join(' | ')

  const lines = [line(model.header), '| ' + rule + ' |', ...model.rows.map(line)]
  if (model.widths) lines.unshift(`<!-- widths: ${fitWidths(model.widths, cols).join(' ')} -->`)
  return lines.join(lineBreak)
}

/** `row === -1` is the header — the one row every table has. Out-of-range
 *  coordinates are a no-op rather than an error: they can only come from a table
 *  that was re-parsed smaller under a click, and losing the keystroke is better
 *  than writing a cell into a row that doesn't exist. */
export function setCell(model: TableModel, row: number, col: number, text: string): TableModel {
  if (col < 0 || col >= model.header.length) return model
  if (row === -1) {
    const header = [...model.header]
    header[col] = text
    return { ...model, header }
  }
  if (row < 0 || row >= model.rows.length) return model
  const rows = model.rows.map((r, i) => {
    if (i !== row) return r
    // Pad first: a short row (legal in GFM) must not swallow the edit.
    const next = [...r]
    while (next.length < model.header.length) next.push('')
    next[col] = text
    return next
  })
  return { ...model, rows }
}

/**
 * Square the table off so the widget can draw a rectangle from a ragged file.
 *
 * The width is the WIDEST row, not the header's — and that is the load-bearing
 * part. A body row with more cells than the header is malformed Markdown, and
 * renderers (GitHub included) simply ignore the extras. This app cannot: it
 * rewrites the block, and `serializeTable` only ever writes `header.length`
 * columns, so anything past that would be **deleted from the file** the first
 * time a cell was clicked. Widening the header instead keeps every character
 * the user can see, and costs only an empty header cell — which still renders
 * correctly everywhere (rule 4).
 */
export function padRows(model: TableModel): TableModel {
  const width = Math.max(1, model.header.length, ...model.rows.map((r) => r.length))
  const pad = (r: string[]): string[] =>
    r.length >= width ? r : [...r, ...Array(width - r.length).fill('')]
  return withWidths(
    {
      header: pad(model.header),
      align: Array.from({ length: width }, (_, i) => model.align[i] ?? null),
      rows: model.rows.map(pad)
    },
    model.widths && fitWidths(model.widths, width)
  )
}

/** A starter table: `cols` wide, with a header and `bodyRows` rows under it.
 *  The default is the 2×2 the "/table" command inserts — two columns, a header
 *  row and one body row, which is the smallest thing that reads as a grid. */
export function emptyTable(cols = 2, bodyRows = 1): TableModel {
  return {
    header: Array(cols).fill(''),
    align: Array(cols).fill(null),
    rows: Array.from({ length: bodyRows }, () => Array(cols).fill(''))
  }
}

// --- growing and shrinking -------------------------------------------------
// What the hover strips drive. All of it clamps rather than throws: these are
// driven by a drag, which reports positions well past both ends of the table as
// a matter of course, and a drag that ran off the edge must stop rather than
// produce a table with no columns.

/** The smallest table Markdown can express: one header cell, no body rows. */
export const MIN_COLS = 1
export const MIN_ROWS = 0

const insertAt = <T,>(list: T[], at: number, value: T): T[] => {
  const out = [...list]
  out.splice(Math.max(0, Math.min(at, out.length)), 0, value)
  return out
}

const removeAt = <T,>(list: T[], at: number): T[] =>
  at < 0 || at >= list.length ? [...list] : list.filter((_, i) => i !== at)

export function addColumn(model: TableModel, at = model.header.length): TableModel {
  return withWidths(
    {
      header: insertAt(model.header, at, ''),
      // A new column states no alignment. Inheriting the neighbour's would be a
      // guess that shows up in the file as bytes the user never chose.
      align: insertAt(model.align, at, null),
      rows: model.rows.map((r) => insertAt(r, at, ''))
    },
    model.widths && insertAt(model.widths, at, DEFAULT_WIDTH)
  )
}

export function removeColumn(model: TableModel, at: number): TableModel {
  if (model.header.length <= MIN_COLS) return model
  return withWidths(
    {
      header: removeAt(model.header, at),
      align: removeAt(model.align, at),
      rows: model.rows.map((r) => removeAt(r, at))
    },
    model.widths && removeAt(model.widths, at)
  )
}

export function addRow(model: TableModel, at = model.rows.length): TableModel {
  return { ...model, rows: insertAt(model.rows, at, Array(model.header.length).fill('')) }
}

export function removeRow(model: TableModel, at: number): TableModel {
  if (model.rows.length <= MIN_ROWS) return model
  return { ...model, rows: removeAt(model.rows, at) }
}

/**
 * Make the table exactly `cols` wide, adding or removing at the RIGHT edge.
 *
 * What a drag on the column handle ends in. Expressed as "be this size" rather
 * than "add one" because a drag reports an absolute position many times a
 * second: replaying it as a stream of increments would double-apply every frame
 * the pointer didn't move.
 *
 * Columns are removed from the right, so dragging out and back in returns the
 * table you started with — as long as you don't let go in between, which is
 * exactly the "drag them back in" gesture. Text in a removed column is gone;
 * that is what undo is for.
 */
export function resizeColumns(model: TableModel, cols: number): TableModel {
  const target = Math.max(MIN_COLS, Math.round(cols))
  let out = model
  while (out.header.length < target) out = addColumn(out)
  while (out.header.length > target) out = removeColumn(out, out.header.length - 1)
  return out
}

/** As `resizeColumns`, for body rows. `MIN_ROWS` is zero: a header on its own is
 *  a valid table, and it is the 1×1 the drag is allowed to shrink to. */
export function resizeRows(model: TableModel, rows: number): TableModel {
  const target = Math.max(MIN_ROWS, Math.round(rows))
  let out = model
  while (out.rows.length < target) out = addRow(out)
  while (out.rows.length > target) out = removeRow(out, out.rows.length - 1)
  return out
}

/** Set one column's alignment. `null` clears it back to a plain `---`. */
export function setAlign(model: TableModel, col: number, align: Align): TableModel {
  if (col < 0 || col >= model.header.length) return model
  const next = [...model.align]
  next[col] = align
  return { ...model, align: next }
}

/**
 * Move column `from` to sit just before `insertBefore`, dragging its cells and
 * its alignment with it. `insertBefore` is an index into the ORIGINAL column
 * order — "drop it here" as the user sees the table before the move, not after.
 *
 * That is the standard shape of a drag-reorder gesture (the drop target is
 * wherever the pointer is over the table you can still see), so the caller
 * hands over exactly what it measured — the boundary the pointer is nearest —
 * with no arithmetic of its own. Internally that means removing `from` first
 * and then correcting the insertion point by one when it fell to the right of
 * the gap that just closed.
 *
 * A no-op — same object back — when the move wouldn't change anything: dropped
 * on itself, or on the gap immediately after itself (both mean "didn't move").
 */
export function moveColumn(model: TableModel, from: number, insertBefore: number): TableModel {
  if (from < 0 || from >= model.header.length) return model
  if (insertBefore === from || insertBefore === from + 1) return model

  const move = <T,>(list: T[]): T[] => {
    const out = [...list]
    const [item] = out.splice(from, 1)
    // The removal shifted everything after `from` one place left, so a target
    // that was to its right has to shift with it.
    const at = insertBefore > from ? insertBefore - 1 : insertBefore
    out.splice(Math.max(0, Math.min(at, out.length)), 0, item)
    return out
  }
  // A column keeps its width when it moves — the width belongs to the column.
  return withWidths(
    { header: move(model.header), align: move(model.align), rows: model.rows.map(move) },
    model.widths && move(model.widths)
  )
}

/** Set every column's width at once — what a drag on the line between two
 *  columns ends in. Rounded to whole pixels so the comment stays readable. */
export function setWidths(model: TableModel, widths: number[]): TableModel {
  return { ...model, widths: fitWidths(widths.map((w) => Math.round(w)), model.header.length) }
}
