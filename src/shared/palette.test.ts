import { describe, expect, it } from 'vitest'
import { colorToken, COLOR_NAMES, isColorToken, splitToken } from './palette'

// `isColorToken` guards a value that arrives from settings.json — a file the
// user (or a bad merge, or an older build) can put anything in. It is the only
// thing standing between that and a `var(--<whatever>)` reaching the DOM, so the
// rejections matter more than the acceptances here.

describe('isColorToken', () => {
  it('accepts every colour in both layers', () => {
    for (const name of COLOR_NAMES) {
      expect(isColorToken(`hl-${name}`)).toBe(true)
      expect(isColorToken(`tc-${name}`)).toBe(true)
    }
  })

  it('rejects a colour that is not in the palette', () => {
    expect(isColorToken('tc-puce')).toBe(false)
    expect(isColorToken('hl-')).toBe(false)
  })

  it('rejects an unknown layer', () => {
    expect(isColorToken('bg-amber')).toBe(false)
    expect(isColorToken('amber')).toBe(false)
  })

  it('rejects anything that could escape into a var() or a style', () => {
    expect(isColorToken('tc-amber; background: red')).toBe(false)
    expect(isColorToken('tc-amber)')).toBe(false)
    expect(isColorToken('--ink-900')).toBe(false)
  })

  it('rejects non-strings rather than throwing on them', () => {
    for (const v of [null, undefined, 7, {}, [], true]) expect(isColorToken(v)).toBe(false)
  })
})

describe('colorToken / splitToken', () => {
  it('round-trips every combination', () => {
    for (const name of COLOR_NAMES) {
      for (const layer of ['hl', 'tc'] as const) {
        const t = colorToken(layer, name)
        expect(isColorToken(t)).toBe(true)
        expect(splitToken(t)).toEqual({ layer, name })
      }
    }
  })

  it('splits on the FIRST hyphen, so a hyphenated colour name would survive', () => {
    // none has one today; this pins the behaviour so adding "sea-green" later
    // does not silently split into layer "hl" / name "sea".
    expect(splitToken('hl-sage')).toEqual({ layer: 'hl', name: 'sage' })
  })
})
