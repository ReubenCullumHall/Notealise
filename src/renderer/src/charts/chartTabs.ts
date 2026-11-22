import {
  chartTabId,
  chartTabKey,
  chartTabNote,
  locateChart,
  type ChartBlock,
  type ChartEdit
} from '../../../shared/charts'
import type { WalkState } from './walk'

// What the app knows about each open chart tab. A tab's address is only a path, which is what
// lets renames, moves and the bin carry it, so where its block is lives here. It is deliberately
// kept out of the note and out of React: a walk or a keystroke in a chart must not redraw the
// window. After a relaunch the address itself holds enough to find the block again.

/** What the tab asks of App, which alone knows how a note is really read and saved. */
export interface ChartBridge {
  /** `noteNow` rather than a path: the note can be renamed while one of these is waiting. */
  read: (noteNow: () => string) => Promise<string>
  /** Change the note through the one safe route for how it is open right now. `make` is handed
   *  the note's current text and may refuse by returning null. */
  edit: (noteNow: () => string, make: (text: string) => ChartEdit | null) => Promise<boolean>
  /** A chart's name changed, so the tab strip should read it again. */
  named: () => void
}

interface Live {
  index: number
  source: string
  count: number
  name: string
  from: number
}

const live = new Map<string, Live>()

function chartHash(source: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

const noteTitle = (note: string): string => (note.split('/').pop() ?? '').replace(/\.md$/i, '') || 'Note'

export function makeChartTab(note: string, charts: readonly ChartBlock[], index: number, name: string): string {
  const c = charts[index]
  const rand = Math.random().toString(36).slice(2, 8) || 'chart'
  const path = chartTabId(note, `${rand}-${index}-${chartHash(c.source)}`)
  live.set(chartTabKey(path), { index, source: c.source, count: charts.length, name, from: c.from })
  return path
}

/** Which of the note's charts this tab shows, or null if its block has gone. */
export function resolveChart(path: string, charts: readonly ChartBlock[]): number | null {
  const key = chartTabKey(path)
  const known = live.get(key)
  if (known) return locateChart(charts, known, known.count)
  // Back after a relaunch: the address says where it was and what it held.
  const m = /^[^-]+-(\d+)-([0-9a-z]+)$/.exec(key)
  if (!m) return null
  const index = Number(m[1])
  let best: number | null = null
  charts.forEach((c, i) => {
    if (chartHash(c.source) !== m[2]) return
    if (best === null || Math.abs(i - index) < Math.abs(best - index)) best = i
  })
  return best ?? (index < charts.length ? index : null)
}

/** Remember where the block is now. True when its name changed. */
export function rememberChart(path: string, charts: readonly ChartBlock[], index: number, name: string): boolean {
  const key = chartTabKey(path)
  const was = live.get(key)
  const c = charts[index]
  live.set(key, { index, source: c.source, count: charts.length, name, from: c.from })
  return was?.name !== name
}

/** What a tab should still show after it was off screen or moved to another column: the walk
 *  and the open text panel. Only for as long as the app is open; a walk is never saved. */
export interface ChartUi {
  walk: WalkState | null
  textOpen: boolean
}
const ui = new Map<string, ChartUi>()
export const chartUi = (path: string): ChartUi => ui.get(chartTabKey(path)) ?? { walk: null, textOpen: false }
export const keepChartUi = (path: string, next: ChartUi): void => void ui.set(chartTabKey(path), next)

/** The tab closed. */
export function forgetChartTab(path: string): void {
  const key = chartTabKey(path)
  live.delete(key)
  ui.delete(key)
}

/** The tab's text is about to be written, so the note's next change is its own echo. */
export function expectChartSource(path: string, source: string): void {
  const was = live.get(chartTabKey(path))
  if (was) was.source = source
}

/** Where to put a deleted block back. */
export const lastChartPosition = (path: string): number => live.get(chartTabKey(path))?.from ?? Number.MAX_SAFE_INTEGER

export const chartTabTitle = (path: string): string =>
  live.get(chartTabKey(path))?.name ?? `${noteTitle(chartTabNote(path))} chart`

/** The tab already open on this chart, if there is one. */
export function openTabFor(tabs: readonly string[], note: string, charts: readonly ChartBlock[], index: number): string | null {
  for (const t of tabs) {
    if (chartTabKey(t) && chartTabNote(t) === note && resolveChart(t, charts) === index) return t
  }
  return null
}

// --- telling an open chart its note changed ------------------------------------------

const listeners = new Map<string, Set<(text?: string) => void>>()

export function onChartNote(note: string, fn: (text?: string) => void): () => void {
  const set = listeners.get(note) ?? new Set()
  set.add(fn)
  listeners.set(note, set)
  return () => {
    set.delete(fn)
    if (!set.size) listeners.delete(note)
  }
}

/** A note changed. `text` when it is known; without it, a chart reads the note itself. */
export function chartNoteChanged(note: string, text?: string): void {
  const set = listeners.get(note)
  if (set) for (const fn of [...set]) fn(text)
}
