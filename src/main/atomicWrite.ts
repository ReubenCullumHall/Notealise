// Saving a small settings file so it is never left half-written, and keeping a copy
// of one that turns out to be damaged before anything writes over it.
//
// settings.json and workspace.json have had both since the 2026-10-27 bug scan, each
// in its own file. The two files in userData that were still written in place —
// config.json (which folder to reopen, onboarding done, the update choice) and
// presets.json (the saved looks) — use these (app check 2026-11-09).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { renameWithRetry } from './vault'

/** Write `text` to `file` by way of a temp file beside it: written whole, flushed to
 *  the disk, then renamed over the real one. Written in place, a crash or a power cut
 *  part-way through left a cut-off file — which reads as "nothing saved" at the next
 *  launch, and is then written over. A failure leaves the file as it was and no temp
 *  file behind. */
export async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)
  try {
    const fh = await fs.open(tmp, 'w')
    try {
      await fh.writeFile(text, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    await renameWithRetry(tmp, file)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

/** Copy a file that is there but can't be used (cut off, or not what it should be) to
 *  `<name>.damaged-<time><ext>` beside it, before the next save replaces it. Once per
 *  damaged file: a second look at the same bytes doesn't copy again. Never throws —
 *  the copy must not stop the app opening. */
const kept = new Set<string>()
export async function keepDamagedCopy(file: string): Promise<void> {
  try {
    const raw = await fs.readFile(file)
    const key = `${file}:${raw.length}:${raw.subarray(0, 64).toString('hex')}`
    if (kept.has(key)) return
    kept.add(key)
    const { dir, name, ext } = path.parse(file)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.writeFile(path.join(dir, `${name}.damaged-${stamp}${ext}`), raw)
  } catch {
    /* best effort */
  }
}
