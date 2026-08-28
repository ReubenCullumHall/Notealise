import { describe, expect, it } from 'vitest'
import { normalizeBundle, TRANSFER_FILE_KIND } from './transfer'

// normalizeBundle is the trust boundary: everything read back from a transfer
// file goes through it before main touches disk. These pin the two things that
// matter — it never throws on junk, and it tells "wrong file" (null) apart from
// "right file, nothing in it" (an empty bundle, which import reports honestly).

const wellFormed = {
  kind: TRANSFER_FILE_KIND,
  version: 1,
  exportedAt: 1_700_000_000_000,
  appVersion: '0.10.2',
  presets: [{ name: 'Revision', look: { theme: 'dark', density: 'compact' } }],
  customFonts: [
    { displayName: 'My Face', originalName: 'my-face.woff2', ext: 'woff2', data: 'AAAA', addedAt: 1 }
  ],
  downloadedFontIds: ['ibm-plex-mono', 'ibm-plex-mono', ' spaced '],
  updatePrefs: { autoUpdate: true }
}

describe('normalizeBundle', () => {
  it('accepts a well-formed bundle and keeps its parts', () => {
    const b = normalizeBundle(wellFormed)
    expect(b).not.toBeNull()
    expect(b!.presets).toHaveLength(1)
    expect(b!.presets[0].name).toBe('Revision')
    expect(b!.customFonts).toHaveLength(1)
    expect(b!.customFonts[0].ext).toBe('woff2')
    expect(b!.updatePrefs).toEqual({ autoUpdate: true })
  })

  it('de-dupes and trims downloaded-font ids', () => {
    const b = normalizeBundle(wellFormed)!
    expect(b.downloadedFontIds).toEqual(['ibm-plex-mono', 'spaced'])
  })

  it('returns null for things that are not a bundle at all', () => {
    expect(normalizeBundle(null)).toBeNull()
    expect(normalizeBundle(42)).toBeNull()
    expect(normalizeBundle('a string')).toBeNull()
    expect(normalizeBundle([])).toBeNull()
    expect(normalizeBundle({ kind: TRANSFER_FILE_KIND, version: 1 })).toBeNull()
    expect(normalizeBundle({ hello: 'world' })).toBeNull()
  })

  it('treats a bare .mdpreset file as a presets-only bundle', () => {
    const presetFile = {
      kind: 'notes-space-preset',
      version: 1,
      presets: [{ name: 'Journal', look: { theme: 'light' } }]
    }
    const b = normalizeBundle(presetFile)
    expect(b).not.toBeNull()
    expect(b!.presets).toHaveLength(1)
    expect(b!.customFonts).toHaveLength(0)
    // no update setting in the file — import must not offer to "apply" one
    expect(b!.updatePrefs).toBeNull()
  })

  it('drops malformed custom fonts without dropping the whole bundle', () => {
    const b = normalizeBundle({
      updatePrefs: {},
      customFonts: [
        { displayName: 'Good', originalName: 'g.ttf', ext: 'ttf', data: 'QQ', addedAt: 1 },
        { displayName: 'No data', originalName: 'x.ttf', ext: 'ttf', data: '', addedAt: 1 },
        { displayName: 'Bad ext', originalName: 'y.exe', ext: 'exe', data: 'QQ', addedAt: 1 },
        'not even an object'
      ]
    })
    expect(b).not.toBeNull()
    expect(b!.customFonts.map((f) => f.displayName)).toEqual(['Good'])
  })

  it('does not throw on deeply wrong shapes', () => {
    expect(() =>
      normalizeBundle({ presets: 'nope', customFonts: 5, downloadedFontIds: {}, updatePrefs: [] })
    ).not.toThrow()
  })

  it('keeps a bundle that only carries update prefs, ignoring a stale betaChannel key', () => {
    const b = normalizeBundle({ updatePrefs: { autoUpdate: false, betaChannel: true } })
    expect(b).not.toBeNull()
    expect(b!.updatePrefs).toEqual({ autoUpdate: false })
    expect(b!.presets).toHaveLength(0)
  })
})
