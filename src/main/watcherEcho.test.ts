import { afterEach, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, realpathSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setVaultRoot, writeNote } from './vault'
import { startWatching, stopWatching } from './watcher'

// Bug scan 2026-11-19, item 18: a vault opened through a link (a shortcut folder,
// or /var/folders on a Mac) was watched under the link's path while the app's own
// writes were marked under the real one — so every save came back as a change
// made outside the app (a full re-read of the vault, and the note reloaded).
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const made: string[] = []
afterEach(async () => {
  await stopWatching()
  for (const p of made.splice(0)) await fs.rm(p, { recursive: true, force: true })
})

it("the app's own save is not reported back, with the vault opened through a link", async () => {
  const real = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'mdnotes-echo-')))
  const link = real + '-link'
  made.push(real, link)
  await fs.writeFile(path.join(real, 'Note.md'), 'one\n')
  symlinkSync(real, link, 'junction') // a junction on Windows needs no admin; the type is ignored elsewhere
  setVaultRoot(link)
  const seen: string[] = []
  startWatching(link, (c) => seen.push(...c.paths))
  await sleep(1500)
  seen.length = 0
  await writeNote('Note.md', 'two\n')
  await sleep(1300)
  expect(seen).toEqual([])
  // …while a change made outside still is
  await fs.writeFile(path.join(real, 'Note.md'), 'three\n')
  await sleep(1300)
  expect(seen).toContain('Note.md')
}, 20000)
