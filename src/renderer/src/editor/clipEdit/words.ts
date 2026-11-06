// Edit by the words (Reuben, 2026-11-05: yes to "select words in the transcript
// and delete them to cut them out of the sound"). The words and their times come
// from Transcribe (window.api.transcribeWordTimes — milliseconds into the
// recording as it is on disk). Here they are placed on the EDITED clip: a word
// whose moment is cut is gone, a moved section takes its words with it.

import { sectionAt, toClip, type Clip } from './model'

/** A word and its times as Transcribe keeps them, milliseconds from the
 *  recording's start (the same shape as shared/types.ts WordTime — written out
 *  here so the editor doesn't depend on Transcribe being in the app). */
export interface WordTime {
  text: string
  from: number
  to: number
}

/** Transcribe's word times for a recording, if this app has Transcribe at all. */
export function wordTimesOf(rel: string): Promise<WordTime[] | null> {
  const api = window.api as { transcribeWordTimes?: (recording: string) => Promise<WordTime[] | null> }
  return typeof api.transcribeWordTimes === 'function' ? api.transcribeWordTimes(rel) : Promise.resolve(null)
}

/** A word where it sits in the edited clip, seconds. */
export interface ClipWord {
  text: string
  from: number
  to: number
  /** which section it is in (from 0) — a new section starts a new line */
  section: number
}

/** The words still in the clip, in the order they play. A word is kept when its
 *  middle is; its ends are clamped to the stretch its middle is in, so a word
 *  cut across by an edit never claims sound from somewhere else in the clip. */
export function placeWords(words: readonly WordTime[], c: Clip): ClipWord[] {
  const out: ClipWord[] = []
  for (const w of words) {
    const a = w.from / 1000
    const b = Math.max(a, w.to / 1000)
    const mid = (a + b) / 2
    const t = toClip(c, mid)
    if (t === null || !w.text.trim()) continue
    const ca = toClip(c, a)
    const cb = toClip(c, b)
    // The same stretch as the middle when the offsets agree with it.
    const from = ca !== null && Math.abs(t - ca - (mid - a)) < 1e-6 ? ca : t - Math.min(mid - a, 0.05)
    const to = cb !== null && Math.abs(cb - t - (b - mid)) < 1e-6 ? cb : t + Math.min(b - mid, 0.05)
    out.push({ text: w.text.trim(), from, to, section: 0 })
  }
  out.sort((x, y) => x.from - y.from)
  for (const w of out) w.section = sectionAt(c, (w.from + w.to) / 2)
  return out
}

/** The word being said at clip time `t`: the last one that has started. -1
 *  before the first. */
export function wordAt(words: readonly ClipWord[], t: number): number {
  let lo = 0
  let hi = words.length - 1
  let best = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (words[m].from <= t + 1e-6) {
      best = m
      lo = m + 1
    } else hi = m - 1
  }
  return best
}

/** The stretch of the clip words `i` to `j` (either order) cover. */
export function wordsSpan(words: readonly ClipWord[], i: number, j: number): [number, number] {
  const a = Math.max(0, Math.min(i, j))
  const b = Math.min(words.length - 1, Math.max(i, j))
  return [words[a].from, words[b].to]
}

/** Is word `w` inside selection `sel` (more than half of it)? */
export const wordSelected = (w: ClipWord, sel: readonly [number, number] | null): boolean =>
  !!sel && Math.min(w.to, sel[1]) - Math.max(w.from, sel[0]) > (w.to - w.from) / 2 - 1e-6
