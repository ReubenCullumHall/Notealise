import { describe, expect, it } from 'vitest'
import { AWKWARD_NAMES } from '../../shared/awkwardNames'
import { forgetChanged } from './searchCache'

const cacheOf = (...paths: string[]): Map<string, string> => new Map(paths.map((p) => [p, `text of ${p}`]))

describe('what Search notes forgets after a change outside the app', () => {
  // The fault (docs/app-check-2026-11-09.md): one note synced in from another
  // computer threw away every note's text, so the next search read them all again.
  it('forgets the note that changed and keeps every other', () => {
    const cache = cacheOf('Biology/Cells.md', 'Biology/Plants.md', 'Maths/Waves.md')
    forgetChanged(cache, ['Biology/Cells.md'])
    expect([...cache.keys()]).toEqual(['Biology/Plants.md', 'Maths/Waves.md'])
  })

  it('forgets everything inside a folder that was renamed, moved or deleted', () => {
    const cache = cacheOf('Biology/Cells.md', 'Biology/Term 3/Plants.md', 'Biology.md', 'Biology notes/Other.md', 'Maths/Waves.md')
    forgetChanged(cache, ['Biology'])
    // not the note called "Biology", and not a folder that only starts the same way
    expect([...cache.keys()]).toEqual(['Biology.md', 'Biology notes/Other.md', 'Maths/Waves.md'])
  })

  it('takes several changes at once', () => {
    const cache = cacheOf('a.md', 'b.md', 'c/d.md', 'c/e.md', 'f.md')
    forgetChanged(cache, ['b.md', 'c', 'not-cached.md'])
    expect([...cache.keys()]).toEqual(['a.md', 'f.md'])
  })

  // A missed change would leave Search showing a note's OLD words, so a path is
  // matched however it was spelled.
  it('matches a path written in other letter-case, or with the other "é"', () => {
    const cache = cacheOf('Biology/Café.md', 'biology/cells.md', 'Maths/Waves.md')
    forgetChanged(cache, ['Biology/Café.md', 'BIOLOGY/Cells.md'])
    expect([...cache.keys()]).toEqual(['Maths/Waves.md'])
  })

  it('finds a note under every awkward name, and only that one', () => {
    for (const name of AWKWARD_NAMES) {
      const cache = cacheOf(`${name}/${name}.md`, `${name}/other.md`, `other/${name}.md`)
      forgetChanged(cache, [`${name}/${name}.md`])
      expect([...cache.keys()], name).toEqual([`${name}/other.md`, `other/${name}.md`])
    }
  })

  it('forgets everything when the notes folder itself is what changed', () => {
    const cache = cacheOf('a.md', 'b/c.md')
    forgetChanged(cache, ['a.md', ''])
    expect(cache.size).toBe(0)
  })

  it('does nothing for no changes, and for an empty memory', () => {
    const cache = cacheOf('a.md')
    forgetChanged(cache, [])
    expect(cache.size).toBe(1)
    expect(() => forgetChanged(new Map(), ['a.md'])).not.toThrow()
  })
})
