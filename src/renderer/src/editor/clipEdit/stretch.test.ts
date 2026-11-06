import { describe, expect, it } from 'vitest'
import { stretch } from './stretch'
import { encodeWav, joinStretches } from './wav'

const RATE = 16000
const tone = (hz: number, seconds: number): Float32Array =>
  Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE))
/** Upward zero crossings a second — the pitch of a pure tone. */
function pitch(s: Float32Array): number {
  let n = 0
  for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 && s[i] >= 0) n++
  return n / (s.length / RATE)
}

describe('speed, voice kept at its pitch', () => {
  it('1.5x is two thirds as long, same pitch', () => {
    const out = stretch(tone(220, 3), RATE, 1.5)
    expect(out.length).toBe(Math.round((RATE * 3) / 1.5))
    expect(pitch(out)).toBeGreaterThan(210)
    expect(pitch(out)).toBeLessThan(230)
  })
  it('0.5x is twice as long, same pitch', () => {
    const out = stretch(tone(220, 2), RATE, 0.5)
    expect(out.length).toBe(RATE * 4)
    expect(pitch(out)).toBeGreaterThan(210)
    expect(pitch(out)).toBeLessThan(230)
  })
  it('2x keeps its loudness (no dips where the windows overlap)', () => {
    const out = stretch(tone(220, 2), RATE, 2)
    let peak = 0
    for (let i = 2000; i < out.length - 2000; i++) peak = Math.max(peak, Math.abs(out[i]))
    expect(peak).toBeGreaterThan(0.45)
    expect(peak).toBeLessThan(0.55)
  })
  it('1x is the same sound', () => {
    const s = tone(220, 1)
    expect(stretch(s, RATE, 1)).toEqual(s)
  })
})

describe('the file it saves through', () => {
  it('a WAV header the converters read: mono, 16-bit, this rate, this length', () => {
    const w = encodeWav(new Float32Array(100), 48000)
    const v = new DataView(w.buffer)
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF')
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(200)
    expect(w.byteLength).toBe(244)
  })
  it('clips out-of-range samples rather than wrapping them', () => {
    const v = new DataView(encodeWav(Float32Array.from([2, -2]), 8000).buffer)
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32768)
  })
  it('joins the kept stretches end to end, hard', () => {
    const s = Float32Array.from({ length: 10 }, (_, i) => i)
    expect(Array.from(joinStretches(s, 1, [[1, 3], [6, 8]]))).toEqual([1, 2, 6, 7])
  })
})
