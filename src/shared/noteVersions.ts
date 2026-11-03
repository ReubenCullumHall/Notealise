// Earlier versions of a note — the rules, kept pure so main (which keeps and tidies
// the copies) and the tests share one answer. Plan and decisions:
// docs/plans/note-versions.md.
//
// On disk (main/noteVersions.ts does the writing):
//   <vault>/.mdnotes/versions/<id>/note.json                      { "path": "Space/Lecture 4.md" }
//   <vault>/.mdnotes/versions/<id>/2026-11-03T14-32-05.123Z Lecture 4.md
// Each copy is the note's text exactly as it was on disk, as a plain .md any editor
// opens. One folder per note, so a rename only rewrites that folder's note.json, and
// two computers sharing the folder through OneDrive never write the same file.
// Losable (hard rule 2): delete the folder and the history goes, never a note.

import { sanitizeFilename } from './filenames'

export const VERSIONS_DIR = '.mdnotes/versions'
export const VERSION_INFO = 'note.json'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/** How often a copy is kept — Settings → Data → Earlier versions (Reuben,
 *  2026-11-03: "everytime you close the note from a tab (default) then the other
 *  options as a choice"). Whole-vault, not per space: it is about keeping notes
 *  safe, not how a set of them looks. */
export type VersionEveryId = 'close' | 'quit' | '1' | '5' | '15'
export const DEFAULT_VERSION_EVERY: VersionEveryId = 'close'
export const VERSION_EVERY: { id: VersionEveryId; label: string; example: string }[] = [
  { id: 'close', label: 'When you close the note', example: 'Closing its tab, opening another note in it, or quitting' },
  // Reuben, 2026-11-03: "and another option of 'every time I close the app'".
  { id: 'quit', label: 'When you close the app', example: 'Each note you changed, once, as the app quits' },
  { id: '1', label: 'Every minute while you write', example: 'The most copies to choose from' },
  { id: '5', label: 'Every 5 minutes while you write', example: 'A copy at most every 5 minutes' },
  { id: '15', label: 'Every 15 minutes while you write', example: 'Fewer, further apart' }
]
export function isVersionEvery(v: unknown): v is VersionEveryId {
  return VERSION_EVERY.some((o) => o.id === v)
}
/** The gap between timed copies, or null for "when you close the note" / "when
 *  you close the app" (the renderer keeps those, as the note or the app closes). */
export function versionEveryMs(id: VersionEveryId): number | null {
  return id === 'close' || id === 'quit' ? null : Number(id) * MINUTE
}

/** In every choice, one straight away before a save that takes away this much
 *  text — about a sentence — so "just before I deleted the paragraph" always
 *  exists. */
export const BIG_REMOVAL_CHARS = 100
/** Every version for a week, then one a day per note up to 30 days, then gone. */
export const KEEP_ALL_MS = 7 * DAY
export const KEEP_DAILY_MS = 30 * DAY

/** A version folder's id: 12 hex characters, made by main. Anything else in the
 *  versions folder is not ours to read or delete. */
export function isVersionId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{12}$/.test(id)
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z(?: [^/\\]*)?\.md$/

/** The file name for a version kept at `at`, of the note called `noteName`. The
 *  time comes first so the files sort oldest-first anywhere; it is in UTC with a Z
 *  (colons swapped for dashes — Windows refuses them) so a Mac and a PC sharing one
 *  folder agree on the order. The name is only there for someone browsing the
 *  folder; `maxName` lets main drop it when the full path would be too long. */
export function versionFileName(at: number, noteName: string, maxName = 40): string {
  const stamp = new Date(at).toISOString().replace(/:/g, '-')
  const stem = noteName.replace(/\.md$/i, '')
  let name = sanitizeFilename(stem).name.replace(/\.+$/, '').trim()
  if (name.length > maxName) name = name.slice(0, maxName).trim()
  return name ? `${stamp} ${name}.md` : `${stamp}.md`
}

/** When a version file was kept, or null when the name isn't one of ours. */
export function versionTime(file: string): number | null {
  if (typeof file !== 'string' || file.length > 200) return null
  const m = STAMP.exec(file)
  if (!m) return null
  const [, y, mo, d, h, mi, s, ms] = m
  const at = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms)
  return Number.isFinite(at) ? at : null
}

/** How much of `before` a save to `after` takes away, measured as the stretch
 *  between what the two share at the start and at the end. A typed word or two
 *  measures a few characters; selecting a paragraph and deleting it (or pasting
 *  over it) measures the paragraph. */
export function removedChars(before: string, after: string): number {
  const max = Math.min(before.length, after.length)
  let p = 0
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p++
  let s = 0
  while (s < max - p && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s++
  return before.length - p - s
}

/** The local calendar day a time falls on, for "one a day". */
export function localDay(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** Which of one note's versions the tidy-up deletes: none younger than a week;
 *  between a week and 30 days, all but the last of each day; everything older. */
export function versionsToDrop(
  versions: { file: string; at: number }[],
  now: number,
  dayOf: (at: number) => string = localDay
): string[] {
  const drop: string[] = []
  const lastOfDay = new Map<string, { file: string; at: number }>()
  for (const v of versions) {
    const age = now - v.at
    if (age < KEEP_ALL_MS) continue
    if (age >= KEEP_DAILY_MS) {
      drop.push(v.file)
      continue
    }
    const day = dayOf(v.at)
    const kept = lastOfDay.get(day)
    if (!kept) lastOfDay.set(day, v)
    else if (v.at > kept.at) {
      drop.push(kept.file)
      lastOfDay.set(day, v)
    } else drop.push(v.file)
  }
  return drop
}

/** One version as the renderer sees it. `token` is `<id>/<file>` — what it hands
 *  back to read that version; main checks it belongs to the note. */
export interface NoteVersion {
  token: string
  at: number
  bytes: number
}
