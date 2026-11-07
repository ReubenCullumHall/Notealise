import { describe, expect, it } from 'vitest'
import { untitledName, untitledNumber, voiceUntitledNumbers } from './untitled'

describe('Untitled N', () => {
  it('reads the number out of a note, folder or voice-note name', () => {
    expect(untitledNumber('Untitled 17')).toBe(17)
    expect(untitledNumber('Untitled 17.md')).toBe(17)
    expect(untitledNumber('untitled 3')).toBe(3)
    expect(untitledName(18)).toBe('Untitled 18')
  })

  it('leaves the older names alone — "Untitled" and "Untitled (2)" are not in the count (Reuben, 2026-11-07)', () => {
    expect(untitledNumber('Untitled')).toBeNull()
    expect(untitledNumber('Untitled (2)')).toBeNull()
    expect(untitledNumber('Untitled 0')).toBeNull()
    expect(untitledNumber('Untitled 4 notes')).toBeNull()
    expect(untitledNumber('My Untitled 4')).toBeNull()
  })

  it('finds the voice notes named Untitled N in a note, both forms', () => {
    const text = [
      '<audio controls src="a.m4a" data-name="Untitled 5"></audio>',
      "<audio controls src='b.m4a' data-name='Untitled 12'></audio>",
      '![Untitled 9](c.m4a)',
      '<audio controls src="d.m4a" data-name="Lecture 3"></audio>',
      'I wrote Untitled 99 in a sentence.'
    ].join('\n')
    expect(voiceUntitledNumbers(text)).toEqual([5, 12, 9])
  })
})
