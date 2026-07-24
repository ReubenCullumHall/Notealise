import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import type { TreeNode } from '../shared/types'
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
  // dotfiles + dot-folders (covers .mdnotes/) and node_modules
  return name.startsWith('.') || name === 'node_modules'
}
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name)
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
      nodes.push({ name: e.name, path: toRel(abs), type: 'file' })
    }
  }
  nodes.sort(compareNodes)
  return nodes
}
export async function listTree(): Promise<TreeNode[]> {
  return readDir(requireVault())
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
  await fs.rename(tmp, abs)
}

/** Create `<dirPath>/<name>.md` (dirPath "" = vault root). Name is sanitised for
 *  cross-platform safety; returns the actual (possibly corrected) rel path. */
export async function createNote(dirPath: string, name: string): Promise<string> {
  const { name: safe } = sanitizeFilename(name)
  const fname = safe.toLowerCase().endsWith('.md') ? safe : `${safe}.md`
  const abs = resolveInVault(dirPath ? `${dirPath}/${fname}` : fname)
  assertPathLength(abs)
  if (await nameTaken(path.dirname(abs), path.basename(abs))) {
    throw new Error('A note or folder with that name already exists')
  }
  markWrite(abs)
  const fh = await fs.open(abs, 'wx') // 'wx' throws if the exact name already exists
  await fh.close()
  return toRel(abs)
}

/** Create a folder at `relPath`; the final segment is sanitised. Returns the
 *  actual (possibly corrected) rel path. */
export async function createFolder(relPath: string): Promise<string> {
  const absRaw = resolveInVault(relPath)
  const dir = path.dirname(absRaw)
  const { name: safe } = sanitizeFilename(path.basename(absRaw))
  const abs = path.join(dir, safe)
  assertInVault(abs)
  assertPathLength(abs)
  if (await nameTaken(dir, safe)) {
    throw new Error('A note or folder with that name already exists')
  }
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
    await fs.rename(fromAbs, tmp)
    await fs.rename(tmp, toAbs)
  } else {
    await fs.rename(fromAbs, toAbs)
  }

  // carry the remembered line-ending across the rename
  const fk = key(fromAbs)
  if (crlfByPath.has(fk)) {
    crlfByPath.set(key(toAbs), crlfByPath.get(fk) as boolean)
    crlfByPath.delete(fk)
  }
  return toRel(toAbs)
}

/** Move to the OS trash — never a hard unlink, so deletes are recoverable.
 *  `shell` is imported lazily so the rest of this module (all node:fs/path) can
 *  be exercised outside the Electron runtime. */
export async function deleteEntry(relPath: string): Promise<void> {
  const abs = resolveInVault(relPath)
  markWrite(abs)
  const { shell } = await import('electron')
  await shell.trashItem(abs)
}
