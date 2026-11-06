import { describe, expect, it } from 'vitest'
import { envelopeOf } from '../voiceWave'
import { RATE, withTake, type Recording } from './audio'

const tone = (secs: number, amp: number): Float32Array => {
  const n = Math.round(secs * RATE)
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = amp * Math.sin(i / 7)
  return s
}
const recOf = (samples: Float32Array): Recording => {
  let peak = 0
  for (const v of samples) peak = Math.max(peak, Math.abs(v))
  return { samples, duration: samples.length / RATE, envelope: envelopeOf([samples], RATE), peak }
}

describe('a take joined onto the recording', () => {
  it('has the waveform of the whole, measured once — the same as measuring it all again', () => {
    const rec = recOf(tone(2, 0.3))
    const grown = withTake(rec, tone(1, 0.6))
    return grown.then((g) => {
      const whole = envelopeOf([g.samples], RATE)
      expect(g.envelope.length).toBe(whole.length)
      let worst = 0
      for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i] - g.envelope[i]))
      expect(worst).toBeLessThan(0.02)
      expect(g.peak).toBeCloseTo(0.6, 2)
      expect(g.duration).toBeCloseTo(3)
    })
  })
})
