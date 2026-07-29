import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  getVaultRoot,
  purgeTrashItem,
  renameWithRetry,
  restoreEntry,
  trashEntry,
  trashEntryToOS
} from './vault'
import {
  EMPTY_WORKSPACE,
  isSelfOrDescendant,
  normalizeWorkspace,
  remapPath,
  type EntryMeta,
  type TrashItem,
  type Workspace
} from '../shared/workspace'

// Persistence for the organisation sidecar. Source of truth is
// <vault>/.mdnotes/workspace.json (rule 2; rule 6: only main touches fs). Writes
// are debounced (a drag-reorder fires many updates) and atomic — temp file,
// fsync, rename over — exactly like note saves in vault.ts, so a crash mid-write
// can never truncate the file. .mdnotes/ is ignored by the watcher, so these
// writes never echo back to the renderer as a tree change.
//
// This replaces the old spaces.json and is deliberately built on the same
// machinery, which had already solved the awkward parts: coalesced writes bound
// to the root captured at schedule time (so switching vaults mid-debounce can't
// misroute a write), a serialised write chain, and a flush before anything that
// touches the filesystem.

const WORKSPACE_FILE = 'workspace.json'

function workspacePathFor(root: string | null): string | null {
  return root ? path.join(root, '.mdnotes', WORKSPACE_FILE) : null
}

let latest: Workspace | null = null
let latestRoot: string | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
let writeChain: Promise<void> = Promise.resolve()

async function readFromDisk(root: string | null): Promise<Workspace> {
  const p = workspacePathFor(root)
  if (!p) return { ...EMPTY_WORKSPACE, entries: {}, trash: [] }
  try {
    let raw = await fs.readFile(p, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // tolerate a UTF-8 BOM
    return normalizeWorkspace(JSON.parse(raw))
  } catch {
    return { entries: {}, trash: [] } // no file yet — everything falls back to defaults
  }
}

async function ensureLoaded(): Promise<Workspace> {
  const root = getVaultRoot()
  if (latest && latestRoot === root) return latest
  latest = await readFromDisk(root)
  latestRoot = root
  return latest
}

async function writeAtomic(ws: Workspace, root: string | null): Promise<void> {
  const p = workspacePathFor(root)
  if (!p) return
  const dir = path.dirname(p)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${WORKSPACE_FILE}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(ws, null, 2), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await renameWithRetry(tmp, p) // .mdnotes/ is inside the vault, so it syncs too
}

/** Queue an atomic write of the current in-memory state, coalescing bursts. */
function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void persist()
  }, 150)
}

function persist(): Promise<void> {
  const snapshot = latest
  const root = latestRoot
  if (!snapshot) return Promise.resolve()
  writeChain = writeChain
    .then(() => writeAtomic(snapshot, root))
    .catch((e) => {
      // Non-fatal: the in-memory state is still correct and the next change
      // retries. Losing workspace.json only loses ordering and pins.
      console.error('workspace.json write failed', e)
    })
  return writeChain
}

/** Flush any pending debounced write immediately and wait for it to land. */
async function flushNow(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  await persist()
}

function commit(next: Workspace): Workspace {
  latest = next
  scheduleWrite()
  return next
}

// ---------------------------------------------------------------------------
// Public API (called by the IPC handlers)
// ---------------------------------------------------------------------------

export async function getWorkspace(): Promise<Workspace> {
  return ensureLoaded()
}

/** Merge `partial` into each of `paths`. One write for a whole multi-select
 *  action rather than one per row. */
export async function updateEntries(paths: string[], partial: EntryMeta): Promise<Workspace> {
  const ws = await ensureLoaded()
  const entries = { ...ws.entries }
  for (const p of paths) {
    if (!p) continue
    entries[p] = { ...entries[p], ...partial }
  }
  return commit(normalizeWorkspace({ ...ws, entries }))
}

/** Record a sibling order by assigning each path its index. Notes and folders
 *  share one sequence per parent, which is what lets them interleave. */
export async function reorderEntries(paths: string[]): Promise<Workspace> {
  const ws = await ensureLoaded()
  const entries = { ...ws.entries }
  paths.forEach((p, i) => {
    if (p) entries[p] = { ...entries[p], order: i }
  })
  return commit(normalizeWorkspace({ ...ws, entries }))
}

/** Re-key an entry and everything beneath it after a move/rename, so pins and
 *  order survive. Called by the same IPC handler that performs the rename. */
export async function migrateKey(from: string, to: string): Promise<Workspace> {
  const ws = await ensureLoaded()
  if (from === to) return ws
  const entries: Record<string, EntryMeta> = {}
  for (const [key, meta] of Object.entries(ws.entries)) {
    entries[remapPath(key, from, to)] = meta
  }
  return commit({ ...ws, entries })
}

/** Move entries into the bin. The filesystem move happens first; only entries
 *  that actually moved get a trash record, so a failed move can't leave a bin
 *  row pointing at nothing. Their metadata is dropped — a restored note comes
 *  back unpinned and unarchived, which is what localhost does too. */
export async function trashEntries(paths: string[]): Promise<Workspace> {
  await flushNow()
  const ws = await ensureLoaded()
  const entries = { ...ws.entries }
  const trash: TrashItem[] = [...ws.trash]

  // Deepest first, so trashing a folder and something inside it can't have the
  // child's move fail because its parent already left.
  const ordered = [...new Set(paths.filter(Boolean))].sort(
    (a, b) => b.split('/').length - a.split('/').length
  )
  for (const p of ordered) {
    // Skip anything already carried away by a folder trashed in this same batch.
    if (ordered.some((other) => other !== p && isSelfOrDescendant(p, other))) continue
    let moved: { id: string; type: 'dir' | 'file' }
    try {
      moved = await trashEntry(p)
    } catch (e) {
      console.error(`could not bin ${p}`, e)
      continue
    }
    trash.unshift({
      id: moved.id,
      from: p,
      name: p.split('/').pop() ?? p,
      type: moved.type,
      deletedAt: Date.now()
    })
    for (const key of Object.keys(entries)) {
      if (isSelfOrDescendant(key, p)) delete entries[key]
    }
  }
  const next = { entries, trash }
  latest = next
  await flushNow()
  return next
}

/** Put binned items back where they came from. */
export async function restoreEntries(ids: string[]): Promise<Workspace> {
  await flushNow()
  const ws = await ensureLoaded()
  const wanted = new Set(ids)
  const kept: TrashItem[] = []
  for (const item of ws.trash) {
    if (!wanted.has(item.id)) {
      kept.push(item)
      continue
    }
    try {
      await restoreEntry(item.id, item.name, item.from)
    } catch (e) {
      console.error(`could not restore ${item.name}`, e)
      kept.push(item) // leave it in the bin rather than losing the record
    }
  }
  const next = { entries: ws.entries, trash: kept }
  latest = next
  await flushNow()
  return next
}

/** Permanently remove binned items (no ids = empty the bin). */
export async function purgeEntries(ids?: string[]): Promise<Workspace> {
  await flushNow()
  const ws = await ensureLoaded()
  const wanted = ids && ids.length ? new Set(ids) : null
  const kept: TrashItem[] = []
  for (const item of ws.trash) {
    if (wanted && !wanted.has(item.id)) {
      kept.push(item)
      continue
    }
    await purgeTrashItem(item.id, item.name)
  }
  const next = { entries: ws.entries, trash: kept }
  latest = next
  await flushNow()
  return next
}

/** Delete a space's folder straight to the OS trash — deliberately NEVER
 *  through the app's own bin (see `trashEntryToOS`). Still clears any pin /
 *  archive / collapse flags recorded for the subtree, the same cleanup
 *  `trashEntries` does, since those entries would otherwise be dead weight
 *  in workspace.json referencing a path that no longer exists. */
export async function deleteSpace(folder: string): Promise<Workspace> {
  await flushNow()
  const ws = await ensureLoaded()
  await trashEntryToOS(folder) // throws on failure — caller surfaces it
  const entries = { ...ws.entries }
  for (const key of Object.keys(entries)) {
    if (isSelfOrDescendant(key, folder)) delete entries[key]
  }
  const next = { entries, trash: ws.trash }
  latest = next
  await flushNow()
  return next
}

/** Called on vault activation: flush the outgoing vault's pending write to its
 *  own root, then drop the in-memory state so the next read loads the new vault. */
export async function resetWorkspaceForVaultSwitch(): Promise<void> {
  await flushNow()
  latest = null
  latestRoot = null
}
