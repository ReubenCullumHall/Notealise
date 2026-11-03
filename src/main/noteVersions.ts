// Earlier versions of a note — keeping, finding, following and tidying the copies
// in <vault>/.mdnotes/versions/. The rules (how often, how long, the file names)
// are in shared/noteVersions.ts; the plan is docs/plans/note-versions.md.
//
// vault.ts drives this and hands in the vault root and its case rule (`Ctx`), so
// this file never imports vault.ts back. Everything here is a SAFETY NET: a failure
// is logged and swallowed by the caller, and must never stop a note being saved.
//
// What stays in memory is small on purpose: which folder belongs to which note
// path, the time of each note's newest copy, and the text of copies kept in this
// session (only notes being edited — a few KB). The copies themselves live on disk
// and are read only when the "Earlier versions" box asks for them.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  BIG_REMOVAL_CHARS,
  DEFAULT_VERSION_EVERY,
  VERSION_INFO,
  VERSIONS_DIR,
  isVersionId,
  removedChars,
  versionFileName,
  versionTime,
  versionEveryMs,
  versionsToDrop,
  type NoteVersion
} from '../shared/noteVersions'

/** The gap between timed copies (Settings → Data → Earlier versions), or null for
 *  "when you close the note". Set by main/settings.ts whenever the active vault's
 *  settings are read or saved. */
let everyMs: number | null = versionEveryMs(DEFAULT_VERSION_EVERY)
export function setVersionCadence(ms: number | null): void {
  everyMs = ms
}

export interface Ctx {
  /** the vault root, symlinks already resolved */
  root: string
  /** the vault's case rule for comparing paths (vault.ts `foldCase`) */
  fold: (s: string) => string
}

interface Index {
  root: string
  /** folded note path -> the version folders holding its copies. Usually one; two
   *  when a second computer started one for the same note before it saw ours. */
  byPath: Map<string, string[]>
  /** folder id -> the note path it belongs to, as stored */
  pathOf: Map<string, string>
  /** folded note path -> newest copy we know of (its time, and its text when kept
   *  in this session) */
  newest: Map<string, { at: number; text?: string }>
}

let index: Index | null = null

/** One thing at a time: a save, a rename and the tidy-up all read and change the
 *  same folders, and a save that raced a rename could start a second folder for
 *  the note. Queued, never dropped; one failing does not stop the next. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

function versionsRoot(ctx: Ctx): string {
  return path.join(ctx.root, ...VERSIONS_DIR.split('/'))
}
/** A note's folder. The id is checked here, so no caller can aim a write or a
 *  delete anywhere but a folder of ours. */
function folderOf(ctx: Ctx, id: string): string {
  if (!isVersionId(id)) throw new Error('Not a version folder')
  return path.join(versionsRoot(ctx), id)
}

async function scan(ctx: Ctx): Promise<Index> {
  const next: Index = { root: ctx.root, byPath: new Map(), pathOf: new Map(), newest: new Map() }
  let names: string[] = []
  try {
    names = await fs.readdir(versionsRoot(ctx))
  } catch {
    return next // no versions yet
  }
  await Promise.all(
    names.filter(isVersionId).map(async (id) => {
      try {
        const info = JSON.parse(await fs.readFile(path.join(folderOf(ctx, id), VERSION_INFO), 'utf8'))
        if (typeof info?.path !== 'string' || info.path === '') return
        next.pathOf.set(id, info.path)
      } catch {
        // No readable note.json: whose copies these are is lost. The tidy-up still
        // ages them out; nothing else touches them.
      }
    })
  )
  for (const [id, p] of next.pathOf) {
    const k = ctx.fold(p)
    next.byPath.set(k, [...(next.byPath.get(k) ?? []), id])
  }
  return next
}

/** The folder map for this vault, read once and then kept up to date as we go.
 *  `fresh` re-reads it — the box does, so copies the other computer kept show up. */
async function load(ctx: Ctx, fresh = false): Promise<Index> {
  if (!index || index.root !== ctx.root || fresh) {
    const keepNewest = index?.root === ctx.root ? index.newest : null
    index = await scan(ctx)
    if (keepNewest) index.newest = keepNewest
  }
  return index
}

async function listFolder(ctx: Ctx, id: string): Promise<{ file: string; at: number; bytes: number }[]> {
  let names: string[] = []
  try {
    names = await fs.readdir(folderOf(ctx, id))
  } catch {
    return []
  }
  const out: { file: string; at: number; bytes: number }[] = []
  for (const file of names) {
    const at = versionTime(file)
    if (at === null) continue
    const st = await fs.stat(path.join(folderOf(ctx, id), file)).catch(() => null)
    if (st?.isFile()) out.push({ file, at, bytes: st.size })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** The newest copy of a note, from memory or (once per session) from disk. */
async function newestOf(ctx: Ctx, ix: Index, k: string): Promise<{ at: number; text?: string } | null> {
  const known = ix.newest.get(k)
  if (known) return known
  let best: { at: number; id: string; file: string } | null = null
  for (const id of ix.byPath.get(k) ?? []) {
    const [top] = await listFolder(ctx, id)
    if (top && (!best || top.at > best.at)) best = { at: top.at, id, file: top.file }
  }
  if (!best) return null
  const text = await fs.readFile(path.join(folderOf(ctx, best.id), best.file), 'utf8').catch(() => undefined)
  const found = { at: best.at, text }
  ix.newest.set(k, found)
  return found
}

/** Write one copy. Makes the note's folder (and its note.json) the first time. */
async function writeCopy(ctx: Ctx, ix: Index, rel: string, text: string): Promise<void> {
  const k = ctx.fold(rel)
  let id = ix.byPath.get(k)?.[0]
  if (!id) {
    id = randomBytes(6).toString('hex')
    await fs.mkdir(folderOf(ctx, id), { recursive: true })
    await fs.writeFile(path.join(folderOf(ctx, id), VERSION_INFO), JSON.stringify({ path: rel }) + '\n', 'utf8')
    ix.byPath.set(k, [id])
    ix.pathOf.set(id, rel)
  } else {
    await fs.mkdir(folderOf(ctx, id), { recursive: true })
  }
  const dir = folderOf(ctx, id)
  const noteName = rel.slice(rel.lastIndexOf('/') + 1)
  let at = Date.now()
  for (let tries = 0; ; tries++) {
    let file = versionFileName(at, noteName)
    // Windows refuses a path over 259 characters; drop the name before that.
    if (path.join(dir, file).length > 259) file = versionFileName(at, noteName, 0)
    try {
      // 'wx': a brand-new file, never over an existing copy. The name carries the
      // time to the millisecond, so a clash is two copies in the same instant.
      await fs.writeFile(path.join(dir, file), text, { encoding: 'utf8', flag: 'wx' })
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || tries >= 5) throw e
      at += 1
    }
  }
  ix.newest.set(k, { at, text })
}

/** Called by `writeNote` just before it replaces a note. `before` is what is on
 *  disk now (null for a note that doesn't exist yet), `after` what is about to be
 *  written. Keeps `before` when this save takes a big piece away; when the note
 *  has no copy at all yet (so the note as it first was is never lost); and, on a
 *  timed setting, when its newest copy is older than the chosen gap. On "when
 *  you close the note" the rest are kept by the renderer, as the note closes. */
export function keepBeforeSave(ctx: Ctx, rel: string, before: string | null, after: string): Promise<void> {
  if (before === null || before === after || before.trim() === '') return Promise.resolve()
  return serial(async () => {
    const ix = await load(ctx)
    const k = ctx.fold(rel)
    const newest = await newestOf(ctx, ix, k)
    const now = Date.now()
    const due = !newest || (everyMs !== null && now - newest.at >= everyMs)
    if (!due && removedChars(before, after) < BIG_REMOVAL_CHARS) return
    if (newest?.text === before) {
      // Already kept, word for word. Count it as kept now, so the gap runs
      // from here rather than re-checking on every keystroke's save.
      ix.newest.set(k, { at: Math.max(newest.at, now), text: before })
      return
    }
    await writeCopy(ctx, ix, rel, before)
  })
}

/** Keep what is on disk now, whatever the clock says — done before a restore or a
 *  Put back, so that can itself be taken back. Skipped when it is already the
 *  newest copy. */
export function keepNow(ctx: Ctx, rel: string, current: string): Promise<void> {
  if (current.trim() === '') return Promise.resolve()
  return serial(async () => {
    const ix = await load(ctx)
    const newest = await newestOf(ctx, ix, ctx.fold(rel))
    if (newest?.text === current) return
    await writeCopy(ctx, ix, rel, current)
  })
}

/** A note or folder moved from `fromRel` to `toRel` — renamed, moved, archived,
 *  put back, binned (into `.mdnotes/trash/…`), emptied into Recovery, or restored.
 *  Its copies (and those of every note inside a folder) follow it. */
export function followMove(ctx: Ctx, fromRel: string, toRel: string): Promise<void> {
  return serial(async () => {
    const ix = await load(ctx)
    const from = ctx.fold(fromRel)
    for (const [id, p] of [...ix.pathOf]) {
      const k = ctx.fold(p)
      if (k !== from && !k.startsWith(from + '/')) continue
      const moved = toRel + p.slice(fromRel.length)
      try {
        await fs.writeFile(path.join(folderOf(ctx, id), VERSION_INFO), JSON.stringify({ path: moved }) + '\n', 'utf8')
      } catch (e) {
        console.error('could not move the earlier versions of', p, e)
        continue
      }
      ix.pathOf.set(id, moved)
      ix.byPath.set(k, (ix.byPath.get(k) ?? []).filter((x) => x !== id))
      if (!ix.byPath.get(k)?.length) ix.byPath.delete(k)
      const nk = ctx.fold(moved)
      ix.byPath.set(nk, [...(ix.byPath.get(nk) ?? []), id])
      const n = ix.newest.get(k)
      if (n) {
        ix.newest.delete(k)
        ix.newest.set(nk, n)
      }
    }
  })
}

/** Delete one folder of copies: only version files and note.json, then the
 *  (now empty) folder — never a recursive delete. */
async function removeFolder(ctx: Ctx, ix: Index, id: string): Promise<void> {
  const dir = folderOf(ctx, id)
  for (const v of await listFolder(ctx, id)) await fs.unlink(path.join(dir, v.file)).catch(() => {})
  await fs.unlink(path.join(dir, VERSION_INFO)).catch(() => {})
  await fs.rmdir(dir).catch(() => {}) // left alone if anything else is in it
  const p = ix.pathOf.get(id)
  ix.pathOf.delete(id)
  if (p !== undefined) {
    const k = ctx.fold(p)
    const left = (ix.byPath.get(k) ?? []).filter((x) => x !== id)
    if (left.length) ix.byPath.set(k, left)
    else {
      ix.byPath.delete(k)
      ix.newest.delete(k)
    }
  }
}

/** The note (or folder of notes) at `rel` is gone for good — Recovery's 7 days ran
 *  out, or it was deleted from there. Its copies go with it. */
export function forget(ctx: Ctx, rel: string): Promise<void> {
  return serial(async () => {
    const ix = await load(ctx)
    const gone = ctx.fold(rel)
    for (const [id, p] of [...ix.pathOf]) {
      const k = ctx.fold(p)
      if (k === gone || k.startsWith(gone + '/')) await removeFolder(ctx, ix, id)
    }
  })
}

/** Every copy of the note at `rel`, newest first. */
export function list(ctx: Ctx, rel: string): Promise<NoteVersion[]> {
  return serial(async () => {
    const ix = await load(ctx, true)
    const out: NoteVersion[] = []
    for (const id of ix.byPath.get(ctx.fold(rel)) ?? []) {
      for (const v of await listFolder(ctx, id)) out.push({ token: `${id}/${v.file}`, at: v.at, bytes: v.bytes })
    }
    return out.sort((a, b) => b.at - a.at)
  })
}

/** The text of one copy. The token has to name a folder that belongs to `rel`
 *  and a file named like a copy — nothing else in the vault can be read this way. */
export function read(ctx: Ctx, rel: string, token: string): Promise<string> {
  return serial(async () => {
    if (typeof token !== 'string') throw new Error('Not a version')
    const slash = token.indexOf('/')
    const id = token.slice(0, slash)
    const file = token.slice(slash + 1)
    if (slash < 0 || versionTime(file) === null) throw new Error('Not a version')
    const ix = await load(ctx)
    if (!(ix.byPath.get(ctx.fold(rel)) ?? []).includes(id)) throw new Error('That version belongs to another note')
    return fs.readFile(path.join(folderOf(ctx, id), file), 'utf8')
  })
}

/** Tidy away what has aged out (shared/noteVersions.ts `versionsToDrop`), and
 *  folders left with nothing in them. Also catches folders whose note.json was
 *  lost, so they don't sit there forever. */
export function sweep(ctx: Ctx): Promise<void> {
  return serial(async () => {
    const ix = await load(ctx, true)
    let names: string[] = []
    try {
      names = await fs.readdir(versionsRoot(ctx))
    } catch {
      return
    }
    const now = Date.now()
    for (const id of names.filter(isVersionId)) {
      const versions = await listFolder(ctx, id)
      const drop = new Set(versionsToDrop(versions, now))
      for (const file of drop) await fs.unlink(path.join(folderOf(ctx, id), file)).catch(() => {})
      if (versions.every((v) => drop.has(v.file))) await removeFolder(ctx, ix, id)
    }
    ix.newest.clear() // a dropped copy may have been someone's newest
  })
}

/** For tests: forget what is in memory, as a fresh launch would. */
export function resetForTests(): void {
  index = null
}
