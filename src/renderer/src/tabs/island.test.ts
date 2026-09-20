import { describe, expect, it } from 'vitest'
import type { EntryMeta } from '../../../shared/workspace'
import { inSpace, islandNotes, rankWrites, withAdded, withRemoved } from './island'

const entries = (map: Record<string, number | undefined>): Record<string, EntryMeta> => {
  const out: Record<string, EntryMeta> = {}
  for (const [path, island] of Object.entries(map)) out[path] = island === undefined ? {} : { island }
  return out
}

describe('inSpace', () => {
  it('takes everything when there are no spaces yet', () => {
    expect(inSpace('Anything.md', '')).toBe(true)
  })

  it('takes the space folder and its descendants', () => {
    expect(inSpace('Work', 'Work')).toBe(true)
    expect(inSpace('Work/Daily.md', 'Work')).toBe(true)
    expect(inSpace('Work/Q3/Plan.md', 'Work')).toBe(true)
  })

  // The bug a bare startsWith would ship: two spaces whose names share a prefix
  // would pool their islands together.
  it('does not let one space swallow a similarly named one', () => {
    expect(inSpace('Workshop/Jig.md', 'Work')).toBe(false)
    expect(inSpace('Working.md', 'Work')).toBe(false)
  })
})

describe('islandNotes', () => {
  it('returns only this space, in rank order', () => {
    const ws = entries({
      'Work/B.md': 1,
      'Work/A.md': 0,
      'Work/Plain.md': undefined,
      'Home/Z.md': 0
    })
    expect(islandNotes(ws, 'Work')).toEqual(['Work/A.md', 'Work/B.md'])
    expect(islandNotes(ws, 'Home')).toEqual(['Home/Z.md'])
  })

  it('breaks a tied rank on path, so the order never flickers', () => {
    const ws = entries({ 'Work/B.md': 2, 'Work/A.md': 2 })
    expect(islandNotes(ws, 'Work')).toEqual(['Work/A.md', 'Work/B.md'])
  })

  it('hides a chip whose file is gone, without forgetting its place', () => {
    const ws = entries({ 'Work/A.md': 0, 'Work/Gone.md': 1, 'Work/C.md': 2 })
    const live = new Set(['Work/A.md', 'Work/C.md'])
    expect(islandNotes(ws, 'Work', live)).toEqual(['Work/A.md', 'Work/C.md'])
    // the rank survives in the entry, so the file reappearing restores it
    expect(ws['Work/Gone.md'].island).toBe(1)
  })

  it('is empty for a space nothing has been dragged into', () => {
    expect(islandNotes(entries({ 'Work/A.md': 0 }), 'Home')).toEqual([])
  })
})

describe('withAdded', () => {
  it('appends at the end when there is no anchor', () => {
    expect(withAdded(['a'], ['b'], null)).toEqual(['a', 'b'])
  })

  it('inserts in front of the anchor', () => {
    expect(withAdded(['a', 'b'], ['c'], 'b')).toEqual(['a', 'c', 'b'])
  })

  it('moves rather than duplicating one already in the island', () => {
    expect(withAdded(['a', 'b', 'c'], ['c'], 'a')).toEqual(['c', 'a', 'b'])
    expect(withAdded(['a', 'b'], ['a'], null)).toEqual(['b', 'a'])
  })

  it('carries a whole multi-select in, keeping its order and dropping repeats', () => {
    expect(withAdded(['a'], ['b', 'c', 'b'], null)).toEqual(['a', 'b', 'c'])
  })

  // Dropping a chip on its own leading edge: the anchor is the thing that moved.
  it('lands at the end when the anchor is itself moving', () => {
    expect(withAdded(['a', 'b'], ['b'], 'b')).toEqual(['a', 'b'])
  })

  it('ignores an empty drop', () => {
    expect(withAdded(['a'], [], null)).toEqual(['a'])
    expect(withAdded(['a'], [''], null)).toEqual(['a'])
  })
})

describe('withRemoved', () => {
  it('drops just that one', () => {
    expect(withRemoved(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(withRemoved(['a'], 'nope')).toEqual(['a'])
  })
})

describe('rankWrites', () => {
  it('numbers a fresh island from zero', () => {
    expect(rankWrites([], ['a', 'b'])).toEqual([
      { path: 'a', island: 0 },
      { path: 'b', island: 1 }
    ])
  })

  it('clears the rank of anything that left', () => {
    expect(rankWrites(['a', 'b'], ['a'])).toEqual([{ path: 'b', island: undefined }])
  })

  it('writes only what actually moved', () => {
    // 'c' arrives at the end; a and b keep positions 0 and 1 and are not rewritten.
    expect(rankWrites(['a', 'b'], ['a', 'b', 'c'])).toEqual([{ path: 'c', island: 2 }])
  })

  it('rewrites the run a reorder disturbs, and nothing past it', () => {
    expect(rankWrites(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'])).toEqual([
      { path: 'b', island: 0 },
      { path: 'a', island: 1 }
    ])
  })

  it('has nothing to say about an unchanged island', () => {
    expect(rankWrites(['a', 'b'], ['a', 'b'])).toEqual([])
  })
})
