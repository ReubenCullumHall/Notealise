import { describe, expect, it } from 'vitest'
import { bounceFrames, NO_TILT, pose, PRESS, pressFrames, tiltAt } from './archivePress'

/** The numbers out of a pose, in order: rotateX, rotateY, sink, scale. */
const parts = (t: string): number[] => {
  const m = t.match(
    /^perspective\(\d+px\) rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\) translate3d\(0, (-?[\d.]+)px, 0\) scale\((-?[\d.]+)\)$/
  )
  if (!m) throw new Error(`not a pose: ${t}`)
  return m.slice(1).map(Number)
}

describe('the archive button press', () => {
  it('rests as the button itself and presses all the way in', () => {
    expect(parts(pose(0, { x: 4, y: -3 }))).toEqual([0, 0, 0, 1])
    expect(parts(pose(1, NO_TILT))).toEqual([0, 0, PRESS.sink, PRESS.scale])
    expect(parts(pose(1, { x: 4, y: -3 })).slice(0, 2)).toEqual([4, -3])
  })

  it('goes in from rest', () => {
    const [from, to] = pressFrames(NO_TILT).map((k) => parts(k.transform as string))
    expect(from).toEqual([0, 0, 0, 1])
    expect(to).toEqual([0, 0, PRESS.sink, PRESS.scale])
  })

  it('bounces off where it rests, never past it — it never swells or rises over its neighbour', () => {
    const frames = bounceFrames({ x: 5, y: 5 })
    const shapes = frames.map((k) => parts(k.transform as string))
    expect(shapes[0]).toEqual(parts(pose(1, { x: 5, y: 5 })))
    expect(shapes[shapes.length - 1]).toEqual([0, 0, 0, 1])
    for (const [, , sink, scale] of shapes) {
      expect(sink).toBeGreaterThanOrEqual(0)
      expect(scale).toBeLessThanOrEqual(1)
    }
    // two bounces, the second smaller
    const depths = shapes.map(([, , sink]) => sink)
    const peaks = depths.filter((d, i) => i > 0 && i < depths.length - 1 && d > 0)
    expect(peaks).toHaveLength(2)
    expect(peaks[1]).toBeLessThan(peaks[0])
    expect(peaks[0]).toBeLessThan(PRESS.sink)
  })

  it('times the bounce in order and speeds up into the stop, slows at the top of each bounce', () => {
    const frames = bounceFrames(NO_TILT)
    const offsets = frames.map((k) => k.offset as number)
    expect(offsets[0]).toBe(0)
    expect(offsets[offsets.length - 1]).toBe(1)
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets)
    const sink = (i: number): number => parts(frames[i].transform as string)[2]
    for (let i = 0; i < frames.length - 1; i++) {
      const intoStop = sink(i) > sink(i + 1)
      expect(frames[i].easing).toBe(intoStop ? 'cubic-bezier(0.12, 0, 0.39, 0)' : 'cubic-bezier(0.61, 1, 0.88, 1)')
    }
  })

  it('tips toward where it was pressed, at most PRESS.maxDeg, and straight in the middle', () => {
    const box = { left: 100, top: 50, width: 120, height: 40 }
    expect(tiltAt(box, 160, 70)).toEqual({ x: 0, y: 0 })
    // right edge: the right side goes in; top edge: the top goes in
    expect(tiltAt(box, 220, 70)).toEqual({ x: 0, y: PRESS.maxDeg })
    expect(tiltAt(box, 160, 50)).toEqual({ x: PRESS.maxDeg, y: 0 })
    expect(tiltAt(box, 100, 90)).toEqual({ x: -PRESS.maxDeg, y: -PRESS.maxDeg })
    // a pointer that strays outside (a drag off the edge) is held to the edge
    expect(tiltAt(box, 400, -20)).toEqual({ x: PRESS.maxDeg, y: PRESS.maxDeg })
  })
})
