import { describe, expect, it } from 'vitest'
import { VOICE_LIMITS } from '../../../shared/voiceNote'
import {
  LIVE_SECONDS,
  SLIDER,
  TONE_DB,
  ZOOM_MIN_SECONDS,
  clockTime,
  fileNameOf,
  followPlayhead,
  liveStart,
  recordingName,
  skipTarget,
  stripAt,
  sliderFromValue,
  speedLabel,
  timeReadout,
  toneGains,
  toneLabel,
  valueFromSlider,
  volumeLabel,
  zoomAt,
  panBy,
  createPanGesture
} from './voiceMixer'

// The voice note block's arithmetic. Each of these numbers either reaches the
// note (a slider's value is what gets written onto the line) or the speakers
// (the shelf gains), so the round trips are pinned rather than trusted.

describe('toneGains', () => {
  it('is exactly flat at 0 — an untouched voice note goes through unchanged', () => {
    const g = toneGains(0)
    expect(Object.is(g.low, 0)).toBe(true) // not −0
    expect(Object.is(g.high, 0)).toBe(true)
  })

  it('tilts the two shelves against each other: warmer lifts the bass and cuts the treble', () => {
    expect(toneGains(-1)).toEqual({ low: TONE_DB, high: -TONE_DB })
    expect(toneGains(1)).toEqual({ low: -TONE_DB, high: TONE_DB })
    expect(toneGains(0.5)).toEqual({ low: -TONE_DB / 2, high: TONE_DB / 2 })
  })

  it('never goes past the ends, and survives junk', () => {
    expect(toneGains(9)).toEqual(toneGains(1))
    expect(toneGains(-9)).toEqual(toneGains(-1))
    expect(toneGains(Number.NaN)).toEqual(toneGains(0))
  })
})

describe('the sliders', () => {
  /** Every value a slider can produce, by walking every position it has. */
  const reachable = (key: 'volume' | 'tone' | 'speed'): number[] => {
    const out = new Set<number>()
    for (let p = SLIDER[key].min; p <= SLIDER[key].max; p += SLIDER[key].step) out.add(valueFromSlider(key, p))
    return [...out]
  }

  it('volume: 0–200% in fives, 100% in the middle', () => {
    expect(valueFromSlider('volume', 100)).toBe(1)
    expect(valueFromSlider('volume', 150)).toBe(1.5)
    expect(valueFromSlider('volume', 0)).toBe(0)
    expect(valueFromSlider('volume', 200)).toBe(2)
    expect(sliderFromValue('volume', 1.25)).toBe(125)
  })

  it('tone: −1 to +1 in twentieths, flat in the middle', () => {
    expect(valueFromSlider('tone', 0)).toBe(0)
    expect(valueFromSlider('tone', -35)).toBe(-0.35)
    expect(sliderFromValue('tone', 0.3)).toBe(30)
  })

  it('speed: a log scale from 0.5× to 3×, snapped to 0.05, with 1× well inside it', () => {
    expect(valueFromSlider('speed', SLIDER.speed.min)).toBe(0.5)
    expect(valueFromSlider('speed', SLIDER.speed.max)).toBe(3)
    const one = sliderFromValue('speed', 1)
    expect(valueFromSlider('speed', one)).toBe(1)
    // On a straight track 1× would sit a fifth of the way along; on this one
    // halving and doubling are the same distance either side of it.
    expect(one / SLIDER.speed.max).toBeGreaterThan(0.35)
    const toHalf = one - sliderFromValue('speed', 0.5)
    const toDouble = sliderFromValue('speed', 2) - one
    expect(Math.abs(toHalf - toDouble)).toBeLessThanOrEqual(1)
  })

  it('puts every value it can produce back where it came from', () => {
    for (const key of ['volume', 'tone', 'speed'] as const) {
      for (const v of reachable(key)) expect(valueFromSlider(key, sliderFromValue(key, v))).toBe(v)
    }
  })

  it('reaches every speed on the 0.05 grid, and nothing off it', () => {
    const speeds = reachable('speed')
    for (let s = 50; s <= 300; s += 5) expect(speeds).toContain(s / 100)
    for (const s of speeds) expect(Math.round(s * 100) % 5).toBe(0)
  })

  it('stays inside the limits shared/voiceNote.ts writes, at any position', () => {
    for (const key of ['volume', 'tone', 'speed'] as const) {
      const [lo, hi] = VOICE_LIMITS[key]
      for (const p of [-5000, SLIDER[key].min, SLIDER[key].max, 5000]) {
        const v = valueFromSlider(key, p)
        expect(v).toBeGreaterThanOrEqual(lo)
        expect(v).toBeLessThanOrEqual(hi)
      }
    }
  })

  it('prints what it means', () => {
    expect(volumeLabel(1.5)).toBe('150%')
    expect(volumeLabel(0)).toBe('0%')
    expect(toneLabel(0)).toBe('0')
    expect(toneLabel(0.3)).toBe('+0.3')
    expect(toneLabel(-0.25)).toBe('−0.25')
    expect(speedLabel(1.25)).toBe('1.25×')
    expect(speedLabel(1)).toBe('1×')
    expect(speedLabel(0.5)).toBe('0.5×')
  })
})

describe('time', () => {
  it('counts like a clock: whole seconds, rounded down', () => {
    expect(clockTime(0)).toBe('0:00')
    expect(clockTime(7.9)).toBe('0:07')
    expect(clockTime(65.4)).toBe('1:05')
    expect(clockTime(750)).toBe('12:30')
    expect(clockTime(3723)).toBe('1:02:03')
    expect(clockTime(Number.NaN)).toBe('0:00')
    expect(clockTime(Infinity)).toBe('0:00')
  })

  it('shows how far in while playing or paused part-way, and the length when stopped', () => {
    expect(timeReadout({ playing: true, position: 12.4, duration: 65 })).toBe('0:12')
    expect(timeReadout({ playing: false, position: 12.4, duration: 65 })).toBe('0:12')
    expect(timeReadout({ playing: false, position: 0, duration: 65 })).toBe('1:05')
    // At the very end it has stopped: the length again.
    expect(timeReadout({ playing: false, position: 65, duration: 65 })).toBe('1:05')
    // A total is rounded, so a 4.6 s memo is 0:05 — and a very short one is
    // never 0:00.
    expect(timeReadout({ playing: false, position: 0, duration: 4.6 })).toBe('0:05')
    expect(timeReadout({ playing: false, position: 0, duration: 0.3 })).toBe('0:01')
    // Length not known yet.
    expect(timeReadout({ playing: false, position: 0, duration: null })).toBe('0:00')
    expect(timeReadout({ playing: true, position: 3.2, duration: null })).toBe('0:03')
  })

  it('skips ten seconds without leaving the recording', () => {
    expect(skipTarget(30, -10, 65)).toBe(20)
    expect(skipTarget(4, -10, 65)).toBe(0)
    expect(skipTarget(60, 10, 65)).toBe(65)
    expect(skipTarget(30, 10, null)).toBe(40) // unknown length: only the start stops it
    expect(skipTarget(Number.NaN, 10, 65)).toBe(10)
  })
})

describe('names', () => {
  it('reads a target the way a person would: decoded, folder dropped', () => {
    expect(fileNameOf('Voice%20note%202026-10-13%2014.32.m4a')).toBe('Voice note 2026-10-13 14.32.m4a')
    expect(fileNameOf('../Shared/memo.m4a')).toBe('memo.m4a')
    expect(fileNameOf('bad%zz.m4a')).toBe('bad%zz.m4a') // a stray % is shown as written
    expect(recordingName('Voice%20note%202026-10-13%2014.32.m4a')).toBe('Voice note 2026-10-13 14.32')
    expect(recordingName('memo')).toBe('memo')
    expect(recordingName('.m4a')).toBe('.m4a')
  })
})

describe('zooming in on the waveform (Cmd/Ctrl-click)', () => {
  it('zooms in by four each click, keeping the moment under the pointer where it was', () => {
    // a 10-minute memo, clicked at 2:00 — 20% of the way along
    const w = zoomAt(null, 120, 1, 600)
    expect(w).toEqual({ start: 90, span: 150 })
    // 2:00 is still 20% of the way across: (120 - 90) / 150
    expect((120 - w!.start) / w!.span).toBeCloseTo(0.2)
  })

  it('reaches a few seconds across, then one more click goes back to the whole recording', () => {
    let w = zoomAt(null, 300, 1, 600)
    for (let i = 0; i < 3; i++) w = zoomAt(w, 300, 1, 600)
    expect(w!.span).toBe(ZOOM_MIN_SECONDS)
    expect(zoomAt(w, 300, 1, 600)).toBeNull() // as close as it goes: back out
  })

  it('zooms back out with Shift, to the whole recording in the end', () => {
    const close = zoomAt(zoomAt(null, 300, 1, 600), 300, 1, 600)!
    expect(close.span).toBeCloseTo(37.5)
    expect(zoomAt(close, 300, -1, 600)!.span).toBeCloseTo(150)
    expect(zoomAt(zoomAt(close, 300, -1, 600), 300, -1, 600)).toBeNull() // the whole of it again
  })

  it('keeps the window inside the recording when clicked near either end', () => {
    expect(zoomAt(null, 2, 1, 600)!.start).toBeGreaterThanOrEqual(0)
    const end = zoomAt(null, 599, 1, 600)!
    expect(end.start + end.span).toBeLessThanOrEqual(600)
  })

  it('does nothing to a recording too short to zoom, or one of no known length', () => {
    expect(zoomAt(null, 1, 1, 3)).toBeNull()
    expect(zoomAt(null, 1, 1, Infinity)).toBeNull()
    expect(zoomAt(null, 1, 1, 0)).toBeNull()
  })
})

describe('scrolling a zoomed-in waveform sideways', () => {
  const win = { start: 60, span: 20 }

  it('moves by the share of the waveform scrolled, either way', () => {
    // half the waveform's width is half of the 20 seconds on show
    expect(panBy(win, 300, 600, 600)).toEqual({ start: 70, span: 20 })
    expect(panBy(win, -150, 600, 600)).toEqual({ start: 55, span: 20 })
  })

  it('stops at either end of the recording', () => {
    expect(panBy(win, -6000, 600, 600)).toEqual({ start: 0, span: 20 })
    expect(panBy(win, 60000, 600, 600)).toEqual({ start: 580, span: 20 })
    const atStart = { start: 0, span: 20 }
    expect(panBy(atStart, -50, 600, 600)).toBe(atStart) // nothing moves
  })

  it('does nothing with a waveform of no width', () => {
    expect(panBy(win, 300, 0, 600)).toBe(win)
  })
})

describe('telling a sideways scroll from one down the note', () => {
  it('waits until it has moved far enough to tell', () => {
    const g = createPanGesture()
    expect(g(1, 1, 0)).toBeNull()
    expect(g(6, 1, 10)).toBe('x')
  })

  it('keeps its first answer for the rest of the gesture, drift and momentum included', () => {
    const g = createPanGesture()
    expect(g(1, 12, 0)).toBe('y')
    expect(g(30, 2, 16)).toBe('y') // a scroll down the note that drifts sideways
    const h = createPanGesture()
    expect(h(12, 1, 0)).toBe('x')
    expect(h(1, 9, 16)).toBe('x') // a sideways swipe that drifts down
  })

  it('starts again after a pause', () => {
    const g = createPanGesture()
    expect(g(1, 12, 0)).toBe('y')
    expect(g(12, 0, 400)).toBe('x')
  })
})

describe('a zoomed-in window as the recording plays', () => {
  const win = { start: 60, span: 20 }

  it('stays put until the playhead passes the middle, then slides along with it', () => {
    expect(followPlayhead(win, 65, 600, true)).toBe(win)
    expect(followPlayhead(win, 75, 600, true)).toEqual({ start: 65, span: 20 })
  })

  it('never moves under a click while paused, but comes round a skip that leaves it', () => {
    expect(followPlayhead(win, 78, 600, false)).toBe(win)
    expect(followPlayhead(win, 130, 600, false)).toEqual({ start: 120, span: 20 })
    expect(followPlayhead(win, 10, 600, false)).toEqual({ start: 0, span: 20 })
  })

  it('stops at the end of the recording rather than sliding past it', () => {
    expect(followPlayhead({ start: 575, span: 20 }, 594, 600, true)).toEqual({ start: 580, span: 20 })
  })
})

describe('the strip of bars', () => {
  it('pins bars to whole slots and slides by the fraction in between', () => {
    expect(stripAt(0, 0.5)).toEqual({ first: 0, offset: 0 })
    const s = stripAt(10.25, 0.5)
    expect(s.first).toBe(20)
    expect(s.offset).toBeCloseTo(0.5)
  })

  it('does not count a whole slot as one short when the sum lands a hair under', () => {
    // 0.1 × 3 is 0.30000000000000004; 0.3 / 0.1 is 2.9999999999999996
    expect(stripAt(0.3, 0.1).first).toBe(3)
  })

  it('holds the live waveform still for its first 30 seconds, then keeps the newest sound at the right', () => {
    expect(liveStart(0)).toBe(0)
    expect(liveStart(LIVE_SECONDS)).toBe(0)
    expect(liveStart(LIVE_SECONDS + 4.5)).toBe(4.5)
  })
})
