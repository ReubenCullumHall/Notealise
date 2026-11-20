import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const userData = path.join(os.tmpdir(), `notealise-settings-test-${process.pid}`)
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { setVaultRoot } = await import('./vault')
const { getSettings, setSettings } = await import('./settings')

// Bug scan 2026-11-19, item 7: a settings.json that EXISTS but can't be read for a
// moment (OneDrive or antivirus holding it, a cloud copy not downloaded yet) was
// read as "no settings", and the next save wrote the defaults over every space's look.
// chmod 000 makes a file unreadable on a Mac or Linux only — on Windows it just sets
// "read-only", which still reads. The Windows pass checks this with the file held
// open by another program instead (docs/bug-scan-2026-11-19.md, "Windows checks").
describe.skipIf(process.platform === 'win32')('a settings.json that cannot be read', () => {
  let root = ''
  const file = (): string => path.join(root, '.mdnotes', 'settings.json')

  beforeEach(async () => {
    await fs.mkdir(userData, { recursive: true })
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdnotes-settings-'))
    await fs.mkdir(path.join(root, '.mdnotes'), { recursive: true })
    setVaultRoot(root)
    await setSettings({ dateFormat: 'ymd' })
  })
  afterEach(async () => {
    await fs.chmod(file(), 0o644).catch(() => {})
    await fs.rm(root, { recursive: true, force: true })
  })

  it('a save is refused rather than writing the defaults over it', async () => {
    const before = await fs.readFile(file(), 'utf8')
    await fs.chmod(file(), 0o000)
    await expect(setSettings({ numberFormat: 'comma' })).rejects.toThrow()
    await fs.chmod(file(), 0o644)
    expect(await fs.readFile(file(), 'utf8')).toBe(before)
  })

  it('a plain read still answers (the defaults), so the app opens', async () => {
    await fs.chmod(file(), 0o000)
    await expect(getSettings()).resolves.toBeTruthy()
  })

  it('a save goes through once the file can be read again', async () => {
    await fs.chmod(file(), 0o000)
    setTimeout(() => void fs.chmod(file(), 0o644), 120)
    const s = await setSettings({ numberFormat: 'comma' })
    expect(s.dateFormat).toBe('ymd')
  })
})
