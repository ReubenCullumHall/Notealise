import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { deleteEntry, getVaultRoot, renameEntry } from './vault'
import { normalizeSpaces, type SpaceMeta, type SpacesMap } from '../shared/spaces'

// Persistence for spaces presentation metadata. Source of truth is
// <vault>/.mdnotes/spaces.json (rule 2; rule 6: only main touches fs). Writes are
// debounced (a drag-reorder fires many updates) and atomic — temp file, fsync,
// rename over — exactly like note saves in vault.ts, so a crash mid-write can
// never truncate the file. .mdnotes/ is ignored by the watcher, so these writes
// never echo back to the renderer as a tree change.

const SPACES_FILE = 'spaces.json'

function spacesPathFor(root: string | null): string | null {
  return root ? path.join(root, '.mdnotes', SPACES_FILE) : null
}

// In-memory truth for the active vault. `latestRoot` is captured so a debounced
// write always lands in the vault it was scheduled for, even if the user has
// since switched vaults.
let latest: SpacesMap | null = null
let latestRoot: string | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null
// Serialise the physical writes so an in-flight write can't be overtaken.
let writeChain: Promise<void> = Promise.resolve()

async function readFromDisk(root: string | null): Promise<SpacesMap> {
  const p = spacesPathFor(root)
  if (!p) return {}
  try {
    let raw = await fs.readFile(p, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // tolerate a UTF-8 BOM
    return normalizeSpaces(JSON.parse(raw))
  } catch {
    return {} // no file yet (or it was deleted) — everything falls back to defaults
  }
}

async function ensureLoaded(): Promise<SpacesMap> {
  const root = getVaultRoot()
  if (latest && latestRoot === root) return latest
  latest = await readFromDisk(root)
  latestRoot = root
  return latest
}

async function writeAtomic(map: SpacesMap, root: string | null): Promise<void> {
  const p = spacesPathFor(root)
  if (!p) return
  const dir = path.dirname(p)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${SPACES_FILE}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(map, null, 2), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.rename(tmp, p)
}

/** Queue an atomic write of the current in-memory map, coalescing bursts. Binds
 *  to the root captured at schedule time so a later vault switch can't misroute
 *  the write. */
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
  writeChain = writeChain.then(() => writeAtomic(snapshot, root)).catch((e) => {
    // A failed write is non-fatal: the in-memory map is still correct and the
    // next change will try again. Losing spaces.json only loses colours.
    console.error('spaces.json write failed', e)
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

// ---------------------------------------------------------------------------
// Public API (called by the IPC handlers)
// ---------------------------------------------------------------------------

export async function getSpaces(): Promise<SpacesMap> {
  return ensureLoaded()
}

/** Merge `partial` into one space's metadata and persist (debounced). */
export async function updateSpace(name: string, partial: SpaceMeta): Promise<SpacesMap> {
  const map = await ensureLoaded()
  const next = normalizeSpaces({ ...map, [name]: { ...map[name], ...partial } })
  latest = next
  scheduleWrite()
  return next
}

/** Record the rail's left-to-right order by assigning each name its index. */
export async function reorderSpaces(names: string[]): Promise<SpacesMap> {
  const map = await ensureLoaded()
  const next: SpacesMap = { ...map }
  names.forEach((n, i) => {
    next[n] = { ...next[n], order: i }
  })
  latest = normalizeSpaces(next)
  scheduleWrite()
  return latest
}

/** Rename a space: move the top-level folder, then migrate its spaces.json key.
 *  Order matters — the hard-to-undo filesystem move happens first; if the
 *  metadata write then fails, the folder move is rolled back so we never leave
 *  orphaned metadata pointing at a folder under the wrong name. */
export async function renameSpace(
  oldName: string,
  newName: string
): Promise<{ name: string; spaces: SpacesMap }> {
  await flushNow() // land any debounced change before mutating on disk
  const map = await ensureLoaded()
  const root = getVaultRoot()

  // 1. Rename the folder. renameEntry sanitises the name, rejects collisions and
  //    handles case-only renames; for a top-level folder its returned rel path is
  //    just the (possibly corrected) new folder name.
  const actual = await renameEntry(oldName, newName)

  // 2. Migrate the metadata key. Roll the folder move back if this fails.
  const next: SpacesMap = { ...map }
  if (Object.prototype.hasOwnProperty.call(next, oldName)) {
    next[actual] = next[oldName]
    delete next[oldName]
  }
  try {
    await writeAtomic(next, root)
  } catch (e) {
    try {
      await renameEntry(actual, oldName)
    } catch {
      /* best-effort rollback; surface the original failure regardless */
    }
    throw e
  }
  latest = next
  latestRoot = root
  return { name: actual, spaces: next }
}

/** Trash a space's folder (recoverable via the OS trash) and drop its metadata. */
export async function deleteSpace(name: string): Promise<SpacesMap> {
  await flushNow()
  await deleteEntry(name)
  const map = await ensureLoaded()
  const next: SpacesMap = { ...map }
  delete next[name]
  latest = next
  await flushNow()
  return next
}

/** Called on vault activation: flush the outgoing vault's pending write to its
 *  own root, then drop the in-memory map so the next read loads the new vault. */
export async function resetSpacesForVaultSwitch(): Promise<void> {
  await flushNow()
  latest = null
  latestRoot = null
}
