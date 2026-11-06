import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { recordingAppend, recordingBegin, recordingEnd, recordingsLeft, setVaultRoot } from './vault'

// Save as you record (vault.ts "a recording kept as it is made").
let root = ''
const info = { note: 'Bio/Cells.md', startedAt: '2026-11-06T14:32:00.000Z', ext: 'm4a' }
const kept = (f: string): string => path.join(root, '.mdnotes', 'recording', f)

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'kept-'))
  await fs.mkdir(path.join(root, 'Bio'))
  await setVaultRoot(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('a recording kept as it is made', () => {
  it('only under an id it has checked — never a path', async () => {
    expect(await recordingBegin('../../x', info)).toBe(false)
    expect(await recordingBegin('a/b', info)).toBe(false)
    expect(await recordingBegin('abc123', { ...info, ext: 'm4a/../x' })).toBe(false)
    expect(await recordingAppend('nothing1', new Uint8Array([1]))).toBe(false) // never begun
  })

  it('grows a piece at a time, and goes once the recording is saved', async () => {
    expect(await recordingBegin('abc123', info)).toBe(true)
    expect(await recordingAppend('abc123', new Uint8Array([1, 2, 3]))).toBe(true)
    expect(await recordingAppend('abc123', new Uint8Array([4]))).toBe(true)
    expect([...(await fs.readFile(kept('abc123.part')))]).toEqual([1, 2, 3, 4])
    await recordingEnd('abc123')
    expect(await fs.readdir(path.join(root, '.mdnotes', 'recording'))).toEqual([])
  })

  it('one left by a crash comes back beside its note, marked recovered', async () => {
    await recordingBegin('abc123', info)
    await recordingAppend('abc123', new Uint8Array([9, 9, 9]))
    const old = (Date.now() - 60_000) / 1000
    await fs.utimes(kept('abc123.part'), old, old)
    const back = await recordingsLeft()
    expect(back).toHaveLength(1)
    expect(back[0].note).toBe('Bio/Cells.md')
    expect(back[0].file).toMatch(/^Bio\/Voice note \d{4}-\d\d-\d\d \d\d\.\d\d \(recovered\)\.m4a$/)
    expect([...(await fs.readFile(path.join(root, back[0].file)))]).toEqual([9, 9, 9])
    expect(await fs.readdir(path.join(root, '.mdnotes', 'recording'))).toEqual([])
  })

  it('never one still being recorded (its file grew just now)', async () => {
    await recordingBegin('abc123', info)
    await recordingAppend('abc123', new Uint8Array([1]))
    expect(await recordingsLeft()).toEqual([])
    expect((await fs.readdir(path.join(root, '.mdnotes', 'recording'))).sort()).toEqual(['abc123.json', 'abc123.part'])
  })
})
