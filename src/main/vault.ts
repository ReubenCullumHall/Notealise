import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import type { TreeNode } from '../shared/types'
import { toPreviewLine } from '../shared/plainText'
import { indexLinks, stripMd, type LinkRow } from '../shared/links'
import { sanitizeFilename } from './filenames'
import { indexEmbeds } from '../shared/attachments'
import { heldPath, RECOVERY_DIR, TRASH_DIR } from '../shared/workspace'

// ---------------------------------------------------------------------------
// Vault state. This module is the ONLY place in the app that touches `fs`.
// ---------------------------------------------------------------------------
let vaultRoot: string | null = null

export function setVaultRoot(root: string): void {
  const abs = path.resolve(root)
  // Store the root with its own symlinks already resolved, because the boundary
  // check below compares against it in real-path space. Both sides have to be
  // resolved or neither: on macOS the root itself is routinely behind a link
  // (/tmp is really /private/tmp, and that is where the onboarding test vault
  // lives), so resolving only the incoming path would reject every path in a
  // perfectly ordinary vault.
  try {
    vaultRoot = realpathSync(abs)
  } catch {
    // Not there yet — a folder picked in the dialog and created on the way in.
    // The lexical path is still a correct boundary; `realInVault` re-resolves
    // per call once the folder exists.
    vaultRoot = abs
  }
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
/** Does `rel` — the output of `path.relative(root, abs)` — leave the vault?
 *
 *  The first SEGMENT is compared against `..`, not the string's prefix. A prefix
 *  test also matches a file legitimately named `..todo.md`, which resolves to a
 *  perfectly ordinary path inside the vault: `path.relative` returns it as
 *  `..todo.md`, `startsWith('..')` says true, and the note becomes unopenable
 *  with a message claiming it escapes. It fails closed, so it was never a hole
 *  — but a note synced in from another tool, or made in Finder, could not be
 *  read at all. */
function escapesVault(rel: string): boolean {
  if (rel === '') return false // the root itself; individual callers decide
  if (path.isAbsolute(rel)) return true // a different drive, or a UNC path
  return rel.split(path.sep)[0] === '..'
}

function assertInVault(abs: string): void {
  if (escapesVault(path.relative(requireVault(), abs))) {
    throw new Error(`Path escapes the vault: ${abs}`)
  }
}
function resolveInVault(relPath: string): string {
  const abs = path.resolve(requireVault(), relPath)
  assertInVault(abs)
  return abs
}

/** Is `abs` the vault root itself? The boundary lets the root through by design
 *  — `listTree` and `scanLinks` need it — so every operation that WRITES or
 *  DELETES has to exclude it separately. This is that check, in one place,
 *  because having it spelled out per call site is how `purgeRecoveryItem` came
 *  to be the one destructive function without it. */
function isVaultRoot(abs: string): boolean {
  return path.relative(requireVault(), abs) === ''
}

/** The in-vault config folder is written by `settings.ts`, `workspace.ts` and
 *  the bin — each through its own validated shape. `writeNote` is a general
 *  "put this text at this path" primitive the renderer drives, so pointing it
 *  at `.mdnotes/` lets note-shaped input rewrite the organisation sidecar and
 *  the recovery records. That is not hypothetical plumbing: a recovery record
 *  is what aims the app's only hard delete (`purgeRecoveryItem`). `.mdnotes/`
 *  is also skipped by `ignored()` and by the watcher, so such a write shows up
 *  nowhere in the tree and raises no change event. */
function assertNotConfig(abs: string): void {
  const first = path.relative(requireVault(), abs).split(path.sep)[0]
  if (foldCase(first) === '.mdnotes') {
    throw new Error('That folder belongs to the app — notes cannot be written into it.')
  }
}

/** Resolve symlinks, then check the boundary.
 *
 *  `assertInVault` is lexical, and a lexical check cannot see a link: one at
 *  `<vault>/Attachments/id_rsa` pointing at `~/.ssh/id_rsa` reads as an ordinary
 *  in-vault path, and both reads and writes follow it straight out of the vault.
 *  Nothing in the app creates such a link, and the tree walks skip them
 *  (`isFile()`/`isDirectory()` are both false for a symlink) — but naming one is
 *  enough, and a note that merely says `![](Attachments/id_rsa)` does.
 *
 *  A path being CREATED does not exist yet and `realpath` would throw on it, so
 *  walk up to the deepest ancestor that DOES exist, resolve that, and re-attach
 *  the tail. That is sufficient: a path component that isn't there yet cannot
 *  itself be a link, and every directory it will be created under has been
 *  resolved and checked. */
async function realInVault(abs: string): Promise<string> {
  const tail: string[] = []
  let head = abs
  for (;;) {
    try {
      const real = await fs.realpath(head)
      const out = tail.length ? path.join(real, ...tail) : real
      assertInVault(out)
      return out
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      // Anything other than "not there" is a real error — a permission problem
      // must surface, not be retried against the parent until it looks like an
      // escape. `assertInVault`'s own throw carries no `code`, so it lands here
      // and is re-thrown unchanged, which is what we want.
      if (err.code !== 'ENOENT') throw e
      const parent = path.dirname(head)
      if (parent === head) throw new Error(`Path escapes the vault: ${abs}`)
      tail.unshift(path.basename(head))
      head = parent
    }
  }
}

/** The whole boundary in one call: lexical check first (cheap, and it catches
 *  the `../` that never needs a stat), then symlink resolution. Every fs
 *  operation on a renderer-supplied path goes through this. */
async function resolveReal(relPath: string): Promise<string> {
  return realInVault(resolveInVault(relPath))
}

/** vault-relative, POSIX-style path for an absolute path inside the vault. */
function toRel(abs: string): string {
  return path.relative(requireVault(), abs).split(path.sep).join('/')
}

// Windows caps a full path at 260 chars unless long-path support is on. Check on
// every platform so a Mac user is warned before making a vault that breaks on Win.
function assertPathLength(abs: string): void {
  // 259, not the 260 the limit is usually quoted as: this is the full path
  // INCLUDING the file itself, and 260 is where Windows starts refusing it.
  // The message doesn't say "Windows" (docs/voice.md — plain, no jargon; a
  // Mac user reading a Windows-specific number mid-sentence is not calm
  // copy) even though the limit only bites there — every renamed vault has
  // to survive being opened on either OS (CLAUDE.md rule 7), so the rule is
  // enforced everywhere rather than only on the platform that needs it.
  if (abs.length > 259) {
    throw new Error('That name is too long — try something shorter, or a shallower folder.')
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
//
// A DIRECTORY rename gets a much longer budget than a file. OneDrive, Google
// Drive and iCloud on Windows all implement folders as Cloud Files API reparse
// points, and renaming one can mean the sync client's filter driver holds the
// whole subtree — not one file — while it settles, which routinely outlasts
// the sub-second budget tuned for a single autosave. This is not a permissions
// problem the app can request its way out of; it's contention with the sync
// client, and it clears on its own if given enough time.
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
      if (i >= attempts - 1 || !TRANSIENT.has(code)) {
        if (TRANSIENT.has(code)) {
          throw new Error(
            'This folder is still syncing (OneDrive, Google Drive or iCloud) — wait a moment and try again.'
          )
        }
        throw e
      }
      await sleep(Math.min(1000, 30 * 2 ** i)) // 30, 60, 120, 240, 480, 960ms, then capped at 1s
    }
  }
}
// A whole-folder rename (a space) waits far longer than a single file before
// giving up — see the comment above. ~11s worst case, which only happens when
// the sync client genuinely hasn't let go; a normal transient lock clears in
// the first second or two, same as a file.
const DIR_RENAME_ATTEMPTS = 16

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
 *  collapse whitespace.
 *
 *  This used to carry its own copy of the strip list (ported from legacy's
 *  `preview()`, legacy/src/App.jsx:66). It now shares one with the renderer's
 *  word count — two answers to "what counts as text" is how the count came to
 *  disagree with the page (shared/plainText.ts). */
const toPreview = (raw: string): string => toPreviewLine(raw, PREVIEW_CHARS)

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
    rows.push({ path: toRel(abs), links: indexLinks(text), embeds: indexEmbeds(text) })
  }
  return rows
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------
export async function readNote(relPath: string): Promise<string> {
  const abs = await resolveReal(relPath)
  const content = await fs.readFile(abs, 'utf8')
  crlfByPath.set(key(abs), isCrlfDominant(content))
  return content
}

/** Atomic write: temp file in the same directory, fsync, then rename over the
 *  target. A crash mid-write can never truncate the real note. The stored line
 *  ending is restored. The temp name is a dotfile, so the watcher and tree never
 *  see it. */
export async function writeNote(relPath: string, content: string): Promise<void> {
  const abs = await resolveReal(relPath)
  if (isVaultRoot(abs)) throw new Error('Cannot write the vault root')
  assertNotConfig(abs)
  // The only creating write that was missing this. A deep imported tree can
  // otherwise produce a note that writes on macOS and cannot be opened on
  // Windows, which is the exact case the check exists to prevent (rule 7).
  assertPathLength(abs)
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

/** Atomic binary write: temp file + fsync + rename, same shape as writeNote but
 *  no EOL handling (binary data). Used by importers for images/attachments. */
export async function writeAsset(relPath: string, data: Buffer): Promise<void> {
  const abs = await resolveReal(relPath)
  if (isVaultRoot(abs)) throw new Error('Cannot write the vault root')
  assertNotConfig(abs)
  assertPathLength(abs)
  const dir = path.dirname(abs)
  await fs.mkdir(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(abs)}.${randomBytes(6).toString('hex')}.tmp`)
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  markWrite(abs)
  markWrite(tmp)
  try {
    await renameWithRetry(tmp, abs)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

/** Write attachment bytes (pasted, dropped, or picked from the renderer) into
 *  `dirPath`, giving them a collision-safe name derived from `filename`. Same
 *  shape as createNote/createFolder: the name is sanitised and de-duplicated,
 *  so the caller MUST use the returned vault-relative path, never the one it
 *  asked for. */
export async function writeAssetUnique(
  dirPath: string,
  filename: string,
  data: Buffer
): Promise<string> {
  const dirAbs = resolveInVault(dirPath)
  const safe = sanitizeFilename(filename).name
  const { name: stem, ext } = path.parse(safe)
  const fname = await uniqueName(dirAbs, stem, ext)
  const relPath = dirPath ? `${dirPath}/${fname}` : fname
  await writeAsset(relPath, data)
  return relPath
}

/** Stamp a note with the time it was really written.
 *
 *  Without this an import dates everything "now", so a decade of notes all
 *  claim to have been edited today and sorting by date says nothing. The tree
 *  reads `updatedAt` from `mtimeMs` (see `listTree`), which is exactly what
 *  this sets.
 *
 *  Only the modification time is restorable: a file's *creation* time can't be
 *  set from Node on any platform, so `createdAt` still shows the import. That's
 *  a real limitation, not an oversight — the edited date is the one the sidebar
 *  shows and sorts on. */
export async function setNoteTimes(relPath: string, modifiedMs: number): Promise<void> {
  if (!Number.isFinite(modifiedMs) || modifiedMs <= 0) return
  const abs = resolveInVault(relPath)
  const when = new Date(modifiedMs)
  markWrite(abs)
  await fs.utimes(abs, when, when).catch(() => {}) // a failed stamp must not fail the import
}

/** Raw bytes of a file in the vault, for showing an image in the editor.
 *  Goes through `resolveInVault` like every other read, so the vault root stays
 *  the boundary — the renderer can't reach a file outside it by writing
 *  `![](../../../etc/passwd)` in a note. Deliberately NOT a `file://` URL: in
 *  dev the renderer is served over http and can't load one, so an image would
 *  work in the packaged app and silently not in dev (or the reverse). */
export async function readAsset(relPath: string): Promise<Uint8Array> {
  const abs = await resolveReal(relPath)
  return new Uint8Array(await fs.readFile(abs))
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
  const dirAbs = await resolveReal(dirPath)
  const stem = name ? sanitizeFilename(stripMd(name)).name : 'Untitled'
  const fname = await uniqueName(dirAbs, stem, '.md')
  const abs = path.join(dirAbs, fname)
  // Re-check after the join, the way `renameEntry` does. `sanitizeFilename` is
  // what normally makes this redundant — but it is one function away, and a
  // boundary that depends on a sanitiser staying correct is not a boundary.
  assertInVault(abs)
  assertPathLength(abs)
  markWrite(abs)
  const fh = await fs.open(abs, 'wx') // 'wx' throws if the exact name already exists
  await fh.close()
  return toRel(abs)
}

/** Create a folder inside `dirPath` ("" = vault root), named `name` (or
 *  "New folder" when the caller has no name in mind), suffixing " (2)" etc. if
 *  that's taken. Returns the actual rel path it landed at — the name is
 *  sanitised, so the caller must use what comes back.
 *
 *  `name` exists for the same reason `createNote`'s does, and the importers are
 *  what proved it: creating "New folder" and renaming it afterwards is two fs
 *  operations with a window in between where the wrong name is on disk — and
 *  `syncSpaces` runs on every tree load, so the watcher can bind that temporary
 *  name as a real space mid-import. The rename could also collide and throw,
 *  which aborted an entire 150-page import. Creating with the final name in one
 *  `mkdir` removes both. */
export async function createFolder(dirPath: string, name?: string): Promise<string> {
  const dirAbs = await resolveReal(dirPath)
  const stem = name ? sanitizeFilename(name).name : 'New folder'
  const fname = await uniqueName(dirAbs, stem, '')
  const abs = path.join(dirAbs, fname)
  // See createNote. This is the one that was actually reachable: `name` arrives
  // over IPC, structured clone carries an ARRAY through intact, and
  // `sanitizeFilename` iterating a non-string yields whole elements — so
  // `['../../evil']` survived it with its separators, and the mkdir landed
  // outside the vault. The type coercion in `filenames.ts` closes that too;
  // this closes the class.
  assertInVault(abs)
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

  const fromStat = await fs.stat(fromAbs).catch(() => null)
  const attempts = fromStat?.isDirectory() ? DIR_RENAME_ATTEMPTS : undefined

  markWrite(fromAbs)
  markWrite(toAbs)
  if (caseOnly) {
    const tmp = path.join(dir, `.${safe}.${randomBytes(6).toString('hex')}.casetmp`)
    markWrite(tmp)
    await renameWithRetry(fromAbs, tmp, attempts)
    await renameWithRetry(tmp, toAbs, attempts)
  } else {
    await renameWithRetry(fromAbs, toAbs, attempts)
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
// binned entry leaves the tree for free. Emptying the bin (or force-deleting
// one item from it) does NOT reach the OS trash — see the recovery block
// below, which is where that now goes instead.
// ---------------------------------------------------------------------------
// The layout itself is shared (shared/workspace.ts) so the renderer can point
// at a held file without re-deriving where main put it.

/** Absolute path of a binned entry. The id prefix keeps two notes of the same
 *  name from colliding in the flat trash folder. */
function trashAbs(id: string, name: string): string {
  return resolveInVault(heldPath(TRASH_DIR, id, name))
}

/** Move an entry into the bin. Returns the id needed to restore it. */
export async function trashEntry(
  relPath: string
): Promise<{ id: string; type: 'dir' | 'file'; name: string }> {
  const abs = await resolveReal(relPath)
  if (isVaultRoot(abs)) throw new Error('Cannot delete the vault root')
  const stat = await fs.stat(abs)
  const id = randomBytes(6).toString('hex')
  // Returned as well as used, so the bin record is keyed on the name the file
  // actually landed under rather than on a second derivation from the caller's
  // string. See `trashEntries` in workspace.ts.
  const name = path.basename(abs)
  const dest = trashAbs(id, name)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  markWrite(abs)
  markWrite(dest)
  await renameWithRetry(abs, dest)
  return { id, type: stat.isDirectory() ? 'dir' : 'file', name }
}

/** Move a held-aside entry back to `to`, wherever it was being held. Its
 *  original parent may have been deleted or renamed since, so the folder is
 *  recreated; a name collision is resolved by suffixing rather than failing, so
 *  Restore always succeeds. Returns the actual rel path it landed at.
 *
 *  Shared by both restore paths — out of the bin, and out of the recovery net
 *  one step later — because they are the same operation from a different
 *  holding folder. The collision handling and the Windows path-length check are
 *  both cross-platform-sensitive, so they get exactly one home. */
async function restoreHeldEntry(src: string, name: string, to: string): Promise<string> {
  const destRaw = await resolveReal(to)
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

/** Put a binned entry back at `to`. */
export async function restoreEntry(id: string, name: string, to: string): Promise<string> {
  return restoreHeldEntry(trashAbs(id, name), name, to)
}

/** Move a binned entry out of the bin and into the recovery safety net,
 *  rather than handing it to the OS trash — see the recovery block below.
 *
 *  Returns **false** when there was nothing to move: already gone (bin emptied
 *  outside the app, or a failed earlier move), so the caller drops the record
 *  and the bin doesn't keep a dead row. Every OTHER failure — a permission
 *  error, a locked file, a full disk — **throws**, because the file is still
 *  sitting in `trash/` and writing a recovery record for it would put a live
 *  7-day countdown in Settings against something that can never be restored.
 *  Distinguishing the two is the whole point of the boolean: swallowing both
 *  alike is what made the UI promise a recoverability that wasn't real. */
export async function purgeTrashItem(id: string, name: string): Promise<boolean> {
  const src = trashAbs(id, name)
  const dest = recoveryAbs(id, name)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  markWrite(src)
  markWrite(dest)
  try {
    await renameWithRetry(src, dest)
  } catch (e) {
    // dest's parent was just created, so ENOENT here can only mean the source
    // is missing — the one case that is genuinely nothing to worry about.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
  return true
}

/** Send a LIVE entry straight to the OS trash, bypassing `.mdnotes/trash`
 *  entirely. Used only for deleting a space: a space is a different level of
 *  the hierarchy from the notes and folders inside it, and putting a deleted
 *  space in the same bin as an individual trashed note conflates the two. The
 *  two-step "click again to delete" button is the confirmation; this is still
 *  recoverable, just from the OS's own Recycle Bin/Trash rather than in-app
 *  or the 7-day recovery net below — a deliberate, product-level choice to
 *  keep deleting a whole space a heavier, differently-recoverable action. */
export async function trashEntryToOS(relPath: string): Promise<void> {
  const abs = await resolveReal(relPath)
  if (isVaultRoot(abs)) throw new Error('Cannot delete the vault root')
  markWrite(abs)
  const { shell } = await import('electron')
  await shell.trashItem(abs)
}

/** Open the OS file explorer with `relPath` selected — onboarding's disk-proof
 *  step ("Show me the file"). Goes through the same vault-boundary check as
 *  every other path (rule 6): the renderer sends a vault-relative path, never
 *  one it constructed itself. */
export async function revealInFolder(relPath: string): Promise<void> {
  const abs = await resolveReal(relPath)
  const { shell } = await import('electron')
  shell.showItemInFolder(abs)
}

// ---------------------------------------------------------------------------
// The recovery safety net. Emptying the bin, or force-deleting one item from
// it, no longer hands off to the OS trash (see purgeTrashItem above) — it
// moves the entry into <vault>/.mdnotes/recovery/ instead, where it sits for
// RECOVERY_TTL_MS before the app deletes it for real. purgeRecoveryItem below
// is the ONLY place this module ever hard-unlinks a note; every other "delete"
// in this file is a move. Deliberately absent from the normal bin UI —
// reachable only from Settings, since arriving here means delete was already
// confirmed twice.
// ---------------------------------------------------------------------------
function recoveryAbs(id: string, name: string): string {
  return resolveInVault(heldPath(RECOVERY_DIR, id, name))
}

/** Put a recovery item back where it came from — restoreEntry's situation one
 *  step later, so it goes through the same restoreHeldEntry. */
export async function restoreFromRecovery(id: string, name: string, to: string): Promise<string> {
  return restoreHeldEntry(recoveryAbs(id, name), name, to)
}

/** The real, permanent delete — called by the 7-day sweep, or by a manual
 *  "delete now" from the recovery panel in Settings. */
export async function purgeRecoveryItem(id: string, name: string): Promise<void> {
  const abs = await realInVault(recoveryAbs(id, name))
  // The one hard `fs.rm` in the app, and until 2026-09-04 the one destructive
  // function with no root guard — every other one has carried its own since it
  // was written. `heldPath` builds this path by interpolating `id` and `name`,
  // the boundary lets the vault root through by design, and the sweep runs
  // unattended at launch: a recovery record named `/../../..` therefore aimed a
  // recursive delete at the whole vault. `isSafeHeldSegment` now stops such a
  // record being built or read at all; this is the second lock on the same door,
  // because the cost of it being wrong is every note the user has.
  if (isVaultRoot(abs)) throw new Error('Cannot delete the vault root')
  const rel = path.relative(requireVault(), abs)
  if (foldCase(rel.split(path.sep).slice(0, 2).join('/')) !== RECOVERY_DIR) {
    throw new Error(`Not a recovery file: ${rel}`)
  }
  markWrite(abs)
  await fs.rm(abs, { recursive: true, force: true })
}
