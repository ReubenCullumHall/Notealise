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
  /** epoch ms — when it left the bin and entered the safety net. */
  purgedAt: number
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
  return meta
}

function normalizeTrashItem(raw: unknown): TrashItem | null {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = str(v.id)
  const from = str(v.from)
  const deletedAt = num(v.deletedAt)
  // Without an id the file can't be found, and without `from` it can't go back.
  if (!id || !from || deletedAt === undefined) return null
  return {
    id,
    from,
    name: str(v.name) ?? from.split('/').pop() ?? from,
    type: v.type === 'dir' ? 'dir' : 'file',
    deletedAt
  }
}

function normalizeRecoveryItem(raw: unknown): RecoveryItem | null {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = str(v.id)
  const from = str(v.from)
  const purgedAt = num(v.purgedAt)
  if (!id || !from || purgedAt === undefined) return null
  return {
    id,
    from,
    name: str(v.name) ?? from.split('/').pop() ?? from,
    type: v.type === 'dir' ? 'dir' : 'file',
    purgedAt
  }
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
