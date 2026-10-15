import { VOICE_LIMITS, type VoiceSettings } from '../../../shared/voiceNote'

// The voice note block's arithmetic: every number it shows, and every number it
// hands the audio graph, worked out here with no DOM and no Web Audio so all of
// it can be tested (voiceMixer.test.ts). voicePlayer.ts does the playing and
// voicePlayerUi.ts draws the block; neither decides any of this.

/** How far Tone tilts each end of the sound at full Warmer or full Brighter, in
 *  dB. Enough to hear clearly on a voice, short of turning it into a muffle
 *  (warmer) or a telephone (brighter). */
export const TONE_DB = 8
/** Where the two shelves turn over: below ~250 Hz is the body of a speaking
 *  voice, above ~3.5 kHz its breath and its s's. */
export const LOW_SHELF_HZ = 250
export const HIGH_SHELF_HZ = 3500

/** The two shelf gains, in dB, for a Tone of `tone` (−1 warmer … +1 brighter).
 *  Opposite and equal — a tilt around the middle of the voice, never a change
 *  of pitch — and exactly 0 at 0, so an untouched voice note passes through
 *  the filters unchanged. */
export function toneGains(tone: number): { low: number; high: number } {
  const t = Math.min(1, Math.max(-1, Number.isFinite(tone) ? tone : 0))
  // `+ 0` turns −0 into 0: the same gain, but it reads as a change everywhere
  // a number is compared or printed.
  return { low: -t * TONE_DB + 0, high: t * TONE_DB + 0 }
}

/** The limiter after the volume. It only acts on what would pass full scale —
 *  a 200% boost on a recording that was already loud — so turning a quiet memo
 *  up never crackles, and anything below that goes through as it was. */
export const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 } as const

// --- the sliders ---------------------------------------------------------------

/** Each mixer slider is a whole-number range input; these are its bounds. */
export const SLIDER: Readonly<Record<keyof VoiceSettings, { min: number; max: number; step: number }>> = {
  /** percent */
  volume: { min: 0, max: 200, step: 5 },
  /** hundredths of the tilt */
  tone: { min: -100, max: 100, step: 5 },
  /** a position along a log scale — see `valueFromSlider` */
  speed: { min: 0, max: 1000, step: 1 }
}

const [SPEED_MIN, SPEED_MAX] = VOICE_LIMITS.speed
const SPEED_SPAN = Math.log(SPEED_MAX / SPEED_MIN)

const clamp = (key: keyof VoiceSettings, n: number): number =>
  Math.min(VOICE_LIMITS[key][1], Math.max(VOICE_LIMITS[key][0], n))
/** Two decimal places, as shared/voiceNote.ts writes them, so what a slider
 *  shows and what reaches the note are the same number. */
const round2 = (n: number): number => Math.round(n * 100) / 100

/** A slider position → the setting it means.
 *
 *  Speed is on a LOG scale and snaps to 0.05. A straight 0.5–3 track puts 1×
 *  a fifth of the way along and spends most of its length on speeds nobody
 *  listens to a voice at; on a log scale halving and doubling are the same
 *  distance either side of 1×, which is how speed is heard. */
export function valueFromSlider(key: keyof VoiceSettings, position: number): number {
  if (key === 'speed') {
    const raw = SPEED_MIN * Math.exp((position / SLIDER.speed.max) * SPEED_SPAN)
    return clamp('speed', round2(Math.round(raw * 20) / 20))
  }
  return clamp(key, round2(position / 100))
}

/** The setting → where its slider sits. The inverse of `valueFromSlider` for
 *  every value that one produces. */
export function sliderFromValue(key: keyof VoiceSettings, value: number): number {
  const v = clamp(key, Number.isFinite(value) ? value : key === 'tone' ? 0 : 1)
  if (key === 'speed') return Math.round((Math.log(v / SPEED_MIN) / SPEED_SPAN) * SLIDER.speed.max)
  return Math.round(v * 100)
}

/** Up to two decimals with no trailing zeros: 0.3, 1.25, 2. */
const trim = (n: number): string => String(round2(n))

/** "150%" */
export const volumeLabel = (v: number): string => `${Math.round(v * 100)}%`
/** "+0.3", "−0.25", "0" — a real minus sign, so the two read as a pair. */
export const toneLabel = (t: number): string =>
  round2(t) === 0 ? '0' : `${t > 0 ? '+' : '−'}${trim(Math.abs(t))}`
/** "1.25×" */
export const speedLabel = (s: number): string => `${trim(s)}×`

// --- time ----------------------------------------------------------------------

/** "0:07", "12:30", "1:02:03". Whole seconds, rounded down, as a clock counts. */
export function clockTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** What the small time readout says: how far in while it plays (or sits paused
 *  part-way), and how long the recording is when it is stopped — the answer
 *  someone glancing at a voice note wants. A total is rounded rather than cut
 *  down, so a 4.6 s memo reads 0:05, and never shows as 0:00 unless it is. */
export function timeReadout(t: {
  playing: boolean
  position: number
  duration: number | null
}): string {
  const partWay = t.position > 0.05 && (t.duration === null || t.position < t.duration - 0.05)
  if (t.playing || partWay) return clockTime(t.position)
  if (t.duration === null || !Number.isFinite(t.duration) || t.duration <= 0) return '0:00'
  return clockTime(Math.max(1, Math.round(t.duration)))
}

/** Where a skip lands: `delta` seconds from `position`, kept inside the
 *  recording. An unknown length only stops a skip at the start. */
export function skipTarget(position: number, delta: number, duration: number | null): number {
  const to = (Number.isFinite(position) ? position : 0) + delta
  const end = duration !== null && Number.isFinite(duration) ? duration : Infinity
  return Math.max(0, Math.min(end, to))
}

// --- zoom ----------------------------------------------------------------------
//
// Cmd-click on the waveform (Ctrl-click off a Mac) zooms in where you click;
// with Shift it zooms back out (Reuben, 2026-10-14: "control/command click zoom
// in and out if its a long track to see a few seconds more precisely").

/** The closest it goes: this many seconds across the block. */
export const ZOOM_MIN_SECONDS = 3
/** Each click shows a quarter as much (or, zooming out, four times as much): a
 *  ten-minute memo is four clicks from a few seconds. */
export const ZOOM_STEP = 4

/** A stretch of the recording shown across the block, in seconds. */
export interface ZoomWindow {
  start: number
  span: number
}

/** `start` kept so the window stays inside the recording. */
const fitStart = (start: number, span: number, duration: number): number =>
  Math.min(Math.max(0, duration - span), Math.max(0, start))

/** The window after a zoom click at `at` seconds — `dir` 1 in, -1 out — with
 *  the moment under the pointer staying under the pointer. Null is the whole
 *  recording: zoomed all the way back out, too short to zoom at all, or a
 *  Cmd-click on the closest view, which goes back to where it started. */
export function zoomAt(current: ZoomWindow | null, at: number, dir: 1 | -1, duration: number): ZoomWindow | null {
  if (!(duration > 0) || !Number.isFinite(duration)) return null
  const cur = current ?? { start: 0, span: duration }
  const span = dir > 0 ? Math.max(ZOOM_MIN_SECONDS, cur.span / ZOOM_STEP) : cur.span * ZOOM_STEP
  if (span >= duration) return null
  if (dir > 0 && span >= cur.span) return null // as close as it goes: back to the whole recording
  const t = Math.min(duration, Math.max(0, Number.isFinite(at) ? at : 0))
  return { start: fitStart(t - (t - cur.start) * (span / cur.span), span, duration), span }
}

/** Where a zoomed-in window sits as the recording plays. Playing past the
 *  middle, it slides along with the playhead (the recorder's live waveform
 *  does the same); a jump outside it — a skip, a seek — brings it round the
 *  playhead. Paused, a click inside it never moves it: what was under the
 *  pointer stays there. Returns `win` itself when nothing moves. */
export function followPlayhead(win: ZoomWindow, position: number, duration: number, playing: boolean): ZoomWindow {
  const { start, span } = win
  let next = start
  if (position < start || position > start + span) next = position - span / 2
  else if (playing && position > start + span / 2) next = position - span / 2
  next = fitStart(next, span, duration)
  return Math.abs(next - start) < 1e-9 ? win : { start: next, span }
}

/** A zoomed-in window scrolled sideways by `px`, over a waveform `width` px
 *  wide: it moves by the same share of what is on show, and stops at either end
 *  of the recording. Returns `win` itself when nothing moves. */
export function panBy(win: ZoomWindow, px: number, width: number, duration: number): ZoomWindow {
  if (!(width > 0) || !Number.isFinite(px)) return win
  const next = fitStart(win.start + (px / width) * win.span, win.span, duration)
  return Math.abs(next - win.start) < 1e-9 ? win : { start: next, span: win.span }
}

/** Which way one scroll gesture over a voice note is going — 'x' sideways, 'y'
 *  up and down, null while it has not moved far enough to tell. Decided once a
 *  gesture and kept until the events pause, so a sideways swipe that drifts
 *  never scrolls the note and a scroll down the note that drifts never moves the
 *  waveform (the momentum after the fingers lift is the same gesture). */
export function createPanGesture(idleMs = 180, decidePx = 4): (dx: number, dy: number, t: number) => 'x' | 'y' | null {
  let last = -Infinity
  let axis: 'x' | 'y' | null = null
  let sx = 0
  let sy = 0
  return (dx, dy, t) => {
    if (t - last > idleMs) {
      axis = null
      sx = sy = 0
    }
    last = t
    if (axis) return axis
    sx += Math.abs(dx)
    sy += Math.abs(dy)
    if (sx + sy < decidePx) return null
    axis = sx > sy ? 'x' : 'y'
    return axis
  }
}

// --- the strip of bars ------------------------------------------------------------
//
// The player's waveform (zoomed in) and the recorder's live one both show a
// stretch of a timeline that moves. Bars are pinned to a fixed grid of slots
// from the very start — slot k is always the same slice of sound — and the
// strip is drawn shifted left by a fraction of a slot, so it slides smoothly
// instead of every bar jittering as the edges move under it.

/** Where a strip of `bars` slots, each `slot` seconds, starts when its left
 *  edge is at `start` seconds: the first slot drawn and how far into it the
 *  edge falls (0–1). One more slot than `bars` is drawn, to fill the gap the
 *  shift leaves at the right. */
export function stripAt(start: number, slot: number): { first: number; offset: number } {
  const at = slot > 0 && start > 0 ? start / slot : 0
  const first = Math.floor(at + 1e-9)
  return { first, offset: Math.max(0, at - first) }
}

/** The recorder's live waveform shows the last 30 seconds (Reuben,
 *  2026-10-14): it fills from the left, then slides left and keeps recording. */
export const LIVE_SECONDS = 30

/** The live strip's left edge after `seconds` of recording: still at 0 until
 *  the window is full, then the newest sound at the right edge. */
export const liveStart = (seconds: number): number => Math.max(0, seconds - LIVE_SECONDS)

// --- names ---------------------------------------------------------------------

/** The file a target names, as a person would read it: decoded, folder dropped,
 *  extension kept — "Voice note 2026-10-13 14.32.m4a". */
export function fileNameOf(target: string): string {
  let t = target
  try {
    t = decodeURIComponent(target)
  } catch {
    // a stray % that isn't an escape — show it as written
  }
  return t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1) || t
}

/** The same without its extension — what a screen reader announces the block as. */
export function recordingName(target: string): string {
  const base = fileNameOf(target)
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base) || 'Recording'
}
