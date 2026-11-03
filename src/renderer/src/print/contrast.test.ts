import { describe, expect, it } from 'vitest'
import { contrast, highlightOnPaper, parseColour, textOnPaper } from './contrast'

const ratio = (c: string): number => contrast(parseColour(c)!.rgb, [255, 255, 255])

describe('parseColour', () => {
  it('reads what getComputedStyle hands back, and hex', () => {
    expect(parseColour('rgb(26, 26, 25)')).toEqual({ rgb: [26, 26, 25], a: 1 })
    expect(parseColour('rgba(10, 20, 30, 0.5)')).toEqual({ rgb: [10, 20, 30], a: 0.5 })
    expect(parseColour('rgb(10 20 30 / 50%)')).toEqual({ rgb: [10, 20, 30], a: 0.5 })
    expect(parseColour('#ffcc00')).toEqual({ rgb: [255, 204, 0], a: 1 })
    expect(parseColour('transparent')).toBeNull()
  })
})

describe('textOnPaper', () => {
  it('leaves dark text exactly as it was', () => {
    expect(textOnPaper('rgb(26, 26, 25)')).toBe('rgb(26, 26, 25)')
  })
  it("darkens a dark theme's cream text and gold heading until they read, keeping the hue", () => {
    // what a dark space with a gold accent hands back (the blank page, 2026-11-03)
    for (const c of ['rgb(245, 236, 214)', 'rgb(232, 196, 110)', 'rgb(250, 250, 250)']) {
      const out = textOnPaper(c)
      expect(ratio(out)).toBeGreaterThanOrEqual(4.5)
      const [r, g, b] = parseColour(out)!.rgb
      if (c.includes('196')) expect(r).toBeGreaterThan(b) // still a gold, not grey
      void g
    }
  })
  it('a stricter line for body text', () => {
    expect(ratio(textOnPaper('rgb(120, 120, 120)', 7))).toBeGreaterThanOrEqual(7)
  })
  it('passes through what it cannot read', () => {
    expect(textOnPaper('inherit')).toBe('inherit')
  })
})

describe('highlightOnPaper', () => {
  it('keeps light highlights, lightens dark-theme ones, leaves clear alone', () => {
    expect(highlightOnPaper('rgb(255, 243, 163)')).toBe('rgb(255, 243, 163)')
    const out = highlightOnPaper('rgb(110, 84, 30)') // a dark theme's amber highlight
    expect(contrast(parseColour(out)!.rgb, [26, 26, 25])).toBeGreaterThanOrEqual(7)
    expect(highlightOnPaper('rgba(0, 0, 0, 0)')).toBe('rgba(0, 0, 0, 0)')
  })
})
