// Workspace = the per-vault organisation layer: custom order, pins, archive
// flags, folder collapse state, and the recoverable bin. The filesystem alone
// only gives alphabetical order, so this has to be recorded somewhere — and by
// rule 2 that somewhere is <vault>/.mdnotes/workspace.json, never note
// frontmatter and never a database. Delete the file and you lose ordering and
// pins; every note is untouched and still opens in any other editor (rule 1).
//
// Pure types + validation, no fs and no DOM, so this is safe to import from
// main, preload and renderer alike (mirrors shared/settings.ts).

import { normalizeHex } from './color'

/** Per-entry organisation state, keyed by vault-relative POSIX path. Every field
 *  is optional on disk; an absent field falls back to a sensible default, so a
 *  note created in Explorer behaves correctly with no entry at all. */
export interface EntryMeta {
  /** position within its parent. Notes and folders share ONE sequence per parent,
   *  which is what lets free-arrange interleave them; absent → sorts last. */
  order?: number
  pinned?: boolean
  archived?: boolean
  /** epoch ms, set when archived; used by the archive's "recently archived" sort. */
  archivedAt?: number
  /** epoch ms, set when this entry lands here via a cross-space drag-drop (see
   *  organise/model.ts `splitMoved`). Hoists it into a "Moved" group at the top
   *  of its new parent's list instead of wherever alphabetical/free-arrange
   *  order would bury it — a cross-space drop is blind (the destination isn't
   *  the list you were looking at), so it needs a deliberate parking spot.
   *  Cleared the moment the entry is moved/reordered again: that action IS the
   *  user sorting it into place, the same way `App.tsx`'s `move` clears it. */
  movedAt?: number
  /** folders only — whether the row is collapsed in the tree. */
  collapsed?: boolean
  /** `#rrggbb`, the colour this row is tagged with in the sidebar. Absent means
   *  no colour of its own — a note or subfolder then shows the nearest coloured
   *  ancestor's (see `colorOf` in organise/model.ts).
   *
   *  It belongs here rather than in settings.json because it is a property of
   *  THIS entry, the same as its pin and its position, and here it is re-keyed
   *  for free when the entry is renamed or moved (`migrateKey`). Losable, like
   *  the rest of this file (rule 2): delete workspace.json and you lose the
   *  colours, never a note. */
  color?: string
  /** this note is being shown as raw Markdown (Markdown pro's corner button).
   *
   *  A property of THIS note, exactly like its pin and its colour, so it belongs
   *  here and gets re-keyed on rename for free (`migrateKey`). Losable with the
   *  rest of the file (rule 2): delete workspace.json and every note goes back
   *  to the formatted view, which is the harmless direction. */
  rawView?: boolean
  /** this note is showing the code behind each photo and video (the eye button).
   *
   *  Stored beside `rawView` and losable on the same terms, but a SEPARATE flag
   *  rather than a second value of one: they answer different questions and are
   *  usefully on at the same time. Raw view shows every syntax mark in the note;
   *  this shows only what each embed points at, and leaves the prose alone. */
  mediaSource?: boolean
}

/** Where a binned photo or video came from INSIDE a note, so restoring it can
 *  put the note back too and not just the file.
 *
 *  Only ever set for media deleted through the editor's grip-and-Backspace —
 *  a note or folder deleted from the sidebar has no such thing, which is why
 *  this is optional rather than a second item type. Without it, Restore returns
 *  a photo to the vault and leaves the note it illustrated still missing it,
 *  which is the asymmetry this record exists to close.
 *
 *  `text` is the exact source that was cut, trailing newline and all, so
 *  putting it back is a paste rather than a reconstruction — the same reasoning
 *  the delete dialog's Cancel is built on. `line` is where to aim it; the note
 *  may have been edited since, so it is a hint, not a promise (see App's
 *  `putMediaBack`). */
export interface MediaOrigin {
  /** the note it was embedded in, vault-relative */
  note: string
  /** the exact text that was removed, including any trailing newline */
  text: string
  /** 1-based line the removed text started on. Kept for older records and as
   *  the tie-breaker when the anchor below matches in more than one place. */
  line: number
  /** 0-based offset into that line. Needed as well as `line` because an embed
   *  written mid-sentence is cut on its own, not with its line — putting it
   *  back at the start of the line would move it. */
  col: number
  /** The note's own text immediately BEFORE the cut, and immediately after it,
   *  captured at delete time — the photo's neighbours rather than its
   *  coordinates.
   *
   *  Why this exists. A line and column describe the note as it was at the
   *  moment of deletion, and a bin item can sit for seven days. Type two
   *  paragraphs at the top and every line below moves, so "line 5" now names
   *  something else entirely: the restore lands the picture in the wrong place
   *  while reporting that it went back where it was. Demonstrated, not
   *  theorised — it put a photo above the note's own heading.
   *
   *  The neighbours don't move. Whatever the user does elsewhere, the text that
   *  sat either side of the picture is still sitting together — because
   *  removing the embed is exactly what joined them. So `before + after` is a
   *  string that appears in the note verbatim, and the seam between the two
   *  halves is the spot. Optional: records written before this existed have
   *  neither, and fall back to the coordinates. */
  before?: string
  after?: string
}

/** How much of each neighbour to keep.
 *
 *  The trade is between ambiguity and fragility: too short and the anchor
 *  matches in several places, too long and any nearby edit breaks it. 40 is
 *  roughly a line of prose, and `spliceMediaBack` retries at `SHORT_ANCHOR`
 *  before giving up, so a small edit next to the picture costs precision rather
 *  than the whole match. */
export const ANCHOR = 40
const SHORT_ANCHOR = 14

/** Where a restored photo ended up, in decreasing order of confidence. The
 *  notice says which, because "back where it was" has to be true when it is
 *  said — the previous version claimed it unconditionally. */
export type MediaLanding =
  /** both neighbours matched: this IS the spot */
  | 'anchored'
  /** one neighbour, or the old line/column: the right region, not a promise */
  | 'aimed'
  /** nothing recognisable left — on the end, where it can't land inside
   *  something else */
  | 'appended'

/** Put a restored photo's source text back into its note.
 *
 *  Pure and shared so it can be tested directly: this is the one piece of the
 *  restore that can silently produce a WRONG note rather than an obvious
 *  failure — an off-by-one splices an embed into the middle of a word, and
 *  nothing downstream would notice.
 *
 *  The search, in order, stopping at the first that matches:
 *
 *  1. Both neighbours, full length. The note is recognisable around the gap, so
 *     the seam between them is exactly where the picture came from.
 *  2. Both neighbours, shortened. Covers an edit that clipped the outer end of
 *     one of them without touching the picture's immediate surroundings.
 *  3. One neighbour, when the other is empty — the picture was at the very top
 *     or very bottom of the note, so there was never a second side to match.
 *  4. The old line/column, for records written before anchors existed.
 *  5. The end of the note.
 *
 *  Deliberately NOT falling back to line/column when anchors were recorded and
 *  failed to match: if the neighbours are gone the note has been rewritten
 *  around that spot, which is precisely when a stale coordinate aims at
 *  something unrelated. Appending is worse-looking and honest; the coordinate
 *  is better-looking and sometimes a lie. */
export function spliceMediaBack(doc: string, m: MediaOrigin): { doc: string; how: MediaLanding } {
  const put = (at: number): string => doc.slice(0, at) + m.text + doc.slice(at)
  const before = m.before ?? ''
  const after = m.after ?? ''

  if (m.before !== undefined || m.after !== undefined) {
    const rungs: [string, string][] = [
      [before, after],
      [before.slice(-SHORT_ANCHOR), after.slice(0, SHORT_ANCHOR)]
    ]
    for (const [b, a] of rungs) {
      // Both halves required: a one-sided match in the middle of a note is a
      // much weaker claim, and rung 3 below handles the case where one side
      // genuinely does not exist.
      if (!b || !a) continue
      const at = soleSeam(doc, b, a, m.line)
      if (at !== null) return { doc: put(at), how: 'anchored' }
    }
    // The picture was at one end of the note, so only one neighbour was ever
    // captured. Matching it is the best available and is reported as such.
    const edge = !before ? after.slice(0, SHORT_ANCHOR) : !after ? before.slice(-SHORT_ANCHOR) : ''
    if (edge) {
      const hits = allIndexesOf(doc, edge)
      if (hits.length === 1) return { doc: put(before ? hits[0] + edge.length : hits[0]), how: 'aimed' }
    }
  } else {
    // No anchors: an older bin record. The coordinates are all there is.
    const lines = doc.split('\n')
    const line = lines[m.line - 1]
    if (line !== undefined && m.col <= line.length) {
      lines[m.line - 1] = line.slice(0, m.col) + m.text + line.slice(m.col)
      return { doc: lines.join('\n'), how: 'aimed' }
    }
  }

  // Trailing newlines are re-made rather than kept, so appending twice can't
  // stack blank lines; the embed's own text is trimmed of them for the same
  // reason — it may or may not carry the newline it was cut with.
  const body = doc.replace(/\n*$/, '')
  const text = m.text.replace(/^\n+|\n+$/g, '')
  return { doc: (body ? body + '\n\n' : '') + text + '\n', how: 'appended' }
}

/** Every index at which `needle` occurs in `hay`. Overlapping matches included:
 *  a repeated anchor is exactly the ambiguous case the caller has to know about,
 *  and skipping past each match would hide some of it. */
function allIndexesOf(hay: string, needle: string): number[] {
  const out: number[] = []
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) out.push(i)
  return out
}

/** The offset of the seam between `b` and `a` where they sit joined in `doc`,
 *  or null if that pair isn't there.
 *
 *  More than one match is normal in a note with repeated structure (a list of
 *  photos under identical headings, say). The recorded line breaks the tie:
 *  everything else about the candidates is identical by definition, so nearest
 *  to where it used to be is the only signal left — and it is a good one, since
 *  an edit big enough to move a line a long way is rare next to one that
 *  duplicated a phrase. */
function soleSeam(doc: string, b: string, a: string, line: number): number | null {
  const hits = allIndexesOf(doc, b + a)
  if (!hits.length) return null
  if (hits.length === 1) return hits[0] + b.length
  let best = hits[0]
  let bestGap = Infinity
  for (const hit of hits) {
    const at = hit + b.length
    const gap = Math.abs(lineAt(doc, at) - line)
    if (gap < bestGap) {
      bestGap = gap
      best = hit
    }
  }
  return best + b.length
}

/** 1-based line number of an offset. */
function lineAt(doc: string, at: number): number {
  let n = 1
  for (let i = 0; i < at; i++) if (doc[i] === '\n') n++
  return n
}

/** One item sitting in the recoverable bin. The file really has been moved to
 *  <vault>/.mdnotes/trash/, so `from` is the only record of where it belongs;
 *  losing it means the item can only be restored to the vault root. */
export interface TrashItem {
  /** random id, also the on-disk prefix inside .mdnotes/trash/. */
  id: string
  /** vault-relative path it was deleted from, for Restore. */
  from: string
  /** display name (basename of `from`). */
  name: string
  type: 'dir' | 'file'
  /** epoch ms. */
  deletedAt: number
  /** set only for a photo/video deleted from inside a note — see MediaOrigin. */
  media?: MediaOrigin
}

/** One item that has left the bin but not yet the disk — the second-stage
 *  safety net (main/vault.ts's recovery block). Reaching here means "delete
 *  this" was already said once (into the bin) and once more (emptying it /
 *  force-deleting it). It expires RECOVERY_TTL_MS after `purgedAt`, at which
 *  point the app deletes it for real, or the user can force that sooner from
 *  Settings. Deliberately absent from the normal bin UI — Settings-only. */
export interface RecoveryItem {
  /** random id, also the on-disk prefix inside .mdnotes/recovery/. */
  id: string
  /** vault-relative path it was deleted from, for Restore. */
  from: string
  /** display name (basename of `from`). */
  name: string
  type: 'dir' | 'file'
  /** carried through from the bin, so a restore from HERE puts the note back
   *  too — exactly as a restore one stage earlier would have. */
  media?: MediaOrigin
  /** epoch ms — when it left the bin and entered the safety net. */
  purgedAt: number
}

// Where held-aside files physically live. Shared, not private to main, because
// the renderer needs them to offer "show me this file" on a bin row — and
// because they are the reason a binned photo LOOKS lost: `.mdnotes` is a
// dot-folder, so Finder and File Explorer both hide it by default. Somebody
// looking for their photo will not find it by looking.
export const TRASH_DIR = '.mdnotes/trash'
export const RECOVERY_DIR = '.mdnotes/recovery'

/** Where a held item's file actually is, vault-relative. The id prefix is what
 *  keeps two same-named notes from colliding in one flat folder. */
export function heldPath(dir: string, id: string, name: string): string {
  return `${dir}/${id}-${name}`
}

/** What a restore actually did.
 *
 *  `landed` is id → where the file really ended up, which is NOT always the
 *  `from` it was promised: if something has taken that name in the meantime,
 *  restore suffixes rather than overwrites. Returning it is what lets a restored
 *  photo's embed be pointed at the file that now exists instead of the one it
 *  used to be — without this the note comes back with a broken picture and
 *  nothing says why. */
export interface RestoreResult {
  workspace: Workspace
  landed: Record<string, string>
}

/** True when this really is a Workspace and not something that only got as far
 *  as looking like one.
 *
 *  Exists because a renderer that trusted it wasn't handed `undefined` blanked
 *  the entire window: React unmounts the whole tree on a render error, so ONE
 *  bad IPC payload cost the user their interface with no message. Cheap enough
 *  to run on every reply from main, and the alternative is not cheap at all. */
export function isWorkspace(v: unknown): v is Workspace {
  if (!v || typeof v !== 'object') return false
  const w = v as Partial<Workspace>
  return !!w.entries && typeof w.entries === 'object' && Array.isArray(w.trash) && Array.isArray(w.recovery)
}

/** A RestoreResult out of whatever main actually sent.
 *
 *  Main used to return a bare Workspace here and now returns `{ workspace,
 *  landed }`. In `npm run dev` the renderer hot-reloads and the main process
 *  does NOT, so for as long as it takes to notice, a renderer speaking the new
 *  contract is talking to a main speaking the old one. That skew is a normal
 *  condition of working on this app, and it must degrade — losing only the
 *  landed-path detail — rather than take the window down. */
export function asRestoreResult(v: unknown): RestoreResult | null {
  if (isWorkspace(v)) return { workspace: v, landed: {} }
  const r = v as Partial<RestoreResult> | null
  if (r && isWorkspace(r.workspace)) {
    return { workspace: r.workspace, landed: r.landed && typeof r.landed === 'object' ? r.landed : {} }
  }
  return null
}

/** How long a purged item survives in the safety net before the app deletes
 *  it for real. */
export const RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface Workspace {
  entries: Record<string, EntryMeta>
  trash: TrashItem[]
  recovery: RecoveryItem[]
}

export const EMPTY_WORKSPACE: Workspace = { entries: {}, trash: [], recovery: [] }

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined

/** Coerce one parsed value into a clean EntryMeta, dropping anything invalid so a
 *  bad field falls back to a default rather than corrupting the map. */
export function normalizeEntry(raw: unknown): EntryMeta {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const meta: EntryMeta = {}
  const order = num(v.order)
  if (order !== undefined) meta.order = order
  const pinned = bool(v.pinned)
  if (pinned !== undefined) meta.pinned = pinned
  const archived = bool(v.archived)
  if (archived !== undefined) meta.archived = archived
  const archivedAt = num(v.archivedAt)
  if (archivedAt !== undefined) meta.archivedAt = archivedAt
  const movedAt = num(v.movedAt)
  if (movedAt !== undefined) meta.movedAt = movedAt
  const collapsed = bool(v.collapsed)
  if (collapsed !== undefined) meta.collapsed = collapsed
  // Anything that isn't a colour is dropped rather than stored — this value is
  // interpolated straight into a CSS custom property, so "whatever the file
  // said" is not an acceptable answer.
  const color = normalizeHex(v.color)
  if (color !== null) meta.color = color
  const rawView = bool(v.rawView)
  if (rawView !== undefined) meta.rawView = rawView
  const mediaSource = bool(v.mediaSource)
  if (mediaSource !== undefined) meta.mediaSource = mediaSource
  return meta
}

/** TrashItem and RecoveryItem are the same record — an entry held aside
 *  somewhere under .mdnotes/ with a note of where it came from — differing only
 *  in which field names when it arrived (`deletedAt` / `purgedAt`). One
 *  coercion covers both, so a fix to the malformed-input handling can't be made
 *  in one and forgotten in the other. */
function normalizeHeldItem(
  raw: unknown,
  stampKey: 'deletedAt' | 'purgedAt'
): (Omit<TrashItem, 'deletedAt'> & { stamp: number }) | null {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = str(v.id)
  const from = str(v.from)
  const stamp = num(v[stampKey])
  const media = normalizeMediaOrigin(v.media)
  // Without an id the file can't be found, and without `from` it can't go back;
  // without the timestamp the bin can't sort it and recovery can't expire it.
  if (!id || !from || stamp === undefined) return null
  return {
    id,
    from,
    name: str(v.name) ?? from.split('/').pop() ?? from,
    type: v.type === 'dir' ? 'dir' : 'file',
    stamp,
    ...(media ? { media } : {})
  }
}

/** A MediaOrigin out of arbitrary parsed JSON, or undefined. All three fields
 *  are required together: a note with no text to put in it, or text with no
 *  note to put it in, would leave Restore promising something it cannot do,
 *  which is the exact failure the whole recovery net exists to avoid. */
function normalizeMediaOrigin(raw: unknown): MediaOrigin | undefined {
  const v = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!v) return undefined
  const note = str(v.note)
  // Not `str`, which rejects whitespace-only — an embed's source text is never
  // blank, but the check that matters here is "is it a string at all".
  const text = typeof v.text === 'string' && v.text ? v.text : undefined
  const line = num(v.line)
  const col = num(v.col)
  if (!note || !text || line === undefined || line < 1) return undefined
  // Anchors are optional and stay optional: `undefined` means "this record
  // predates them, use the coordinates", whereas an empty string means "the
  // picture was at the very top/bottom, there is genuinely nothing that side".
  // Collapsing the two would send old records down the anchor path with nothing
  // to match on, and they would all land on the end of the note.
  // Clamped from the END for `before` and the START for `after`: those are the
  // halves that touch the picture, and a corrupt or hand-edited file could
  // otherwise hand us an anchor far longer than one was ever written.
  const before = typeof v.before === 'string' ? v.before.slice(-ANCHOR) : undefined
  const after = typeof v.after === 'string' ? v.after.slice(0, ANCHOR) : undefined
  return {
    note,
    text,
    line,
    col: col !== undefined && col >= 0 ? col : 0,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {})
  }
}

function normalizeTrashItem(raw: unknown): TrashItem | null {
  const held = normalizeHeldItem(raw, 'deletedAt')
  if (!held) return null
  const { stamp, ...rest } = held
  return { ...rest, deletedAt: stamp }
}

function normalizeRecoveryItem(raw: unknown): RecoveryItem | null {
  const held = normalizeHeldItem(raw, 'purgedAt')
  if (!held) return null
  const { stamp, ...rest } = held
  return { ...rest, purgedAt: stamp }
}

/** Coerce arbitrary parsed JSON into a valid Workspace. Never throws; unknown or
 *  malformed entries are dropped rather than failing the whole file — a corrupt
 *  sidecar must never stop the vault from opening. */
export function normalizeWorkspace(raw: unknown): Workspace {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const entries: Record<string, EntryMeta> = {}
  const rawEntries = v.entries
  if (rawEntries && typeof rawEntries === 'object') {
    for (const [key, val] of Object.entries(rawEntries as Record<string, unknown>)) {
      if (!key || !val || typeof val !== 'object') continue
      entries[key] = normalizeEntry(val)
    }
  }
  const trash: TrashItem[] = []
  if (Array.isArray(v.trash)) {
    for (const t of v.trash) {
      const item = normalizeTrashItem(t)
      if (item) trash.push(item)
    }
  }
  const recovery: RecoveryItem[] = []
  if (Array.isArray(v.recovery)) {
    for (const r of v.recovery) {
      const item = normalizeRecoveryItem(r)
      if (item) recovery.push(item)
    }
  }
  return { entries, trash, recovery }
}

// ---------------------------------------------------------------------------
// Path helpers. Keys are vault-relative POSIX paths, so moving an entry has to
// re-key it AND everything beneath it — these are shared so main and renderer
// agree on exactly what "beneath" means.
// ---------------------------------------------------------------------------

/** True when `path` is `underPath` itself or a descendant of it. Compares whole
 *  segments, so "notesX" is never treated as a child of "notes". */
export function isSelfOrDescendant(path: string, underPath: string): boolean {
  if (underPath === '') return true
  return path === underPath || path.startsWith(underPath + '/')
}

/** Re-key `path` for a move of `from` → `to`, or return it unchanged. */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(from + '/')) return to + path.slice(from.length)
  return path
}
