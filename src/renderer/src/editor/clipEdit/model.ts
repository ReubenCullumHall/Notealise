// The voice note editor's edits (docs/plans/voice-editor.md), as plain data.
//
// An edit never touches the sound. It is a list of the stretches of the
// ORIGINAL recording that are kept, in order, plus where it is split into takes.
// What you see and hear is those stretches end to end — a cut closes up
// (Reuben, 2026-11-04: "close up") — so there are two clocks:
//   original time: seconds into the recording as it is on disk
//   clip time:     seconds into the edited clip, what the panel shows
// Every operation here takes clip time, because that is what the person points
// at. Splits are kept in ORIGINAL time, so a later cut elsewhere doesn't move
// them; a split whose spot is cut away goes with it.

/** One kept stretch of the original, [start, end) in seconds, start < end. */
export type Seg = readonly [number, number]

export interface Clip {
  /** the kept stretches, in order, never overlapping */
  segs: readonly Seg[]
  /** where it is split into sections, original time (any order: clip order is `splitTimes`) */
  splits: readonly number[]
}

/** Shorter than this and a stretch isn't worth keeping — a sliver left by a
 *  cut a hair away from a join. 10 ms is under one syllable's attack. */
export const MIN_SEG = 0.01

/** A split this close to another, or to either end, isn't added. */
export const MIN_TAKE = 0.1

export const wholeClip = (duration: number): Clip => ({ segs: duration > 0 ? [[0, duration]] : [], splits: [] })

/** How long the edited clip is. */
export const lengthOf = (c: Clip): number => c.segs.reduce((n, [a, b]) => n + (b - a), 0)

/** Clip time → original time. At a join, the start of the later stretch. */
export function toOriginal(c: Clip, t: number): number {
  let at = 0
  for (let i = 0; i < c.segs.length; i++) {
    const [a, b] = c.segs[i]
    const len = b - a
    if (t < at + len || i === c.segs.length - 1) return a + Math.min(Math.max(0, t - at), len)
    at += len
  }
  return 0
}

/** Original time → clip time, or null when that moment has been cut. Each
 *  stretch owns its start, not its end — once sections are reordered, the end
 *  of one stretch can be the start of another somewhere else in the clip, and a
 *  split there means the start. Only the clip's very end is an end. */
export function toClip(c: Clip, o: number): number | null {
  let at = 0
  const last = c.segs.length - 1
  for (let i = 0; i <= last; i++) {
    const [a, b] = c.segs[i]
    if (o >= a && (o < b || (i === last && o <= b))) return at + (o - a)
    at += b - a
  }
  return null
}

/** The original stretches that clip time [t0, t1) is made of. */
export function originalRanges(c: Clip, t0: number, t1: number): Seg[] {
  const out: Seg[] = []
  let at = 0
  for (const [a, b] of c.segs) {
    const len = b - a
    const from = Math.max(t0, at)
    const to = Math.min(t1, at + len)
    if (to > from) out.push([a + (from - at), a + (to - at)])
    at += len
  }
  return out
}

/** Where two kept stretches meet, in clip time — the little marks on the
 *  waveform's bottom edge that show a cut was made there. */
export function joins(c: Clip): number[] {
  const out: number[] = []
  let at = 0
  for (let i = 0; i < c.segs.length - 1; i++) {
    at += c.segs[i][1] - c.segs[i][0]
    out.push(at)
  }
  return out
}

/** The splits that still stand, in clip time. */
export function splitTimes(c: Clip): number[] {
  const len = lengthOf(c)
  const out: number[] = []
  for (const o of c.splits) {
    const t = toClip(c, o)
    if (t !== null && t > MIN_TAKE / 2 && t < len - MIN_TAKE / 2) out.push(t)
  }
  return out.sort((x, y) => x - y)
}

function tidy(segs: Seg[], splits: readonly number[]): Clip {
  // Two stretches that run straight on in the original (a section moved back
  // where it came from) are one: no join mark where nothing was cut.
  const kept: Seg[] = []
  for (const s of segs) {
    if (s[1] - s[0] < MIN_SEG) continue
    const prev = kept[kept.length - 1]
    if (prev && Math.abs(prev[1] - s[0]) < 1e-9) kept[kept.length - 1] = [prev[0], s[1]]
    else kept.push(s)
  }
  const c: Clip = { segs: kept, splits: [] }
  const len = lengthOf(c)
  // A split survives only where its moment is still in the clip — and not on
  // top of another, or at either end: cutting out a whole section leaves the
  // splits either side of it meeting at the join, and one is enough.
  // In CLIP order: once sections move, original order isn't the order they play.
  const placed = splits
    .map((o) => ({ o, t: toClip(c, o) }))
    .filter((p): p is { o: number; t: number } => p.t !== null)
    .sort((x, y) => x.t - y.t)
  const out: number[] = []
  let last = -Infinity
  for (const { o, t } of placed) {
    if (t < MIN_TAKE / 2 || t > len - MIN_TAKE / 2 || t - last < MIN_TAKE) continue
    out.push(o)
    last = t
  }
  return { segs: kept, splits: out }
}

/** Take original [a, b) out of the kept stretches. */
export function cutOriginal(c: Clip, a: number, b: number): Clip {
  if (!(b > a)) return c
  const segs: Seg[] = []
  for (const [x, y] of c.segs) {
    if (y <= a || x >= b) segs.push([x, y])
    else {
      if (x < a) segs.push([x, a])
      if (y > b) segs.push([b, y])
    }
  }
  // A split exactly on the cut's edge would now sit on a join; it stays, which
  // is the same moment — but one strictly inside the cut is gone.
  return tidy(segs, c.splits.filter((o) => o <= a || o >= b))
}

/** Cut clip time [t0, t1): the stretch goes and the gap closes up. */
export function cut(c: Clip, t0: number, t1: number): Clip {
  const lo = Math.max(0, Math.min(t0, t1))
  const hi = Math.min(lengthOf(c), Math.max(t0, t1))
  if (!(hi > lo)) return c
  let next = c
  // Right to left would matter for clip-time ranges; these are original ranges,
  // which a cut never moves.
  for (const [a, b] of originalRanges(c, lo, hi)) next = cutOriginal(next, a, b)
  return next
}

/** Keep only clip time [t0, t1) — the good take — and drop everything else. */
export function keepOnly(c: Clip, t0: number, t1: number): Clip {
  const lo = Math.max(0, Math.min(t0, t1))
  const hi = Math.min(lengthOf(c), Math.max(t0, t1))
  if (!(hi > lo)) return c
  return tidy(originalRanges(c, lo, hi), c.splits)
}

/** The start handle dragged to clip time `t`. */
export const trimStart = (c: Clip, t: number): Clip => cut(c, 0, t)
/** The end handle dragged to clip time `t`. */
export const trimEnd = (c: Clip, t: number): Clip => cut(c, t, lengthOf(c))

/** Split into takes at clip time `t` (the playhead). Nothing for a spot too
 *  near either end or another split. */
export function split(c: Clip, t: number): Clip {
  const len = lengthOf(c)
  if (t < MIN_TAKE || t > len - MIN_TAKE) return c
  if (splitTimes(c).some((s) => Math.abs(s - t) < MIN_TAKE)) return c
  const o = toOriginal(c, t)
  return { segs: c.segs, splits: [...c.splits, o] }
}

/** Take a split back out (a click on its line). */
export function unsplit(c: Clip, t: number): Clip {
  const o = toOriginal(c, t)
  let best = -1
  c.splits.forEach((s, i) => {
    if (Math.abs(s - o) < MIN_TAKE && (best < 0 || Math.abs(s - o) < Math.abs(c.splits[best] - o))) best = i
  })
  return best < 0 ? c : { segs: c.segs, splits: c.splits.filter((_, i) => i !== best) }
}

/** Where section `k` (from 0) starts and ends, in clip time. */
export function sectionBounds(c: Clip, k: number): Seg | null {
  const at = [0, ...splitTimes(c), lengthOf(c)]
  return k >= 0 && k < at.length - 1 ? [at[k], at[k + 1]] : null
}

/** Which section clip time `t` is in (from 0). */
export function sectionAt(c: Clip, t: number): number {
  return splitTimes(c).filter((s) => s <= t).length
}

/** Move section `from` to boundary `to` (0 = before the first, n = after the
 *  last) — the table's column drag (Reuben, 2026-11-04: "the table like cell
 *  property dragging style"). Dropping it either side of itself changes nothing. */
export function moveSection(c: Clip, from: number, to: number): Clip {
  const list = takes(c)
  if (from < 0 || from >= list.length || to < 0 || to > list.length || to === from || to === from + 1) return c
  const [moved] = list.splice(from, 1)
  list.splice(to > from ? to - 1 : to, 0, moved)
  return tidy(list.flat(), list.slice(1).map((sec) => sec[0][0]))
}

/** Each section's number, in the order they play: its place in the ORIGINAL
 *  recording, so moving a section keeps its number (Reuben, 2026-11-05: "it
 *  shouldn't change the 'section 1/2/3..' name since that helps you know what
 *  order it was originally in"). Counted from 1. */
export function sectionNumbers(c: Clip): number[] {
  const starts = takes(c).map((sec) => sec[0][0])
  const ranked = [...starts].sort((x, y) => x - y)
  return starts.map((s) => ranked.indexOf(s) + 1)
}

/** A take recorded in the editor, original [from, to), goes on the end as a
 *  section of its own (Reuben, 2026-11-05: "Record another take"). The
 *  recording grows by it, so its stretch sits after everything already there —
 *  and by section numbering it is the newest, highest number. */
export function appendTake(c: Clip, from: number, to: number): Clip {
  if (!(to - from >= MIN_SEG)) return c
  if (!c.segs.length) return { segs: [[from, to]], splits: [] }
  return tidy([...c.segs, [from, to]], [...c.splits, from])
}

/** Every place an edit was made, in clip time: both ends, the splits and the
 *  joins — what ↑/↓ jump between and what drags snap to. */
export function editPoints(c: Clip): number[] {
  const all = [0, lengthOf(c), ...splitTimes(c), ...joins(c)].sort((x, y) => x - y)
  return all.filter((t, i) => i === 0 || t - all[i - 1] > 1e-6)
}

/** Delete section `k` (Reuben, 2026-11-04: "a delete sign to delete it"). */
export function deleteSection(c: Clip, k: number): Clip {
  const b = sectionBounds(c, k)
  return b ? cut(c, b[0], b[1]) : c
}

/** The takes: the kept stretches grouped between the splits, each a list of
 *  original stretches to play end to end. One take when there are no splits. */
export function takes(c: Clip): Seg[][] {
  const at = [0, ...splitTimes(c), lengthOf(c)]
  const out: Seg[][] = []
  for (let i = 0; i < at.length - 1; i++) {
    const r = originalRanges(c, at[i], at[i + 1])
    if (r.length) out.push(r)
  }
  return out
}

/** Nothing cut, trimmed or split. */
export const untouched = (c: Clip, duration: number): boolean =>
  c.splits.length === 0 && c.segs.length === 1 && c.segs[0][0] <= 1e-6 && Math.abs(c.segs[0][1] - duration) <= 1e-6

/** Pauses (clip time, as `silence.ts` finds them) shortened to `breath` seconds:
 *  half the breath is left at each side, so words don't run into each other
 *  (Reuben, 2026-11-04: "leave 1/3 second breath"). Still a hard cut — no fade. */
export function shortenPauses(c: Clip, pauses: readonly Seg[], breath: number): Clip {
  let next = c
  // Right to left: each cut closes up, which moves everything AFTER it in clip
  // time, never anything before.
  for (const [a, b] of [...pauses].sort((x, y) => y[0] - x[0])) {
    if (b - a <= breath) continue
    next = cut(next, a + breath / 2, b - breath / 2)
  }
  return next
}
