// "Remove silences": finding the pauses (docs/plans/voice-editor.md).
//
// Loudness is measured in 20 ms slices of the original. What counts as quiet is
// set by the recording itself, not a fixed level — a phone memo in a noisy room
// and a clean studio take have very different floors: a slice is quiet when it
// is within a few decibels of the room's own hum, and well under the speech.
// A pause is a run of quiet slices at least `MIN_PAUSE` long, measured along the
// EDITED clip, so two half-pauses either side of an earlier cut count as one.

import { type Clip, type Seg } from './model'

/** Slice length, seconds. */
export const SLICE = 0.02
/** Shorter gaps are part of speaking — a breath, a comma (Reuben: "longer than 1 second"). */
export const MIN_PAUSE = 1
/** What a pause is shortened to (Reuben, 2026-11-04: "1/3 second breath"). */
export const BREATH = 1 / 3

const FLOOR_DB = -90

/** Loudness of each slice in decibels (RMS), from the mono samples. */
export function sliceLevels(samples: Float32Array, rate: number): Float32Array {
  const size = Math.max(1, Math.round(rate * SLICE))
  const count = Math.ceil(samples.length / size)
  const out = new Float32Array(count)
  for (let k = 0; k < count; k++) {
    const from = k * size
    const to = Math.min(samples.length, from + size)
    let sum = 0
    for (let i = from; i < to; i++) sum += samples[i] * samples[i]
    const rms = Math.sqrt(sum / Math.max(1, to - from))
    out[k] = rms > 0 ? Math.max(FLOOR_DB, 20 * Math.log10(rms)) : FLOOR_DB
  }
  return out
}

function percentile(levels: Float32Array, p: number): number {
  if (!levels.length) return FLOOR_DB
  const sorted = Float32Array.from(levels).sort()
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** Which slices are quiet. The line sits 8 dB above the room's floor (its
 *  quietest tenth) or 35 dB under the speech (its loudest twentieth), whichever
 *  is higher — the first for a noisy room, the second for digital silence. */
export function quietSlices(levels: Float32Array): Uint8Array {
  const floor = percentile(levels, 0.1)
  const loud = percentile(levels, 0.95)
  const line = Math.max(floor + 8, loud - 35)
  const out = new Uint8Array(levels.length)
  // A recording with no speech in it at all: nothing is a pause, or the whole
  // thing would be.
  if (loud - floor < 10) return out
  for (let k = 0; k < levels.length; k++) out[k] = levels[k] <= line ? 1 : 0
  return out
}

/** The pauses in the edited clip, in clip time, each at least `minPause` long. */
export function pausesIn(c: Clip, quiet: Uint8Array, minPause = MIN_PAUSE): Seg[] {
  const out: Seg[] = []
  let at = 0
  let start: number | null = null
  for (const [a, b] of c.segs) {
    // Whole slices only: a slice is in a stretch when its middle is.
    for (let k = Math.max(0, Math.round(a / SLICE)); (k + 0.5) * SLICE < b; k++) {
      const t = at + (k * SLICE - a)
      const q = k < quiet.length && quiet[k] === 1
      if (q && start === null) start = Math.max(at, t)
      if (!q && start !== null) {
        if (t - start >= minPause) out.push([start, t])
        start = null
      }
    }
    at += b - a
  }
  if (start !== null && at - start >= minPause) out.push([start, at])
  return out
}
