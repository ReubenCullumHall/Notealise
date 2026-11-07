// Word times for a transcribed recording (vault.ts, docs/plans/transcribe.md "Word times"): kept in
// <vault>/.mdnotes/transcripts/, handed back only while the recording is the one they were made from.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readWordTimes, recordingStamp, setVaultRoot, writeWordTimes } from './vault'

let root = ''
const words = [
  { text: 'Plants', from: 6730, to: 7080 },
  { text: '금요일', from: 540, to: 880 }
]

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'wordtimes-'))
  setVaultRoot(root)
  writeFileSync(path.join(root, 'Voice note 1.m4a'), Buffer.alloc(1000, 1))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('word times', () => {
  it('kept, then read back while the recording is unchanged', async () => {
    const stamp = await recordingStamp('Voice note 1.m4a')
    expect(stamp?.size).toBe(1000)
    await writeWordTimes('Voice note 1.m4a', stamp!, words)
    expect(await readWordTimes('Voice note 1.m4a')).toEqual(words)
    // stored inside the hidden folder, not beside the recording
    expect((await fs.readdir(path.join(root, '.mdnotes', 'transcripts'))).length).toBe(1)
  })
  it('a recording changed since (a clip edit saved over it) is a miss, never stale times', async () => {
    const stamp = await recordingStamp('Voice note 1.m4a')
    await writeWordTimes('Voice note 1.m4a', stamp!, words)
    writeFileSync(path.join(root, 'Voice note 1.m4a'), Buffer.alloc(900, 2))
    expect(await readWordTimes('Voice note 1.m4a')).toBeNull()
  })
  it('a recording changed DURING transcribing is a miss too (stamped when it started)', async () => {
    const stamp = await recordingStamp('Voice note 1.m4a')
    writeFileSync(path.join(root, 'Voice note 1.m4a'), Buffer.alloc(1200, 2))
    await writeWordTimes('Voice note 1.m4a', stamp!, words)
    expect(await readWordTimes('Voice note 1.m4a')).toBeNull()
  })
  it('a renamed recording is a cheap miss', async () => {
    await writeWordTimes('Voice note 1.m4a', (await recordingStamp('Voice note 1.m4a'))!, words)
    await fs.rename(path.join(root, 'Voice note 1.m4a'), path.join(root, 'Renamed.m4a'))
    expect(await readWordTimes('Renamed.m4a')).toBeNull()
  })
  it('nothing kept, a missing recording, or a path outside the vault: null, never a throw', async () => {
    expect(await readWordTimes('Voice note 1.m4a')).toBeNull()
    expect(await readWordTimes('nope.m4a')).toBeNull()
    expect(await readWordTimes('../../etc/passwd')).toBeNull()
    expect(await recordingStamp('../outside.m4a')).toBeNull()
  })
  it('a damaged times file is a miss', async () => {
    await writeWordTimes('Voice note 1.m4a', (await recordingStamp('Voice note 1.m4a'))!, words)
    const dir = path.join(root, '.mdnotes', 'transcripts')
    const [f] = await fs.readdir(dir)
    writeFileSync(path.join(dir, f), '{not json')
    expect(await readWordTimes('Voice note 1.m4a')).toBeNull()
  })
})
