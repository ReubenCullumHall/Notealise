import { describe, expect, it } from 'vitest'
import {
  ALL_PARTS,
  fromPresetFile,
  lookKey,
  LOOK_PARTS,
  normalizePreset,
  partKeysForTest,
  pickLook,
  presetFromSpace,
  PRESET_FILE_KIND,
  samePreset,
  sortPresets,
  toPresetFile,
  vaultName,
  type SpacePreset
} from './presets'
import { DEFAULT_SPACE, freshSpace, normalizeLook, spaceLook } from './settings'

// A preset file is read off disk, from a folder the user can open, hand-edit and
// sync between two machines — so the contract is settings.json's: never throw,
// default what's missing, drop what's junk.

describe('normalizePreset', () => {
  it('never throws, and refuses anything that is not a preset', () => {
    const junk = [null, undefined, 0, '', 'nope', [], true, NaN, { look: {} }, { name: '   ' }]
    for (const j of junk) {
      expect(() => normalizePreset(j, 'x')).not.toThrow()
      expect(normalizePreset(j, 'x')).toBeNull()
    }
  })

  it('refuses a file with no id, because the id is how it is applied and deleted', () => {
    expect(normalizePreset({ name: 'Revision' }, '')).toBeNull()
  })

  it('KEEPS the id that is already in the entry, and only falls back without one', () => {
    // Regression, found by exercising main against a real library file. The id
    // has to survive a round trip through disk: it is what Delete and Export
    // are given by the renderer, and main re-reads the library inside both. When
    // this returned the fallback unconditionally, every read minted new ids, so
    // those two buttons matched nothing and silently did nothing — with no error
    // and nothing visibly wrong in the list.
    expect(normalizePreset({ id: 'kept', name: 'Revision' }, 'fresh')?.id).toBe('kept')
    expect(normalizePreset({ name: 'Revision' }, 'fresh')?.id).toBe('fresh')
    expect(normalizePreset({ id: '   ', name: 'Revision' }, 'fresh')?.id).toBe('fresh')
  })

  it('fills a missing look with the defaults rather than failing the file', () => {
    // The case that matters: a preset written by an OLDER build, missing keys
    // this one has. Refusing it would lose a look the user still wants; the same
    // loose validation settings.json gets is what keeps it usable.
    const p = normalizePreset({ name: 'Journal' }, 'Journal')
    expect(p?.look).toEqual(spaceLook(DEFAULT_SPACE))
  })

  it('drops keys a newer build wrote, and keeps the ones it knows', () => {
    const p = normalizePreset(
      { name: 'Revision', origin: 'Notes', savedAt: 5, look: { theme: 'light', somethingNew: 42 } },
      'Revision'
    )
    expect(p?.look.theme).toBe('light')
    expect(p?.look).not.toHaveProperty('somethingNew')
    expect(p?.origin).toBe('Notes')
    expect(p?.savedAt).toBe(5)
  })

  it('never lets a folder name into the look', () => {
    // A look is a Space with its IDENTITY removed. If `folder` survived, pouring
    // a preset onto a space would repoint that space at another folder — which
    // is a file operation, from a control that promises not to be one.
    const p = normalizePreset({ name: 'Revision', look: { folder: 'Elsewhere', theme: 'light' } }, 'Revision')
    expect(p?.look).not.toHaveProperty('folder')
  })

  it('is idempotent — re-reading what it wrote changes nothing', () => {
    const once = normalizePreset({ name: 'Revision', look: { density: 'compact' } }, 'Revision')
    const twice = normalizePreset(once, 'Revision')
    expect(twice).toEqual(once)
  })
})

describe('presetFromSpace', () => {
  it('carries the whole look and none of the identity', () => {
    const space = { ...freshSpace('Revision'), emoji: '🧠', theme: 'light' as const }
    const draft = presetFromSpace(space, 'Notes', 123)
    expect(draft).toEqual({ name: 'Revision', origin: 'Notes', savedAt: 123, look: spaceLook(space) })
    expect(draft.look).not.toHaveProperty('folder')
    // The emoji is part of the look on purpose: it is what tells two spaces
    // apart in the switcher, so a look without it is half a look.
    expect(draft.look.emoji).toBe('🧠')
  })

  it('does not share a mutable reference with the space it came from', () => {
    // Same guarantee freshSpace gives: a preset held in state must not change
    // under you because the space it was taken from was edited.
    const space = freshSpace('Revision')
    const draft = presetFromSpace(space, 'Notes', 0)
    space.colorPalette.push('#ff0000')
    expect(draft.look.colorPalette).not.toContain('#ff0000')
  })
})

describe('samePreset', () => {
  it('is (name, origin), so two vaults may each keep a "Revision"', () => {
    // The whole reason `origin` exists. Folding these together would mean
    // opening one vault silently overwrote the other vault's saved look.
    expect(samePreset({ name: 'Revision', origin: 'Notes' }, { name: 'Revision', origin: 'Archive' })).toBe(false)
    expect(samePreset({ name: 'Revision', origin: 'Notes' }, { name: 'Revision', origin: 'Notes' })).toBe(true)
    expect(samePreset({ name: 'Revision', origin: 'Notes' }, { name: 'Journal', origin: 'Notes' })).toBe(false)
  })
})

describe('lookKey', () => {
  it('does not depend on the order the look was built in', () => {
    // This is what stops the mirror rewriting every preset file on every render.
    // A look read back off disk and the same look held in React state are built
    // by different code paths; if their keys differed, the app would write the
    // library continuously — on a vault inside OneDrive, real sync churn.
    const a = normalizeLook({ theme: 'light', density: 'compact' })
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a
    expect(lookKey(reordered)).toBe(lookKey(a))
  })

  it('changes when any field of the look changes', () => {
    const a = normalizeLook({ theme: 'light' })
    expect(lookKey(normalizeLook({ theme: 'dark' }))).not.toBe(lookKey(a))
    expect(lookKey({ ...a, emoji: '🧠' })).not.toBe(lookKey(a))
    expect(lookKey({ ...a, colorPalette: [...a.colorPalette, '#123456'] })).not.toBe(lookKey(a))
  })
})

describe('sortPresets', () => {
  it('is newest first, and falls back to the name so the order is never arbitrary', () => {
    const at = (name: string, savedAt: number): SpacePreset => ({
      id: name,
      name,
      origin: 'Notes',
      savedAt,
      look: normalizeLook({})
    })
    const sorted = sortPresets([at('B', 1), at('A', 9), at('C', 1)])
    expect(sorted.map((p) => p.name)).toEqual(['A', 'B', 'C'])
  })

  it('does not mutate its input', () => {
    const list = [
      { id: 'B', name: 'B', origin: '', savedAt: 1, look: normalizeLook({}) },
      { id: 'A', name: 'A', origin: '', savedAt: 9, look: normalizeLook({}) }
    ]
    sortPresets(list)
    expect(list.map((p) => p.name)).toEqual(['B', 'A'])
  })
})

describe('vaultName', () => {
  it('reads the folder name off either platform s separator', () => {
    // `origin` must be the same string for the same OneDrive vault opened on
    // Windows and on the Mac, or the library duplicates itself per machine.
    expect(vaultName('D:\\OneDrive\\Notes')).toBe('Notes')
    expect(vaultName('/Users/x/OneDrive/Notes')).toBe('Notes')
    expect(vaultName('/Users/x/OneDrive/Notes/')).toBe('Notes')
    expect(vaultName('Notes')).toBe('Notes')
  })
})

describe('pickLook — what moves when a preset is applied', () => {
  it('covers every field of a look, exactly once', () => {
    // THE test in this file. Applying is grouped into tick boxes, so a field in
    // no group could never be copied by ANY combination of ticks — a setting
    // that silently ignores presets, with nothing to see in the UI. A field in
    // two groups is the mirror bug: unticking one group wouldn't stop it moving.
    // Adding a key to `Space` must therefore fail here rather than go missing.
    const grouped = LOOK_PARTS.flatMap((p) => partKeysForTest()[p])
    const expected = Object.keys(spaceLook(DEFAULT_SPACE)).sort()
    expect([...grouped].sort()).toEqual(expected)
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('copies only the ticked parts', () => {
    const look = normalizeLook({ theme: 'light', density: 'compact', freeArrange: true, colorStyle: 'solid' })
    const only = pickLook(look, ['appearance'])
    expect(only.theme).toBe('light')
    expect(only.density).toBe('compact')
    // arranging and colour were not ticked, so they must not be in the patch at
    // all — an `undefined` value here would overwrite the target's own setting.
    expect(only).not.toHaveProperty('freeArrange')
    expect(only).not.toHaveProperty('colorStyle')
  })

  it('never carries the folder, whatever is ticked', () => {
    // The guarantee that makes "only the look moves" true: applying a preset
    // must never be able to repoint a space at a different folder on disk.
    expect(pickLook(normalizeLook({}), ALL_PARTS)).not.toHaveProperty('folder')
  })

  it('copies arrays rather than sharing them', () => {
    const look = normalizeLook({})
    const patch = pickLook(look, ['colour'])
    ;(patch.colorPalette as string[]).push('#ff0000')
    expect(look.colorPalette).not.toContain('#ff0000')
  })

  it('nothing ticked copies nothing', () => {
    expect(pickLook(normalizeLook({ theme: 'light' }), [])).toEqual({})
  })
})

describe('the shareable file', () => {
  const preset = (name: string): SpacePreset => ({
    id: 'local-handle',
    name,
    origin: 'My private folder',
    savedAt: 123,
    look: normalizeLook({ theme: 'light', emoji: '🧠' })
  })

  it('strips the id, the timestamp and the folder it came from', () => {
    // `origin` is a folder name off the exporter's own disk; a look you hand to
    // someone must not carry it. `id` is a handle into one machine's library and
    // means nothing anywhere else.
    const file = toPresetFile([preset('Revision')])
    expect(file.kind).toBe(PRESET_FILE_KIND)
    expect(file.presets).toEqual([{ name: 'Revision', look: preset('Revision').look }])
    expect(JSON.stringify(file)).not.toContain('My private folder')
    expect(JSON.stringify(file)).not.toContain('local-handle')
  })

  it('round-trips through JSON', () => {
    const back = fromPresetFile(JSON.parse(JSON.stringify(toPresetFile([preset('Revision')]))))
    expect(back).toEqual([{ name: 'Revision', look: preset('Revision').look }])
  })

  it('carries one file or a whole library through the same shape', () => {
    // Why export-one and export-all can share a format: a file is always a list,
    // so import never has to know which button wrote it.
    expect(toPresetFile([preset('A'), preset('B')]).presets).toHaveLength(2)
    expect(fromPresetFile(toPresetFile([preset('A'), preset('B')]))).toHaveLength(2)
  })

  it('accepts a bare array and a lone preset, which a person might hand you', () => {
    expect(fromPresetFile([{ name: 'A', look: {} }])).toHaveLength(1)
    expect(fromPresetFile({ name: 'A', look: {} })).toHaveLength(1)
    // …and a hand-written file with the look at the top level
    expect(fromPresetFile({ name: 'A', theme: 'light' })[0].look.theme).toBe('light')
  })

  it('never throws, and returns nothing for anything that is not a preset', () => {
    const junk = [null, undefined, 0, '', 'nope', true, NaN, [], {}, { presets: 'x' }, { name: '  ' }]
    for (const j of junk) {
      expect(() => fromPresetFile(j)).not.toThrow()
      expect(fromPresetFile(j)).toEqual([])
    }
  })

  it('defaults a look it does not recognise rather than rejecting the file', () => {
    // Someone else's newer build, or a hand-edited file. Refusing it would lose
    // a look the user was given; the fields are validated one by one instead.
    const back = fromPresetFile({ presets: [{ name: 'Theirs', look: { theme: 'chartreuse', whatIsThis: 1 } }] })
    expect(back).toHaveLength(1)
    expect(back[0].look.theme).toBe(DEFAULT_SPACE.theme)
    expect(back[0].look).not.toHaveProperty('whatIsThis')
  })
})
