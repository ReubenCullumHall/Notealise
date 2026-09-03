import { describe, expect, it } from 'vitest'
import {
  COLLECTION_CAP,
  normalizePageLookLibrary,
  normalizeTintLibrary,
  PAGE_LOOKS,
  parseTint,
  TINT_MAX,
  tintName,
  tintToken
} from './looks'

// Same contract as the rest of shared/: these read a hand-editable
// settings.json, so they never throw and junk becomes "no tint" / "nothing
// collected" rather than something nobody chose.

describe('tint tokens', () => {
  it('round-trips a colour and an opacity', () => {
    const token = tintToken('#FBF0D9', 16)
    expect(token).toBe('#fbf0d9@16')
    expect(parseTint(token)).toEqual({ hex: '#fbf0d9', opacity: 16 })
  })

  it('clamps the opacity into the offered range rather than storing it', () => {
    expect(parseTint(tintToken('#123456', 900))).toEqual({ hex: '#123456', opacity: TINT_MAX })
    expect(parseTint(tintToken('#123456', -4))).toEqual({ hex: '#123456', opacity: 1 })
  })

  it('expands a short hex, so #abc and #aabbcc are one tint', () => {
    expect(tintToken('#abc', 10)).toBe(tintToken('#aabbcc', 10))
  })

  it('returns null for anything that is not a tint', () => {
    for (const junk of ['', 'lined', '#fff', '#fff@', '#fff@abc', 'x@10', null, 7, {}, '#gggggg@10']) {
      expect(parseTint(junk)).toBeNull()
    }
  })

  it('rejects an opacity outside the range, rather than repairing it', () => {
    // A stored token is not a slider position: `#fff@90` was written by
    // something that isn't this build, and guessing what it meant would paint
    // a page a colour nobody picked.
    expect(parseTint('#ffffff@90')).toBeNull()
    expect(parseTint('#ffffff@0')).toBeNull()
  })

  it('shows the colour as the name — there is nothing else to show', () => {
    // Deliberately no shipped tints to name (shared/looks.ts explains why),
    // so a tint's identity IS its hex.
    expect(tintName('#123456@10')).toBe('#123456')
    expect(tintName('rubbish')).toBe('Tint')
  })
})

describe('the collection', () => {
  it('keeps only ids this build can draw, once each', () => {
    expect(normalizePageLookLibrary(['dots', 'dots', 'nope', 42, 'graph'])).toEqual(['dots', 'graph'])
  })

  it('never stores a look that is already in the collection', () => {
    const bundled = PAGE_LOOKS.find((l) => l.source === 'bundled')!
    expect(normalizePageLookLibrary([bundled.id])).toEqual([])
  })

  it('normalises tints so one colour cannot sit in the collection twice', () => {
    expect(normalizeTintLibrary(['#ABCDEF@12', '#abcdef@12'])).toEqual(['#abcdef@12'])
  })

  it('keeps every valid tint — none of them is ours to exclude', () => {
    expect(normalizeTintLibrary(['#fbf0d9@16', '#010203@5'])).toEqual(['#fbf0d9@16', '#010203@5'])
  })

  it('never throws, and caps a corrupted file', () => {
    for (const junk of [null, undefined, 0, 'x', {}, [null, [], {}]]) {
      expect(normalizePageLookLibrary(junk)).toEqual([])
      expect(normalizeTintLibrary(junk)).toEqual([])
    }
    const many = Array.from({ length: COLLECTION_CAP + 40 }, (_, i) => `#${i.toString(16).padStart(6, '0')}@10`)
    expect(normalizeTintLibrary(many)).toHaveLength(COLLECTION_CAP)
  })
})
