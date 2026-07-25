import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import {
  DEFAULT_UPDATE_PREFS,
  defaultBetaChannel,
  isPrereleaseVersion,
  normalizeUpdatePrefs,
  shouldFollowBeta
} from './update'

// Both of these read files a user can hand-edit or a sync client can half-write.
// The contract is the same in each case: never throw, fall back to the default.

describe('normalizeSettings', () => {
  it('never throws, and defaults on junk', () => {
    for (const junk of [null, undefined, 0, '', 'nope', [], true, NaN]) {
      expect(() => normalizeSettings(junk)).not.toThrow()
      expect(normalizeSettings(junk)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('keeps valid values', () => {
    expect(normalizeSettings({ theme: 'light', density: 'ultra', accentMode: 'tint' })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      density: 'ultra',
      accentMode: 'tint'
    })
  })

  it('rejects out-of-range values field by field', () => {
    // one bad field must not discard the good ones alongside it
    const s = normalizeSettings({ theme: 'neon', density: 'ultra' })
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(s.density).toBe('ultra')
  })

  it('accepts any non-empty accent string but not an empty one', () => {
    expect(normalizeSettings({ accent: 'ocean' }).accent).toBe('ocean')
    expect(normalizeSettings({ accent: '' }).accent).toBe(DEFAULT_SETTINGS.accent)
    expect(normalizeSettings({ accent: 42 }).accent).toBe(DEFAULT_SETTINGS.accent)
  })
})

describe('normalizeUpdatePrefs', () => {
  it('defaults to auto-update on', () => {
    expect(DEFAULT_UPDATE_PREFS.autoUpdate).toBe(true)
    for (const junk of [null, undefined, 0, 'nope', [], NaN]) {
      expect(normalizeUpdatePrefs(junk)).toEqual(DEFAULT_UPDATE_PREFS)
    }
  })

  it('honours an explicit false', () => {
    // the one value that must survive a round trip, or turning updates off
    // silently turns itself back on
    expect(normalizeUpdatePrefs({ autoUpdate: false }).autoUpdate).toBe(false)
  })

  it('ignores a non-boolean rather than coercing it', () => {
    expect(normalizeUpdatePrefs({ autoUpdate: 'false' }).autoUpdate).toBe(true)
    expect(normalizeUpdatePrefs({ autoUpdate: 0 }).autoUpdate).toBe(true)
  })

  it('keeps the beta channel OFF by default', () => {
    // the important direction: an ordinary user must never be silently opted
    // into test builds by a missing or malformed field
    expect(DEFAULT_UPDATE_PREFS.betaChannel).toBe(false)
    expect(normalizeUpdatePrefs({}).betaChannel).toBe(false)
    expect(normalizeUpdatePrefs({ betaChannel: 'true' }).betaChannel).toBe(false)
    expect(normalizeUpdatePrefs({ betaChannel: 1 }).betaChannel).toBe(false)
  })

  it('carries both fields independently', () => {
    // each setter read-modify-writes the pair; this is the shape it relies on
    expect(normalizeUpdatePrefs({ autoUpdate: false, betaChannel: true })).toEqual({
      autoUpdate: false,
      betaChannel: true
    })
  })
})

describe('isPrereleaseVersion', () => {
  it('recognises the beta tag scheme we release under', () => {
    expect(isPrereleaseVersion('0.2.0-beta.1')).toBe(true)
    expect(isPrereleaseVersion('1.0.0-rc.2')).toBe(true)
  })

  it('treats a plain version as stable', () => {
    expect(isPrereleaseVersion('0.1.4')).toBe(false)
    expect(isPrereleaseVersion('1.0.0')).toBe(false)
  })
})

// This is the rule that decides who receives unfinished software, so it gets
// tested from both directions rather than trusted.
describe('shouldFollowBeta', () => {
  it('REFUSES beta on a stable build even when the preference says yes', () => {
    // the case that matters: someone downloads the app and hand-edits
    // `"betaChannel": true` into config.json, or replays the IPC call. A stable
    // build must still never receive a test build.
    expect(shouldFollowBeta(true, '0.2.0')).toBe(false)
    expect(shouldFollowBeta(true, '1.0.0')).toBe(false)
  })

  it('follows beta on a build that is itself a prerelease', () => {
    expect(shouldFollowBeta(true, '0.2.0-beta.1')).toBe(true)
  })

  it('lets a tester opt back out, so nobody is stranded on a beta', () => {
    expect(shouldFollowBeta(false, '0.2.0-beta.1')).toBe(false)
  })

  it('leaves an ordinary stable install alone', () => {
    expect(shouldFollowBeta(false, '0.2.0')).toBe(false)
  })
})

describe('defaultBetaChannel', () => {
  it('keeps a fresh beta install on beta when config.json has no key', () => {
    // with a flat `false` default this build read as stable and immediately
    // downgraded itself off the channel it was installed for
    expect(defaultBetaChannel('0.2.0-beta.1')).toBe(true)
  })

  it('keeps a fresh stable install on stable', () => {
    expect(defaultBetaChannel('0.2.0')).toBe(false)
  })
})
