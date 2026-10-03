import { useSyncExternalStore } from 'react'
import { normalizeHex } from '../../../shared/color'
import { RECENT_COLORS_MAX, SAVED_COLORS_MAX } from '../../../shared/settings'

// What every colour picker remembers: the last three colours picked, and up to
// five starred ones ("your palette"). Reuben, 2026-10-03: both are "across the
// app and not space specific" — so one store, read by every `ColorField`
// wherever it is mounted, rather than a prop threaded through the selection
// toolbar, the format bar's colour menu, the sidebar popover and Settings.
//
// The lists are SAVED in settings.json (`recentColors` / `savedColors`, global
// keys). App.tsx feeds this store whatever settings it loads and hands it the
// function that writes them back; this file never touches settings itself.
//
// Its own file rather than an export from Picker.tsx for the same reason
// dragTrack.ts is: a component file that also exports a hook loses fast
// refresh for everything in it.

export interface ColorMemory {
  recent: string[]
  saved: string[]
}

let memory: ColorMemory = { recent: [], saved: [] }
let persist: (m: ColorMemory) => void = () => {}
const listeners = new Set<() => void>()

const set = (next: ColorMemory): void => {
  memory = next
  listeners.forEach((l) => l())
  persist(next)
}

/** App.tsx: the lists as just loaded from settings, and how to save them. Not
 *  a write — loading what is already on disk must not save it straight back. */
export function bindColorMemory(m: ColorMemory, save: (m: ColorMemory) => void): void {
  persist = save
  if (sameList(m.recent, memory.recent) && sameList(m.saved, memory.saved)) return
  memory = m
  listeners.forEach((l) => l())
}

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

export function useColorMemory(): ColorMemory {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => memory
  )
}

/** A colour was picked: it goes to the front of the recents. Called when a
 *  choice SETTLES (a drag let go of, a hex finished), not on every step of a
 *  drag — otherwise one drag across the square would fill all three slots
 *  with shades of the same colour. */
export function rememberColor(raw: string): void {
  const hex = normalizeHex(raw)
  if (!hex || memory.recent[0] === hex) return
  set({ ...memory, recent: [hex, ...memory.recent.filter((c) => c !== hex)].slice(0, RECENT_COLORS_MAX) })
}

/** Star a colour. Returns false when the palette is already full — the picker
 *  says so rather than quietly dropping the oldest one you chose to keep. */
export function starColor(raw: string): boolean {
  const hex = normalizeHex(raw)
  if (!hex) return false
  if (memory.saved.includes(hex)) return true
  if (memory.saved.length >= SAVED_COLORS_MAX) return false
  set({ ...memory, saved: [...memory.saved, hex] })
  return true
}

export function unstarColor(raw: string): void {
  const hex = normalizeHex(raw)
  if (!hex || !memory.saved.includes(hex)) return
  set({ ...memory, saved: memory.saved.filter((c) => c !== hex) })
}
