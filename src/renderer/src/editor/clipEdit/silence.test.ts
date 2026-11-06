import { describe, expect, it } from 'vitest'
import { cut, wholeClip } from './model'
import { pausesIn, quietSlices, sliceLevels } from './silence'

const RATE = 8000
/** 1 s of "speech" (a tone), then `gap` s of silence (or a little hiss), repeated. */
function takesWithGaps(gaps: number[], hiss = 0): Float32Array {
  const parts: number[] = []
  let seed = 1
  const noise = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * hiss
  const speak = (): void => { for (let i = 0; i < RATE; i++) parts.push(0.5 * Math.sin(i / 3) + noise()) }
  speak()
  for (const g of gaps) {
    for (let i = 0; i < g * RATE; i++) parts.push(noise())
    speak()
  }
  return Float32Array.from(parts)
}

describe('finding pauses', () => {
  it('finds the pauses over a second, not the short ones', () => {
    const s = takesWithGaps([2, 0.4, 1.5])
    const p = pausesIn(wholeClip(s.length / RATE), quietSlices(sliceLevels(s, RATE)))
    expect(p).toHaveLength(2)
    expect(p[0][0]).toBeCloseTo(1, 1)
    expect(p[0][1]).toBeCloseTo(3, 1)
    expect(p[1][1] - p[1][0]).toBeCloseTo(1.5, 1)
  })
  it('works in a noisy room: hiss is the floor, not speech', () => {
    const s = takesWithGaps([2], 0.02)
    expect(pausesIn(wholeClip(s.length / RATE), quietSlices(sliceLevels(s, RATE)))).toHaveLength(1)
  })
  it('a recording that is all hiss has no pauses — not one long one', () => {
    const s = Float32Array.from({ length: RATE * 5 }, (_, i) => Math.sin(i * 12.9898) * 0.01)
    expect(pausesIn(wholeClip(5), quietSlices(sliceLevels(s, RATE)))).toEqual([])
  })
  it('two half-pauses either side of an earlier cut count as one pause', () => {
    // 1 s speech, 2 s silence, 1 s speech. Cut 1.6–2.4 out of the middle of the
    // silence: what's left is 1.2 s of pause across the join.
    const s = takesWithGaps([2])
    const c = cut(wholeClip(4), 1.6, 2.4)
    const p = pausesIn(c, quietSlices(sliceLevels(s, RATE)))
    expect(p).toHaveLength(1)
    expect(p[0][1] - p[0][0]).toBeCloseTo(1.2, 1)
  })
})
