// The two spellings of an accent on a Mac disk (bug scan 2026-10-27).
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { moveEntryInto, renameEntry, setVaultRoot } from './vault'

const NFD = 'Café' // e + a combining accent: how Finder, zips and iCloud often write it
const NFC = 'Café' // é as one character: what the keyboard types
let root = ''
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'vaultnames-'))
  setVaultRoot(root)
})

describe.runIf(process.platform === 'darwin')('a Mac treats both spellings as one name', () => {
  it('renaming onto the other spelling never replaces that note', async () => {
    writeFileSync(path.join(root, `${NFD}.md`), 'A original')
    writeFileSync(path.join(root, 'B.md'), 'B text')
    const landed = await renameEntry('B.md', `${NFC}.md`).catch(() => null)
    const texts = readdirSync(root).filter((f) => f.endsWith('.md')).map((f) => readFileSync(path.join(root, f), 'utf8'))
    expect(texts).toContain('A original')
    expect(texts).toContain('B text')
    if (landed) expect(landed.normalize('NFC')).not.toBe(`${NFC}.md`)
  })
  it('archiving onto the other spelling never replaces the archived note', async () => {
    mkdirSync(path.join(root, 'Archive'))
    mkdirSync(path.join(root, 'Space'))
    writeFileSync(path.join(root, 'Archive', `${NFD}.md`), 'archived original')
    writeFileSync(path.join(root, 'Space', `${NFC}.md`), 'space note')
    await moveEntryInto(`Space/${NFC}.md`, 'Archive').catch(() => null)
    const texts = readdirSync(path.join(root, 'Archive')).map((f) => readFileSync(path.join(root, 'Archive', f), 'utf8'))
    expect(texts.sort()).toEqual(['archived original', 'space note'])
  })
})
