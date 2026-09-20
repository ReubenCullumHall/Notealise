import { describe, expect, it } from 'vitest'
import { sanitizeFilename } from './filenames'

// Windows' filename rules are applied on BOTH platforms (CLAUDE.md cross-platform
// rules): a note titled "Q3: Review" created on a Mac must still open when the
// vault is copied to Windows.

const BACKSLASH = String.fromCharCode(92)
const NUL = String.fromCharCode(0)
const BELL = String.fromCharCode(7)

describe('sanitizeFilename', () => {
  it('leaves an already-safe name untouched', () => {
    expect(sanitizeFilename('Shopping list')).toEqual({ name: 'Shopping list', changed: false })
  })

  it('replaces every Windows-forbidden character', () => {
    for (const ch of ['<', '>', ':', '"', '/', BACKSLASH, '|', '?', '*']) {
      expect(sanitizeFilename(`a${ch}b`).name).toBe('a-b')
    }
  })

  it('treats a separator as a forbidden char, not a directory boundary', () => {
    // must never be able to escape its parent folder by naming a note "../x"
    expect(sanitizeFilename('../secrets').name).not.toContain('/')
    expect(sanitizeFilename(`..${BACKSLASH}secrets`).name).not.toContain(BACKSLASH)
  })

  it('strips control characters', () => {
    expect(sanitizeFilename(`a${NUL}bc`).name).toBe('abc')
    expect(sanitizeFilename(`tab${BELL}here`).name).toBe('tabhere')
    expect(sanitizeFilename('line\nbreak').name).toBe('linebreak')
  })

  it('drops trailing dots and spaces (Windows silently truncates them)', () => {
    expect(sanitizeFilename('report.').name).toBe('report')
    expect(sanitizeFilename('report   ').name).toBe('report')
    expect(sanitizeFilename('report. . .').name).toBe('report')
  })

  it('escapes reserved device names, case-insensitively and with extensions', () => {
    expect(sanitizeFilename('con').name).toBe('_con')
    expect(sanitizeFilename('CON').name).toBe('_CON')
    expect(sanitizeFilename('con.md').name).toBe('_con.md')
    expect(sanitizeFilename('COM1').name).toBe('_COM1')
    expect(sanitizeFilename('lpt9.txt').name).toBe('_lpt9.txt')
  })

  it('does not escape names that merely start with a reserved word', () => {
    expect(sanitizeFilename('console').name).toBe('console')
    expect(sanitizeFilename('conference notes').name).toBe('conference notes')
  })

  it('never returns an empty name', () => {
    expect(sanitizeFilename('').name).toBe('Untitled')
    expect(sanitizeFilename('   ').name).toBe('Untitled')
    expect(sanitizeFilename('...').name).toBe('Untitled')
    expect(sanitizeFilename(NUL + NUL).name).toBe('Untitled')
  })

  it('reports whether it changed the name, so the UI can say so', () => {
    expect(sanitizeFilename('fine').changed).toBe(false)
    expect(sanitizeFilename('Q3: Review').changed).toBe(true)
    expect(sanitizeFilename('Q3: Review').name).toBe('Q3- Review')
  })
})
