import { describe, expect, it } from 'vitest'
import { MIN_BAR, barsFor, envelopeOf } from './voiceWave'

// The waveform. What matters to the eye: there are always exactly as many bars
// as asked for, the loudest is full height whatever the recording's level, a
// silent stretch still shows, a slice is as loud as its loudest channel — and a
// zoomed-in stretch (Cmd/Ctrl-click) keeps the scale of the whole recording.

/** An envelope at 4 values a second, straight from a list. */
const env = (...v: number[]): Float32Array => new Float32Array(v)

describe('envelopeOf', () => {
  it('scales the loudest moment of the whole recording to 1 — a quiet memo draws as tall as a loud one', () => {
    const quiet = new Float32Array(400).map((_, i) => (i < 200 ? 0.05 : 0.1))
    expect([...envelopeOf([quiet], 400, 4)]).toEqual([0.5, 0.5, 1, 1])
  })

  it('reads a negative swing as loud as a positive one', () => {
    expect([...envelopeOf([new Float32Array([0, -0.9, 0, 0.45])], 4, 2)]).toEqual([1, 0.5])
  })

  it('takes each slice from its loudest channel', () => {
    const left = new Float32Array([0.2, 0.2, 0, 0])
    const right = new Float32Array([0, 0, 0.4, 0.4])
    expect([...envelopeOf([left, right], 4, 2)]).toEqual([0.5, 1])
  })

  it('covers every sample exactly once when they do not divide evenly', () => {
    // 10 samples at 10 a second into thirds of a second — three slices of 3⅓
    // samples: a spike in the last sample must land in the last slice.
    const s = new Float32Array(10)
    s[9] = 1
    s[0] = 0.5
    expect([...envelopeOf([s], 10, 3)]).toEqual([0.5, 0, 1])
  })

  it('is empty for nothing, and silence stays silence', () => {
    expect(envelopeOf([], 8000)).toHaveLength(0)
    expect([...envelopeOf([new Float32Array(8)], 4, 2)]).toEqual([0, 0, 0, 0])
  })
})

describe('barsFor', () => {
  it('always gives exactly the bars asked for', () => {
    expect(barsFor(env(1, 0.5), 4, 0, 0.5, 96)).toHaveLength(96) // fewer values than bars
    expect(barsFor(new Float32Array(1000), 4, 0, 250, 96)).toHaveLength(96)
    expect(barsFor(env(), 4, 0, 1, 96)).toHaveLength(96)
  })

  it('draws the whole recording, each bar its slice’s loudest moment', () => {
    expect(barsFor(env(0.5, 0.25, 1, 0.75), 4, 0, 1, 2)).toEqual([0.5, 1])
  })

  it('keeps silence visible as stubs, never as nothing', () => {
    expect(barsFor(env(0, 0, 0, 0), 4, 0, 1, 4)).toEqual([MIN_BAR, MIN_BAR, MIN_BAR, MIN_BAR])
  })

  it('draws a zoomed-in stretch on the scale of the whole, not its own', () => {
    // the second half is quiet: zoomed in on it, it must stay quiet — scaled to
    // its own loudest it would look as loud as the shout before it
    const e = env(1, 1, 0.25, 0.125)
    expect(barsFor(e, 4, 0.5, 1, 2)).toEqual([0.25, 0.125])
  })

  it('draws nothing past the end of the recording — not silence that isn’t there', () => {
    expect(barsFor(env(0.5, 1), 4, 0, 1, 4)).toEqual([0.5, 1, 0, 0])
  })

  it('puts every value inside the stretch into exactly one bar', () => {
    // 10 values into 3 bars: the spike in the last value lands in the last bar.
    const e = new Float32Array(10)
    e[0] = 0.5
    e[9] = 1
    expect(barsFor(e, 10, 0, 1, 3)).toEqual([0.5, MIN_BAR, 1])
  })
})
