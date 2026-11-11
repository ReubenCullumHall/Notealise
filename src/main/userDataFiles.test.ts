// The two small files kept beside the app rather than in a vault — config.json (which
// folder to reopen, first run done, the update choice) and presets.json (the saved
// looks) — are saved whole or not at all, and a damaged one is kept, not written over
// (app check 2026-11-09). Electron is stood in for: only its userData folder is used.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { where } = vi.hoisted(() => ({ where: { userData: '' } }))
vi.mock('electron', () => ({ app: { getPath: () => where.userData }, dialog: {} }))

import { getHasOnboarded, getSavedVault, saveVault, setHasOnboarded } from './config'
import { listPresets, syncPresets } from './presets'
import { presetFromSpace } from '../shared/presets'
import { DEFAULT_SPACE } from '../shared/settings'

const file = (name: string): string => path.join(where.userData, name)
const names = (): string[] => readdirSync(where.userData).sort()
const damaged = (stem: string): string[] => names().filter((n) => n.startsWith(`${stem}.damaged-`))

beforeEach(() => {
  where.userData = mkdtempSync(path.join(os.tmpdir(), 'userdata-files-'))
})
afterEach(() => rmSync(where.userData, { recursive: true, force: true }))

describe('config.json', () => {
  it('is saved whole, with nothing else left beside it', async () => {
    await saveVault(where.userData)
    await setHasOnboarded(true)
    expect(JSON.parse(readFileSync(file('config.json'), 'utf8'))).toEqual({ vaultPath: where.userData, hasOnboarded: true })
    expect(names()).toEqual(['config.json'])
    expect(await getSavedVault()).toBe(where.userData)
  })

  it('a cut-off one is kept beside it before the next save writes over it', async () => {
    const cutOff = '{\n  "vaultPath": "/Users/someone/Not'
    writeFileSync(file('config.json'), cutOff)
    expect(await getHasOnboarded()).toBe(false) // reads as "nothing set", as before
    await setHasOnboarded(true)
    const [copy] = damaged('config')
    expect(copy, 'a copy of the damaged file').toBeTruthy()
    expect(readFileSync(file(copy), 'utf8')).toBe(cutOff)
    expect(JSON.parse(readFileSync(file('config.json'), 'utf8'))).toEqual({ hasOnboarded: true })
  })

  it('no file yet is not damage: nothing is copied', async () => {
    expect(await getHasOnboarded()).toBe(false)
    expect(names()).toEqual([])
  })
})

describe('presets.json (the saved looks)', () => {
  const look = (folder: string): ReturnType<typeof presetFromSpace> => presetFromSpace({ ...DEFAULT_SPACE, folder }, 'My notes', 1)

  it('is saved whole, with nothing else left beside it', async () => {
    const list = await syncPresets([look('Biology'), look('Maths')])
    expect(list.map((p) => p.name).sort()).toEqual(['Biology', 'Maths'])
    expect((JSON.parse(readFileSync(file('presets.json'), 'utf8')) as { presets: unknown[] }).presets.length).toBe(2)
    expect(names()).toEqual(['presets.json'])
  })

  it('a cut-off one is kept beside it before the next save writes over it', async () => {
    const cutOff = '{\n  "presets": [\n    { "name": "Revision", "origin": "Another folder", "look": { "theme": "da'
    writeFileSync(file('presets.json'), cutOff)
    expect(await listPresets()).toEqual([]) // reads as an empty library, as before
    await syncPresets([look('Biology')])
    const [copy] = damaged('presets')
    expect(copy, 'a copy of the damaged file').toBeTruthy()
    expect(readFileSync(file(copy), 'utf8')).toBe(cutOff)
    expect(damaged('presets').length).toBe(1) // one copy, however often it was read
  })

  it('no file yet is not damage: nothing is copied', async () => {
    expect(await listPresets()).toEqual([])
    expect(names()).toEqual([])
  })
})
