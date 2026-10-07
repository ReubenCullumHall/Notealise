import { describe, expect, it } from 'vitest'
import { AREAS, GUIDES } from './guides'

// The tutorials list is plain data (guides.ts) so Settings search and the list
// itself read the same thing. What this pins is the part the type checker can't:
// that the list reads sensibly.
describe('tutorial guides', () => {
  it('has one row per id and per title', () => {
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length)
    expect(new Set(GUIDES.map((g) => g.title)).size).toBe(GUIDES.length)
  })

  // The list draws one heading per area; a guide in an area that isn't listed
  // would vanish from it, and from nothing else.
  it('puts every guide in a listed area, and every area has a guide', () => {
    const areas = new Set(AREAS.map((a) => a.id))
    for (const g of GUIDES) expect(areas).toContain(g.area)
    for (const a of AREAS) expect(GUIDES.some((g) => g.area === a.id)).toBe(true)
  })

  it('gives every guide the words that make "tutorial" and "guide" find it', () => {
    for (const g of GUIDES) expect(g.words.split(' ')).toEqual(expect.arrayContaining(['tutorial', 'guide']))
  })
})
