import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setVaultRoot } from './vault'
import { purgeEntries, restoreEntries, restoreRecoveryEntries, trashEntries } from './workspace'
import { TRASH_DIR, type MediaOrigin } from '../shared/workspace'

// Against a REAL temporary vault, deliberately — no mocked file system.
//
// This file exists because of a bug that every other test in the repo was
// blind to. The renderer sent a photo's origin, main's source accepted it, and
// the pure splice that puts it back was covered from both sides — but nothing
// exercised the actual write, so nobody noticed that the record reaching
// `.mdnotes/workspace.json` had no `media` on it at all. The symptom read as
// "restore is broken": the file came back to the vault and the note stayed
// empty. What binds these pieces together is a file on disk, so the test has to
// use one.
describe('the bin, against a real vault', () => {
  let root = ''

  const origin = (over: Partial<MediaOrigin> = {}): MediaOrigin => ({
    note: 'Space/Note.md',
    text: '![](photo.png)\n',
    line: 3,
    col: 0,
    before: 'One\n\n',
    after: 'Three\n',
    ...over
  })

  const read = async (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8')
  const exists = async (rel: string): Promise<boolean> =>
    fs.access(path.join(root, rel)).then(() => true, () => false)

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdnotes-test-'))
    await fs.mkdir(path.join(root, 'Space'), { recursive: true })
    await fs.writeFile(path.join(root, 'Space/Note.md'), 'One\n\n![](photo.png)\nThree\n')
    await fs.writeFile(path.join(root, 'Space/photo.png'), 'PNGBYTES')
    setVaultRoot(root)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('writes the media origin onto the bin record', async () => {
    const ws = await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    const row = ws.trash.find((t) => t.from === 'Space/photo.png')
    expect(row).toBeDefined()
    // The exact assertion that would have caught it.
    expect(row?.media).toEqual(origin())
  })

  it('persists the origin to workspace.json, not just the returned object', async () => {
    await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    const onDisk = JSON.parse(await read('.mdnotes/workspace.json'))
    expect(onDisk.trash[0].media).toEqual(origin())
  })

  it('really moves the file into .mdnotes/trash', async () => {
    const ws = await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    expect(await exists('Space/photo.png')).toBe(false)
    expect(await exists(`${TRASH_DIR}/${ws.trash[0].id}-photo.png`)).toBe(true)
  })

  it('a sidebar delete carries no origin, and says so by omission', async () => {
    const ws = await trashEntries(['Space/photo.png'])
    expect(ws.trash[0].media).toBeUndefined()
  })

  it('restores the file and reports where it landed', async () => {
    const binned = await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    const id = binned.trash[0].id
    const res = await restoreEntries([id])
    expect(res.landed[id]).toBe('Space/photo.png')
    expect(await read('Space/photo.png')).toBe('PNGBYTES')
    expect(res.workspace.trash).toHaveLength(0)
  })

  it('suffixes rather than overwrites when the name was retaken', async () => {
    const binned = await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    const id = binned.trash[0].id
    // Something else claimed the name while it sat in the bin.
    await fs.writeFile(path.join(root, 'Space/photo.png'), 'SOMETHING ELSE')
    const res = await restoreEntries([id])
    expect(res.landed[id]).toBe('Space/photo (2).png')
    expect(await read('Space/photo.png')).toBe('SOMETHING ELSE')
    expect(await read('Space/photo (2).png')).toBe('PNGBYTES')
  })

  it('carries the origin through the bin into the 7-day recovery net', async () => {
    const binned = await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    const ws = await purgeEntries([binned.trash[0].id])
    expect(ws.trash).toHaveLength(0)
    expect(ws.recovery).toHaveLength(1)
    // The whole point: a restore one stage later still knows where the picture
    // belongs in the note.
    expect(ws.recovery[0].media).toEqual(origin())
  })

  it('restores from recovery with the file intact', async () => {
    const binned = await trashEntries(['Space/photo.png'], { 'Space/photo.png': origin() })
    const purged = await purgeEntries([binned.trash[0].id])
    const id = purged.recovery[0].id
    const res = await restoreRecoveryEntries([id])
    expect(res.landed[id]).toBe('Space/photo.png')
    expect(await read('Space/photo.png')).toBe('PNGBYTES')
    expect(res.workspace.recovery).toHaveLength(0)
  })

  it('keeps two origins apart in one batch', async () => {
    await fs.writeFile(path.join(root, 'Space/two.png'), 'TWO')
    const ws = await trashEntries(['Space/photo.png', 'Space/two.png'], {
      'Space/photo.png': origin(),
      'Space/two.png': origin({ text: '![](two.png)\n', line: 9, before: 'X\n', after: 'Y\n' })
    })
    const one = ws.trash.find((t) => t.from === 'Space/photo.png')
    const two = ws.trash.find((t) => t.from === 'Space/two.png')
    expect(one?.media?.text).toBe('![](photo.png)\n')
    expect(two?.media?.text).toBe('![](two.png)\n')
    expect(two?.media?.line).toBe(9)
  })
})
