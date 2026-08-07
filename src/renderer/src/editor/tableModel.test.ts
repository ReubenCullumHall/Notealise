import { describe, expect, it } from 'vitest'
import {
  addColumn,
  addRow,
  emptyTable,
  moveColumn,
  padRows,
  parseAlign,
  readCell,
  serializeTable,
  setCell,
  removeColumn,
  removeRow,
  resizeColumns,
  resizeRows,
  setAlign,
  splitRow,
  writeCell,
  type TableModel
} from './tableModel'

// This module is the only thing in the app that REWRITES a block of a user's
// note from a structure held in memory. Everything here is about the round trip
// giving back what it was given — a wrong reading used to draw a wrong table,
// and now it writes one to disk.

describe('splitRow', () => {
  it('drops the outer pipes but keeps the cells between them', () => {
    expect(splitRow('| a | b |').map((s) => s.trim())).toEqual(['a', 'b'])
    // Both outer pipes are optional in GFM, and a row without them is still two
    // cells rather than one.
    expect(splitRow('a | b').map((s) => s.trim())).toEqual(['a', 'b'])
  })

  it('keeps an EMPTY cell instead of dropping it', () => {
    // The bug this whole approach exists to avoid. Building cells from the
    // parser's `TableCell` nodes loses empty ones entirely — an empty cell
    // produces no node at all — so `| a |  | c |` read back as two cells and `c`
    // silently moved into column 2. Cosmetic while the table was read-only;
    // once a cell edit rewrites the block, it deletes a column from the file.
    expect(splitRow('| a |  | c |').map((s) => s.trim())).toEqual(['a', '', 'c'])
    expect(splitRow('|  |  |').map((s) => s.trim())).toEqual(['', ''])
  })

  it('does not split on an escaped pipe', () => {
    // `\|` is a literal pipe INSIDE a cell. Splitting on it cuts the cell in two
    // and the table gains a column every time it is written back.
    expect(splitRow('| a \\| b | c |').map((s) => s.trim())).toEqual(['a \\| b', 'c'])
  })
})

describe('parseAlign', () => {
  it('reads each column independently', () => {
    expect(parseAlign('|:---|---:|:---:|---|')).toEqual(['left', 'right', 'center', null])
  })

  it('tells "no alignment" apart from "left"', () => {
    // `---` and `:---` render the same but are different bytes. Rewriting one as
    // the other changes a file the user never asked to change.
    expect(parseAlign('| --- |')).toEqual([null])
    expect(parseAlign('| :--- |')).toEqual(['left'])
  })
})

describe('cell text', () => {
  it('round-trips a literal pipe', () => {
    expect(readCell(' a \\| b ')).toBe('a | b')
    expect(writeCell('a | b')).toBe('a \\| b')
    expect(readCell(writeCell('a | b'))).toBe('a | b')
  })

  it('flattens a line break rather than breaking the table', () => {
    // A GFM cell cannot contain a newline. Writing one ends the table mid-row
    // and turns the remaining rows into paragraphs — pasting a paragraph into a
    // cell is exactly how that would happen.
    expect(writeCell('one\ntwo')).toBe('one two')
    expect(writeCell('one\r\ntwo')).toBe('one two')
  })
})

describe('serializeTable', () => {
  const t = (): TableModel => ({
    header: ['Element', 'Symbol'],
    align: ['left', 'right'],
    rows: [['Sodium', 'Na']]
  })

  it('writes a header, a delimiter and the rows, padded the way each column sits', () => {
    expect(serializeTable(t())).toBe(
      ['| Element | Symbol |', '| :------ | -----: |', '| Sodium  |     Na |'].join('\n')
    )
  })

  it('keeps alignment through a round trip', () => {
    const out = serializeTable(t()).split('\n')
    expect(parseAlign(out[1])).toEqual(['left', 'right'])
  })

  it('writes plain dashes when no alignment was stated', () => {
    const out = serializeTable({ header: ['a'], align: [null], rows: [] }).split('\n')
    expect(parseAlign(out[1])).toEqual([null])
    expect(out[1]).not.toContain(':')
  })

  it('honours the document’s line ending', () => {
    // CM6 normalises to \n internally, but a CRLF file is restored on write
    // (vault.ts). Hard-coding \n here would put mixed endings inside one block.
    expect(serializeTable(t(), '\r\n').split('\r\n')).toHaveLength(3)
  })

  it('escapes a pipe typed into a cell', () => {
    const out = serializeTable({ header: ['a|b'], align: [null], rows: [] })
    expect(out.split('\n')[0]).toBe('| a\\|b |')
    // …and reading it back gives the pipe, not a third column
    expect(splitRow(out.split('\n')[0]).map(readCell)).toEqual(['a|b'])
  })

  it('never writes a delimiter too short to parse', () => {
    // `---` is the minimum and the colons sit OUTSIDE it, so a centred column is
    // at least `:---:`. Letting a narrow column shrink the rule to `|:|` would
    // stop the block being a table at all.
    const out = serializeTable({ header: ['a'], align: ['center'], rows: [] }).split('\n')
    expect(out[1]).toBe('| :---: |')
    expect(parseAlign(out[1])).toEqual(['center'])
  })

  it('survives a table with a header and no rows', () => {
    // The 1×1 minimum. Markdown has no table without a header, so this is the
    // smallest thing that still parses.
    expect(serializeTable({ header: [''], align: [null], rows: [] })).toBe('|     |\n| --- |')
  })
})

describe('setCell', () => {
  const base = (): TableModel => ({ header: ['a', 'b'], align: [null, null], rows: [['1', '2']] })

  it('writes the header at row -1', () => {
    expect(setCell(base(), -1, 1, 'B').header).toEqual(['a', 'B'])
  })

  it('writes a body cell without touching its neighbours', () => {
    expect(setCell(base(), 0, 0, 'X').rows).toEqual([['X', '2']])
  })

  it('pads a short row rather than losing the edit', () => {
    // A row with fewer cells than the header is legal GFM. Writing into the
    // missing column has to grow the row, not silently do nothing.
    const model: TableModel = { header: ['a', 'b', 'c'], align: [null, null, null], rows: [['1']] }
    expect(setCell(model, 0, 2, 'Z').rows).toEqual([['1', '', 'Z']])
  })

  it('ignores coordinates that are out of range instead of throwing', () => {
    // Reachable for real: the note can be re-parsed smaller between a click and
    // the commit. Losing one keystroke beats writing into a row that is gone.
    expect(setCell(base(), 9, 0, 'X')).toEqual(base())
    expect(setCell(base(), 0, 9, 'X')).toEqual(base())
  })

  it('does not mutate the model it was given', () => {
    const model = base()
    setCell(model, 0, 0, 'X')
    expect(model.rows).toEqual([['1', '2']])
  })
})

describe('padRows', () => {
  it('squares off a ragged table to the WIDEST row, dropping nothing', () => {
    const model: TableModel = { header: ['a', 'b'], align: [], rows: [['1'], ['1', '2', '3']] }
    const out = padRows(model)
    // Three columns, because one row has three. Squaring to the HEADER's width
    // instead would leave that third cell outside every column serializeTable
    // writes — see "widens to the widest row" below for why that deletes it.
    expect(out.header).toEqual(['a', 'b', ''])
    expect(out.align).toEqual([null, null, null])
    expect(out.rows[0]).toEqual(['1', '', ''])
    expect(out.rows[1]).toEqual(['1', '2', '3'])
  })
})

describe('emptyTable', () => {
  it('is 2 columns, a header and one row — the 2×2 that /table inserts', () => {
    const t = emptyTable()
    expect(t.header).toHaveLength(2)
    expect(t.rows).toEqual([['', '']])
    // Every cell empty, and still a table: verified against the real parser.
    expect(serializeTable(t)).toBe('|     |     |\n| --- | --- |\n|     |     |')
  })
})

describe('growing and shrinking', () => {
  const t = (): TableModel => ({
    header: ['a', 'b'],
    align: ['left', 'right'],
    rows: [['1', '2'], ['3', '4']]
  })

  it('adds a column to every row, and to the alignment list', () => {
    const out = addColumn(t())
    expect(out.header).toEqual(['a', 'b', ''])
    expect(out.rows).toEqual([['1', '2', ''], ['3', '4', '']])
    // A new column states NO alignment. Inheriting its neighbour's would put
    // bytes in the file the user never chose.
    expect(out.align).toEqual(['left', 'right', null])
  })

  it('inserts in the middle without disturbing the columns either side', () => {
    const out = addColumn(t(), 1)
    expect(out.header).toEqual(['a', '', 'b'])
    expect(out.align).toEqual(['left', null, 'right'])
    expect(out.rows[0]).toEqual(['1', '', '2'])
  })

  it('removes a column from every row and its alignment with it', () => {
    const out = removeColumn(t(), 0)
    expect(out.header).toEqual(['b'])
    expect(out.align).toEqual(['right'])
    expect(out.rows).toEqual([['2'], ['4']])
  })

  it('refuses to remove the last column', () => {
    // Markdown has no table with no columns, so the drag has to stop somewhere.
    const one: TableModel = { header: ['a'], align: [null], rows: [['1']] }
    expect(removeColumn(one, 0)).toEqual(one)
  })

  it('adds and removes body rows, and allows none at all', () => {
    expect(addRow(t()).rows).toHaveLength(3)
    expect(addRow(t()).rows[2]).toEqual(['', ''])
    expect(removeRow(t(), 0).rows).toEqual([['3', '4']])
    // A header on its own IS a table — this is the 1×1 the drag shrinks to.
    const bare = removeRow(removeRow(t(), 0), 0)
    expect(bare.rows).toEqual([])
    expect(removeRow(bare, 0)).toEqual(bare)
  })

  it('resizes to an absolute size rather than by steps', () => {
    // A drag reports where the pointer IS, many times a second. Replaying that
    // as "add one" per event would double-apply on every frame the pointer
    // didn't happen to move.
    expect(resizeColumns(t(), 4).header).toHaveLength(4)
    expect(resizeColumns(t(), 1).header).toHaveLength(1)
    expect(resizeRows(t(), 0).rows).toEqual([])
    expect(resizeRows(t(), 3).rows).toHaveLength(3)
  })

  it('clamps a drag that runs off the edge instead of throwing', () => {
    expect(resizeColumns(t(), -5).header).toHaveLength(1)
    expect(resizeRows(t(), -5).rows).toEqual([])
  })

  it('drag out and back in returns what you started with', () => {
    // The gesture the user asked for, stated as a property: columns are always
    // added and removed at the RIGHT edge, so the two cancel.
    const start = t()
    expect(resizeColumns(resizeColumns(start, 5), 2)).toEqual(start)
    expect(resizeRows(resizeRows(start, 6), 2)).toEqual(start)
  })

  it('setAlign changes one column and clears back to unstated', () => {
    expect(setAlign(t(), 1, 'center').align).toEqual(['left', 'center'])
    expect(setAlign(t(), 0, null).align).toEqual([null, 'right'])
    expect(setAlign(t(), 9, 'center')).toEqual(t())
  })

  it('none of them mutate the model they were given', () => {
    const model = t()
    addColumn(model)
    removeColumn(model, 0)
    addRow(model)
    removeRow(model, 0)
    setAlign(model, 0, 'center')
    expect(model).toEqual(t())
  })
})

describe('padRows widens to the widest row', () => {
  it('keeps cells a malformed row has beyond the header', () => {
    // GFM renderers ignore extras, but this app REWRITES the block and
    // serializeTable only writes header.length columns — so anything past that
    // would be deleted from the file on the first cell edit. Widening the header
    // costs an empty header cell and keeps every character the user can see.
    const model: TableModel = { header: ['a'], align: [null], rows: [['1', 'kept', 'also']] }
    const out = padRows(model)
    expect(out.header).toEqual(['a', '', ''])
    expect(out.rows[0]).toEqual(['1', 'kept', 'also'])
    expect(serializeTable(out)).toContain('kept')
    expect(serializeTable(out)).toContain('also')
  })
})

describe('moveColumn', () => {
  const t = (): TableModel => ({
    header: ['A', 'B', 'C', 'D'],
    align: ['left', null, 'right', 'center'],
    rows: [['a1', 'b1', 'c1', 'd1']]
  })

  it('drags a column rightward, past two others', () => {
    // A dropped to before the (original) gap after D — i.e. at the very end.
    const out = moveColumn(t(), 0, 4)
    expect(out.header).toEqual(['B', 'C', 'D', 'A'])
    expect(out.align).toEqual([null, 'right', 'center', 'left'])
    expect(out.rows).toEqual([['b1', 'c1', 'd1', 'a1']])
  })

  it('drags a column leftward, to the very front', () => {
    const out = moveColumn(t(), 3, 0)
    expect(out.header).toEqual(['D', 'A', 'B', 'C'])
    expect(out.rows).toEqual([['d1', 'a1', 'b1', 'c1']])
  })

  it('is a no-op dropped on itself or on the gap right after itself', () => {
    // Both describe "didn't move" from the user's point of view: the column is
    // already sitting in that slot.
    expect(moveColumn(t(), 1, 1)).toEqual(t())
    expect(moveColumn(t(), 1, 2)).toEqual(t())
  })

  it('moves one place over correctly (the easiest case to get off-by-one)', () => {
    const out = moveColumn(t(), 1, 3) // B dropped just before D
    expect(out.header).toEqual(['A', 'C', 'B', 'D'])
  })

  it('ignores an out-of-range source', () => {
    expect(moveColumn(t(), 9, 0)).toEqual(t())
    expect(moveColumn(t(), -1, 0)).toEqual(t())
  })

  it('clamps a target past either end rather than throwing', () => {
    expect(() => moveColumn(t(), 0, 999)).not.toThrow()
    expect(moveColumn(t(), 0, 999).header).toEqual(['B', 'C', 'D', 'A'])
  })

  it('does not mutate its input', () => {
    const model = t()
    moveColumn(model, 0, 3)
    expect(model).toEqual(t())
  })
})
