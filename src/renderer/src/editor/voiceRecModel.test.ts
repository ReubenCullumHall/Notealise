import { describe, expect, it } from 'vitest'
import {
  AAC_PLAN,
  OPUS_PLAN,
  addedAtEnd,
  addedWhenOpened,
  blockPlacement,
  chooseRecording,
  endInsert,
  extForRecordedMime,
  formatElapsed,
  isIsoMedia,
  isPlayable,
  isSoundOnly,
  isoDeclaresVideo,
  micAccessMessage,
  micBlockedMessage,
  mightBeSoundOnly,
  notConvertedMessage,
  ownLineInsert,
  platformOf,
  recorderErrorMessage,
  recordingInsert,
  shouldConfirmDiscard,
  tooBigMessage
} from './voiceRecModel'

/** A stand-in for MediaRecorder.isTypeSupported that knows exactly `types`. */
const only =
  (...types: string[]) =>
  (mime: string): boolean =>
    types.includes(mime)

/** What this Electron answers (measured by the format lab): AAC and Opus in MP4,
 *  WebM — and no Ogg. */
const ELECTRON_43 = only(
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4;codecs=opus',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm'
)

describe('choosing what to record in', () => {
  it('records AAC in an .m4a at 64 kbps from an ordinary 44.1 or 48 kHz microphone', () => {
    for (const rate of [44100, 48000]) {
      const plan = chooseRecording(ELECTRON_43, rate)
      expect(plan?.first).toEqual({ mime: 'audio/mp4;codecs=mp4a.40.2', bitsPerSecond: 64000, ext: 'm4a' })
      // …with Opus running beside it until AAC has proved itself.
      expect(plan?.understudy).toEqual({ mime: 'audio/mp4;codecs=opus', bitsPerSecond: 32000, ext: 'm4a' })
    }
  })

  it('goes straight to Opus for a Bluetooth headset — AAC gives nothing at 16 or 24 kHz', () => {
    for (const rate of [16000, 24000, 8000, 32000, 96000, undefined]) {
      expect(chooseRecording(ELECTRON_43, rate), String(rate)).toEqual({ first: OPUS_PLAN, understudy: null })
    }
  })

  it('goes to Opus where there is no AAC encoder at all', () => {
    expect(chooseRecording(only('audio/mp4;codecs=opus'), 48000)).toEqual({ first: OPUS_PLAN, understudy: null })
  })

  it('keeps AAC without an understudy rather than not recording', () => {
    expect(chooseRecording(only('audio/mp4;codecs=mp4a.40.2'), 48000)).toEqual({ first: AAC_PLAN, understudy: null })
  })

  it('never records WebM, and never leaves the type to the recorder', () => {
    // With only WebM on offer there is nothing it will record in.
    expect(chooseRecording(only('audio/webm;codecs=opus', 'audio/webm'), 48000)).toBeNull()
    for (const plan of [AAC_PLAN, OPUS_PLAN]) {
      expect(plan.mime).toMatch(/^audio\/mp4;codecs=/) // plain audio/mp4 would mean Opus here
      expect(plan.ext).toBe('m4a')
    }
  })

  it('never asks AAC for less than 48 kbps — below that it fails outright', () => {
    expect(AAC_PLAN.bitsPerSecond).toBeGreaterThanOrEqual(48000)
  })

  it('reads a check that throws as "no", rather than failing the recording', () => {
    const fussy = (mime: string): boolean => {
      if (mime.includes('mp4a')) throw new Error('not here')
      return mime === 'audio/mp4;codecs=opus'
    }
    expect(chooseRecording(fussy, 48000)?.first).toBe(OPUS_PLAN)
  })
})

describe('naming a recording after what is in it', () => {
  it('maps what the recorder says it made to an extension', () => {
    expect(extForRecordedMime('audio/mp4;codecs=mp4a.40.2', 'webm')).toBe('m4a')
    // Asked for plain audio/mp4, this Electron answers with Opus in MP4.
    expect(extForRecordedMime('audio/mp4;codecs=opus', 'webm')).toBe('m4a')
    expect(extForRecordedMime('audio/webm;codecs=opus', 'm4a')).toBe('webm')
    expect(extForRecordedMime('video/webm;codecs="opus"', 'm4a')).toBe('webm')
    expect(extForRecordedMime('audio/ogg; codecs=opus', 'm4a')).toBe('ogg')
    expect(extForRecordedMime('AUDIO/MP4', 'webm')).toBe('m4a')
  })

  it('keeps the requested extension for a type it has never seen, or none at all', () => {
    expect(extForRecordedMime('', 'm4a')).toBe('m4a')
    expect(extForRecordedMime('audio/x-future', 'webm')).toBe('webm')
  })
})

describe('the recorder block', () => {
  it('shows minutes and seconds, hours only when there are some', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(7_400)).toBe('0:07')
    expect(formatElapsed(59_999)).toBe('0:59')
    expect(formatElapsed(750_000)).toBe('12:30')
    expect(formatElapsed(3_725_000)).toBe('1:02:05')
    expect(formatElapsed(-5)).toBe('0:00')
    expect(formatElapsed(NaN)).toBe('0:00')
  })

  it('asks before discarding only once there is something worth keeping', () => {
    expect(shouldConfirmDiscard(4_999)).toBe(false)
    expect(shouldConfirmDiscard(5_000)).toBe(true)
  })

  it('sits above the line it was started on, or below one it was started partway along', () => {
    expect(blockPlacement(10, 10, 10)).toEqual({ at: 10, side: -1 }) // an empty line
    expect(blockPlacement(10, 10, 25)).toEqual({ at: 10, side: -1 }) // start of a line with text
    expect(blockPlacement(18, 10, 25)).toEqual({ at: 25, side: 1 }) // partway along
  })

  it('puts a voice note on a line of its own', () => {
    const tag = '<audio controls src="a.m4a"></audio>'
    expect(ownLineInsert('', tag)).toBe(tag + '\n')
    expect(ownLineInsert('Notes from the call: ', tag)).toBe('\n' + tag + '\n')
  })

  it('puts the voice note where its recorder was showing, never through a sentence typed meanwhile', () => {
    const tag = '<audio controls src="a.m4a"></audio>'
    // `/voice` at the start of a line (the recorder sat above it): the voice
    // note goes above whatever was typed on that line while it recorded.
    expect(recordingInsert('Typed while talking', 10, 10, tag)).toEqual({ at: 10, text: tag + '\n' })
    expect(recordingInsert('', 10, 10, tag)).toEqual({ at: 10, text: tag + '\n' })
    // `/voice` at the end of "Hello " and the sentence carried on while it
    // recorded (the recorder sat after the whole line): it goes after the
    // whole line, not between "Hello " and the rest — measured 2026-10-14,
    // the first build split the sentence in two.
    expect(recordingInsert('Hello world, typed meanwhile', 10, 16, tag)).toEqual({ at: 38, text: '\n' + tag + '\n' })
    // Started partway along a line: after the line too, the line kept whole.
    expect(recordingInsert('Hello world', 10, 15, tag)).toEqual({ at: 21, text: '\n' + tag + '\n' })
  })

  it('adds a voice note at the end of a note on its own line, after a blank line', () => {
    const tag = '<audio controls src="a.m4a"></audio>'
    expect(endInsert('', [tag])).toBe(tag + '\n') // an empty note: just the line
    expect(endInsert('Last words', [tag])).toBe('\n\n' + tag + '\n')
    expect(endInsert('Last words\n', [tag])).toBe('\n' + tag + '\n')
    expect(endInsert('Last words\n\n', [tag])).toBe(tag + '\n') // the blank line is already there
    // A CRLF file is judged the same way (the writer puts its endings back).
    expect(endInsert('Last words\r\n', [tag])).toBe('\n' + tag + '\n')
    expect(endInsert('Last words\r\n\r\n', [tag])).toBe(tag + '\n')
    // Several waiting for the same note: one per line, in order.
    expect(endInsert('x', [tag, tag.replace('a.m4a', 'b.m4a')])).toBe('\n\n' + tag + '\n' + tag.replace('a.m4a', 'b.m4a') + '\n')
  })
})

describe('what the person is told', () => {
  it('says where the microphone switch is on each system', () => {
    expect(micBlockedMessage('darwin')).toContain('System Settings → Privacy & Security → Microphone')
    expect(micBlockedMessage('win32')).toContain('Settings → Privacy & security → Microphone')
    expect(micBlockedMessage('linux')).not.toContain('System Settings')
  })

  it('reads main\'s answer about the microphone', () => {
    expect(micAccessMessage({ ok: true })).toBeNull()
    expect(micAccessMessage({ ok: false, reason: 'denied', platform: 'darwin' })).toContain('System Settings')
    expect(micAccessMessage({ ok: false, reason: 'restricted', platform: 'win32' })).toContain('Settings → Privacy')
    expect(micAccessMessage({ ok: false, reason: 'unavailable', platform: 'darwin' })).toBe('No microphone found.')
  })

  it('turns each microphone refusal into its own sentence', () => {
    expect(recorderErrorMessage('NotAllowedError', 'darwin')).toContain('System Settings')
    expect(recorderErrorMessage('NotFoundError', 'win32')).toBe('No microphone found.')
    expect(recorderErrorMessage('NotReadableError', 'win32')).toBe('The microphone is being used by another app.')
    expect(recorderErrorMessage('SomethingNew', 'linux')).toBe('Couldn’t start the microphone.')
  })

  it('knows which system it is on from the window', () => {
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/43')).toBe('darwin')
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/43')).toBe('win32')
    expect(platformOf('Mozilla/5.0 (X11; Linux x86_64) Electron/43')).toBe('linux')
    expect(platformOf('Node.js/24')).toBe('other')
  })

  it('never says "we", never shouts, and spells it the British way', () => {
    const all = [
      micBlockedMessage('darwin'),
      micBlockedMessage('win32'),
      micBlockedMessage('other'),
      addedAtEnd(['Voice note 2026-10-13 14.32.m4a'], 'Lecture'),
      addedAtEnd(['a.m4a', 'b.m4a'], 'Lecture'),
      addedWhenOpened('Voice note 2026-10-13 14.32.m4a', 'Lecture'),
      tooBigMessage(['a.wav']) ?? '',
      tooBigMessage(['a.wav', 'b.wav']) ?? '',
      notConvertedMessage('memo.wma', 'unsupported'),
      notConvertedMessage('memo.wma', 'failed')
    ]
    for (const s of all) {
      expect(s).not.toMatch(/\bwe\b|!/i)
      expect(s).not.toMatch(/\b(color|recognize|organize)\b/i)
    }
    expect(addedAtEnd(['a.m4a'], 'Lecture')).toBe('Added a.m4a to the end of Lecture.')
    expect(addedAtEnd(['a.m4a', 'b.m4a'], 'Lecture')).toBe('Added 2 voice notes to the end of Lecture.')
    expect(addedWhenOpened('a.m4a', 'Lecture')).toBe('Saved a.m4a — it will be added to the end of Lecture when you open it.')
  })

  it('names what the picker left out, and says nothing when nothing was', () => {
    expect(tooBigMessage([])).toBeNull()
    expect(tooBigMessage(['long.wav'])).toBe('long.wav is too big to add as a voice note.')
    expect(tooBigMessage(['a.wav', 'b.aiff'])).toContain('a.wav, b.aiff')
  })
})

describe('can the player play it', () => {
  const probe = { canPlay: true, error: false, timedOut: false, duration: 4 }

  it('plays what the decoder got going', () => {
    expect(isPlayable(probe)).toBe(true)
    // A recorder's WebM often has no length written — it still plays.
    expect(isPlayable({ ...probe, duration: Infinity })).toBe(true)
  })

  it('converts anything the player refused, gave up on, or found nothing in', () => {
    expect(isPlayable({ ...probe, canPlay: false, error: true })).toBe(false) // a .wma, an .aiff, ALAC
    expect(isPlayable({ ...probe, canPlay: false, timedOut: true })).toBe(false)
    expect(isPlayable({ ...probe, duration: 0 })).toBe(false)
  })
})

describe('a video that is really a recording', () => {
  it('only checks the containers recorders actually use', () => {
    expect(mightBeSoundOnly('Recording 20261013.webm', 'video/webm')).toBe(true)
    expect(mightBeSoundOnly('clip.mp4', '')).toBe(true)
    expect(mightBeSoundOnly('memo.MOV', 'video/quicktime')).toBe(true)
    expect(mightBeSoundOnly('film.ogv', 'video/ogg')).toBe(false)
  })

  it('calls it a recording only on a definite "no picture"', () => {
    const none = { metadata: true, error: false, videoWidth: 0, videoHeight: 0 }
    expect(isSoundOnly(none, false)).toBe(true)
    expect(isSoundOnly({ ...none, videoWidth: 1280, videoHeight: 720 }, false)).toBe(false)
    // A picture the player couldn't decode (HEVC with no decoder) is still a picture.
    expect(isSoundOnly(none, true)).toBe(false)
    // Unsure is a video, as before voice notes existed.
    expect(isSoundOnly({ ...none, metadata: false, error: true }, false)).toBe(false)
    expect(isSoundOnly({ ...none, metadata: false }, false)).toBe(false)
  })

  it('finds a video track declared in an MP4 or MOV header', () => {
    const box = (handler: string): number[] => [
      0, 0, 0, 33, ...[...'hdlr'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[...'mhlr'].map((c) => c.charCodeAt(0)),
      ...[...handler].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0, 0, 0
    ]
    expect(isoDeclaresVideo(new Uint8Array([1, 2, 3, ...box('soun'), ...box('vide')]))).toBe(true)
    expect(isoDeclaresVideo(new Uint8Array([...box('soun'), ...box('mdir')]))).toBe(false)
    expect(isoDeclaresVideo(new Uint8Array([]))).toBe(false)
    expect(isIsoMedia('a.mov')).toBe(true)
    expect(isIsoMedia('a.webm')).toBe(false)
  })
})
