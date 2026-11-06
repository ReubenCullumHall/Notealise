// A mono 16-bit WAV, the plainest file every converter reads (afconvert, Media
// Foundation, ffmpeg) — the edited sound goes to main's convertAudio as this
// and comes back as .m4a. Also what the panel plays its preview from.

/** `samples` (−1…1, mono) as WAV bytes. Out-of-range values are clipped. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const work = encodeWork(samples, rate)
  for (;;) {
    const step = work.next()
    if (step.done) return step.value
  }
}

/** The same, a million samples at a time with the window free in between: a
 *  25-minute clip is 72 million of them (2026-11-06: ~1 s of a still window). */
export async function encodeWavAsync(samples: Float32Array, rate: number): Promise<Uint8Array> {
  const work = encodeWork(samples, rate)
  for (;;) {
    const step = work.next()
    if (step.done) return step.value
    await new Promise<void>((r) => setTimeout(r, 0))
  }
}

const CHUNK = 1 << 20

function* encodeWork(samples: Float32Array, rate: number): Generator<void, Uint8Array> {
  const data = samples.length * 2
  const buf = new ArrayBuffer(44 + data)
  const v = new DataView(buf)
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + data, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  v.setUint32(16, 16, true) // the size of this chunk
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // bytes a second
  v.setUint16(32, 2, true) // bytes a sample
  v.setUint16(34, 16, true) // bits
  text(36, 'data')
  v.setUint32(40, data, true)
  // An Int16Array over the data, not DataView.setInt16 per sample (several times
  // slower). WAV is little-endian, and so is every computer this app runs on
  // (x64, Apple silicon, ARM Windows) — checked here anyway, as the old way.
  const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
  const out = le ? new Int16Array(buf, 44, samples.length) : null
  for (let from = 0; from < samples.length; from += CHUNK) {
    const to = Math.min(samples.length, from + CHUNK)
    for (let i = from; i < to; i++) {
      const s = samples[i] > 1 ? 1 : samples[i] < -1 ? -1 : samples[i]
      const q = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
      if (out) out[i] = q
      else v.setInt16(44 + i * 2, q, true)
    }
    if (to < samples.length) yield
  }
  return new Uint8Array(buf)
}

/** The kept stretches (original seconds) of `samples`, end to end — a hard cut
 *  at every join, nothing smoothed (Reuben, 2026-11-04: "if there is a noise
 *  that is harshly cut, keep it"). */
export function joinStretches(samples: Float32Array, rate: number, segs: readonly (readonly [number, number])[]): Float32Array {
  const parts = segs.map(([a, b]) => [Math.max(0, Math.round(a * rate)), Math.min(samples.length, Math.round(b * rate))] as const)
  const total = parts.reduce((n, [a, b]) => n + Math.max(0, b - a), 0)
  const out = new Float32Array(total)
  let at = 0
  for (const [a, b] of parts) {
    if (b <= a) continue
    out.set(samples.subarray(a, b), at)
    at += b - a
  }
  return out
}
