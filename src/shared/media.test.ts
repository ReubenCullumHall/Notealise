import { describe, expect, it } from 'vitest'
import { idForPath, reconcileMedia, type MediaIndex } from './media'

// The whole point of this module is a GUESS — "these two files are the same
// one" — so the tests are mostly about when it refuses to make it.
describe('reconcileMedia', () => {
  let n = 0
  const mint = (): string => `id${++n}`
  const fresh = (): (() => string) => {
    n = 0
    return mint
  }

  const index = (over: MediaIndex = {}): MediaIndex => ({
    a: { path: 'School/photo.png', size: 100, added: 1 },
    ...over
  })

  it('mints an id for a file it has not seen', () => {
    const out = reconcileMedia({}, [{ path: 'School/new.png', size: 10 }], 5, fresh())
    expect(out.moved).toEqual([])
    expect(out.index).toEqual({ id1: { path: 'School/new.png', size: 10, added: 5 } })
  })

  it('leaves an unmoved file exactly as it was', () => {
    const out = reconcileMedia(index(), [{ path: 'School/photo.png', size: 100 }], 9, fresh())
    expect(out.moved).toEqual([])
    expect(out.index.a).toEqual({ path: 'School/photo.png', size: 100, added: 1 })
  })

  it('recognises a rename and keeps the id', () => {
    const out = reconcileMedia(index(), [{ path: 'School/me.png', size: 100 }], 9, fresh())
    expect(out.moved).toEqual([{ id: 'a', from: 'School/photo.png', to: 'School/me.png' }])
    expect(out.index.a.path).toBe('School/me.png')
    expect(out.index.a.added).toBe(1) // identity is preserved, not re-created
  })

  it('recognises a move into another folder', () => {
    const out = reconcileMedia(index(), [{ path: 'Archive/photo.png', size: 100 }], 9, fresh())
    expect(out.moved).toEqual([{ id: 'a', from: 'School/photo.png', to: 'Archive/photo.png' }])
  })

  // The refusals. Repointing a note at the WRONG picture is much worse than
  // leaving it broken, so anything short of decisive is left alone.
  it('refuses to guess when two files share a size and extension', () => {
    const two = index({ b: { path: 'School/other.png', size: 100, added: 2 } })
    const out = reconcileMedia(two, [{ path: 'School/x.png', size: 100 }], 9, fresh())
    expect(out.moved).toEqual([])
    // Both records kept; the new file is simply new.
    expect(out.index.a.path).toBe('School/photo.png')
    expect(out.index.b.path).toBe('School/other.png')
    expect(Object.values(out.index)).toHaveLength(3)
  })

  it('refuses when two candidates on disk match one missing record', () => {
    const out = reconcileMedia(
      index(),
      [{ path: 'School/x.png', size: 100 }, { path: 'School/y.png', size: 100 }],
      9,
      fresh()
    )
    expect(out.moved).toEqual([])
    expect(out.index.a.path).toBe('School/photo.png')
  })

  it('will not match across kinds, however the sizes line up', () => {
    const out = reconcileMedia(index(), [{ path: 'School/photo.mp4', size: 100 }], 9, fresh())
    expect(out.moved).toEqual([])
  })

  it('will not match on a different size', () => {
    const out = reconcileMedia(index(), [{ path: 'School/me.png', size: 101 }], 9, fresh())
    expect(out.moved).toEqual([])
  })

  // A binned photo is missing from the vault but is coming back. Forgetting it
  // would mean it returned as a stranger with a new id.
  it('keeps a record whose file is gone entirely', () => {
    const out = reconcileMedia(index(), [], 9, fresh())
    expect(out.moved).toEqual([])
    expect(out.index.a).toEqual({ path: 'School/photo.png', size: 100, added: 1 })
  })

  it('handles a rename and a genuinely new file in the same scan', () => {
    const out = reconcileMedia(
      index(),
      [{ path: 'School/me.png', size: 100 }, { path: 'School/fresh.jpg', size: 7 }],
      9,
      fresh()
    )
    expect(out.moved).toEqual([{ id: 'a', from: 'School/photo.png', to: 'School/me.png' }])
    expect(idForPath(out.index, 'School/fresh.jpg')).toBe('id1')
  })

  it('is stable when run twice over the same vault', () => {
    const once = reconcileMedia(index(), [{ path: 'School/me.png', size: 100 }], 9, fresh())
    const twice = reconcileMedia(once.index, [{ path: 'School/me.png', size: 100 }], 20, fresh())
    expect(twice.moved).toEqual([])
    expect(twice.index).toEqual(once.index)
  })
})

describe('idForPath', () => {
  it('finds the id at a path, and nothing for an unknown one', () => {
    const i: MediaIndex = { z: { path: 'a/b.png', size: 1, added: 1 } }
    expect(idForPath(i, 'a/b.png')).toBe('z')
    expect(idForPath(i, 'a/c.png')).toBeUndefined()
  })
})
