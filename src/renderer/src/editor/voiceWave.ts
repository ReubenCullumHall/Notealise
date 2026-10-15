// The voice note's waveform: how loud each slice of the recording is, read
// once from the file's own audio and drawn as bars (voicePlayerUi.ts).
//
// What is kept is an ENVELOPE — the loudest moment in every hundredth of a
// second — not the bars themselves, so the block can draw any stretch of the
// recording: the whole of it, or the few seconds a Cmd/Ctrl-click zooms in to
// (Reuben, 2026-10-14). `envelopeOf` and `barsFor` are pure and tested
// (voiceWave.test.ts). `decodeWave` is the one call into the browser's decoder.

/** How many bars the waveform shows, whatever the width of the note — CSS
 *  stretches them, so a narrow split pane gets thin bars, not fewer. */
export const BARS = 96

/** The shortest a bar is drawn, as a share of the tallest: a silent stretch
 *  still shows as a row of stubs, so the line reads as one recording. */
export const MIN_BAR = 0.06

/** Recordings longer than this, or bigger than `WAVE_MAX_BYTES`, get flat bars
 *  instead of a waveform. Decoding holds the whole recording as 32-bit samples;
 *  at the 8 kHz below that is ~115 MB an hour of mono (measured by the format
 *  lab — at the usual 44.1 kHz it was ~635 MB), so an hour-long lecture still
 *  gets its waveform and a longer one simply plays without it. */
export const WAVE_MAX_SECONDS = 60 * 60
export const WAVE_MAX_BYTES = 150 * 1024 * 1024

/** The decoder's output rate. The waveform needs ~100 numbers a second, not
 *  48,000; asking the decoder to resample to this keeps what it holds small.
 *  8 kHz is comfortably above the 3 kHz Chromium accepts. */
const DECODE_RATE = 8000

/** The envelope's resolution: the loudest moment in each hundredth of a
 *  second. Fine enough for the closest zoom (a few seconds across the block is
 *  about three of these a bar), small enough to keep: an hour is 360,000. */
export const ENVELOPE_PER_SECOND = 100

/** The loudest moment in every 1/`perSecond` of a second, reading every
 *  channel (a slice is as loud as its loudest side), scaled so the loudest in
 *  the WHOLE recording is 1 — a quiet phone memo draws as tall as a loud one,
 *  and a zoomed-in stretch keeps the scale of the whole. */
export function envelopeOf(
  channels: readonly ArrayLike<number>[],
  sampleRate: number,
  perSecond = ENVELOPE_PER_SECOND
): Float32Array {
  const length = channels.reduce((n, c) => Math.max(n, c.length), 0)
  if (!length || !(sampleRate > 0) || !(perSecond > 0)) return new Float32Array(0)
  const step = sampleRate / perSecond
  const count = Math.ceil(length / step)
  const out = new Float32Array(count)
  let loudest = 0
  for (let k = 0; k < count; k++) {
    const from = Math.floor(k * step)
    // The last slice runs to the end outright: (k + 1) × step can come out a
    // hair under `length` and would drop the final sample.
    const to = k === count - 1 ? length : Math.max(from + 1, Math.min(length, Math.floor((k + 1) * step)))
    let peak = 0
    for (const ch of channels) {
      const end = Math.min(to, ch.length)
      for (let i = from; i < end; i++) {
        const v = Math.abs(ch[i])
        if (v > peak) peak = v
      }
    }
    out[k] = peak
    if (peak > loudest) loudest = peak
  }
  if (loudest > 0) for (let k = 0; k < count; k++) out[k] /= loudest
  return out
}

/** The bars for the stretch from `from` to `to` seconds, `bars` of them: each
 *  the loudest moment in its slice, never below MIN_BAR — and exactly 0 for a
 *  slice wholly past the end of the recording, which draws as nothing rather
 *  than as silence that isn't there. Every value of the envelope inside the
 *  stretch lands in exactly one bar. */
export function barsFor(env: ArrayLike<number>, perSecond: number, from: number, to: number, bars: number): number[] {
  const count = Math.max(0, Math.floor(bars))
  const out = new Array<number>(count).fill(0)
  if (!count || !(to > from) || !(perSecond > 0)) return out
  // The envelope value at `t` seconds. The nudge absorbs floating-point error
  // (12.34 × 100 comes out as 1233.999…), which would otherwise move a value
  // at a bar's edge into the wrong bar, or off the end altogether.
  const at = (t: number): number => Math.floor(t * perSecond + 1e-6)
  const edge = (b: number): number => (b >= count ? to : from + ((to - from) * b) / count)
  for (let b = 0; b < count; b++) {
    const a = Math.max(0, at(edge(b)))
    const z = Math.max(a + 1, at(edge(b + 1)))
    if (a >= env.length) continue // past the end: nothing here
    let peak = 0
    for (let i = a; i < Math.min(z, env.length); i++) if (env[i] > peak) peak = env[i]
    out[b] = Math.max(MIN_BAR, peak)
  }
  return out
}

export interface Wave {
  /** `envelopeOf` the recording, at ENVELOPE_PER_SECOND */
  envelope: Float32Array
  /** seconds, from the decoded audio itself — exact, which the <audio> element's
   *  own figure is not for a recording made in the browser (see voicePlayer.ts) */
  duration: number
}

/** The waveform of a recording's bytes, or null when the browser cannot read
 *  them — which is exactly when the player cannot play them either (the format
 *  lab checked the two against each other, format by format).
 *
 *  An OfflineAudioContext, not the one that plays: it needs no click to start,
 *  never opens the sound output, and decodes at the low rate above. A COPY of
 *  the bytes is handed over because decoding detaches the buffer it is given. */
export async function decodeWave(bytes: Uint8Array): Promise<Wave | null> {
  try {
    const ctx = new OfflineAudioContext(1, 1, DECODE_RATE)
    const audio = await ctx.decodeAudioData(bytes.slice().buffer)
    const channels: Float32Array[] = []
    for (let i = 0; i < audio.numberOfChannels; i++) channels.push(audio.getChannelData(i))
    // Only the envelope leaves this function: the decoded samples go as soon
    // as it returns.
    return { envelope: envelopeOf(channels, audio.sampleRate), duration: audio.duration }
  } catch {
    return null
  }
}
