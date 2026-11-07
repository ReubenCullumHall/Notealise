// Markdown pro is ONE switch for the whole app since 2026-11-07 (Settings → Extra features).
// A settings file written before has it per space; nobody who used it may lose it.
import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './settings'

describe('Markdown pro, app-wide (migration from per-space)', () => {
  it('on if ANY space had it on; the marks look comes from that space', () => {
    const s = normalizeSettings({
      spaces: [
        { folder: 'Journal', markdownPro: false },
        { folder: 'Revision', markdownPro: true, rawMarkStyle: 'colour', rawMarkTint: 'hl-amber' }
      ]
    })
    expect(s.markdownPro).toBe(true)
    expect(s.rawMarkStyle).toBe('colour')
    expect(s.rawMarkTint).toBe('hl-amber')
    expect('markdownPro' in s.spaces[0]).toBe(false)
  })
  it('off when no space had it; defaults for the marks', () => {
    const s = normalizeSettings({ spaces: [{ folder: 'A' }, { folder: 'B', markdownPro: false }] })
    expect(s.markdownPro).toBe(false)
    expect(s.rawMarkStyle).toBe('faded')
    expect(s.rawMarkTint).toBe('tc-violet')
  })
  it('once written app-wide, that wins over anything left in a space', () => {
    const s = normalizeSettings({
      markdownPro: false,
      rawMarkStyle: 'faded',
      spaces: [{ folder: 'A', markdownPro: true, rawMarkStyle: 'colour' }]
    })
    expect(s.markdownPro).toBe(false)
    expect(s.rawMarkStyle).toBe('faded')
  })
  it('junk is the default, never a throw', () => {
    const s = normalizeSettings({ markdownPro: 'yes', rawMarkStyle: 'neon', rawMarkTint: 'tc-nope' })
    expect(s.markdownPro).toBe(false)
    expect(s.rawMarkStyle).toBe('faded')
    expect(s.rawMarkTint).toBe('tc-violet')
  })
})
