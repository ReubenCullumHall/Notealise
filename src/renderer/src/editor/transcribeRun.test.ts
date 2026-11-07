import { describe, expect, it } from 'vitest'
import { mixToInt16 } from './transcribeRun'

describe('mixToInt16', () => {
  it('a stereo recording is heard in full: both sides averaged, not just the left', () => {
    // talk only on the RIGHT side (a phone held on one side, a lapel mic on one channel)
    const left = new Float32Array([0, 0, 0])
    const right = new Float32Array([1, -1, 0.5])
    expect(Array.from(mixToInt16([left, right], 0, 3))).toEqual([16384, -16383, 8192]) // ±0.5 × 32767, rounded
  })
  it('mono passes through; loud peaks are clamped, never wrapped round', () => {
    expect(Array.from(mixToInt16([new Float32Array([1, -1, 2, -3])], 0, 4))).toEqual([32767, -32767, 32767, -32767])
  })
  it('takes exactly the piece asked for, and an empty piece is empty', () => {
    const ch = new Float32Array([0.1, 0.2, 0.3, 0.4])
    expect(mixToInt16([ch], 1, 3).length).toBe(2)
    expect(mixToInt16([ch], 3, 3).length).toBe(0)
  })
})
