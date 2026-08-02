import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import type { TreeNode } from '../shared/types'
import { indexLinks, stripMd, type LinkRow } from '../shared/links'
import { sanitizeFilename } from './filenames'

// ---------------------------------------------------------------------------
// Vault state. This module is the ONLY place in the app that touches `fs`.
// ---------------------------------------------------------------------------
let vaultRoot: string | null = null

export function setVaultRoot(root: string): void {
  vaultRoot = path.resolve(root)
}
export function getVaultRoot(): string | null {
  return vaultRoot
}

function requireVault(): string {
  if (!vaultRoot) throw new Error('No vault is open')
  return vaultRoot
}

// macOS (APFS) and Windows (NTFS) are case-insensitive but case-preserving, so
// name comparisons must fold case on both. Linux is case-sensitive.
const caseInsensitiveFs = process.platform === 'win32' || process.platform === 'darwin'
const foldCase = (s: string): string => (caseInsensitiveFs ? s.toLowerCase() : s)
/** Canonical comparison key for an absolute path. */
const key = (abs: string): string => foldCase(path.normalize(abs))

// ---------------------------------------------------------------------------
// The security boundary. Every incoming path is vault-relative; resolve it and
// refuse anything that escapes the vault root (../ traversal, absolute paths,
// Windows drive hops). THIS CHECK LIVES ONLY HERE, IN MAIN.
// ---------------------------------------------------------------------------
function assertInVault(abs: string): void {
  const rel = path.relative(requireVault(), abs)
  if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error(`Path escapes the vault: ${abs}`)
  }
}
function resolveInVault(relPath: string): string {
  const abs = path.resolve(requireVault(), relPath)
  assertInVault(abs)
  return abs
}

/** vault-relative, POSIX-style path for an absolute path inside the vault. */
function toRel(abs: string): string {
  return path.relative(requireVault(), abs).split(path.sep).join('/')
}

// Windows caps a full path at 260 chars unless long-path support is on. Check on
// every platform so a Mac user is warned before making a vault that breaks on Win.
function assertPathLength(abs: string): void {
  if (abs.length > 259) {
    throw new Error(
      `Path is too long (${abs.length} chars). Windows caps paths at 260 — use a shorter name or a shallower folder.`
    )
  }
}

/** Is a name already used in `dirAbs`, compared case-insensitively? `exceptAbs`
 *  (the entry being renamed) is not counted against itself. */
async function nameTaken(dirAbs: string, name: string, exceptAbs?: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await fs.readdir(dirAbs)
  } catch {
    return false
  }
  const target = foldCase(name)
  const except = exceptAbs ? key(exceptAbs) : null
  for (const e of entries) {
    if (foldCase(e) !== target) continue
    if (except && key(path.join(dirAbs, e)) === except) continue
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Line endings. CodeMirror normalises to LF internally, so to avoid silently
// rewriting every CRLF file a Windows user opens, we detect the dominant ending
// on read, remember it per file, and restore it on write.
// ---------------------------------------------------------------------------
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const CRLF = CR + LF
const crlfByPath = new Map<string, boolean>()

function isCrlfDominant(content: string): boolean {
  let crlf = 0
  let loneLf = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== LF) continue
    if (content[i - 1] === CR) crlf++
    else loneLf++
  }
  return crlf > loneLf
}
function applyEol(content: string, useCrlf: boolean): string {
  const lf = content.split(CRLF).join(LF) // normalise to LF first
  return useCrlf ? lf.split(LF).join(CRLF) : lf
}
async function resolveEol(abs: string): Promise<boolean> {
  const k = key(abs)
  if (crlfByPath.has(k)) return crlfByPath.get(k) as boolean
  try {
    return isCrlfDominant(await fs.readFile(abs, 'utf8'))
  } catch {
    return os.EOL === CRLF
  }
}

// ---------------------------------------------------------------------------
// Renames, retried. On Windows a file can be briefly locked by something else
// holding a handle — OneDrive syncing it, an antivirus scanner, a search
// indexer — and `rename` then fails with EPERM/EACCES/EBUSY. It is transient:
// the lock is released in tens of milliseconds. Without this, an autosave onto
// a synced vault (a very normal setup) fails and the user's edit is lost, which
// is the worst bug this app could have. Retry with a short backoff, then give up
// and surface the real error.
// ---------------------------------------------------------------------------
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY'])
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? ''
      if (i >= attempts - 1 || !TRANSIENT.has(code)) throw e
      await sleep(30 * 2 ** i) // 30, 60, 120, 240, 480ms — ~0.9s total
    }
  }
}

// ---------------------------------------------------------------------------
// Echo guard: paths the app itself just wrote, so the watcher can ignore its
// own writes and not loop. ~1.5s TTL.
// ---------------------------------------------------------------------------
const recentWrites = new Set<string>()
function markWrite(abs: string): void {
  const k = key(abs)
  recentWrites.add(k)
  setTimeout(() => recentWrites.delete(k), 1500).unref()
}
export function wasRecentlyWritten(abs: string): boolean {
  return recentWrites.has(key(abs))
}

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------
function ignored(name: string): boolean {
  // dotfiles + dot-folders (covers .mdnotes/, and so the bin) and node_modules
  return name.startsWith('.') || name === 'node_modules'
}
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
}

// The second line of a sidebar row. Only the head of the file is read — a tree
// walk touches every note, so reading them whole would make a large vault crawl.
const PREVIEW_BYTES = 400
const PREVIEW_CHARS = 90

/** Strip the markdown that would read as noise in a one-line preview, then
 *  collapse whitespace. Mirrors legacy's `preview()` (legacy/src/App.jsx:66). */
function toPreview(raw: string): string {
  return raw
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '') // frontmatter block
    .replace(/^#{1,6}\s+/gm, '') // heading marks
    .replace(/^\s{0,3}>\s?/gm, '') // blockquote marks
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, '') // bullets + task boxes
    .replace(/`{1,3}/g, '')
    .replace(/[*_~]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links/images → their text
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PREVIEW_CHARS)
}

/** Read just the head of a note for its preview. Never throws — an unreadable
 *  file must not fail the whole tree, it just gets no second line. */
async function readPreview(abs: string): Promise<string | undefined> {
  let fh: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    fh = await fs.open(abs, 'r')
    const buf = Buffer.alloc(PREVIEW_BYTES)
    const { bytesRead } = await fh.read(buf, 0, PREVIEW_BYTES, 0)
    const text = toPreview(buf.subarray(0, bytesRead).toString('utf8'))
    return text || undefined
  } catch {
    return undefined
  } finally {
    await fh?.close().catch(() => {})
  }
}

async function readDir(absDir: string): Promise<TreeNode[]> {
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (ignored(e.name)) continue
    const abs = path.join(absDir, e.name)
    if (e.isDirectory()) {
      nodes.push({ name: e.name, path: toRel(abs), type: 'dir', children: await readDir(abs) })
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      // One stat per note, for "made / last edited". The walk already opens and
      // reads the head of every file for its preview, so this is the cheaper
      // half of what this loop was already doing.
      // `birthtime` is not recorded by every filesystem — where it isn't, it
      // comes back as 0 or as the mtime; either way it is left off rather than
      // shown as 1970 (`|| undefined` below).
      const st = await fs.stat(abs).catch(() => null)
      nodes.push({
        name: e.name,
        path: toRel(abs),
        type: 'file',
        preview: await readPreview(abs),
        createdAt: st ? st.birthtimeMs || undefined : undefined,
        updatedAt: st ? st.mtimeMs || undefined : undefined
      })
    }
  }
  nodes.sort(compareNodes)
  return nodes
}
export async function listTree(): Promise<TreeNode[]> {
  return readDir(requireVault())
}

// ---------------------------------------------------------------------------
// The wiki-link scan
// ---------------------------------------------------------------------------
// The renderer needs to know which notes link to which, and it can't read files
// (rule 6). So main reads them and hands back only the LINKS — never the
// documents. A vault of a thousand notes is a thousand small arrays over the
// bridge, not a thousand documents.
//
// Main parses but deliberately does NOT resolve: which note `[[Waves]]` means
// depends on where the *linking* note sits, which space it's in and what the
// sidebar is showing — none of which are main's business. `shared/links.ts` is
// the parser both sides use, so the two can't disagree about what a link is.
//
// Nothing is written to disk. There is no index file, no cache, no database
// (rules 1 and 2): the vault's own text is the index, and this is just a read.

/** Every `.md` under `absDir`, depth first, honouring the same `ignored()` rule
 *  the tree walk uses so `.mdnotes/` and the bin never appear. */
async function listMarkdown(absDir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (ignored(e.name)) continue
    const abs = path.join(absDir, e.name)
    if (e.isDirectory()) await listMarkdown(abs, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(abs)
  }
}

/**
 * The outgoing links of every note in the vault, or of just `paths` when given.
 *
 * `paths` is the whole freshness story: the watcher reports what changed, and
 * only those notes are re-read. A note the user is *typing* in isn't re-read at
 * all — the renderer already holds that text and parses it in process.
 *
 * An unreadable file is skipped rather than failing the scan: one bad file in a
 * synced vault must not cost the user every backlink they have.
 */
export async function scanLinks(paths?: string[]): Promise<LinkRow[]> {
  const root = requireVault()
  let files: string[]
  if (paths) {
    files = paths.filter((p) => p.toLowerCase().endsWith('.md')).map((p) => resolveInVault(p))
  } else {
    files = []
    await listMarkdown(root, files)
  }
  const rows: LinkRow[] = []
  for (const abs of files) {
    const text = await fs.readFile(abs, 'utf8').catch(() => null)
    if (text === null) continue // deleted between the watcher event and here, or unreadable
    rows.push({ path: toRel(abs), links: indexLinks(text) })
  }
  return rows
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------
export async function readNote(relPath: string): Promise<string> {
  const abs = resolveInVault(relPath)
  const content = await fs.readFile(abs, 'utf8')
  crlfByPath.set(key(abs), isCrlfDominant(content))
  return content
}

/** Atomic write: temp file in the same directory, fsync, then rename over the
 *  target. A crash mid-write can never truncate the real note. The stored line
 *  ending is restored. The temp name is a dotfile, so the watcher and tree never
 *  see it. */
export async function writeNote(relPath: string, content: string): Promise<void> {
  const abs = resolveInVault(relPath)
  if (path.relative(requireVault(), abs) === '') throw new Error('Cannot write the vault root')
  const data = applyEol(content, await resolveEol(abs))
  const dir = path.dirname(abs)
  const tmp = path.join(dir, `.${path.basename(abs)}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  markWrite(abs)
  markWrite(tmp)
  try {
    await renameWithRetry(tmp, abs)
  } catch (e) {
    // Don't leave the scratch file behind in the user's vault when the rename
    // loses — it's a dotfile so nothing shows it, and they accumulate silently.
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

/** First available "<stem><ext>" in `dirAbs`; suffixes " (2)", " (3)"... on a
 *  collision rather than failing. Shared by createNote/createFolder (there's
 *  no user-typed name to collide with any more — creating one is a single
 *  click) and by restoreEntry (whose original name may have been retaken
 *  since deletion). */
async function uniqueName(dirAbs: string, stem: string, ext: string): Promise<string> {
  let candidate = `${stem}${ext}`
  for (let n = 2; await nameTaken(dirAbs, candidate); n++) {
    candidate = `${stem} (${n})${ext}`
  }
  return candidate
}

/** Create `<dirPath>/<name>.md` (dirPath "" = vault root), defaulting to
 *  "Untitled" and suffixing " (2)" etc. if that name's taken. Returns the actual
 *  rel path it landed at — the name is sanitised, so it may not be the one asked
 *  for, and the caller must use what comes back.
 *
 *  `name` exists for clicking an unwritten `[[link]]`: creating and then renaming
 *  would be two fs operations, two watcher events, and a window in which the
 *  wrong filename is on disk. */
export async function createNote(dirPath: string, name?: string): Promise<string> {
  const dirAbs = resolveInVault(dirPath)
  const stem = name ? sanitizeFilename(stripMd(name)).name : 'Untitled'
  const fname = await uniqueName(dirAbs, stem, '.md')
  const abs = path.join(dirAbs, fname)
  assertPathLength(abs)
  markWrite(abs)
  const fh = await fs.open(abs, 'wx') // 'wx' throws if the exact name already exists
  await fh.close()
  return toRel(abs)
}

/** Create a folder named "New folder" (or "New folder (2)" etc. if that's
 *  taken) inside `dirPath` ("" = vault root). Returns the actual rel path it
 *  landed at. */
export async function createFolder(dirPath: string): Promise<string> {
  const dirAbs = resolveInVault(dirPath)
  const fname = await uniqueName(dirAbs, 'New folder', '')
  const abs = path.join(dirAbs, fname)
  assertPathLength(abs)
  markWrite(abs)
  await fs.mkdir(abs)
  return toRel(abs)
}

/** Rename/move an entry. The target's final segment is sanitised. Handles a
 *  case-only rename (Note.md -> note.md) via a temp name so case-insensitive
 *  filesystems don't no-op or error. Returns the actual new rel path. */
export async function renameEntry(fromPath: string, toPath: string): Promise<string> {
  const fromAbs = resolveInVault(fromPath)
  const toRaw = resolveInVault(toPath)
  const dir = path.dirname(toRaw)
  const { name: safe } = sanitizeFilename(path.basename(toRaw))
  const toAbs = path.join(dir, safe)
  assertInVault(toAbs)
  assertPathLength(toAbs)

  const caseOnly = key(fromAbs) === key(toAbs) && fromAbs !== toAbs
  if (!caseOnly && (await nameTaken(dir, safe, fromAbs))) {
    throw new Error('A note or folder with that name already exists')
  }

  markWrite(fromAbs)
  markWrite(toAbs)
  if (caseOnly) {
    const tmp = path.join(dir, `.${safe}.${randomBytes(6).toString('hex')}.casetmp`)
    markWrite(tmp)
    await renameWithRetry(fromAbs, tmp)
    await renameWithRetry(tmp, toAbs)
  } else {
    await renameWithRetry(fromAbs, toAbs)
  }

  // carry the remembered line-ending across the rename
  const fk = key(fromAbs)
  if (crlfByPath.has(fk)) {
    crlfByPath.set(key(toAbs), crlfByPath.get(fk) as boolean)
    crlfByPath.delete(fk)
  }
  return toRel(toAbs)
}

// ---------------------------------------------------------------------------
// The bin. Deleting moves an entry into <vault>/.mdnotes/trash/ rather than
// handing it to the OS, so it stays recoverable in-app the way localhost's bin
// is. `.mdnotes/` is already skipped by `ignored()` and by the watcher, so a
// binned entry leaves the tree for free. Emptying the bin is the ONLY path that
// reaches the OS trash — nothing here ever hard-unlinks a note.
// ---------------------------------------------------------------------------
const TRASH_DIR = '.mdnotes/trash'

/** Absolute path of a binned entry. The id prefix keeps two notes of the same
 *  name from colliding in the flat trash folder. */
function trashAbs(id: string, name: string): string {
  return resolveInVault(`${TRASH_DIR}/${id}-${name}`)
}

/** Move an entry into the bin. Returns the id needed to restore it. */
export async function trashEntry(relPath: string): Promise<{ id: string; type: 'dir' | 'file' }> {
  const abs = resolveInVault(relPath)
  if (path.relative(requireVault(), abs) === '') throw new Error('Cannot delete the vault root')
  const stat = await fs.stat(abs)
  const id = randomBytes(6).toString('hex')
  const dest = trashAbs(id, path.basename(abs))
  await fs.mkdir(path.dirname(dest), { recursive: true })
  markWrite(abs)
  markWrite(dest)
  await renameWithRetry(abs, dest)
  return { id, type: stat.isDirectory() ? 'dir' : 'file' }
}

/** Put a binned entry back at `to`. Its original parent may have been deleted or
 *  renamed since, so the folder is recreated; a name collision is resolved by
 *  suffixing rather than failing, so Restore always succeeds. Returns the actual
 *  rel path it landed at. */
export async function restoreEntry(id: string, name: string, to: string): Promise<string> {
  const src = trashAbs(id, name)
  const destRaw = resolveInVault(to)
  const dir = path.dirname(destRaw)
  await fs.mkdir(dir, { recursive: true })

  const ext = path.extname(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  const candidate = path.join(dir, await uniqueName(dir, stem, ext))
  assertInVault(candidate)
  assertPathLength(candidate)
  markWrite(src)
  markWrite(candidate)
  await renameWithRetry(src, candidate)
  return toRel(candidate)
}

/** Permanently remove a binned entry — hands it to the OS trash, so even this is
 *  recoverable outside the app. `shell` is imported lazily so the rest of this
 *  module (all node:fs/path) can be exercised outside the Electron runtime. */
export async function purgeTrashItem(id: string, name: string): Promise<void> {
  const abs = trashAbs(id, name)
  markWrite(abs)
  const { shell } = await import('electron')
  try {
    await shell.trashItem(abs)
  } catch {
    // Already gone (bin emptied outside the app, or a failed earlier move) —
    // the caller still drops the record, so the bin doesn't keep a dead row.
  }
}

/** Send a LIVE entry straight to the OS trash, bypassing `.mdnotes/trash`
 *  entirely. Used only for deleting a space: a space is a different level of
 *  the hierarchy from the notes and folders inside it, and putting a deleted
 *  space in the same bin as an individual trashed note conflates the two. The
 *  two-step "click again to delete" button is the confirmation; this is still
 *  recoverable, just from the OS's own Recycle Bin/Trash rather than in-app. */
export async function trashEntryToOS(relPath: string): Promise<void> {
  const abs = resolveInVault(relPath)
  if (path.relative(requireVault(), abs) === '') throw new Error('Cannot delete the vault root')
  markWrite(abs)
  const { shell } = await import('electron')
  await shell.trashItem(abs)
}
