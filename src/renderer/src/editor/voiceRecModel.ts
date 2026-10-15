// The pure half of voice notes: what to record in, what a file is called, what
// to tell someone, and how to read what the hidden players found out. No DOM and
// no CodeMirror view — voiceRecorder.ts (the /voice block) and voiceImport.ts
// (recordings dropped, pasted or picked) do the touching; voiceRecModel.test.ts
// tests the deciding.

import type { MicAccess, VoicePlatform } from '../../../shared/types'

// --- what MediaRecorder is asked for ------------------------------------------

export interface RecorderPlan {
  /** what MediaRecorder is asked for — always with the codec named */
  mime: string
  /** what it is asked to spend, in bits per second */
  bitsPerSecond: number
  /** the extension the recording is saved with */
  ext: string
}

// Measured by the format lab in this exact Electron (43.2.0, Chromium 150),
// 2026-10-13, and built to the lead's brief from it:
//
//   • AAC in .m4a is the one to have. It is what Voice Memos and Windows' Voice
//     Recorder write, so every other app opens it (rule 4), it carries its own
//     length (a seek bar from the first frame) and macOS's own tools read it.
//   • But AAC is the SYSTEM's encoder, not Chromium's, and it is fragile: it gives
//     no bytes at all — an `EncodingError`, 0.16–0.56 s after start, with the GPU
//     process crashing and restarting — when the microphone delivers 16 or 24 kHz
//     (a Bluetooth headset, AirPods), or when asked for under 48 kbps. So it is
//     only asked for at 44.1/48 kHz, and at 64 kbps (plenty for a voice).
//   • Opus in the same .m4a box is Chromium's own encoder and never failed in any
//     test, at any rate. It is the fallback, at 32 kbps.
//   • Plain 'audio/mp4' quietly means Opus here, so the codec is always named.
//     WebM is never used: with timeslices it has no length (Infinity), and
//     nothing on a Mac opens it. Leaving the type out gives WebM, so a type is
//     always given. 'audio/ogg' isn't recordable here at all.

export const AAC_PLAN: Readonly<RecorderPlan> = { mime: 'audio/mp4;codecs=mp4a.40.2', bitsPerSecond: 64000, ext: 'm4a' }
export const OPUS_PLAN: Readonly<RecorderPlan> = { mime: 'audio/mp4;codecs=opus', bitsPerSecond: 32000, ext: 'm4a' }

/** The microphone rates AAC records at here. 16 and 24 kHz fail outright. */
export const AAC_SAFE_RATES: readonly number[] = [44100, 48000]

/** What to record in, from what this recorder supports and the rate the
 *  microphone runs at (`track.getSettings().sampleRate`, which may be missing).
 *
 *  `first` is the recording. `understudy`, when there is one, is an Opus
 *  recorder that runs beside AAC from the very first moment until AAC has
 *  handed over its first sound — so if AAC fails anyway (an `EncodingError`,
 *  or simply nothing), the Opus one takes over and nothing said so far is lost,
 *  where restarting would lose the first half-second. Null when neither can be
 *  recorded at all (not the case anywhere Electron 43 runs).
 *
 *  `isTypeSupported` is MediaRecorder's own, passed in so this stays testable;
 *  one that throws is read as "no". */
export function chooseRecording(
  isTypeSupported: (mime: string) => boolean,
  sampleRate: number | undefined
): { first: RecorderPlan; understudy: RecorderPlan | null } | null {
  const can = (p: RecorderPlan): boolean => {
    try {
      return isTypeSupported(p.mime)
    } catch {
      return false
    }
  }
  const opus = can(OPUS_PLAN) ? OPUS_PLAN : null
  if (can(AAC_PLAN) && sampleRate !== undefined && AAC_SAFE_RATES.includes(sampleRate)) {
    return { first: AAC_PLAN, understudy: opus }
  }
  return opus ? { first: opus, understudy: null } : null
}

/** The extension for what the recorder ACTUALLY produced. MediaRecorder may
 *  answer with a different type from the one it was asked for (asked for
 *  'audio/mp4', it says 'audio/mp4;codecs=opus'), and the file is named after
 *  what is in it. `fallback` is used for a type it doesn't recognise. */
export function extForRecordedMime(mime: string, fallback: string): string {
  const base = mime.split(';')[0].trim().toLowerCase()
  if (base === 'audio/mp4' || base === 'video/mp4' || base === 'audio/x-m4a' || base === 'audio/m4a') return 'm4a'
  if (base === 'audio/webm' || base === 'video/webm' || base === 'audio/x-matroska') return 'webm'
  if (base === 'audio/ogg' || base === 'application/ogg') return 'ogg'
  if (base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave') return 'wav'
  return fallback
}

// --- the recorder block ---------------------------------------------------------

/** "0:07", "12:30", "1:02:05" — the elapsed time on the recorder, never counting
 *  time spent paused (that is the caller's job; this only formats). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** How much recorded sound makes Discard ask first. Below this a slip costs
 *  almost nothing; above it, a stray click could throw away a thought. */
export const DISCARD_ASKS_AFTER_MS = 5000

export const shouldConfirmDiscard = (recordedMs: number): boolean => recordedMs >= DISCARD_ASKS_AFTER_MS

/** Where the recorder block sits while recording, and where the voice note's
 *  line will go. `lineFrom`/`lineTo` are the line holding `pos`.
 *
 *  At the start of a line (where `/voice` on an empty line leaves you) the block
 *  sits ABOVE that line — exactly where the player will be, with the line you
 *  are typing on under it. Partway along a line, it sits after the line, which
 *  is where `recordingInsert` puts the voice note. */
export function blockPlacement(pos: number, lineFrom: number, lineTo: number): { at: number; side: -1 | 1 } {
  return pos <= lineFrom ? { at: lineFrom, side: -1 } : { at: lineTo, side: 1 }
}

/** What Stop writes, and where: the voice note goes exactly where its recorder
 *  block was showing (`blockPlacement`) — above the line it was started at the
 *  start of, or after the WHOLE line it was started partway along, words typed
 *  on that line while recording included. Splitting the line at the spot
 *  `/voice` was typed would cut a sentence someone kept typing in two.
 *  `lineText` is the line holding `pos`, which starts at `lineFrom`. */
export function recordingInsert(lineText: string, lineFrom: number, pos: number, tag: string): { at: number; text: string } {
  const { at } = blockPlacement(pos, lineFrom, lineFrom + lineText.length)
  return { at, text: ownLineInsert(lineText.slice(0, at - lineFrom), tag) }
}

/** The text to insert for a voice note at a point whose line has `textBefore`
 *  ahead of it: the tag on a line of its own. A line break after it always (the
 *  same as a photo, attachInput.ts), and one before it only when the point is
 *  partway along a line — a player can't sit in the middle of a sentence. */
export function ownLineInsert(textBefore: string, tag: string): string {
  return (textBefore.length > 0 ? '\n' : '') + tag + '\n'
}

// --- what to tell someone ------------------------------------------------------

/** The system this window is on, read from the user agent — enough to say where
 *  the microphone switch lives when the main process hasn't said already. */
export function platformOf(userAgent: string): VoicePlatform {
  if (/Mac/i.test(userAgent)) return 'darwin'
  if (/Windows/i.test(userAgent)) return 'win32'
  if (/Linux|X11|CrOS/i.test(userAgent)) return 'linux'
  return 'other'
}

/** "The app isn't allowed the microphone" — and where to change that. */
export function micBlockedMessage(platform: VoicePlatform): string {
  if (platform === 'darwin')
    return 'Notealise isn’t allowed to use the microphone. Switch it on in System Settings → Privacy & Security → Microphone, then try again.'
  if (platform === 'win32')
    return 'Notealise isn’t allowed to use the microphone. Switch it on in Settings → Privacy & security → Microphone, then try again.'
  return 'Notealise isn’t allowed to use the microphone. Allow it in your computer’s privacy settings, then try again.'
}

export const NO_MIC = 'No microphone found.'
export const MIC_BUSY = 'The microphone is being used by another app.'

/** What `microphoneAccess()` answered, as a sentence — null when it said yes. */
export function micAccessMessage(access: MicAccess): string | null {
  if (access.ok) return null
  return access.reason === 'unavailable' ? NO_MIC : micBlockedMessage(access.platform)
}

/** A `getUserMedia` refusal (its error's `name`) as a sentence. */
export function recorderErrorMessage(errorName: string, platform: VoicePlatform): string {
  switch (errorName) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return micBlockedMessage(platform)
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return NO_MIC
    case 'NotReadableError':
    case 'TrackStartError':
      return MIC_BUSY
    default:
      return 'Couldn’t start the microphone.'
  }
}

// A recording whose note left the screen before it was saved still ends up IN
// that note — at its end, since the spot it was started at belonged to a
// document that is no longer in front of anyone (voiceRecorder.ts).

/** Said when the voice note has been added to the end of its note. */
export const addedAtEnd = (names: readonly string[], noteTitle: string): string =>
  names.length === 1
    ? `Added ${names[0]} to the end of ${noteTitle}.`
    : `Added ${names.length} voice notes to the end of ${noteTitle}.`

/** Said when the note is open nowhere: the line waits for the note to be opened
 *  (or for the app to quit, when it is written into the file). */
export const addedWhenOpened = (name: string, noteTitle: string): string =>
  `Saved ${name} — it will be added to the end of ${noteTitle} when you open it.`

/** What to put at the END of a note's text to add these lines: each on a line
 *  of its own, after a blank line when the note has text. Judged on the text
 *  with its line endings normalised — a CRLF file is decided the same way, and
 *  the writer restores its endings. */
export function endInsert(text: string, lines: readonly string[]): string {
  const body = lines.join('\n') + '\n'
  const t = text.replace(/\r\n/g, '\n')
  if (t.length === 0 || t.endsWith('\n\n')) return body
  return (t.endsWith('\n') ? '\n' : '\n\n') + body
}

/** The picker's "left out" list, or null when nothing was. */
export function tooBigMessage(names: readonly string[]): string | null {
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} is too big to add as a voice note.`
  return `These are too big to add as voice notes: ${names.join(', ')}.`
}

export const convertingMessage = (name: string): string => `Converting ${name}…`

/** Said once a recording that couldn't be played here has been saved AS IT IS,
 *  because this computer couldn't turn it into one that can. */
export function notConvertedMessage(name: string, reason: 'unsupported' | 'failed'): string {
  return reason === 'unsupported'
    ? `${name} is in the note, but this computer can’t convert this kind of recording to play inside Notealise. Open it in its own app to listen.`
    : `${name} is in the note, but this computer couldn’t convert it to play inside Notealise. Open it in its own app to listen.`
}

export const tooBigToConvert = (name: string): string => `${name} is too big to convert, so it wasn’t added.`

// --- what the hidden players found out -----------------------------------------

/** What a hidden <audio> made of a file: did it get as far as being able to
 *  play, or did it give up (or run out of time)? */
export interface PlayProbe {
  canPlay: boolean
  error: boolean
  timedOut: boolean
  /** seconds, NaN before metadata, Infinity for a stream with no length written */
  duration: number
}

/** Can the app's own player play this? Only a file that reached `canplay` —
 *  the decoder has produced sound, not just read a header — and has some
 *  length. Anything else is converted (or saved as it is) rather than written
 *  into the note as a player that will never play. Infinity is a length:
 *  a WebM written by a recorder often carries none, and plays perfectly. */
export function isPlayable(p: PlayProbe): boolean {
  if (p.error || !p.canPlay) return false
  return !(p.duration === 0)
}

/** What a hidden <video> made of a file that arrived looking like a video. */
export interface PictureProbe {
  metadata: boolean
  error: boolean
  videoWidth: number
  videoHeight: number
}

/** Is this "video" really a recording — sound with no picture at all?
 *
 *  Only a definite yes counts: the player read the file and found no picture,
 *  AND the file itself declares no video track (`declaresVideo`, from the MP4
 *  box scan below). A picture it merely couldn't decode is still a picture —
 *  an iPhone video on a PC without the HEVC decoder must stay a video. Anything
 *  uncertain (an error, a timeout) stays a video, exactly as it was before
 *  voice notes existed. */
export function isSoundOnly(p: PictureProbe, declaresVideo: boolean): boolean {
  return p.metadata && !p.error && p.videoWidth === 0 && p.videoHeight === 0 && !declaresVideo
}

/** Does an MP4 / MOV / 3GP file declare a video track? Every track names its
 *  kind in a handler box: `hdlr`, then four bytes of version and flags, four of
 *  pre-defined (QuickTime's component type), then the handler type — `vide` for
 *  video, `soun` for sound. A plain scan, so a moov box at either end is found. */
export function isoDeclaresVideo(bytes: Uint8Array): boolean {
  const n = bytes.length - 16
  for (let i = 0; i <= n; i++) {
    if (bytes[i] !== 0x68 || bytes[i + 1] !== 0x64 || bytes[i + 2] !== 0x6c || bytes[i + 3] !== 0x72) continue
    const t = i + 12
    if (bytes[t] === 0x76 && bytes[t + 1] === 0x69 && bytes[t + 2] === 0x64 && bytes[t + 3] === 0x65) return true
  }
  return false
}

/** A container that is sometimes a recording in disguise: Obsidian's audio
 *  recorder writes .webm, screen and phone recorders write sound-only .mp4 and
 *  .mov. Only these are worth loading into a hidden player to find out. */
export function mightBeSoundOnly(name: string, mime: string): boolean {
  if (/^video\/(webm|mp4|quicktime|x-m4v)$/i.test(mime)) return true
  return /\.(webm|mp4|mov|m4v)$/i.test(name)
}

/** The MP4 family, whose header can be scanned for a video track. */
export const isIsoMedia = (name: string): boolean => /\.(mp4|mov|m4v|3gp|3g2)$/i.test(name)

/** The bare file name out of a vault path. */
export const baseNameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
