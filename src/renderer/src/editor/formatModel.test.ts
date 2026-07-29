import { describe, expect, it } from 'vitest'
import { splitMarker, toggleMarker, wrapRange } from './formatModel'

// The toolbar's editing logic, tested without a live editor. The cases that
// matter are the ones a user hits by accident: pressing a button twice, pressing
// a second list button over the first, and dragging a selection that includes a
// blank line.

describe('wrapRange', () => {
  it('wraps a selection', () => {
    const r = wrapRange('hello', 0, 5, '**', '**')
    expect(r.insert).toBe('**hello**')
    expect([r.selFrom, r.selTo]).toEqual([2, 7])
  })

  it('unwraps when the markers sit just outside the selection', () => {
    const r = wrapRange('**hello**', 2, 7, '**', '**')
    expect(r.insert).toBe('hello')
  })

  it('unwraps when the markers sit inside the selection', () => {
    const r = wrapRange('**hello**', 0, 9, '**', '**')
    expect(r.insert).toBe('hello')
  })

  it('drops the cursor between the markers on an empty selection', () => {
    const r = wrapRange('', 0, 0, '**', '**')
    expect(r.insert).toBe('****')
    expect([r.selFrom, r.selTo]).toEqual([2, 2])
  })
})

describe('splitMarker', () => {
  it('reads a checklist as a checklist, not a bullet', () => {
    // the ordering trap: `- [ ] ` starts with `- `, so a naive pattern splits it
    // as a bullet whose body is "[ ] buy milk"
    expect(splitMarker('- [ ] buy milk')).toEqual({ indent: '', marker: '- [ ] ', body: 'buy milk' })
    expect(splitMarker('- [x] done')).toEqual({ indent: '', marker: '- [x] ', body: 'done' })
  })

  it('keeps indentation out of the marker, so nesting survives a toggle', () => {
    expect(splitMarker('  - nested')).toEqual({ indent: '  ', marker: '- ', body: 'nested' })
  })

  it('reports no marker on a plain line', () => {
    expect(splitMarker('plain text')).toEqual({ indent: '', marker: '', body: 'plain text' })
  })

  it('does not treat a bare # or a mid-line > as a marker', () => {
    expect(splitMarker('#tag').marker).toBe('')
    expect(splitMarker('a > b').marker).toBe('')
  })
})

describe('toggleMarker', () => {
  it('applies to every line', () => {
    expect(toggleMarker(['one', 'two'], 'bullet')).toEqual(['- one', '- two'])
    expect(toggleMarker(['one'], 'h2')).toEqual(['## one'])
  })

  it('removes the marker when every line already has it', () => {
    expect(toggleMarker(['- one', '- two'], 'bullet')).toEqual(['one', 'two'])
    expect(toggleMarker(['## title'], 'h2')).toEqual(['title'])
  })

  it('applies rather than removes when only some lines have it', () => {
    expect(toggleMarker(['- one', 'two'], 'bullet')).toEqual(['- one', '- two'])
  })

  it('REPLACES a different marker instead of stacking one on top', () => {
    // the whole reason markers are parsed rather than prefixed
    expect(toggleMarker(['- one'], 'numbered')).toEqual(['1. one'])
    expect(toggleMarker(['# title'], 'h3')).toEqual(['### title'])
    expect(toggleMarker(['> quoted'], 'bullet')).toEqual(['- quoted'])
    expect(toggleMarker(['- [ ] task'], 'bullet')).toEqual(['- task'])
  })

  it('renumbers a numbered list from 1', () => {
    expect(toggleMarker(['a', 'b', 'c'], 'numbered')).toEqual(['1. a', '2. b', '3. c'])
    expect(toggleMarker(['5. a', '9. b'], 'numbered')).toEqual(['a', 'b'])
  })

  it('accepts any legal numbered form as already-numbered', () => {
    expect(toggleMarker(['1) a', '2) b'], 'numbered')).toEqual(['a', 'b'])
  })

  it('leaves a blank line beside text alone', () => {
    // marking them would turn a paragraph gap into an empty list item
    expect(toggleMarker(['one', '', 'two'], 'bullet')).toEqual(['- one', '', '- two'])
    // and a blank line must not block the off-toggle either
    expect(toggleMarker(['- one', '', '- two'], 'bullet')).toEqual(['one', '', 'two'])
  })

  it('preserves indentation', () => {
    expect(toggleMarker(['  nested'], 'bullet')).toEqual(['  - nested'])
    expect(toggleMarker(['  - nested'], 'bullet')).toEqual(['  nested'])
  })

  // REGRESSION. Blank lines used to be skipped unconditionally, so a list or
  // heading button pressed on an empty line — a new note, or straight after
  // Enter, which is precisely when you ask for a list — silently did nothing.
  it('marks an all-blank selection, because there is nothing else to mark', () => {
    expect(toggleMarker([''], 'bullet')).toEqual(['- '])
    expect(toggleMarker([''], 'numbered')).toEqual(['1. '])
    expect(toggleMarker([''], 'checklist')).toEqual(['- [ ] '])
    expect(toggleMarker([''], 'h1')).toEqual(['# '])
    expect(toggleMarker(['', ''], 'numbered')).toEqual(['1. ', '2. '])
  })

  it('still toggles an empty list item back off', () => {
    // the marker alone is not a blank line, so this takes the normal path
    expect(toggleMarker(['- '], 'bullet')).toEqual([''])
    expect(toggleMarker(['1. '], 'numbered')).toEqual([''])
  })
})
