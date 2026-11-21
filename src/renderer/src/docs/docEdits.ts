// The two pieces of state a document's tab shares with the rest of the window
// (docs/DocView.tsx): whether the theme is dark, and the edits waiting to be
// saved — which App saves before a quit, a window close, a rename or a move.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { DocResult } from '../../../shared/docs'

// --- the theme --------------------------------------------------------------------

/** Is the window showing a dark theme right now? Follows a space switch. */
function subscribeTheme(cb: () => void): () => void {
  const mo = new MutationObserver(cb)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}
const darkNow = (): boolean => (document.documentElement.dataset.theme ?? 'light') !== 'light'
export const useDarkTheme = (): boolean => useSyncExternalStore(subscribeTheme, darkNow)

// --- saving edits -----------------------------------------------------------------

/** How long after the last change an edit is saved — a note's wait (App.tsx). */
const SAVE_AFTER_MS = 400

export const COULD_NOT_SAVE =
  'Couldn’t save — something else may have this file open. Your change is kept here and saved with the next one.'

/** Edits not yet saved, by tab. App calls `flushDocEdits` before the window
 *  closes or the app quits, as it saves notes. */
const pending = new Map<string, () => Promise<void>>()

/** Changes the computer refused to save (Excel holding the file, say), by file.
 *  Kept HERE rather than in the tab, because a tab is let go of by a mere click on
 *  another one: the change has to be there when the file is shown again, and still
 *  be tried when the other program lets go. `view` is the tab's content with the
 *  change in it, so coming back shows it without working the file out again. */
interface Owed {
  text: string
  view: DocResult
  /** the file as it was when the change was made: anything else on disk later is
   *  another program's own save, which a retry must not write over */
  base?: DocResult
}
const owed = new Map<string, Owed>()
/** The tabs showing a file: told how its saves go, and asked for typing not yet sent. */
interface Watcher {
  heard: (error: string | null) => void
  take: () => { text: string; view: DocResult } | null
}
const watchers = new Map<string, Set<Watcher>>()
/** What each open file last held on disk, as far as this app knows. */
const onDisk = new Map<string, DocResult>()
/** Changes on their way to the disk: a quit that can't wait for one still has its words. */
const inFlight = new Map<string, string>()
/** One write at a time per file, so an older retry can't land over a newer change. */
const lines = new Map<string, Promise<unknown>>()
/** Goes up when another vault opens: paths are vault-relative, so anything still
 *  waiting from before would land on the same-named file in the new vault. */
let session = 0
/** App's ear: a change has gone into a "Recovered" note instead of its file. */
let onKept: ((path: string, why: 'changed' | 'gone') => void) | null = null
export function onDocEditKept(fn: (path: string, why: 'changed' | 'gone') => void): () => void {
  onKept = fn
  return () => {
    onKept = null
  }
}

function inLine<T>(path: string, job: () => Promise<T>): Promise<T> {
  const run = (lines.get(path) ?? Promise.resolve()).then(job, job)
  lines.set(path, run)
  return run
}

/** The words of a read, the same however the file's line endings are written. */
function wordsOf(d: DocResult): string {
  if (d.kind === 'text') return d.text.replace(/\r\n?/g, '\n')
  if (d.kind === 'sheet') return JSON.stringify(d.sheets.map((s) => s.rows))
  return d.kind
}

/** A "Recovered" note at the top of the vault, as a note's unsaveable typing gets.
 *  The name is capped, and dropped if the path is still too long for Windows: a copy
 *  must not fail because of what its file happened to be called. */
async function keepCopy(path: string, text: string, nth = 0): Promise<boolean> {
  const name = path.slice(path.lastIndexOf('/') + 1).slice(0, 100)
  const stamp = Date.now() + nth
  for (const file of [`Recovered - ${name} ${stamp}.md`, `Recovered - ${stamp}.md`]) {
    try {
      await window.api.writeNote(file, text)
      return true
    } catch {
      // the shorter name next
    }
  }
  return false
}

/** The file can't take this change any more (another program saved its own version,
 *  or it has gone): the change becomes a note, and the tab goes back to the file. */
async function rescue(path: string, why: 'changed' | 'gone'): Promise<boolean> {
  const o = owed.get(path)
  if (!o) return true
  let newest: Owed = o
  for (const w of watchers.get(path) ?? []) {
    const typed = w.take()
    if (typed) newest = { ...o, ...typed }
  }
  owed.set(path, newest)
  if (!(await keepCopy(path, newest.text))) return false
  owed.delete(path)
  inFlight.delete(path)
  watchers.get(path)?.forEach((w) => w.heard(null))
  onKept?.(path, why)
  return true
}

async function attempt(path: string, text: string, view: DocResult): Promise<boolean> {
  const at = session
  const settled = (): void => {
    if (inFlight.get(path) === text) inFlight.delete(path)
  }
  // Only a change that was already refused can be behind the file: the other
  // program had it all that time, and may have saved its own work.
  const was = owed.get(path)
  if (was?.base) {
    const now = await window.api.readDocument(path)
    if (at !== session) return false
    const moved = now.kind === 'error' && now.reason === 'gone'
    if (moved || (now.kind !== 'error' && wordsOf(now) !== wordsOf(was.base) && wordsOf(now) !== wordsOf(view))) {
      owed.set(path, { ...was, text, view })
      settled()
      return rescue(path, moved ? 'gone' : 'changed')
    }
  }
  let saved = true
  try {
    await window.api.writeTextDoc(path, text)
  } catch {
    saved = false
  }
  if (at !== session) return saved
  settled()
  if (saved) {
    owed.delete(path)
    if (watchers.has(path)) onDisk.set(path, view)
  } else owed.set(path, { text, view, base: was?.base ?? onDisk.get(path) })
  watchers.get(path)?.forEach((w) => w.heard(saved ? null : COULD_NOT_SAVE))
  return saved
}

function put(path: string, text: string, view: DocResult): Promise<boolean> {
  const at = session
  inFlight.set(path, text)
  return inLine(path, () => (at === session ? attempt(path, text, view) : Promise.resolve(false)))
}

/** Tries a refused change again, as it stands when its turn comes. */
function retry(path: string): Promise<boolean> {
  const at = session
  return inLine(path, () => {
    const o = owed.get(path)
    if (at !== session) return Promise.resolve(false)
    return o ? attempt(path, o.text, o.view) : Promise.resolve(true)
  })
}

export async function flushDocEdits(): Promise<void> {
  const waiting = new Set(pending.keys())
  await Promise.allSettled([...pending.values()].map((save) => save()))
  await Promise.allSettled([...owed.keys()].filter((p) => !waiting.has(p)).map(retry))
}

/** Does this file have a change that isn't on disk yet? */
export const docEditWaiting = (path: string): boolean => pending.has(path) || owed.has(path)
/** Every file with a refused change. */
export const docEditsOwed = (): string[] => [...owed.keys()]
/** The tab's content with the refused change in it, if there is one. */
export const owedDocView = (path: string): DocResult | null => owed.get(path)?.view ?? null

/** Saves this file's change now. True once it is on disk. */
export async function saveDocEdit(path: string): Promise<boolean> {
  const waiting = pending.get(path)
  if (waiting) await waiting()
  else await retry(path)
  return !owed.has(path)
}

/** The tab read the file: this is what it holds now. */
export function noteDocRead(path: string, read: DocResult): void {
  if (read.kind !== 'error' && !owed.has(path)) onDisk.set(path, read)
}

/** At a quit, once the last try has had its moment: whatever still isn't in its
 *  file goes into a "Recovered" note, because the window is about to take it. */
export async function keepUnsavedDocCopies(): Promise<void> {
  const left = new Map<string, string>()
  for (const [p, o] of owed) left.set(p, o.text)
  for (const [p, text] of inFlight) left.set(p, text) // newer than a refused one
  owed.clear()
  inFlight.clear()
  let nth = 0
  for (const [p, text] of left) await keepCopy(p, text, nth++)
}

/** The person chose to lose it ("Close anyway"). */
export function dropDocEdit(path: string): void {
  owed.delete(path)
  inFlight.delete(path)
}

/** Files moved or renamed: a refused change goes with its file. */
export function moveDocEdits(map: (p: string) => string): void {
  for (const table of [owed, onDisk, inFlight] as Map<string, unknown>[]) {
    for (const [p, v] of [...table]) {
      const to = map(p)
      if (to === p) continue
      table.delete(p)
      table.set(to, v)
    }
  }
}

/** Files binned: nothing is left to save into. A refused change goes into a note,
 *  because the file in the bin is the older words and Restore would bring those back. */
export function forgetDocEditsUnder(roots: string[]): void {
  const inside = (p: string): boolean => roots.some((r) => p === r || p.startsWith(r + '/'))
  for (const p of [...owed.keys()]) if (inside(p)) void rescue(p, 'gone')
  for (const table of [onDisk, inFlight] as Map<string, unknown>[]) {
    for (const p of [...table.keys()]) if (inside(p)) table.delete(p)
  }
}

/** Another vault opened. */
export function forgetAllDocEdits(): void {
  session++
  owed.clear()
  pending.clear()
  onDisk.clear()
  inFlight.clear()
}

/** One file's edits: `queue(text, view)` saves it after the wait. `dirty` is true
 *  from the first change until it is on disk, and while true an outside change does
 *  not reload the tab over the typing. */
export function useSaver(path: string, onError: (msg: string | null) => void) {
  const latest = useRef<{ text: string; view: DocResult } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirty = useRef(owed.has(path))
  const born = useRef(session)
  const save = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = latest.current
    if (born.current !== session) return
    pending.delete(path)
    if (!next) return
    latest.current = null
    await put(path, next.text, next.view)
  }, [path])
  const queue = useCallback(
    (text: string, view: DocResult): void => {
      latest.current = { text, view }
      dirty.current = true
      pending.set(path, save)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void save(), SAVE_AFTER_MS)
    },
    [path, save]
  )
  // Hears how this file's saves go, from whichever save it was. Leaving the tab
  // (closed, another file put in this column) saves what is waiting.
  useEffect(() => {
    const me: Watcher = {
      heard: (error) => {
        onError(error)
        if (!error && latest.current === null) dirty.current = false
      },
      take: () => {
        const typed = latest.current
        latest.current = null
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
        pending.delete(path)
        return typed
      }
    }
    const here = watchers.get(path) ?? new Set<Watcher>()
    here.add(me)
    watchers.set(path, here)
    return () => {
      here.delete(me)
      if (!here.size) watchers.delete(path)
      void save().finally(() => {
        if (!watchers.has(path) && !owed.has(path)) onDisk.delete(path)
      })
    }
  }, [path, onError, save])
  return { queue, dirty }
}
