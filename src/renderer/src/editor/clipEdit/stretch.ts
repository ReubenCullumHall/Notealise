// Speeding a clip up (or slowing it down) with the voice kept at its pitch, for
// SAVING it that way (Reuben, 2026-11-04: "speed up the clip and save it as a
// sped up clip"). Playback in the panel uses the player's own pitch-keeping
// speed instead; this is only what the saved file is made with. No dependency.
//
// WSOLA, the standard way for speech: the sound is laid down in overlapping
// 40 ms windows at the output's pace, each taken from about where the input's
// pace says, nudged within ±12 ms to the spot that best continues the one
// before it, so the waves line up and no warble is heard. The search runs on a
// copy averaged down 8 times — a tenth of the work, and 1/6000 of a second is
// as near as speech needs it.

const WINDOW = 0.04
const TOLERANCE = 0.012
const COARSE = 8

/** `samples` played `speed` times faster, pitch kept. Output length is
 *  round(input / speed). Speed 1 returns a copy. */
export function stretch(samples: Float32Array, rate: number, speed: number): Float32Array {
  const work = stretchWork(samples, rate, speed)
  for (;;) {
    const step = work.next()
    if (step.done) return step.value
  }
}

/** The same, in slices with the window free in between, for a long clip: 25
 *  minutes at 1.5× is ~2 s of work, which held the window still (2026-11-06). */
export async function stretchAsync(samples: Float32Array, rate: number, speed: number): Promise<Float32Array> {
  const work = stretchWork(samples, rate, speed)
  for (;;) {
    const step = work.next()
    if (step.done) return step.value
    await breathe()
  }
}

/** A moment for the window to draw and take input. */
export const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/** How long a slice runs before it hands the window back. */
const SLICE_MS = 24

/** The work itself, yielding every ~24 ms. */
function* stretchWork(samples: Float32Array, rate: number, speed: number): Generator<void, Float32Array> {
  const n = samples.length
  const outLen = Math.round(n / speed)
  if (!(speed > 0) || Math.abs(speed - 1) < 1e-4 || n === 0) return samples.slice()
  let N = Math.round(WINDOW * rate)
  N += N % 2
  const H = N / 2
  if (n < N * 2) return resampleNaive(samples, outLen)

  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)

  const cn = Math.floor(n / COARSE)
  const coarse = new Float32Array(cn)
  for (let i = 0; i < cn; i++) {
    let s = 0
    for (let j = 0; j < COARSE; j++) s += samples[i * COARSE + j]
    coarse[i] = s / COARSE
  }
  const cTol = Math.max(1, Math.round((TOLERANCE * rate) / COARSE))
  const cLen = Math.max(4, Math.round(H / COARSE))

  const out = new Float32Array(outLen + N)
  const norm = new Float32Array(outLen + N)
  let prev = 0
  let since = performance.now()
  for (let k = 0; ; k++) {
    if ((k & 63) === 0 && performance.now() - since > SLICE_MS) {
      yield
      since = performance.now()
    }
    const outPos = k * H
    if (outPos >= outLen) break
    const nominal = Math.round(outPos * speed)
    let pos = nominal
    if (k > 0) {
      // Find the spot near `nominal` that best continues the previous window
      // (whatever followed it in the input).
      const target = Math.floor((prev + H) / COARSE)
      const centre = Math.floor(nominal / COARSE)
      let best = centre
      let bestScore = -Infinity
      for (let d = -cTol; d <= cTol; d++) {
        const p = centre + d
        if (p < 0 || p + cLen >= cn || target + cLen >= cn) continue
        let score = 0
        for (let i = 0; i < cLen; i++) score += coarse[target + i] * coarse[p + i]
        if (score > bestScore) {
          bestScore = score
          best = p
        }
      }
      pos = best * COARSE
    }
    if (pos + N > n) pos = Math.max(0, n - N)
    for (let i = 0; i < N; i++) {
      out[outPos + i] += samples[pos + i] * win[i]
      norm[outPos + i] += win[i]
    }
    prev = pos
  }
  const result = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) result[i] = norm[i] > 1e-3 ? out[i] / norm[i] : out[i]
  return result
}

/** For a clip too short to window (under 80 ms): plain resampling. */
function resampleNaive(samples: Float32Array, outLen: number): Float32Array {
  const out = new Float32Array(outLen)
  const r = samples.length / Math.max(1, outLen)
  for (let i = 0; i < outLen; i++) out[i] = samples[Math.min(samples.length - 1, Math.floor(i * r))]
  return out
}
