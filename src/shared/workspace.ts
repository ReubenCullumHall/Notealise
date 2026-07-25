// Workspace = the per-vault organisation layer: custom order, pins, archive
// flags, folder collapse state, and the recoverable bin. The filesystem alone
// only gives alphabetical order, so this has to be recorded somewhere — and by
// rule 2 that somewhere is <vault>/.mdnotes/workspace.json, never note
// frontmatter and never a database. Delete the file and you lose ordering and
// pins; every note is untouched and still opens in any other editor (rule 1).
//
// Pure types + validation, no fs and no DOM, so this is safe to import from
// main, preload and renderer alike (mirrors shared/settings.ts).

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
  /** folders only — whether the row is collapsed in the tree. */
  collapsed?: boolean
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

export interface Workspace {
  entries: Record<string, EntryMeta>
  trash: TrashItem[]
}

export const EMPTY_WORKSPACE: Workspace = { entries: {}, trash: [] }

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
  const collapsed = bool(v.collapsed)
  if (collapsed !== undefined) meta.collapsed = collapsed
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
  return { entries, trash }
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
