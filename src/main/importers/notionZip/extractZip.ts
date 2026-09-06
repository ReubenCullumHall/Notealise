import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'
import { ZIP_LIMITS, assertSafeZip } from './inspectZip'

// A 6-second extraction hung for 30+ minutes the first time this ran for
// real (2026-08-04). Root cause: `spawn`'s stdout/stdin default to pipes, and
// this neither drained stdout nor closed stdin. A pipe nobody reads fills its
// OS buffer (~64KB) and blocks the child's next write forever; a prompt on
// stdin (a warning, an odd entry) blocks forever the same way, since nothing
// is connected to answer it. Both are silent — the child just never exits,
// so `close` never fires and the promise hangs with no error, no timeout,
// nothing. `stdio: ['ignore', 'pipe', 'pipe']` plus actually consuming both
// pipes (even by discarding the data) removes both traps, and the timeout
// below is the backstop for whatever this reasoning missed.
function run(
  cmd: string,
  args: string[],
  timeoutMs = 10 * 60_000,
  /** Polled every 2s while the child runs. Return a reason to kill it. The
   *  archive's declared sizes are a claim (`assertSafeZip` checks them, and a
   *  hostile archive can simply lie), so this watches what is actually landing
   *  on disk. */
  guard?: () => Promise<string | null>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let failure: Error | null = null
    child.stdout.on('data', () => {}) // drain — unread output can block the child
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    const timer = setTimeout(() => {
      failure = new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`)
      child.kill()
    }, timeoutMs)
    const watch = guard
      ? setInterval(() => {
          void guard().then((reason) => {
            if (!reason || failure) return
            failure = new Error(reason)
            child.kill()
          })
        }, 2000)
      : null
    const done = (): void => {
      clearTimeout(timer)
      if (watch) clearInterval(watch)
    }
    child.on('error', (e) => {
      done()
      reject(e)
    })
    child.on('close', (code) => {
      done()
      if (failure) reject(failure)
      else if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}: ${stderr.trim()}`))
    })
  })
}

/** Bytes currently sitting under `dir`. Cheap enough to poll: it walks names
 *  and stats, and stops counting once it is past the ceiling — the answer only
 *  has to be "too much" or "not yet". */
async function bytesUnder(dir: string, limit: number): Promise<number> {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const at = stack.pop() as string
    const entries = await fs.readdir(at, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const p = path.join(at, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.isFile()) {
        total += await fs
          .stat(p)
          .then((s) => s.size)
          .catch(() => 0)
        if (total > limit) return total
      }
    }
  }
  return total
}

/** One extraction, using the OS's own tool — no bundled zip dependency.
 *  macOS uses `ditto`, not `unzip`: confirmed against a real export
 *  (2026-08-04) that `unzip` mangles a filename containing an en-dash into
 *  invalid UTF-8 and then aborts the whole archive on the resulting write
 *  error — Apple's own unzip build has no working charset flag to fix this
 *  (`-O`/`-I`, present in mainline Info-ZIP, aren't in Apple's fork). `ditto`
 *  is what Finder itself uses to extract a double-clicked .zip and decoded
 *  the same file correctly. */
async function unzipTo(zipPath: string, destDir: string): Promise<void> {
  // Before a single byte is written. `ditto` sanitises hostile entry names on
  // its own; `Expand-Archive` does not, and the app used to add nothing on
  // either platform. See inspectZip.ts.
  await assertSafeZip(zipPath)
  await fs.mkdir(destDir, { recursive: true })
  const guard = async (): Promise<string | null> =>
    (await bytesUnder(destDir, ZIP_LIMITS.MAX_TOTAL_BYTES)) > ZIP_LIMITS.MAX_TOTAL_BYTES
      ? 'That archive is unpacking to more than this can import, so it was stopped.'
      : null
  if (process.platform === 'win32') {
    const esc = (s: string): string => s.replace(/'/g, "''")
    await run(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${esc(zipPath)}' -DestinationPath '${esc(destDir)}' -Force`
      ],
      10 * 60_000,
      guard
    )
  } else {
    await run('ditto', ['-x', '-k', zipPath, destDir], 10 * 60_000, guard)
  }
}

/** Real content, as opposed to archive/metadata noise. */
async function meaningfulEntries(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries
    .filter((e) => e.name !== '__MACOSX' && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
}

/** Remove extraction folders left behind by earlier imports.
 *
 *  `extractZip` creates `<temp>/notes-import-<hex>/`, and only ever removed the
 *  INTERMEDIATE peel levels — the final extraction was never cleaned up, not
 *  after a preview, not after a run, not after a failure. So every Notion import
 *  left a complete second copy of the user's whole workspace sitting in the OS
 *  temp directory, indefinitely. For a product whose promise is that your notes
 *  are files in one folder you chose, that is a privacy point at least as much
 *  as a disk-space one.
 *
 *  Swept at launch rather than deleted when an import ends, because the same
 *  extraction is used by `importPreview` and then again by `importRun` — the
 *  moment it stops being needed is not a moment this module can see. An hour is
 *  far longer than any import and far shorter than "forever". */
export async function sweepStaleExtractions(maxAgeMs = 60 * 60_000): Promise<void> {
  const dir = app.getPath('temp')
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const now = Date.now()
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith('notes-import-')) continue
    const p = path.join(dir, e.name)
    const stat = await fs.stat(p).catch(() => null)
    if (!stat || now - stat.mtimeMs < maxAgeMs) continue
    await fs.rm(p, { recursive: true, force: true }).catch(() => {})
  }
}

/** Extracts a Notion export .zip and returns the folder that should be
 *  treated as the export root.
 *
 *  Notion nests archives: the file you download is a zip whose only contents
 *  are further `…-Part-N.zip` archives (confirmed against a real export,
 *  2026-08-04 — a single extraction yields another .zip and no notes at all,
 *  which is exactly what made the first import report "0 notes"). Large
 *  workspaces are split across several parts, so every part is extracted into
 *  ONE merged folder rather than the first one winning.
 *
 *  Also unwraps a lone top-level folder, since that's how the parts are
 *  themselves packed. */
export async function extractZip(zipPath: string): Promise<string> {
  const base = path.join(app.getPath('temp'), `notes-import-${randomBytes(6).toString('hex')}`)
  let current = path.join(base, 'level-0')
  await unzipTo(zipPath, current)

  // Peel nested archive layers. Bounded rather than `while (true)`: a
  // malformed or hostile archive must not spin here.
  for (let depth = 1; depth <= 3; depth++) {
    const entries = await meaningfulEntries(current)
    const zips = entries.filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.zip'))
    if (zips.length === 0 || zips.length !== entries.length) break

    const next = path.join(base, `level-${depth}`)
    for (const zip of zips) await unzipTo(path.join(current, zip.name), next)
    // The intermediate holds only archives already expanded into `next`;
    // dropping it keeps a multi-hundred-MB export from sitting in temp twice.
    await fs.rm(current, { recursive: true, force: true }).catch(() => {})
    current = next
  }

  const entries = await meaningfulEntries(current)
  if (entries.length === 1 && entries[0].isDir) return path.join(current, entries[0].name)
  return current
}
