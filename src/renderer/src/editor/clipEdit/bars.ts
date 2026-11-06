// The editor's waveform bars, measured ONCE on a fixed grid (Reuben, 2026-11-05:
// as a take recorded, the old bars "smushing down" made "the pixels kind of dance").
//
// They danced because every frame cut the visible stretch into a fixed number of
// bars afresh: as the clip grew, each bar's edges slid across the sound and its
// height jumped about. Here a bar is one cell of a grid in CLIP time — 1/100 s,
// 2/100, 4/100… — so a bar's height never changes; zooming or a growing clip
// only moves and squeezes the bars. When they get too close the next grid up
// (two bars made one, the louder of the pair) fades in over the old one, once
// per doubling of the length, rather than anything changing every frame.

import { type Clip } from './model'

/** The finest grid: one value per hundredth of a second (the recording's envelope). */
export const CELL = 0.01

/** The clip's loudness on the finest grid, in clip time: the original's
 *  envelope (100 values a second, loudest = 1), its kept stretches end to end. */
export function clipCells(env: ArrayLike<number>, clip: Clip): Float32Array {
  const parts: [number, number][] = clip.segs.map(([a, z]) => [Math.round(a / CELL), Math.round(z / CELL)])
  const n = parts.reduce((m, [i, j]) => m + Math.max(0, j - i), 0)
  const out = new Float32Array(n)
  let at = 0
  for (const [i, j] of parts) for (let k = i; k < j; k++) out[at++] = k < env.length ? env[k] : 0
  return out
}

/** A take coming in, on the same grid: its live levels (one per `slot` seconds),
 *  measured against the clip's loudest sample so both sit on one scale. */
export function liveCells(levels: ArrayLike<number>, slot: number, seconds: number, peak: number): Float32Array {
  const n = Math.max(0, Math.round(seconds / CELL))
  const out = new Float32Array(n)
  const per = slot / CELL
  for (let k = 0; k < n; k++) out[k] = Math.min(1, (levels[Math.floor(k / per)] ?? 0) / (peak || 1))
  return out
}

/** Every grid: [0] is the finest; each next one is pairs of the one below, the louder of the two. */
export function pyramid(cells: Float32Array): Float32Array[] {
  const out = [cells]
  while (out[out.length - 1].length > 1) {
    const prev = out[out.length - 1]
    const next = new Float32Array(Math.ceil(prev.length / 2))
    for (let i = 0; i < next.length; i++) next[i] = Math.max(prev[2 * i], prev[2 * i + 1] ?? 0)
    out.push(next)
  }
  return out
}

/** Which grid to draw at `pxPerSecond`: the finest whose bars are at least
 *  `pitch` pixels apart — so they sit between `pitch` and twice that — and how
 *  far (0–1) the next grid up has faded in, over the last `fade` of the way. */
export function gridFor(pxPerSecond: number, pitch: number, levels: number, fade = 0.25): { level: number; mix: number } {
  if (!(pxPerSecond > 0)) return { level: Math.max(0, levels - 1), mix: 0 }
  const want = Math.log2(pitch / (pxPerSecond * CELL))
  const level = Math.max(0, Math.min(levels - 1, Math.ceil(want - 1e-9)))
  // At `level` the bars are `pitch`…2×`pitch` apart; nearer `pitch` the next grid fades in.
  const spacing = CELL * 2 ** level * pxPerSecond
  const mix = level + 1 < levels ? Math.max(0, Math.min(1, (pitch * (1 + fade) - spacing) / (pitch * fade))) : 0
  return { level, mix }
}
