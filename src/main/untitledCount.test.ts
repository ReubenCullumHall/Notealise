// One "Untitled N" count for the whole vault (shared/untitled.ts, vault.ts `takeUntitled`) —
// Reuben, 2026-11-07: never two of the same number, and naming one never renumbers another.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFolder, createNote, renameEntry, setVaultRoot, takeUntitled } from './vault'

let root = ''
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'untitled-'))
  setVaultRoot(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the Untitled count', () => {
  it('notes, folders and voice notes share one count', async () => {
    expect(await createNote('')).toBe('Untitled 1.md')
    expect(await createFolder('')).toBe('Untitled 2')
    expect(await takeUntitled(2)).toEqual(['Untitled 3', 'Untitled 4'])
    expect(await createNote('Untitled 2')).toBe('Untitled 2/Untitled 5.md')
  })

  it('starts past every Untitled N already in the vault — names, voice notes, the bin', async () => {
    mkdirSync(path.join(root, 'Untitled 3'))
    writeFileSync(path.join(root, 'Untitled 3', 'Untitled 7.md'), '')
    writeFileSync(path.join(root, 'Lecture.md'), '<audio controls src="a.m4a" data-name="Untitled 12"></audio>\n')
    mkdirSync(path.join(root, '.mdnotes', 'trash', 'k1'), { recursive: true })
    writeFileSync(path.join(root, '.mdnotes', 'trash', 'k1', 'Untitled 20.md'), '')
    // the older names are left out of it
    writeFileSync(path.join(root, 'Untitled (40).md'), '')
    writeFileSync(path.join(root, 'Untitled.md'), '')
    expect(await createNote('')).toBe('Untitled 21.md')
  })

  it('naming one never moves the others down to fill its number', async () => {
    await createNote('')
    await createNote('')
    await renameEntry('Untitled 1.md', 'Plan.md')
    expect(await createNote('')).toBe('Untitled 3.md')
    const names = (await fs.readdir(root)).filter((n) => n.endsWith('.md')).sort()
    expect(names).toEqual(['Plan.md', 'Untitled 2.md', 'Untitled 3.md'])
  })

  it('the kept count travels with the vault, and a lost or behind one can never repeat a number', async () => {
    mkdirSync(path.join(root, '.mdnotes'))
    writeFileSync(path.join(root, '.mdnotes', 'untitled.json'), '{"next":5}')
    writeFileSync(path.join(root, 'Untitled 9.md'), '')
    expect(await createNote('')).toBe('Untitled 10.md')
    expect(JSON.parse(await fs.readFile(path.join(root, '.mdnotes', 'untitled.json'), 'utf8'))).toEqual({ next: 11 })
    // another computer took some meanwhile (the file synced in)
    writeFileSync(path.join(root, '.mdnotes', 'untitled.json'), '{"next":50}')
    expect(await createFolder('')).toBe('Untitled 50')
  })

  it('a damaged count file is ignored, not trusted', async () => {
    mkdirSync(path.join(root, '.mdnotes'))
    writeFileSync(path.join(root, '.mdnotes', 'untitled.json'), 'not json')
    expect(await createNote('')).toBe('Untitled 1.md')
  })

  it('five quick New notes get five numbers', async () => {
    const made = await Promise.all([1, 2, 3, 4, 5].map(() => createNote('')))
    expect(new Set(made).size).toBe(5)
  })

  it('a name somehow already there is skipped, not doubled', async () => {
    mkdirSync(path.join(root, '.mdnotes'))
    writeFileSync(path.join(root, '.mdnotes', 'untitled.json'), '{"next":2}')
    writeFileSync(path.join(root, 'Untitled 1.md'), '')
    mkdirSync(path.join(root, 'Sub'))
    // made by hand after the vault was looked at
    await takeUntitled(1)
    writeFileSync(path.join(root, 'Sub', 'Untitled 3.md'), '')
    expect(await createNote('Sub')).toBe('Sub/Untitled 4.md')
  })
})
