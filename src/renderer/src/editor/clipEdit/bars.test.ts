import { describe, expect, it } from 'vitest'
import { CELL, clipCells, gridFor, liveCells, pyramid } from './bars'
import { cut, wholeClip } from './model'

describe('waveform bars on a fixed grid', () => {
  const env = Float32Array.from({ length: 1000 }, (_, i) => (i % 100) / 100) // 10 s
  it('the clip on the finest grid is its kept stretches, end to end', () => {
    const c = cut(wholeClip(10), 2, 5)
    const cells = clipCells(env, c)
    expect(cells.length).toBe(700)
    expect(cells[199]).toBeCloseTo(env[199])
    expect(cells[200]).toBeCloseTo(env[500]) // straight after the join
  })
  it('each grid up is pairs of the one below, the louder', () => {
    const p = pyramid(Float32Array.from([0.1, 0.5, 0.3, 0.2, 0.9]))
    expect(Array.from(p[1])).toEqual([0.5, 0.3, 0.9].map((v) => Math.fround(v)))
    expect(p[p.length - 1].length).toBe(1)
  })
  it('a live take is scaled against the clip\'s loudest sample', () => {
    const c = liveCells([0.25, 0.5], 0.05, 0.1, 0.5)
    expect(c.length).toBe(10)
    expect(c[0]).toBeCloseTo(0.5)
    expect(c[9]).toBeCloseTo(1)
  })
  it('a bar\'s height never depends on the view — only on its own cell', () => {
    // The point of the grid: the same cell, seen at two lengths of clip, is the same number.
    const a = pyramid(clipCells(env, wholeClip(10)))
    const b = pyramid(clipCells(env, wholeClip(10)))
    expect(a[3][40]).toBe(b[3][40])
  })
  it('picks the grid that keeps bars between the pitch and twice it apart', () => {
    for (const pps of [10, 37, 100, 413, 1000]) {
      const { level } = gridFor(pps, 5, 20)
      const spacing = CELL * 2 ** level * pps
      expect(spacing).toBeGreaterThanOrEqual(5 - 1e-6)
      expect(spacing).toBeLessThan(10 + 1e-6)
    }
  })
  it('the next grid fades in only near the switch, and fully by it', () => {
    // spacing just above the pitch: mostly the next grid
    const near = gridFor(5.05 / (CELL * 4), 5, 20)
    expect(near.level).toBe(2)
    expect(near.mix).toBeGreaterThan(0.9)
    // spacing well clear of it: none
    expect(gridFor(8 / (CELL * 4), 5, 20).mix).toBe(0)
  })
})
