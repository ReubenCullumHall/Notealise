// Saving a settings file whole or not at all, and keeping a damaged one (atomicWrite.ts).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { keepDamagedCopy, writeFileAtomic } from './atomicWrite'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeFileAtomic', () => {
  it('writes a new file, and replaces one that is there', async () => {
    const file = path.join(dir, 'config.json')
    await writeFileAtomic(file, '{"a":1}')
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}')
    await writeFileAtomic(file, '{"a":2,"b":"é"}')
    expect(readFileSync(file, 'utf8')).toBe('{"a":2,"b":"é"}')
  })

  it('leaves nothing but the file behind', async () => {
    const file = path.join(dir, 'presets.json')
    await writeFileAtomic(file, '{}')
    await writeFileAtomic(file, '{"presets":[]}')
    expect(readdirSync(dir)).toEqual(['presets.json'])
  })

  it('a save that cannot land leaves what was there untouched, and no temp file', async () => {
    // Something un-replaceable where the file should go: a folder with a file in it.
    const file = path.join(dir, 'config.json')
    mkdirSync(file)
    writeFileSync(path.join(file, 'inside.txt'), 'still here')
    await expect(writeFileAtomic(file, '{"a":1}')).rejects.toThrow()
    expect(readFileSync(path.join(file, 'inside.txt'), 'utf8')).toBe('still here')
    expect(readdirSync(dir)).toEqual(['config.json'])
  })

  it('the folder it goes in must exist — a missing one is an error, not a guess', async () => {
    await expect(writeFileAtomic(path.join(dir, 'gone', 'config.json'), '{}')).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('keepDamagedCopy', () => {
  const copies = (): string[] => readdirSync(dir).filter((n) => n.includes('.damaged-'))

  it('copies a cut-off file beside itself, named after it', async () => {
    const file = path.join(dir, 'presets.json')
    writeFileSync(file, '{"presets":[{"name":"Rev')
    await keepDamagedCopy(file)
    const [copy] = copies()
    expect(copy).toMatch(/^presets\.damaged-.*\.json$/)
    expect(readFileSync(path.join(dir, copy), 'utf8')).toBe('{"presets":[{"name":"Rev')
  })

  it('once per damaged file, however often it is looked at', async () => {
    const file = path.join(dir, 'config.json')
    writeFileSync(file, '{"vaultPath":"/Users/x/No')
    await keepDamagedCopy(file)
    await keepDamagedCopy(file)
    await keepDamagedCopy(file)
    expect(copies().length).toBe(1)
  })

  it('a file that is not there is nothing to keep', async () => {
    await keepDamagedCopy(path.join(dir, 'config.json'))
    expect(readdirSync(dir)).toEqual([])
  })
})
