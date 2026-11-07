// Transcribe, the window's half (docs/plans/transcribe.md): read a voice note's recording, decode
// it to the sound Whisper reads (16 kHz, one channel, 16-bit), hand it to main in five-minute
// pieces and wait for the words. Main does the rest (main/transcribe.ts). Decoding here, with the
// browser's own decoder, is what makes Transcribe work on every recording that PLAYS — Voice Memos,
// WhatsApp, Windows Voice Recorder — on every computer, with no converter.
//
// No UI here: the voice note's button, menu item and progress bar call `transcribeRecording` and
// draw what it reports (hooked in with the clip editor's files — editor/voicePlayerUi.ts).

import type { TranscribeProgress, TranscribeResult } from '../../../shared/types'
import { TRANSCRIBE_MAX_SECONDS } from '../../../shared/transcript'

const RATE = 16000
const PIECE_SECONDS = 5 * 60

/** Every channel averaged into one (a stereo recording is heard in full, not just its
 *  left side), clamped and turned into 16-bit samples, for [from, to). */
export function mixToInt16(channels: ArrayLike<number>[], from: number, to: number): Int16Array {
  const n = Math.max(0, to - from)
  const out = new Int16Array(n)
  const k = channels.length || 1
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (const ch of channels) sum += ch[from + i] ?? 0
    const v = Math.max(-1, Math.min(1, sum / k))
    out[i] = Math.round(v * 32767)
  }
  return out
}

export type TranscribeOutcome = TranscribeResult | { ok: false; reason: 'unreadable' | 'too-long' }

export interface Transcribing {
  /** resolves when it ends — with the words, or why not */
  done: Promise<TranscribeOutcome>
  /** stop it (the answer is then `cancelled`) */
  cancel(): void
}

/** Start transcribing the recording at `rel` (a vault path, as the voice note's player has it).
 *  `onProgress` hears how far it has got, and where it is in line. */
export function transcribeRecording(rel: string, onProgress: (p: Omit<TranscribeProgress, 'job'>) => void): Transcribing {
  let job: string | null = null
  let cancelled = false
  const cancel = (): void => {
    cancelled = true
    if (job) void window.api.transcribeCancel(job)
  }
  const done = (async (): Promise<TranscribeOutcome> => {
    let audio: AudioBuffer
    try {
      const bytes = await window.api.readAsset(rel)
      // An OfflineAudioContext decodes straight to 16 kHz; a COPY of the bytes, because
      // decoding detaches the buffer it is given (as voiceWave.ts does).
      audio = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(bytes.slice().buffer)
    } catch {
      return { ok: false, reason: 'unreadable' }
    }
    if (audio.duration > TRANSCRIBE_MAX_SECONDS) return { ok: false, reason: 'too-long' }
    if (cancelled) return { ok: false, reason: 'cancelled' }

    const channels: Float32Array[] = []
    for (let c = 0; c < audio.numberOfChannels; c++) channels.push(audio.getChannelData(c))
    const id = await window.api.transcribeBegin(rel)
    job = id
    const off = window.api.onTranscribeProgress((p) => {
      if (p.job === id) onProgress({ percent: p.percent, etaMs: p.etaMs, waiting: p.waiting })
    })
    try {
      for (let at = 0; at < audio.length; at += PIECE_SECONDS * RATE) {
        if (cancelled) break
        await window.api.transcribeAppend(id, mixToInt16(channels, at, Math.min(audio.length, at + PIECE_SECONDS * RATE)))
      }
      if (cancelled) {
        await window.api.transcribeCancel(id)
        return { ok: false, reason: 'cancelled' }
      }
      return await window.api.transcribeRun(id)
    } catch {
      return { ok: false, reason: cancelled ? 'cancelled' : 'failed' }
    } finally {
      off()
    }
  })()
  return { done, cancel }
}
