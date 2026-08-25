import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  isNewerVersion,
  pickRelease,
  shouldFollowBeta,
  defaultBetaChannel,
  normalizeUpdatePrefs,
  parseFeed,
  isAllowedReleaseUrl,
  type FeedRelease
} from './update'
// A REAL payload, captured from the live releases API on 2026-08-25. Kept because
// the shape of GitHub's response is the thing most likely to change under us
// without anyone noticing — a hand-written fixture only ever proves the parser
// agrees with whoever wrote the fixture.
import realFeed from './releases.fixture.json'

// These decide whether a Mac user is told to download something. Getting the
// prerelease rule backwards would offer every stable install a downgrade, and
// getting the asset check wrong would point someone at a release with no .dmg
// in it — so both are asserted in the direction that would actually hurt, not
// just the happy one.

const rel = (version: string, prerelease = false, dmg = true): FeedRelease => ({
  version,
  prerelease,
  dmgUrl: dmg ? `https://github.com/x/y/releases/download/v${version}/Notealise.dmg` : null
})

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1)
    expect(compareVersions('0.9.1', '0.9.0')).toBe(1)
    expect(compareVersions('0.9.0', '0.9.0')).toBe(0)
  })

  it('treats a leading v and surrounding space as noise', () => {
    expect(compareVersions('v0.9.0', '0.9.0')).toBe(0)
    expect(compareVersions(' 0.9.0 ', 'v0.9.0')).toBe(0)
  })

  it('sorts a prerelease BEFORE its own release — the rule that stops a downgrade', () => {
    // If this ever returns 1, every stable user gets offered a beta as an
    // "upgrade" and electron-updater's allowDowngrade is not there to save us.
    expect(compareVersions('0.9.0-beta.1', '0.9.0')).toBe(-1)
    expect(compareVersions('0.9.0', '0.9.0-beta.1')).toBe(1)
  })

  it('compares numeric prerelease parts numerically, not as strings', () => {
    // 'beta.10' < 'beta.9' under a string compare, which would strand a tester
    // on beta.9 for every release after the ninth.
    expect(compareVersions('0.9.0-beta.10', '0.9.0-beta.9')).toBe(1)
    expect(compareVersions('0.9.0-beta.2', '0.9.0-beta.10')).toBe(-1)
  })

  it('sorts a numeric prerelease part before an alphabetic one', () => {
    expect(compareVersions('0.9.0-1', '0.9.0-alpha')).toBe(-1)
  })

  it('treats more prerelease parts as newer than fewer', () => {
    expect(compareVersions('0.9.0-beta.1.1', '0.9.0-beta.1')).toBe(1)
  })

  it('sorts an unparseable version oldest rather than throwing', () => {
    // A hand-made tag, or a release created by something other than CI. It must
    // not be offered, and it must not take the check down with it.
    expect(() => compareVersions('not-a-version', '0.9.0')).not.toThrow()
    expect(isNewerVersion('not-a-version', '0.9.0')).toBe(false)
  })
})

describe('pickRelease', () => {
  const current = '0.9.0'

  it('returns null when nothing on the feed is newer', () => {
    expect(pickRelease([rel('0.9.0'), rel('0.8.0')], current, false)).toBeNull()
  })

  it('returns the newest usable release, not merely the first', () => {
    // GitHub returns newest-first, but that is its ordering, not a guarantee we
    // should build on — so the feed is deliberately handed over out of order.
    const got = pickRelease([rel('0.9.1'), rel('0.10.0'), rel('0.9.5')], current, false)
    expect(got?.version).toBe('0.10.0')
  })

  it('skips a release with no .dmg asset', () => {
    // A Windows-only release, or one whose mac job failed. Offering it would
    // send someone to a download that does not exist.
    const got = pickRelease([rel('0.9.1', false, false), rel('0.9.0')], current, false)
    expect(got).toBeNull()
  })

  it('ignores prereleases unless they are allowed', () => {
    const feed = [rel('1.0.0-beta.1', true), rel('0.9.1')]
    expect(pickRelease(feed, current, false)?.version).toBe('0.9.1')
    expect(pickRelease(feed, current, true)?.version).toBe('1.0.0-beta.1')
  })

  it('does not offer a stable user the beta of the version they already run', () => {
    expect(pickRelease([rel('0.9.0-beta.2', true)], current, true)).toBeNull()
  })

  it('handles an empty feed', () => {
    expect(pickRelease([], current, false)).toBeNull()
  })
})

describe('the beta rules these lean on', () => {
  it('only honours beta on a build that is itself a prerelease', () => {
    expect(shouldFollowBeta(true, '0.9.0')).toBe(false)
    expect(shouldFollowBeta(true, '0.9.0-beta.1')).toBe(true)
    expect(shouldFollowBeta(false, '0.9.0-beta.1')).toBe(false)
  })

  it('defaults the channel to the build type when config.json is silent', () => {
    expect(defaultBetaChannel('0.9.0')).toBe(false)
    expect(defaultBetaChannel('0.9.0-beta.1')).toBe(true)
  })

  it('normalises junk prefs without throwing', () => {
    expect(normalizeUpdatePrefs(null)).toEqual({ autoUpdate: true, betaChannel: false })
    expect(normalizeUpdatePrefs({ autoUpdate: 'yes' })).toEqual({
      autoUpdate: true,
      betaChannel: false
    })
  })
})

describe('parseFeed, against a real GitHub payload', () => {
  const feed = parseFeed(realFeed)

  it('reads every release, and strips the leading v from the tag', () => {
    expect(feed.length).toBe(realFeed.length)
    expect(feed[0].version).toBe('0.8.0')
    expect(feed.every((r) => !r.version.startsWith('v'))).toBe(true)
  })

  it('finds the .dmg and ignores the Windows and metadata assets', () => {
    // The v0.8.0 release carries latest.yml, the .exe, its .blockmap and the
    // .dmg. Picking any of the first three would hand a Mac user a file they
    // cannot open.
    expect(feed[0].dmgUrl).toBe(
      'https://github.com/ReubenCullumHall/Notes-app/releases/download/v0.8.0/Notealise.dmg'
    )
  })

  it('offers 0.8.0 to someone on 0.7.1, and nothing to someone on 0.9.0', () => {
    expect(pickRelease(feed, '0.7.1', false)?.version).toBe('0.8.0')
    expect(pickRelease(feed, '0.9.0', false)).toBeNull()
  })

  it('accepts the real asset host and refuses anything else', () => {
    expect(isAllowedReleaseUrl(feed[0].dmgUrl as string)).toBe(true)
    expect(isAllowedReleaseUrl('http://github.com/x/y.dmg')).toBe(false) // not https
    expect(isAllowedReleaseUrl('https://evil.example.com/y.dmg')).toBe(false)
    expect(isAllowedReleaseUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedReleaseUrl('not a url at all')).toBe(false)
  })

  it('drops a draft release, which only the repo owner can see', () => {
    const withDraft = [{ ...realFeed[0], tag_name: 'v9.9.9', draft: true }, ...realFeed]
    expect(pickRelease(parseFeed(withDraft), '0.8.0', false)).toBeNull()
  })

  it('survives junk in the feed without throwing', () => {
    expect(parseFeed(null)).toEqual([])
    expect(parseFeed({ message: 'Not Found' })).toEqual([])
    expect(parseFeed([null, 42, {}, { tag_name: 'v1.0.0' }])).toHaveLength(1)
  })
})
