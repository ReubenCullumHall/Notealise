import { describe, expect, it } from 'vitest'
import {
  activeSpace,
  DEFAULT_SETTINGS,
  DEFAULT_SPACE,
  normalizeSettings,
  normalizeThemeCache,
  reconcileSpaces,
  settingsFromThemeCache,
  SPACE_CAP,
  withNewSpace,
  withoutSpace,
  withSpacePatch,
  withSpaceRenamed,
  type AppSettings
} from './settings'
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
    const junk = [null, undefined, 0, '', 'nope', [], true, NaN, { spaces: 'x' }, { spaces: [null, 7, [], 'a'] }]
    for (const j of junk) {
      expect(() => normalizeSettings(j)).not.toThrow()
      expect(normalizeSettings(j)).toEqual({ ...DEFAULT_SETTINGS, spaces: [DEFAULT_SPACE] })
    }
  })

  it('rejects out-of-range values field by field', () => {
    // one bad field must not discard the good ones alongside it
    const s = activeSpace(normalizeSettings({ theme: 'neon', density: 'ultra' }))
    expect(s.theme).toBe(DEFAULT_SPACE.theme)
    expect(s.density).toBe('ultra')
  })

  it('accepts every theme it offers, including extra dark', () => {
    for (const theme of ['dark', 'light', 'black']) {
      expect(activeSpace(normalizeSettings({ theme })).theme).toBe(theme)
    }
  })

  it('defaults text tone to grey and takes only the two it knows', () => {
    // grey is the long-standing ramp, so an existing settings.json with no
    // textTone key must keep looking exactly as it did
    expect(activeSpace(normalizeSettings({})).textTone).toBe('grey')
    expect(activeSpace(normalizeSettings({ textTone: 'white' })).textTone).toBe('white')
    for (const bad of ['WHITE', 'silver', '', 1, null]) {
      expect(activeSpace(normalizeSettings({ textTone: bad })).textTone).toBe('grey')
    }
  })

  it('keeps button definition off unless it is really a true', () => {
    expect(activeSpace(normalizeSettings({})).buttonDefinition).toBe(false)
    expect(activeSpace(normalizeSettings({ buttonDefinition: true })).buttonDefinition).toBe(true)
    // 'false' and 0 are the ones that matter: coercing either would turn the
    // option on for someone who never asked for it
    for (const bad of ['true', 'false', 1, 0, null]) {
      expect(activeSpace(normalizeSettings({ buttonDefinition: bad })).buttonDefinition).toBe(false)
    }
  })

  it('accepts any non-empty accent string but not an empty one', () => {
    expect(activeSpace(normalizeSettings({ accent: 'ocean' })).accent).toBe('ocean')
    expect(activeSpace(normalizeSettings({ accent: '' })).accent).toBe(DEFAULT_SPACE.accent)
    expect(activeSpace(normalizeSettings({ accent: 42 })).accent).toBe(DEFAULT_SPACE.accent)
  })

  it('rejects a folder that is not a single path segment', () => {
    // the value is a vault-relative folder NAME; anything with a separator or a
    // traversal must not survive into a path
    for (const bad of ['a/b', 'a\\b', '..', '.', '   ', 5, null]) {
      expect(normalizeSettings({ spaces: [{ folder: bad }] }).spaces[0].folder).toBe('')
    }
    expect(normalizeSettings({ spaces: [{ folder: ' Work ' }] }).spaces[0].folder).toBe('Work')
  })

  it('drops a duplicated folder, keeping the first', () => {
    const s = normalizeSettings({ spaces: [{ folder: 'A', theme: 'light' }, { folder: 'A' }, { folder: 'B' }] })
    expect(s.spaces.map((x) => x.folder)).toEqual(['A', 'B'])
    expect(s.spaces[0].theme).toBe('light')
  })

  it('caps at SPACE_CAP', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ folder: `f${i}` }))
    expect(normalizeSettings({ spaces: many }).spaces).toHaveLength(SPACE_CAP)
  })

  it('resolves activeSpaceFolder, falling back to the first space', () => {
    const two = { spaces: [{ folder: 'A' }, { folder: 'B' }] }
    expect(normalizeSettings({ ...two, activeSpaceFolder: 'B' }).activeSpaceFolder).toBe('B')
    expect(normalizeSettings({ ...two, activeSpaceFolder: 'zzz' }).activeSpaceFolder).toBe('A')
    expect(normalizeSettings(two).activeSpaceFolder).toBe('A')
  })

  it('always gives a space exactly four toolbar slots', () => {
    for (const slots of [undefined, ['a'], [1, 2, 3, 4], Array(9).fill('x'), 'nope']) {
      expect(activeSpace(normalizeSettings({ toolbarSlots: slots })).toolbarSlots).toHaveLength(4)
    }
  })

  it('never shares a mutable reference with DEFAULT_SETTINGS', () => {
    const s = normalizeSettings({})
    s.spaces[0].theme = 'light'
    s.spaces[0].toolbarSlots[0] = 'h1'
    expect(DEFAULT_SPACE.theme).toBe('dark')
    expect(DEFAULT_SPACE.toolbarSlots).toEqual(['', '', '', ''])
    expect(DEFAULT_SETTINGS.spaces).toHaveLength(1)
  })
})

// The migration is the part that touches every existing user's real settings, so
// it gets tested from a realistic old file rather than from synthetic fragments.
describe('normalizeSettings — migration from the flat pre-Spaces shape', () => {
  const OLD = {
    theme: 'light',
    density: 'compact',
    accent: 'blue',
    accentMode: 'tint',
    freeArrange: true,
    compactNav: true,
    toolbarSlots: ['h1', '', 'link', ''],
    startup: 'last',
    lastNotePath: 'notes/a.md',
    dateFormat: 'ymd',
    numberFormat: 'comma',
    timezone: 'Europe/London'
  }

  it('lifts every per-space value into one unbound space, verbatim', () => {
    const s = normalizeSettings(OLD)
    expect(s.spaces).toHaveLength(1)
    expect(s.spaces[0]).toEqual({
      ...DEFAULT_SPACE,
      folder: '', // unbound — reconcileSpaces binds it to the vault's first folder
      theme: 'light',
      density: 'compact',
      accent: 'blue',
      accentMode: 'tint',
      freeArrange: true,
      compactNav: true,
      toolbarSlots: ['h1', '', 'link', '']
    })
  })

  it('leaves the global fields at the top level', () => {
    const s = normalizeSettings(OLD)
    expect(s.startup).toBe('last')
    expect(s.dateFormat).toBe('ymd')
    expect(s.numberFormat).toBe('comma')
    expect(s.timezone).toBe('Europe/London')
  })

  it('reads a pre-tabs `lastNotePath` as a one-tab session', () => {
    // The note someone had open before tabs existed IS their session, so it
    // comes back on the next launch instead of being dropped as an unknown key.
    const s = normalizeSettings(OLD)
    expect(s.session).toEqual({ tabs: ['notes/a.md'], panes: ['notes/a.md'], focus: 0 })
    // ...and once `session` exists it wins: the stale key is never read again,
    // which is what keeps the migration idempotent.
    const next = normalizeSettings({
      ...OLD,
      session: { tabs: ['b.md', 'c.md'], panes: ['c.md'], focus: 0 }
    })
    expect(next.session.tabs).toEqual(['b.md', 'c.md'])
  })

  it('keeps a junk session from reaching the layout', () => {
    const s = normalizeSettings({ session: { tabs: ['a.md', 7, null], panes: 'nope', focus: -3 } })
    expect(s.session).toEqual({ tabs: ['a.md'], panes: [], focus: 0 })
  })

  it('lets spaces win over leftover top-level keys', () => {
    // only reachable by hand-editing, but it is the rule that keeps the
    // function idempotent
    const s = normalizeSettings({ theme: 'light', spaces: [{ folder: 'A', theme: 'dark' }] })
    expect(activeSpace(s).theme).toBe('dark')
  })

  it('is idempotent', () => {
    // the test that catches a migration which re-migrates its own output
    for (const raw of [OLD, {}, null, { spaces: [{ folder: 'A' }, { folder: 'A' }] }]) {
      const once = normalizeSettings(raw)
      expect(normalizeSettings(once)).toEqual(once)
    }
  })

  it('carries an existing user through to a real folder', () => {
    // the whole point of migrating unbound: their theme and density must survive
    // becoming folder-shaped, not reset to defaults
    const migrated = normalizeSettings(OLD)
    const next = reconcileSpaces(migrated, ['Revision', 'Journal'])
    expect(next?.spaces?.[0]).toMatchObject({ folder: 'Revision', theme: 'light', density: 'compact' })
    expect(next?.spaces?.[1]).toMatchObject({ folder: 'Journal', theme: DEFAULT_SPACE.theme })
    expect(next?.activeSpaceFolder).toBe('Revision')
  })
})

describe('reconcileSpaces', () => {
  const withFolders = (...folders: string[]): AppSettings =>
    normalizeSettings({ spaces: folders.map((folder) => ({ folder })), activeSpaceFolder: folders[0] })

  it('returns null when the folders already match', () => {
    expect(reconcileSpaces(withFolders('A', 'B'), ['A', 'B'])).toBeNull()
  })

  it('adopts a folder created outside the app', () => {
    const next = reconcileSpaces(withFolders('A'), ['A', 'B'])
    expect(next?.spaces?.map((x) => x.folder)).toEqual(['A', 'B'])
  })

  it('keeps each surviving space settings and position', () => {
    const s = normalizeSettings({
      spaces: [{ folder: 'A', theme: 'light' }, { folder: 'B', density: 'ultra' }]
    })
    const next = reconcileSpaces(s, ['B', 'A', 'C'])
    // order follows the SAVED order for known folders, not the disk order
    expect(next?.spaces?.map((x) => x.folder)).toEqual(['A', 'B', 'C'])
    expect(next?.spaces?.[0].theme).toBe('light')
    expect(next?.spaces?.[1].density).toBe('ultra')
  })

  it('rebinds a space whose folder was renamed outside the app', () => {
    // "A" is gone and "Renamed" is new: the orphan adopts it and keeps its look,
    // which is what stops an Explorer rename wiping a space's settings
    const s = normalizeSettings({ spaces: [{ folder: 'A', theme: 'light' }] })
    const next = reconcileSpaces(s, ['Renamed'])
    expect(next?.spaces).toHaveLength(1)
    expect(next?.spaces?.[0]).toMatchObject({ folder: 'Renamed', theme: 'light' })
  })

  it('drops a space whose folder is gone with nothing to adopt', () => {
    const next = reconcileSpaces(withFolders('A', 'B'), ['A'])
    expect(next?.spaces?.map((x) => x.folder)).toEqual(['A'])
  })

  it('repoints the active space when its folder disappears', () => {
    const s = { ...withFolders('A', 'B'), activeSpaceFolder: 'B' }
    expect(reconcileSpaces(s, ['A'])?.activeSpaceFolder).toBe('A')
  })

  // REGRESSION. Dropping the last space when there's nothing to bind to reset
  // the user's theme and density to the defaults — silently, on a vault whose
  // top level holds only notes, and on deleting your last space.
  it('keeps the last space as the whole-vault space rather than losing its look', () => {
    const s = normalizeSettings({ theme: 'light', density: 'ultra', compactNav: true })
    const next = reconcileSpaces(s, [])
    const after = { ...s, ...next }
    expect(after.spaces).toHaveLength(1)
    expect(after.spaces[0].folder).toBe('')
    expect(activeSpace(after)).toMatchObject({ theme: 'light', density: 'ultra', compactNav: true })
  })

  it('converges once unbound — no write on every tree load', () => {
    // the reference-preserving half of the fix above: rebuilding the object
    // each time would make `same` always false and rewrite settings.json on
    // every watcher event
    const s = normalizeSettings({ theme: 'light' })
    const after = { ...s, ...reconcileSpaces(s, []) }
    expect(reconcileSpaces(after, [])).toBeNull()
  })

  it('binds the kept whole-vault space once a folder appears', () => {
    const s = normalizeSettings({ theme: 'light' })
    const flat = { ...s, ...reconcileSpaces(s, []) }
    const next = reconcileSpaces(flat, ['Revision'])
    expect(next?.spaces?.[0]).toMatchObject({ folder: 'Revision', theme: 'light' })
  })

  it('leaves a brand-new vault alone', () => {
    expect(reconcileSpaces(DEFAULT_SETTINGS, [])).toBeNull()
  })

  // REGRESSION. With no spaces at all, withSpacePatch matched nothing, so on a
  // vault whose top level holds only notes every theme/accent/density control
  // silently did nothing.
  it('leaves a fresh vault with a patchable space', () => {
    const s = DEFAULT_SETTINGS
    const patched = { ...s, ...withSpacePatch(s, activeSpace(s).folder, { theme: 'light' }) }
    expect(activeSpace(patched).theme).toBe('light')
  })

  it('never exceeds the cap, however many folders exist', () => {
    const folders = Array.from({ length: 20 }, (_, i) => `f${i}`)
    const next = reconcileSpaces(DEFAULT_SETTINGS, folders)
    expect(next?.spaces).toHaveLength(SPACE_CAP)
  })

  it('does not mutate the settings it was given', () => {
    const s = withFolders('A')
    const before = JSON.stringify(s)
    reconcileSpaces(s, ['A', 'B'])
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('activeSpace', () => {
  it('finds the active space', () => {
    const s = normalizeSettings({ spaces: [{ folder: 'A' }, { folder: 'B' }], activeSpaceFolder: 'B' })
    expect(activeSpace(s).folder).toBe('B')
  })

  it('falls back to the first space when the folder is unknown', () => {
    const s = { ...normalizeSettings({ spaces: [{ folder: 'A' }] }), activeSpaceFolder: 'nope' }
    expect(activeSpace(s).folder).toBe('A')
  })

  it('returns the whole-vault space when there are none', () => {
    // a vault with no top-level folders still has to paint and still has to
    // show its notes — folder '' means the vault root
    const s = activeSpace(DEFAULT_SETTINGS)
    expect(s.folder).toBe('')
    expect(s.theme).toBe(DEFAULT_SPACE.theme)
  })
})

describe('withSpacePatch / withSpaceRenamed / withNewSpace / withoutSpace', () => {
  const three = (): AppSettings =>
    normalizeSettings({ spaces: [{ folder: 'A' }, { folder: 'B' }, { folder: 'C' }], activeSpaceFolder: 'A' })

  it('patches only the named space and does not mutate the input', () => {
    const s = three()
    const before = JSON.stringify(s)
    const next = withSpacePatch(s, 'B', { theme: 'light' })
    expect(next.spaces?.map((x) => x.theme)).toEqual(['dark', 'light', 'dark'])
    expect(JSON.stringify(s)).toBe(before)
  })

  it('ignores an unknown folder rather than appending a phantom space', () => {
    const s = three()
    expect(withSpacePatch(s, 'nope', { theme: 'light' }).spaces).toEqual(s.spaces)
  })

  it('refuses to let a patch change the folder', () => {
    // folder is the identity AND a real directory — only withSpaceRenamed may
    // move it, because that has to happen on disk too
    const next = withSpacePatch(three(), 'A', { folder: 'hacked', theme: 'light' } as never)
    expect(next.spaces?.[0].folder).toBe('A')
    expect(next.spaces?.[0].theme).toBe('light')
  })

  it('re-keys a renamed space, following the active one', () => {
    const next = withSpaceRenamed(three(), 'A', 'Archive')
    expect(next.spaces?.map((x) => x.folder)).toEqual(['Archive', 'B', 'C'])
    expect(next.activeSpaceFolder).toBe('Archive')
  })

  it('leaves the active space alone when renaming a different one', () => {
    expect(withSpaceRenamed(three(), 'C', 'Zed').activeSpaceFolder).toBe('A')
  })

  it('ignores a rename of an unknown space, or a no-op rename', () => {
    expect(withSpaceRenamed(three(), 'nope', 'X')).toEqual({})
    expect(withSpaceRenamed(three(), 'A', 'A')).toEqual({})
  })

  it('registers a new space and switches to it', () => {
    const next = withNewSpace(three(), 'D')
    expect(next.spaces?.map((x) => x.folder)).toEqual(['A', 'B', 'C', 'D'])
    expect(next.activeSpaceFolder).toBe('D')
  })

  it('refuses a duplicate, an empty name, or one past the cap', () => {
    expect(withNewSpace(three(), 'B')).toEqual({})
    expect(withNewSpace(three(), '')).toEqual({})
    const full = normalizeSettings({
      spaces: Array.from({ length: SPACE_CAP }, (_, i) => ({ folder: `f${i}` }))
    })
    expect(withNewSpace(full, 'extra')).toEqual({})
  })

  // REGRESSION. Adding your first real space used to APPEND beside the lone
  // unbound placeholder rather than replacing it, leaving a ghost entry
  // (folder: '') in the switcher: indistinguishable from a real space, and
  // silently sending every new note/folder to the vault root once clicked.
  it('rebinds the lone unbound placeholder instead of appending beside it', () => {
    const fresh = normalizeSettings({ theme: 'light' }) // one space, folder ''
    const next = withNewSpace(fresh, 'Work')
    expect(next.spaces).toHaveLength(1)
    expect(next.spaces?.[0]).toMatchObject({ folder: 'Work', theme: 'light' })
    expect(next.activeSpaceFolder).toBe('Work')
  })

  it('still appends normally once a real space already exists', () => {
    const one = normalizeSettings({ spaces: [{ folder: 'A' }] })
    const next = withNewSpace(one, 'B')
    expect(next.spaces?.map((x) => x.folder)).toEqual(['A', 'B'])
  })

  it('selects the LEFT neighbour when the active space is removed', () => {
    // positional switcher, so selection lands next to where the finger was
    const s = { ...three(), activeSpaceFolder: 'B' }
    expect(withoutSpace(s, 'B').activeSpaceFolder).toBe('A')
  })

  it('selects the new first space when the leftmost active one is removed', () => {
    expect(withoutSpace(three(), 'A').activeSpaceFolder).toBe('B')
  })

  it('leaves the active space alone when removing a different one', () => {
    expect(withoutSpace(three(), 'C').activeSpaceFolder).toBe('A')
  })

  it('turns the last space into the whole-vault space rather than removing it', () => {
    // spaces is never empty: with none, withSpacePatch has nothing to match and
    // every appearance control silently stops working
    const one = normalizeSettings({ spaces: [{ folder: 'A', theme: 'light' }], activeSpaceFolder: 'A' })
    const next = withoutSpace(one, 'A')
    expect(next.spaces).toHaveLength(1)
    expect(next.spaces?.[0]).toMatchObject({ folder: '', theme: 'light' })
    expect(next.activeSpaceFolder).toBe('')
  })

  it('ignores an unknown folder', () => {
    expect(withoutSpace(three(), 'nope')).toEqual({})
  })
})

describe('normalizeThemeCache / settingsFromThemeCache', () => {
  const DEFAULT_CACHE = {
    theme: DEFAULT_SPACE.theme,
    density: DEFAULT_SPACE.density,
    textTone: DEFAULT_SPACE.textTone,
    buttonDefinition: DEFAULT_SPACE.buttonDefinition
  }

  it('never throws, and defaults on junk', () => {
    for (const j of [null, undefined, 0, 'nope', [], { theme: 'neon', density: 9 }]) {
      expect(normalizeThemeCache(j)).toEqual(DEFAULT_CACHE)
    }
  })

  it('reads a cache file written by an older build', () => {
    // the keys added since (textTone, buttonDefinition) must default rather
    // than throw or blank the two that were always there — this is the file
    // read synchronously before first paint, so a bad read is a visible flash
    expect(normalizeThemeCache({ theme: 'light', density: 'ultra' })).toEqual({
      ...DEFAULT_CACHE,
      theme: 'light',
      density: 'ultra'
    })
  })

  it('round-trips every paint value <html> needs', () => {
    const cache = { theme: 'black', density: 'ultra', textTone: 'white', buttonDefinition: true } as const
    expect(normalizeThemeCache(cache)).toEqual(cache)
  })

  it('builds a valid no-vault AppSettings from the cache', () => {
    const s = settingsFromThemeCache({
      theme: 'black',
      density: 'ultra',
      textTone: 'white',
      buttonDefinition: true
    })
    expect(activeSpace(s)).toMatchObject({
      theme: 'black',
      density: 'ultra',
      textTone: 'white',
      buttonDefinition: true
    })
    expect(normalizeSettings(s)).toEqual(s)
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
