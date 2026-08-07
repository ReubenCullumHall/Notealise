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
}

/** The narrowest a delimiter cell may be and still parse: `---`. */
const MIN_RULE = 3

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

/** Cell text as the user should see it: escapes undone, padding removed. */
export function readCell(raw: string): string {
  return raw.replace(/\\\|/g, '|').trim()
}

/**
 * Cell text as it goes into the file.
 *
 * Two things are not optional. A literal `|` must be escaped or it becomes a
 * column boundary and the table gains a cell on the next read. And a line break
 * cannot exist inside a GFM cell at all — pasting a paragraph into one would
 * otherwise end the table mid-row and turn the rest into paragraphs.
 */
export function writeCell(text: string): string {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
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

  return [line(model.header), '| ' + rule + ' |', ...model.rows.map(line)].join(lineBreak)
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
  return {
    header: pad(model.header),
    align: Array.from({ length: width }, (_, i) => model.align[i] ?? null),
    rows: model.rows.map(pad)
  }
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
  return {
    header: insertAt(model.header, at, ''),
    // A new column states no alignment. Inheriting the neighbour's would be a
    // guess that shows up in the file as bytes the user never chose.
    align: insertAt(model.align, at, null),
    rows: model.rows.map((r) => insertAt(r, at, ''))
  }
}

export function removeColumn(model: TableModel, at: number): TableModel {
  if (model.header.length <= MIN_COLS) return model
  return {
    header: removeAt(model.header, at),
    align: removeAt(model.align, at),
    rows: model.rows.map((r) => removeAt(r, at))
  }
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
  return { header: move(model.header), align: move(model.align), rows: model.rows.map(move) }
}
