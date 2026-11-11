// The word count of every loaded note — kept here, outside React's state.
//
// It used to be `wordCounts` in App's state, counted in the same instant as each
// keystroke. Profiling typing in a 2,000-line note (app check 2026-11-09) found two
// costs in that: the count read the WHOLE note on every key (about a seventh of the work
// a keystroke did), and each new word then redrew the WHOLE window — sidebar, tab strip,
// every pane and its row of link chips — because App's state had changed (about a
// third). Now the count is worked out a moment after the key, off its path, and only
// the two words that show it are redrawn (`WordCount` in tabs/NotePane.tsx).
//
// No React in this file, so it can be tested as it is (wordCounts.test.ts).

import { countWords } from '../../shared/plainText'

const counts = new Map<string, number>()
const listeners = new Set<() => void>()
/** Notes typed in since the last count, each with its text as of the last key. */
const waiting = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null
/** How long the last round of counting took, in ms. */
let lastCost = 0

/** The count follows the typing by at most this long… */
const SOONEST_MS = 120
/** …stretching for a note so long that counting it is itself slow — never more than
 *  about a tenth of the time goes on counting — and never past this. */
const LATEST_MS = 1000

/** How long to wait before the next count, given how long the last one took. */
export function countDelay(lastCostMs: number): number {
  return Math.min(LATEST_MS, Math.max(SOONEST_MS, Math.ceil(lastCostMs * 10)))
}

function put(path: string, n: number): boolean {
  if (counts.get(path) === n) return false
  counts.set(path, n)
  return true
}
function tell(): void {
  for (const fn of [...listeners]) fn()
}

/** For `useSyncExternalStore`: be told when any count changes. */
export function subscribeWordCounts(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** A note's count as last worked out (0 for one that hasn't been counted). */
export function wordCountOf(path: string): number {
  return counts.get(path) ?? 0
}

/** Count now: a note just opened, or read again because it changed on disk. Whatever
 *  was waiting to be counted for it is older than this text, and is dropped. */
export function countNow(path: string, text: string): void {
  waiting.delete(path)
  if (put(path, countWords(text))) tell()
}

/** Count a moment from now: a note being typed in. The wait is not restarted by the
 *  next key, so while you type without a pause the count still follows, every
 *  `countDelay` — and lands that long, at most, after the last key. */
export function countSoon(path: string, text: string): void {
  waiting.set(path, text)
  if (timer !== null) return
  timer = setTimeout(countWaiting, countDelay(lastCost))
}

function countWaiting(): void {
  timer = null
  const started = performance.now()
  let changed = false
  for (const [path, text] of waiting) changed = put(path, countWords(text)) || changed
  waiting.clear()
  lastCost = performance.now() - started
  if (changed) tell()
}

/** A note or folder was renamed or moved: its count, and any count still waiting,
 *  goes with it (`map` is the old-path → new-path rule App's `remapOpen` uses). */
export function remapWordCounts(map: (path: string) => string): void {
  const moved = [...counts].map(([p, n]) => [map(p), n] as const)
  counts.clear()
  for (const [p, n] of moved) counts.set(p, n)
  const late = [...waiting].map(([p, text]) => [map(p), text] as const)
  waiting.clear()
  for (const [p, text] of late) waiting.set(p, text)
  tell()
}

/** For tests: forget everything, as a fresh window would. */
export function resetWordCountsForTests(): void {
  counts.clear()
  waiting.clear()
  listeners.clear()
  if (timer !== null) clearTimeout(timer)
  timer = null
  lastCost = 0
}
