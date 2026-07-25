import { describe, expect, it } from 'vitest'
import { isSelfOrDescendant, normalizeWorkspace, remapPath } from './workspace'

// workspace.json is a sidecar the user can edit, sync, or corrupt. The contract
// is that it NEVER stops the vault opening (rule 1: files are the source of
// truth, the sidecar is losable), so every test here feeds it something broken.

describe('normalizeWorkspace', () => {
  it('never throws on junk', () => {
    for (const junk of [null, undefined, 0, '', 'nope', [], true, NaN]) {
      expect(() => normalizeWorkspace(junk)).not.toThrow()
      expect(normalizeWorkspace(junk)).toEqual({ entries: {}, trash: [] })
    }
  })

  it('keeps valid entry fields and drops invalid ones', () => {
    const ws = normalizeWorkspace({
      entries: {
        'a.md': { order: 2, pinned: true, archived: false, archivedAt: 1700, collapsed: true },
        'b.md': { order: 'first', pinned: 'yes', archived: null }
      }
    })
    expect(ws.entries['a.md']).toEqual({
      order: 2,
      pinned: true,
      archived: false,
      archivedAt: 1700,
      collapsed: true
    })
    // b.md survives as an entry, but every bad field is dropped rather than coerced
    expect(ws.entries['b.md']).toEqual({})
  })

  it('drops non-finite numbers rather than storing NaN/Infinity', () => {
    const ws = normalizeWorkspace({ entries: { 'a.md': { order: NaN, archivedAt: Infinity } } })
    expect(ws.entries['a.md']).toEqual({})
  })

  it('drops trash items that could not be restored', () => {
    const ws = normalizeWorkspace({
      trash: [
        { id: 'x1', from: 'notes/a.md', deletedAt: 5, type: 'file' },
        { from: 'notes/b.md', deletedAt: 5 }, // no id -> file can't be found
        { id: 'x3', deletedAt: 5 }, // no `from` -> nowhere to put it back
        { id: 'x4', from: 'notes/d.md' }, // no timestamp
        'not an object'
      ]
    })
    expect(ws.trash.map((t) => t.id)).toEqual(['x1'])
  })

  it('infers a missing display name from the path', () => {
    const ws = normalizeWorkspace({ trash: [{ id: 'x', from: 'a/b/c.md', deletedAt: 1 }] })
    expect(ws.trash[0].name).toBe('c.md')
  })

  it('defaults an unknown trash type to file', () => {
    const ws = normalizeWorkspace({ trash: [{ id: 'x', from: 'a.md', deletedAt: 1, type: 'wat' }] })
    expect(ws.trash[0].type).toBe('file')
  })
})

describe('isSelfOrDescendant', () => {
  it('matches on whole segments, not string prefixes', () => {
    expect(isSelfOrDescendant('notes/a.md', 'notes')).toBe(true)
    expect(isSelfOrDescendant('notes', 'notes')).toBe(true)
    // the bug this exists to prevent: a startsWith() check would say true here
    expect(isSelfOrDescendant('notesX/a.md', 'notes')).toBe(false)
    expect(isSelfOrDescendant('notes-old/a.md', 'notes')).toBe(false)
  })

  it('treats the vault root as containing everything', () => {
    expect(isSelfOrDescendant('anything/at/all.md', '')).toBe(true)
  })
})

describe('remapPath', () => {
  it('re-keys the moved entry itself', () => {
    expect(remapPath('a.md', 'a.md', 'b.md')).toBe('b.md')
  })

  it('re-keys descendants', () => {
    expect(remapPath('old/deep/x.md', 'old', 'new')).toBe('new/deep/x.md')
  })

  it('leaves unrelated paths alone, including prefix look-alikes', () => {
    expect(remapPath('older/x.md', 'old', 'new')).toBe('older/x.md')
    expect(remapPath('other.md', 'old', 'new')).toBe('other.md')
  })
})
