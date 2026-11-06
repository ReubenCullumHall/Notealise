import { describe, expect, it } from 'vitest'
import { editedName, editedStem, sectionName } from './names'

describe('names of saved sections and edits', () => {
  it('a section of a named voice note', () => {
    expect(sectionName('Explain it', 2)).toBe('Explain it · Section 2')
    expect(sectionName('', 2)).toBe('Section 2')
  })
  it('a section split again numbers inside it, not stacked', () => {
    expect(sectionName('Explain it · Section 1', 2)).toBe('Explain it · Section 1.2')
    expect(sectionName('Section 3', 1)).toBe('Section 3.1')
    expect(sectionName('Explain it · Section 1.2', 1)).toBe('Explain it · Section 1.2.1')
  })
  it('"(edited)" once, however many times it is edited', () => {
    expect(editedName('Explain it')).toBe('Explain it (edited)')
    expect(editedName('Explain it (edited)')).toBe('Explain it (edited)')
    expect(editedName('')).toBe('')
  })
  it('file names follow the same rules', () => {
    expect(editedStem('takes', null)).toBe('takes (edited)')
    expect(editedStem('takes (edited)', null)).toBe('takes (edited)')
    expect(editedStem('takes', 2)).toBe('takes section 2')
    expect(editedStem('takes section 1', 2)).toBe('takes section 1.2')
  })
})
