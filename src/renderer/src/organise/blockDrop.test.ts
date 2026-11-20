import { describe, expect, it } from 'vitest'
import { appendBlock } from './blockDrop'
import { carryLabel } from '../dragHold'

describe('a block dropped on a note in the sidebar goes on the end of that note, as a block of its own', () => {
  it('after an empty line, whatever the note ends with', () => {
    expect(appendBlock('Last line', 'Moved')).toBe('Last line\n\nMoved\n')
    expect(appendBlock('Last line\n', 'Moved')).toBe('Last line\n\nMoved\n')
    expect(appendBlock('Last line\n\n', 'Moved')).toBe('Last line\n\nMoved\n')
  })

  it('never joins a list the note ends with (a list item would carry on the list without the gap)', () => {
    expect(appendBlock('- one\n- two\n', '- moved')).toBe('- one\n- two\n\n- moved\n')
  })

  it('an empty note is just the block', () => {
    expect(appendBlock('', 'Moved')).toBe('Moved\n')
    expect(appendBlock('\n\n', 'Moved')).toBe('Moved\n')
  })

  it('what the note already had is left exactly as it was', () => {
    const before = '# Title\n\nText  \n\n\n'
    expect(appendBlock(before, 'Moved').startsWith(before)).toBe(true)
  })
})

describe('dragging several sidebar rows says how many beside the pointer', () => {
  it('one row says nothing — the row is the picture', () => {
    expect(carryLabel(['A.md'])).toBe(null)
    expect(carryLabel([])).toBe(null)
  })
  it('notes, folders, or a mix', () => {
    expect(carryLabel(['A.md', 'B.md', 'C.MD'])).toBe('3 notes')
    expect(carryLabel(['Physics', 'Maths'])).toBe('2 folders')
    expect(carryLabel(['A.md', 'Physics'])).toBe('2 items')
  })
})
