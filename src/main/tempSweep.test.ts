// The launch clean-up of the app's own temp folders (tempSweep.ts), against a real
// folder. What matters most is what it must NOT delete.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { STALE_TEMP_MS, sweepStaleTemp } from './tempSweep'

let tmp = ''
const DAY = 24 * 60 * 60_000
const exists = (name: string): Promise<boolean> => fs.access(path.join(tmp, name)).then(() => true, () => false)

/** A folder holding one file, both last touched `ageMs` ago. */
async function folder(name: string, ageMs: number, file = 'input.wav'): Promise<void> {
  const dir = path.join(tmp, name)
  await fs.mkdir(dir)
  await fs.writeFile(path.join(dir, file), 'x'.repeat(100))
  const when = new Date(Date.now() - ageMs)
  await fs.utimes(path.join(dir, file), when, when)
  await fs.utimes(dir, when, when)
}

const CAN_SYMLINK = ((): boolean => {
  const probe = mkdtempSync(path.join(os.tmpdir(), 'sweep-link-probe-'))
  try {
    writeFileSync(path.join(probe, 't'), 'x')
    symlinkSync(path.join(probe, 't'), path.join(probe, 'l'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sweep-test-')))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('the launch clean-up of temp folders', () => {
  it('removes what a quit mid-Transcribe, mid-conversion or mid-print left, once a day old', async () => {
    await folder('notealise-transcribe-Ab3xY9', 2 * DAY)
    await folder('notealise-voice-000000', 2 * DAY, 'input.m4a')
    await folder('notealise-print-zZzZzZ', 2 * DAY, 'note.html')
    const removed = await sweepStaleTemp(tmp)
    expect(removed.sort()).toEqual(['notealise-print-zZzZzZ', 'notealise-transcribe-Ab3xY9', 'notealise-voice-000000'])
    expect(await fs.readdir(tmp)).toEqual([])
  })

  // Another copy of the app may be in the middle of one right now.
  it('leaves a job that could still be running', async () => {
    await folder('notealise-transcribe-fresh1', 0)
    await folder('notealise-transcribe-hours3', 3 * 60 * 60_000)
    await folder('notealise-transcribe-almost', STALE_TEMP_MS - 60_000)
    expect(await sweepStaleTemp(tmp)).toEqual([])
    expect((await fs.readdir(tmp)).length).toBe(3)
  })

  it('goes by the newest thing inside, not the folder’s own date', async () => {
    await folder('notealise-transcribe-active', 2 * DAY)
    // the program wrote its output a minute ago
    await fs.writeFile(path.join(tmp, 'notealise-transcribe-active', 'input.wav.json'), '{}')
    const old = new Date(Date.now() - 2 * DAY)
    await fs.utimes(path.join(tmp, 'notealise-transcribe-active'), old, old)
    expect(await sweepStaleTemp(tmp)).toEqual([])
    expect(await exists('notealise-transcribe-active')).toBe(true)
  })

  it('never touches anything that is not exactly one of ours', async () => {
    await folder('notealise-onboarding-test', 30 * DAY, 'Welcome.md') // the practice vault
    await folder('notealise-transcribe-', 30 * DAY)
    await folder('notealise-transcribe-toolong77', 30 * DAY)
    await folder('notealise-other-Ab3xY9', 30 * DAY)
    await folder('notes-import-a1b2c3d4e5f6', 30 * DAY) // the Notion sweep's, with its own rule
    await folder('someone-elses-notealise-print-Ab3xY9', 30 * DAY)
    await folder('Notealise-Print-Ab3xY9', 30 * DAY)
    await fs.writeFile(path.join(tmp, 'notealise-voice-AFILE1'), 'a file, not a folder')
    const old = new Date(Date.now() - 30 * DAY)
    await fs.utimes(path.join(tmp, 'notealise-voice-AFILE1'), old, old)
    const before = (await fs.readdir(tmp)).sort()
    expect(await sweepStaleTemp(tmp)).toEqual([])
    expect((await fs.readdir(tmp)).sort()).toEqual(before)
    expect(await exists('notealise-onboarding-test/Welcome.md')).toBe(true)
  })

  it('does not follow a link wearing one of our names', async (ctx) => {
    ctx.skip(!CAN_SYMLINK, 'this process cannot create symlinks — not verified here')
    const precious = path.join(tmp, 'precious')
    await fs.mkdir(precious)
    await fs.writeFile(path.join(precious, 'thesis.md'), 'years of work')
    const old = new Date(Date.now() - 30 * DAY)
    await fs.utimes(path.join(precious, 'thesis.md'), old, old)
    await fs.utimes(precious, old, old)
    symlinkSync(precious, path.join(tmp, 'notealise-print-LINKED'))
    expect(await sweepStaleTemp(tmp)).toEqual([])
    expect(await exists('precious/thesis.md')).toBe(true)
  })

  it('removes a link INSIDE a stale folder without following it', async (ctx) => {
    ctx.skip(!CAN_SYMLINK, 'this process cannot create symlinks — not verified here')
    const precious = path.join(tmp, 'precious')
    await fs.mkdir(precious)
    await fs.writeFile(path.join(precious, 'thesis.md'), 'years of work')
    await folder('notealise-voice-Ab3xY9', 2 * DAY)
    symlinkSync(precious, path.join(tmp, 'notealise-voice-Ab3xY9', 'out'))
    const old = new Date(Date.now() - 2 * DAY)
    await fs.lutimes(path.join(tmp, 'notealise-voice-Ab3xY9', 'out'), old, old)
    await fs.utimes(path.join(tmp, 'notealise-voice-Ab3xY9'), old, old)
    expect(await sweepStaleTemp(tmp)).toEqual(['notealise-voice-Ab3xY9'])
    expect(await exists('precious/thesis.md')).toBe(true)
  })

  it('is quiet about a temp folder that is not there', async () => {
    expect(await sweepStaleTemp(path.join(tmp, 'nowhere'))).toEqual([])
  })
})
