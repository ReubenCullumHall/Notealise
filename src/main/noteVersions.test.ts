// Earlier versions of a note, against a REAL temporary vault, through the same
// vault.ts calls the app makes — so the seams (a save, a rename, the bin, Recovery)
// are what is tested, not the keeper on its own. docs/plans/note-versions.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createFolder,
  keepVersionNow,
  listVersions,
  moveEntryInto,
  purgeRecoveryItem,
  purgeTrashItem,
  readVersion,
  renameEntry,
  restoreEntry,
  setVaultRoot,
  sweepVersions,
  trashEntry,
  writeNote
} from './vault'
import { resetForTests, setVersionCadence } from './noteVersions'
import { VERSIONS_DIR } from '../shared/noteVersions'
import { AWKWARD_NAMES } from '../shared/awkwardNames'

let root = ''
const MIN = 60 * 1000
const T0 = Date.UTC(2026, 10, 3, 9, 0, 0)
const PARA =
  'The Krebs cycle runs in the mitochondrial matrix and produces NADH, FADH2 and ATP from acetyl-CoA, two turns per glucose.'

const at = (ms: number): void => {
  vi.setSystemTime(T0 + ms)
}
const texts = async (rel: string): Promise<string[]> =>
  Promise.all((await listVersions(rel)).map((v) => readVersion(rel, v.token)))
const versionFolders = (): string[] => {
  try {
    return readdirSync(path.join(root, ...VERSIONS_DIR.split('/')))
  } catch {
    return []
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(0)
  root = mkdtempSync(path.join(os.tmpdir(), 'notealise-versions-'))
  setVaultRoot(root)
  resetForTests()
  // Most of these run on a timed choice; "When you close the note" has its own block.
  setVersionCadence(5 * MIN)
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('keeping versions on save', () => {
  it('keeps nothing for a brand-new or empty note', async () => {
    await writeNote('New.md', 'first words')
    expect(await listVersions('New.md')).toEqual([])
    writeFileSync(path.join(root, 'Empty.md'), '')
    await writeNote('Empty.md', 'typed')
    expect(await listVersions('Empty.md')).toEqual([])
  })

  it('keeps the text from before the first save, then waits 5 minutes', async () => {
    writeFileSync(path.join(root, 'Note.md'), 'v1')
    await writeNote('Note.md', 'v2')
    at(1 * MIN)
    await writeNote('Note.md', 'v3')
    at(2 * MIN)
    await writeNote('Note.md', 'v4')
    expect(await texts('Note.md')).toEqual(['v1'])
    at(6 * MIN)
    await writeNote('Note.md', 'v5')
    expect(await texts('Note.md')).toEqual(['v4', 'v1'])
  })

  it('keeps a copy straight away before a save that deletes a paragraph', async () => {
    writeFileSync(path.join(root, 'Bio.md'), 'Intro.')
    await writeNote('Bio.md', 'Intro.\n\n' + PARA + '\n\nOutro.') // keeps "Intro."
    at(1 * MIN)
    await writeNote('Bio.md', 'Intro.\n\n\n\nOutro.') // the paragraph goes, a minute later
    at(2 * MIN)
    await writeNote('Bio.md', 'Intro.\n\nNew thought.\n\nOutro.')
    const kept = await texts('Bio.md')
    expect(kept[0]).toContain(PARA)
    expect(kept).toHaveLength(2)
  })

  it('stores each version as the exact text on disk, line endings and all', async () => {
    writeFileSync(path.join(root, 'Win.md'), 'one\r\ntwo\r\n')
    await writeNote('Win.md', 'one\ntwo\nthree\n')
    const [v] = await listVersions('Win.md')
    expect(await readVersion('Win.md', v.token)).toBe('one\r\ntwo\r\n')
    const folder = versionFolders()[0]
    const files = readdirSync(path.join(root, ...VERSIONS_DIR.split('/'), folder)).sort()
    expect(files).toEqual(['2026-11-03T09-00-00.000Z Win.md', 'note.json'])
  })

  it('does not keep the same text twice', async () => {
    writeFileSync(path.join(root, 'Same.md'), 'abc')
    await keepVersionNow('Same.md')
    await keepVersionNow('Same.md')
    at(10 * MIN)
    await writeNote('Same.md', 'abcd') // before = "abc", already kept
    expect(await texts('Same.md')).toEqual(['abc'])
  })

  it('keeps on a forced keep even inside the 5 minutes', async () => {
    writeFileSync(path.join(root, 'R.md'), 'a')
    await writeNote('R.md', 'b')
    at(1 * MIN)
    await keepVersionNow('R.md')
    expect(await texts('R.md')).toEqual(['b', 'a'])
  })
})

describe('"When you close the note" (the default)', () => {
  it('keeps the note as it first was, then nothing on ordinary saves however long you type', async () => {
    setVersionCadence(null)
    writeFileSync(path.join(root, 'C.md'), 'first')
    await writeNote('C.md', 'first, then more') // no copy yet: the note as it first was is kept
    at(20 * MIN)
    await writeNote('C.md', 'first, then more and more')
    at(60 * MIN)
    await writeNote('C.md', 'first, then more and more, still typing')
    expect(await texts('C.md')).toEqual(['first'])
  })

  it('still keeps a copy straight away before a big deletion', async () => {
    setVersionCadence(null)
    writeFileSync(path.join(root, 'D.md'), 'Intro.')
    await writeNote('D.md', 'Intro.\n\n' + PARA)
    at(1 * MIN)
    await writeNote('D.md', 'Intro.\n\n')
    expect((await texts('D.md'))[0]).toContain(PARA)
  })

  it('keeps the note as it closes (the window asks), and not twice for the same text', async () => {
    setVersionCadence(null)
    writeFileSync(path.join(root, 'E.md'), 'one')
    await writeNote('E.md', 'one two')
    at(3 * MIN)
    await writeNote('E.md', 'one two three')
    await keepVersionNow('E.md') // the tab closes
    await keepVersionNow('E.md') // and the app quits with nothing changed since
    expect(await texts('E.md')).toEqual(['one two three', 'one'])
  })
})

describe('versions follow the note', () => {
  it('through a rename and a case-only rename', async () => {
    writeFileSync(path.join(root, 'Old.md'), 'before')
    await writeNote('Old.md', 'after')
    await renameEntry('Old.md', 'New.md')
    expect(await texts('New.md')).toEqual(['before'])
    expect(await listVersions('New.md')).toHaveLength(1)
    await renameEntry('New.md', 'new.md')
    expect(await texts('new.md')).toEqual(['before'])
  })

  it('when the folder it is in is renamed or moved into the archive', async () => {
    await createFolder('', 'Biology')
    writeFileSync(path.join(root, 'Biology', 'Cells.md'), 'cells v1')
    await writeNote('Biology/Cells.md', 'cells v2')
    await renameEntry('Biology', 'Bio')
    expect(await texts('Bio/Cells.md')).toEqual(['cells v1'])
    await moveEntryInto('Bio', 'Archive')
    expect(await texts('Archive/Bio/Cells.md')).toEqual(['cells v1'])
  })

  it('into the bin and back out, and is deleted only when the note is', async () => {
    writeFileSync(path.join(root, 'Bin me.md'), 'kept text')
    await writeNote('Bin me.md', 'later text')
    const { id, name } = await trashEntry('Bin me.md')
    await restoreEntry(id, name, 'Bin me.md')
    expect(await texts('Bin me.md')).toEqual(['kept text'])

    const again = await trashEntry('Bin me.md')
    expect(await purgeTrashItem(again.id, again.name)).toBe(true) // emptied into Recovery
    expect(versionFolders()).toHaveLength(1) // still kept while it can come back
    await purgeRecoveryItem(again.id, again.name) // gone for good
    expect(versionFolders()).toHaveLength(0)
  })

  it('a new note made later at an old name does not pick up a binned note’s versions', async () => {
    writeFileSync(path.join(root, 'Plan.md'), 'old plan')
    await writeNote('Plan.md', 'old plan, edited')
    await trashEntry('Plan.md')
    writeFileSync(path.join(root, 'Plan.md'), 'a different plan')
    expect(await listVersions('Plan.md')).toEqual([])
  })
})

describe('awkward note names', () => {
  it('keeps, lists, reads and follows a rename for every name on the list', async () => {
    for (const [i, raw] of AWKWARD_NAMES.entries()) {
      const name = `${raw.trim()} ${i}.md` // the two "Café"s are one name on a Mac
      writeFileSync(path.join(root, name), `before ${i}`)
      await writeNote(name, `after ${i}`)
      expect(await texts(name)).toEqual([`before ${i}`])
      const moved = await renameEntry(name, `moved ${name}`)
      expect(await texts(moved)).toEqual([`before ${i}`])
    }
  })
})

describe('reading a version is fenced in', () => {
  it("refuses another note's version, and anything that isn't a version file", async () => {
    writeFileSync(path.join(root, 'A.md'), 'a1')
    writeFileSync(path.join(root, 'B.md'), 'b1')
    await writeNote('A.md', 'a2')
    await writeNote('B.md', 'b2')
    const [a] = await listVersions('A.md')
    await expect(readVersion('B.md', a.token)).rejects.toThrow()
    const id = a.token.split('/')[0]
    await expect(readVersion('A.md', `${id}/note.json`)).rejects.toThrow()
    await expect(readVersion('A.md', `${id}/../../../B.md`)).rejects.toThrow()
    await expect(readVersion('A.md', `../${a.token}`)).rejects.toThrow()
    await expect(listVersions('.mdnotes/versions')).rejects.toThrow()
  })
})

describe('the tidy-up', () => {
  it('thins old versions and removes a folder left empty', async () => {
    writeFileSync(path.join(root, 'T.md'), 'day 0')
    await writeNote('T.md', 'x0')
    for (let d = 1; d <= 40; d++) {
      at(d * 24 * 60 * MIN)
      await writeNote('T.md', `day ${d}`)
      at(d * 24 * 60 * MIN + 10 * MIN)
      await writeNote('T.md', `x${d}`)
    }
    // the first save keeps "day 0", then two saves a day keep two each: 1 + 2 × 40
    expect((await listVersions('T.md')).length).toBe(81)
    await sweepVersions()
    const left = await listVersions('T.md')
    const now = Date.now()
    const ages = left.map((v) => (now - v.at) / (24 * 60 * MIN))
    expect(Math.max(...ages)).toBeLessThan(30)
    // a week of everything (2 a day), then one a day
    expect(left.filter((v) => now - v.at < 7 * 24 * 60 * MIN).length).toBe(14)
    expect(left.length).toBeLessThan(40)

    at(400 * 24 * 60 * MIN)
    await sweepVersions()
    expect(versionFolders()).toHaveLength(0)
    await fs.access(path.join(root, 'T.md')) // the note itself is untouched
  })
})
