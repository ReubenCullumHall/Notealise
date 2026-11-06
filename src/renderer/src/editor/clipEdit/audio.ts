// The voice note editor's sound: reading the recording in, and making the
// saved files. The renderer never touches the disk (rule 6) — bytes come in
// through readAsset, the edited sound goes to main's convertAudio as a WAV and
// comes back as .m4a, and writeAsset saves it beside the note.

import { baseName, dirName } from '../../../../shared/links'
import { envelopeOf } from '../voiceWave'
import { micAccessMessage, platformOf, recorderErrorMessage } from '../voiceRecModel'
import { type Seg } from './model'
import { editedStem } from './names'
import { breathe, stretchAsync } from './stretch'
import { encodeWavAsync, joinStretches } from './wav'
import { openMic } from '../micChoice'

/** Every edit works at this rate: what macOS and Windows record at, and what
 *  the converters write. */
export const RATE = 48000

/** The longest recording the panel opens. Edits hold the whole recording in
 *  memory as one channel of 32-bit samples — ~350 MB at half an hour — and a
 *  copy of it again to play the preview. */
export const MAX_EDIT_SECONDS = 30 * 60
/** The biggest file it reads, before knowing how long it is. */
export const MAX_EDIT_BYTES = 200 * 1024 * 1024

export interface Recording {
  /** one channel: a voice note saved from here is mono (both sides mixed) */
  samples: Float32Array
  duration: number
  /** the loudest moment in every hundredth of a second, the loudest = 1 */
  envelope: Float32Array
  /** the loudest sample itself, 0–1 — what a take's live bars are measured against */
  peak: number
}

function peakOf(samples: Float32Array): number {
  let p = 0
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i])
    if (v > p) p = v
  }
  return p
}

export type LoadFailure = 'too-long' | 'unreadable'

/** Read and decode a recording, both sides mixed into one. */
export async function loadRecording(rel: string): Promise<Recording | LoadFailure> {
  let bytes: Uint8Array
  try {
    bytes = await window.api.readAsset(rel)
  } catch {
    return 'unreadable'
  }
  if (bytes.byteLength > MAX_EDIT_BYTES) return 'too-long'
  let audio: AudioBuffer
  try {
    // An OfflineAudioContext decodes without opening the sound output; the
    // copy is because decoding detaches the buffer it is given.
    audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.slice().buffer)
  } catch {
    return 'unreadable'
  }
  if (audio.duration > MAX_EDIT_SECONDS) return 'too-long'
  // Each step over a long recording is a fraction of a second: the window
  // gets a moment between them.
  const samples = monoOf(audio)
  await breathe()
  const envelope = envelopeOf([samples], RATE)
  await breathe()
  return { samples, duration: audio.length / RATE, envelope, peak: peakOf(samples) }
}

/** The edited clip as WAV bytes for the panel to play (speed is the player's).
 *  In slices: a long clip took the window away for a second (2026-11-06). */
export const previewWav = (rec: Recording, segs: readonly Seg[]): Promise<Uint8Array> =>
  encodeWavAsync(joinStretches(rec.samples, RATE, segs), RATE)

/** The file name a saved clip starts from: the original's, marked (names.ts). */
export function editedFileName(originalRel: string, section: number | null): string {
  const base = baseName(originalRel)
  const dot = base.lastIndexOf('.')
  return editedStem(dot > 0 ? base.slice(0, dot) : base, section)
}

/** Make and save one clip: its stretches joined, sped up if asked, converted to
 *  .m4a by the computer's own converter, saved beside the note. Where this
 *  computer has no converter (Linux without ffmpeg) the WAV itself is saved —
 *  bigger, but it plays everywhere. Answers the saved file's vault path. */
export async function saveClip(rec: Recording, segs: readonly Seg[], speed: number, notePath: string, stem: string): Promise<string> {
  let sound = joinStretches(rec.samples, RATE, segs)
  if (Math.abs(speed - 1) > 1e-3) sound = await stretchAsync(sound, RATE, speed)
  const wav = await encodeWavAsync(sound, RATE)
  const converted = await window.api.convertAudio(`${stem}.wav`, wav)
  if (converted.ok) return window.api.writeAsset(dirName(notePath), `${stem}.m4a`, converted.data)
  if (converted.reason === 'unsupported') return window.api.writeAsset(dirName(notePath), `${stem}.wav`, wav)
  throw new Error(converted.reason === 'too-big' ? 'The edited clip is too big to save' : 'The edited clip couldn’t be converted')
}

// --- recording another take in the editor (Reuben, 2026-11-05) -------------------
// The microphone is asked for only when Record is pressed, through the same
// door the voice note recorder uses (docs/security.md 2c): main's
// microphoneAccess first, then the page's own request. The take is kept in
// memory as sound until Save, like every other edit here.

export interface TakeRecorder {
  /** Stop and hand back the take as mono samples at RATE (null if nothing usable). */
  stop(): Promise<Float32Array | null>
  /** Stop and throw the take away. */
  cancel(): void
  /** How loud the microphone is right now (the loudest sample in the last ~20 ms, 0–1) — the live bars. */
  level(): number
}

/** Open the microphone and start a take — or answer the sentence saying why not. */
export async function startTake(): Promise<TakeRecorder | string> {
  try {
    const access = await window.api.microphoneAccess()
    const blocked = micAccessMessage(access)
    if (blocked) return blocked
  } catch {
    // The question couldn't be asked; the request below is the real test.
  }
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!devices?.getUserMedia || typeof MediaRecorder === 'undefined') return 'Recording isn’t available here.'
  let stream: MediaStream
  try {
    stream = await openMic()
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name
    return recorderErrorMessage(typeof name === 'string' ? name : '', platformOf(navigator.userAgent))
  }
  // The live bars: a level meter on the stream, into an analyser and nowhere
  // else — never to the speakers (voiceRecorder.ts `startMeter`).
  let meter: { ctx: AudioContext; analyser: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null
  try {
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    void ctx.resume().catch(() => {})
    meter = { ctx, analyser, buf: new Float32Array(analyser.fftSize) }
  } catch {
    meter = null
  }
  const release = (): void => {
    for (const t of stream.getTracks()) t.stop()
    void meter?.ctx.close().catch(() => {})
  }
  let rec: MediaRecorder
  try {
    // Whatever the recorder makes by default: the take is decoded straight back
    // to sound here and never saved in this form.
    rec = new MediaRecorder(stream)
  } catch {
    release()
    return 'Recording isn’t available here.'
  }
  const chunks: Blob[] = []
  rec.addEventListener('dataavailable', (e) => {
    if (e.data.size) chunks.push(e.data)
  })
  rec.start(500)
  return {
    stop: () =>
      new Promise<Float32Array | null>((done) => {
        rec.addEventListener(
          'stop',
          () => {
            release()
            void (async () => {
              try {
                const bytes = await new Blob(chunks, { type: rec.mimeType }).arrayBuffer()
                const audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes)
                done(monoOf(audio))
              } catch {
                done(null)
              }
            })()
          },
          { once: true }
        )
        if (rec.state !== 'inactive') rec.stop()
        else rec.dispatchEvent(new Event('stop'))
      }),
    cancel: () => {
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
    level: () => {
      if (!meter) return 0
      meter.analyser.getFloatTimeDomainData(meter.buf)
      let p = 0
      for (let i = 0; i < meter.buf.length; i++) {
        const v = Math.abs(meter.buf[i])
        if (v > p) p = v
      }
      return p
    }
  }
}

function monoOf(audio: AudioBuffer): Float32Array {
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice()
  const out = new Float32Array(audio.length)
  const n = audio.numberOfChannels
  for (let c = 0; c < n; c++) {
    const ch = audio.getChannelData(c)
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / n
  }
  return out
}

/** The recording with a take on its end: a new Recording (the old one is left as it was). */
export async function withTake(rec: Recording, take: Float32Array): Promise<Recording> {
  const samples = new Float32Array(rec.samples.length + take.length)
  samples.set(rec.samples)
  samples.set(take, rec.samples.length)
  // Only the take's part of the waveform is new: the rest is the recording's
  // own, copied — measuring all 25 minutes again held the window ~0.3 s.
  await breathe()
  const envelope = new Float32Array(Math.ceil(samples.length / (RATE / 100)))
  const tail = envelopeOf([take], RATE)
  const head = rec.envelope
  // envelopeOf scales to the loudest = 1: put both on the same scale.
  const peak = Math.max(rec.peak, peakOf(take))
  const a = peak > 0 ? rec.peak / peak : 1
  const b = peak > 0 ? peakOf(take) / peak : 1
  const keep = Math.min(head.length, Math.floor(rec.samples.length / (RATE / 100)))
  for (let i = 0; i < keep; i++) envelope[i] = head[i] * a
  for (let i = 0; i < tail.length && keep + i < envelope.length; i++) envelope[keep + i] = tail[i] * b
  return { samples, duration: samples.length / RATE, envelope, peak }
}
