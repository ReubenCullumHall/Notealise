// Clearing out the app's own temporary folders that a quit, a crash or a power
// cut left behind.
//
// Three jobs work in a private folder under the system's temp folder and remove it
// when they end: Transcribe (`notealise-transcribe-…`, the recording as a WAV —
// about 115 MB an hour), the recording converter (`notealise-voice-…`) and Save
// as / Print (`notealise-print-…`, the note itself as a web page). When the app
// goes away mid-job, that removal never runs. macOS empties its temp folder by
// itself in time; Windows never does (docs/app-check-2026-11-09.md, "Quitting
// mid-Transcribe"). So at launch, anything of ours that nothing has touched for
// a day is removed — the same idea as `sweepStaleExtractions` for Notion imports.
//
// A day, not "whatever is there": another copy of the app may be running a job
// right now (a test copy beside the installed one shares the temp folder but not
// the one-copy-at-a-time lock), and no real job runs anywhere near that long.
//
// No Electron import, so it is tested against a real folder (tempSweep.test.ts).

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Exactly what `mkdtemp` makes from our three prefixes: the prefix and six
 *  characters. Deliberately not "anything starting notealise-": the onboarding
 *  practice vault (`notealise-onboarding-test`) lives in the same folder. */
const OURS = /^notealise-(transcribe|voice|print)-[A-Za-z0-9]{6}$/

export const STALE_TEMP_MS = 24 * 60 * 60_000

/** Remove our stale temp folders from `dir`. Answers the names it removed. Never throws. */
export async function sweepStaleTemp(dir = os.tmpdir(), maxAgeMs = STALE_TEMP_MS, now = Date.now()): Promise<string[]> {
  const removed: string[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    // A real folder only: `isDirectory()` is false for a link, so a link wearing
    // one of our names is never followed.
    if (!e.isDirectory() || !OURS.test(e.name)) continue
    const p = path.join(dir, e.name)
    try {
      // "Untouched" = neither the folder nor anything directly in it has changed.
      let newest = (await fs.lstat(p)).mtimeMs
      for (const name of await fs.readdir(p)) {
        newest = Math.max(newest, (await fs.lstat(path.join(p, name))).mtimeMs)
      }
      if (now - newest < maxAgeMs) continue
      await fs.rm(p, { recursive: true, force: true })
      removed.push(e.name)
    } catch {
      // held by another program, or gone already — the next launch tries again
    }
  }
  return removed
}
