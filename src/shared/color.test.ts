import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PALETTE,
  PALETTE_MAX,
  hexToHsv,
  hsvToHex,
  inkOn,
  normalizeHex,
  normalizePalette,
  pickAutoColor,
  rgbChannels
} from './color'

describe('normalizeHex', () => {
  it('accepts the forms a person actually types', () => {
    // The hex field is free text, so all four of these reach the validator on
    // the way to a finished colour — rejecting them would make the field feel
    // broken rather than strict.
    expect(normalizeHex('#e0605e')).toBe('#e0605e')
    expect(normalizeHex('e0605e')).toBe('#e0605e')
    expect(normalizeHex('#E0605E')).toBe('#e0605e')
    expect(normalizeHex('  #e0605e  ')).toBe('#e0605e')
  })

  it('expands the 3-digit short form', () => {
    expect(normalizeHex('#f0a')).toBe('#ff00aa')
    expect(normalizeHex('fff')).toBe('#ffffff')
  })

  it('returns one canonical string per colour', () => {
    // Load-bearing, not cosmetic: the palette de-duplicates by string equality
    // and the picker marks the current swatch by `value === hex`, so #FFF and
    // #ffffff being different strings would put the same colour on the palette
    // twice and leave neither of them ticked.
    expect(normalizeHex('#FFF')).toBe(normalizeHex('#ffffff'))
  })

  it('rejects anything that is not a colour', () => {
    // These end up inside a CSS custom property, so "whatever the file said" is
    // not an acceptable answer — a rejected value falls back to no colour.
    for (const bad of ['', 'red', '#12345', '#gggggg', 'rgb(1,2,3)', null, 42, {}, ['#fff']]) {
      expect(normalizeHex(bad)).toBeNull()
    }
  })
})

describe('normalizePalette', () => {
  it('drops junk, drops duplicates, and caps the length', () => {
    expect(normalizePalette(['#fff', 'nope', '#FFFFFF', '#000'])).toEqual(['#ffffff', '#000000'])
    expect(normalizePalette(null)).toEqual([])
    const many = Array.from({ length: 40 }, (_, i) => '#' + i.toString(16).padStart(6, '0'))
    expect(normalizePalette(many)).toHaveLength(PALETTE_MAX)
  })

  it('leaves the starter palette untouched', () => {
    // If a default ever fails its own validator, every new space silently opens
    // with a shorter palette than it was given.
    expect(normalizePalette(DEFAULT_PALETTE)).toEqual(DEFAULT_PALETTE)
  })
})

describe('hsv round trip', () => {
  it('returns the colour it was given', () => {
    // The picker holds HSV while you drag and emits hex; a lossy conversion
    // would make the handle creep across the square on its own between renders.
    for (const hex of [...DEFAULT_PALETTE, '#000000', '#ffffff', '#7f7f7f']) {
      const { h, s, v } = hexToHsv(hex)
      expect(hsvToHex(h, s, v)).toBe(hex)
    }
  })

  it('holds saturation and value at every hue', () => {
    for (let h = 0; h < 360; h += 30) {
      const hex = hsvToHex(h, 60, 80)
      const back = hexToHsv(hex)
      expect(Math.abs(back.s - 60)).toBeLessThan(1)
      expect(Math.abs(back.v - 80)).toBeLessThan(1)
    }
  })
})

describe('rgbChannels', () => {
  it('emits the bare triple the CSS variables are written in', () => {
    expect(rgbChannels('#e0605e')).toBe('224 96 94')
  })
})

describe('inkOn', () => {
  it('picks ink by luminance, not by brightness average', () => {
    // The reason this is not `(r+g+b)/3`: pure green and pure blue have the same
    // average and are nowhere near as bright as each other. Black dots on green
    // and white dots on blue is the correct answer, and an average gets one of
    // them wrong whichever threshold you choose.
    expect(inkOn('#00ff00')).toBe('dark')
    expect(inkOn('#0000ff')).toBe('light')
    expect(inkOn('#ffffff')).toBe('dark')
    expect(inkOn('#000000')).toBe('light')
  })

  it('keeps the starter palette on light ink', () => {
    // The starter hues are mid-lightness on purpose; if one drifted pale enough
    // to need black dots it would look like a different control from its
    // neighbours on the same row.
    for (const hex of DEFAULT_PALETTE) expect(inkOn(hex)).toBe('light')
  })
})

describe('pickAutoColor', () => {
  const palette = ['#aaa000', '#bbb000', '#ccc000']

  it('does nothing without a palette, because there is nothing to assign', () => {
    // "Nothing" is right here rather than a made-up colour: auto-colour draws
    // from colours the user chose, and inventing one would be the app deciding
    // something it was not asked to decide. The settings page says so when the
    // palette is empty rather than leaving it a mystery.
    expect(pickAutoColor([], ['#aaa000'])).toBeNull()
  })

  it('never repeats a colour a sibling already has, while one is unused', () => {
    // The whole point of the feature: folders side by side should look
    // different. Uniform random over the palette hands out a repeat roughly one
    // time in three here, which is often enough to notice immediately.
    for (let r = 0; r < 1; r += 0.1) {
      expect(pickAutoColor(palette, ['#aaa000', '#bbb000'], () => r)).toBe('#ccc000')
    }
  })

  it('starts a fresh cycle once every colour is used equally', () => {
    // With no unused colour left it has to reuse one — the guarantee is that it
    // reuses a LEAST-used one, so the sidebar keeps cycling evenly instead of
    // piling onto whichever colour random happened to favour.
    const used = [...palette, ...palette, '#aaa000']
    for (let r = 0; r < 1; r += 0.1) {
      expect(['#bbb000', '#ccc000']).toContain(pickAutoColor(palette, used, () => r))
    }
  })

  it('ignores colours that are not on the palette', () => {
    // A sibling coloured by hand from outside the palette must not make one of
    // the palette entries look "used" and skew the next pick.
    expect(pickAutoColor(['#aaa000'], ['#123456'], () => 0)).toBe('#aaa000')
  })

  it('stays in range when rand() returns exactly 1', () => {
    // Math.random() never returns 1, but an injected source might, and an
    // off-by-one here is an `undefined` written into workspace.json.
    expect(pickAutoColor(palette, [], () => 1)).toBe('#ccc000')
  })
})
