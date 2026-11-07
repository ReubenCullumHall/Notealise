// Transcribe a voice note — the pure half (docs/plans/transcribe.md). Everything here is
// arithmetic on numbers and text, so it is tested without running Whisper
// (transcribeModel.test.ts). transcribe.ts runs the program.

import path from 'node:path'
import { TRANSCRIBE_MAX_SECONDS, TRANSCRIBE_SLOW_MS } from '../shared/transcript'

/** The sound Whisper reads: 16,000 samples a second, one channel, 16-bit. */
export const SAMPLE_RATE = 16000

/** The longest recording that can be transcribed. The renderer holds the whole
 *  recording decoded at 16 kHz while it sends it (~230 MB an hour), so past this a
 *  window could run out of memory. Two hours covers a long lecture. (Assumed,
 *  docs/plans/transcribe.md.) */
export const MAX_SECONDS = TRANSCRIBE_MAX_SECONDS
export const MAX_SAMPLES = MAX_SECONDS * SAMPLE_RATE

/** The guess, in milliseconds, past which the bar says "This will take a long time
 *  on this computer" (Reuben, 2026-11-04: "on a slow computer say it will take a long
 *  time"; the 2-minute cut-off is assumed). */
export const SLOW_MS = TRANSCRIBE_SLOW_MS

/** Half the processor, so the app and everything else keep the other half
 *  (Reuben's pick, 2026-11-04). At least one; more than eight buys Whisper almost nothing. */
export function threadsFor(cpuCount: number): number {
  const n = Math.floor((Number.isFinite(cpuCount) ? cpuCount : 2) / 2)
  return Math.min(8, Math.max(1, n))
}

/** The Whisper program's file name on this system. */
export function exeName(platform: string): string {
  return platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
}

export const MODEL_FILE = 'ggml-base-q5_1.bin'
/** The speech finder's file (Silero VAD): which parts of a recording are someone talking. */
export const VAD_FILE = 'ggml-silero-v5.1.2.bin'

/** The speech finder's program name on this system (whisper.cpp's vad-speech-segments). */
export function finderName(platform: string): string {
  return platform === 'win32' ? 'whisper-vad-speech-segments.exe' : 'whisper-vad-speech-segments'
}

/** Where the program and the Base file are. In the app itself: beside the app's
 *  other resources (electron-builder.yml `extraResources` → `whisper/`). In the test
 *  copy: what tools/whisper/build.sh left in build-whisper/. */
export function whisperFiles(opts: {
  platform: string
  arch: string
  packaged: boolean
  resourcesPath: string
  appPath: string
}): { exe: string; finder: string; model: string; vad: string } {
  const root = opts.packaged ? path.join(opts.resourcesPath, 'whisper') : path.join(opts.appPath, 'build-whisper')
  const bin = opts.packaged ? root : path.join(root, `${opts.platform}-${opts.arch}`)
  return {
    exe: path.join(bin, exeName(opts.platform)),
    finder: path.join(bin, finderName(opts.platform)),
    model: path.join(root, MODEL_FILE),
    vad: path.join(root, VAD_FILE)
  }
}

/** Asks the speech finder where the talking is. Its own defaults (half-certain counts as
 *  speech, 100 ms of quiet splits) were right on every awkward test recording. */
export function finderArgs(opts: { vad: string; wav: string; threads: number }): string[] {
  return ['-vm', opts.vad, '-f', opts.wav, '-t', String(opts.threads)]
}

/** The finder's "Speech segment 0: start = 685.00, end = 1203.00" lines (hundredths of a
 *  second) → [from, to) in ms. */
export function parseSpeech(text: string): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const m of text.matchAll(/Speech segment \d+:\s*start\s*=\s*([0-9.]+),\s*end\s*=\s*([0-9.]+)/g)) {
    const from = Number(m[1]) * 10
    const to = Number(m[2]) * 10
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) out.push({ from, to })
  }
  return out
}

/** The arguments the program runs with. Every one is fixed except the paths, and
 *  each path is an argument of its own (no shell).
 *  - `-l auto`: the language is worked out from the recording (Reuben's 3a).
 *  - `-mc 0`: don't feed what was just written back in. With Whisper's default, long
 *    recordings went wrong in 3 of 5 runs on Reuben's Mac — one sentence repeated up
 *    to 40 times, or 49 words out of 10 minutes (docs/plans/transcribe.md "Measured").
 *  - timestamps stay ON: without them the pieces are whole 30-second windows, and the
 *    paragraph breaks below need the real pauses.
 *  - `-sns`: no "[Music]"-style markers. `-pp`: progress on stderr. `-np`: nothing else
 *    printed. `-ojf`: the result as JSON beside `outBase`, with every word's own times (the clip
 *    editor's "edit by the words" selects sound by them). */
export function whisperArgs(opts: {
  model: string
  wav: string
  outBase: string
  threads: number
  /** the stretch's own language (see languageRuns); 'auto' when there is only one stretch */
  language?: string
  /** the stretch, in ms; offsets in the result stay counted from the recording's start */
  fromMs?: number
  durationMs?: number
  /** an opening line in the right script (scriptPrompt) */
  prompt?: string | null
}): string[] {
  const span =
    opts.fromMs !== undefined && opts.durationMs !== undefined
      ? ['-ot', String(Math.max(0, Math.round(opts.fromMs))), '-d', String(Math.max(1, Math.round(opts.durationMs)))]
      : []
  return [
    '-m', opts.model,
    '-f', opts.wav,
    '-l', opts.language ?? 'auto',
    ...span,
    '-t', String(opts.threads),
    // A script hint needs a little room to be read (-mc 0 throws it away and the run comes
    // out EMPTY — measured); 32 is the most it takes and far short of what looped.
    ...(opts.prompt ? ['-mc', '32', '--prompt', opts.prompt] : ['-mc', '0']),
    '-sns',
    '-pp',
    '-np',
    '-ojf',
    '-of', opts.outBase
  ]
}

/** An opening line written in the script a language should come out in, for the two
 *  languages Whisper otherwise writes the wrong way (FLEURS, 2026-11-06): Hindi came out in
 *  English letters ("dunia may sabsthe achi…") and Mandarin in Traditional characters. With
 *  the line, Hindi comes out in Devanagari and Mandarin in Simplified — or Traditional when
 *  the computer is set to Taiwan, Hong Kong or Macau. Every other language: none. */
export function scriptPrompt(language: string, locale: string): string | null {
  if (language === 'zh') {
    return /^zh[-_](TW|HK|MO|Hant)/i.test(locale) ? '以下是普通話的句子。' : '以下是普通话的句子。'
  }
  if (language === 'hi') return 'यह हिंदी में बातचीत है।'
  return null
}

/** Asks only "which language is this?" of one stretch's own WAV. (`-dl` ignores
 *  `-ot`/`-d` and always reads from the file's start — measured 2026-11-04 — so each
 *  stretch is written to a file of its own.) */
export function detectArgs(opts: { model: string; wav: string; threads: number }): string[] {
  return ['-m', opts.model, '-f', opts.wav, '-l', 'auto', '-dl', '-t', String(opts.threads)]
}

/** The program's "auto-detected language: ko (p = 0.982390)" line, read. */
export function parseLanguage(text: string): { language: string; p: number } | null {
  const m = /auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/.exec(text)
  if (!m) return null
  const p = Number(m[2])
  return { language: m[1], p: Number.isFinite(p) ? p : 0 }
}

/** The last "progress = NN%" in a stretch of the program's stderr, as 0–100, or null.
 *  Whisper overshoots (118% was measured on a short clip), so it is capped. */
export function parseProgress(text: string): number | null {
  const all = [...text.matchAll(/progress\s*=\s*(\d+)%/g)]
  if (all.length === 0) return null
  const n = Number(all[all.length - 1][1])
  return Math.max(0, Math.min(100, n))
}

/** How much longer, in ms, going by how far it has got — or null while that is too
 *  early to say. Loading the Base file makes the first few percent slow: on Reuben's M4 the
 *  guess at 8% was 150 s for a run that took 33 s, which would have shown "long time"
 *  on the fastest computer we have. From 15% it was within a minute of the truth. */
export function etaMs(elapsedMs: number, percent: number): number | null {
  if (!(percent >= 15) || !(elapsedMs >= 8000) || percent >= 100) return null
  return Math.round((elapsedMs * (100 - percent)) / percent)
}

/** A 44-byte WAV header for `samples` 16-bit mono samples at SAMPLE_RATE. */
export function wavHeader(samples: number): Buffer {
  const data = samples * 2
  const b = Buffer.alloc(44)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16) // fmt chunk size
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // one channel
  b.writeUInt32LE(SAMPLE_RATE, 24)
  b.writeUInt32LE(SAMPLE_RATE * 2, 28) // bytes a second
  b.writeUInt16LE(2, 32) // bytes a sample
  b.writeUInt16LE(16, 34) // bits a sample
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(data, 40)
  return b
}

export interface Segment {
  /** ms from the start */
  from: number
  to: number
  text: string
}

/** One word and when it was said, in ms from the recording's start. */
export interface Word {
  text: string
  from: number
  to: number
}

/** A pause at least this long between two pieces starts a new paragraph
 *  (Reuben's 2a: "broken where the speaker pauses"). */
export const PARAGRAPH_PAUSE_MS = 1500
/** A paragraph that runs on with no such pause is broken at the next sentence
 *  end after this long, so a fast talker doesn't come out as one wall of text. */
export const PARAGRAPH_MAX_MS = 60_000

/** Markers Whisper writes instead of words: [BLANK_AUDIO], [Music], (laughs), ♪… */
function clean(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:music|laughs?|laughter|applause|silence|noise|inaudible)[^)]*\)/gi, ' ')
    .replace(/[♪♫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SENTENCE_END = /[.!?。！？…]["'”’)]*$/

/** Whisper's pieces → the paragraphs that go under the voice note. */
export function paragraphsFrom(segments: Segment[]): string[] {
  const out: string[] = []
  let words: string[] = []
  let start = 0
  let lastTo = 0
  const flush = (): void => {
    const p = words.join(' ').replace(/\s+([,.!?])/g, '$1').trim()
    if (p) out.push(p)
    words = []
  }
  for (const seg of segments) {
    const text = clean(seg.text)
    if (!text) continue
    if (words.length > 0) {
      const pause = seg.from - lastTo
      const long = lastTo - start >= PARAGRAPH_MAX_MS && SENTENCE_END.test(words[words.length - 1])
      if (pause >= PARAGRAPH_PAUSE_MS || long) flush()
    }
    if (words.length === 0) start = seg.from
    words.push(text)
    lastTo = seg.to
  }
  flush()
  return out
}

/** Reads the JSON the program writes with `-ojf`. Anything it can't make sense of is
 *  an empty list, never a throw — the caller reports "nothing heard". */
export function segmentsFromJson(json: unknown): { segments: Segment[]; words: Word[]; language: string | null } {
  const o = json as { transcription?: unknown; result?: { language?: unknown } } | null
  const list = Array.isArray(o?.transcription) ? o.transcription : []
  const segments: Segment[] = []
  const words: Word[] = []
  for (const item of list) {
    const s = item as { offsets?: { from?: unknown; to?: unknown }; text?: unknown; tokens?: unknown }
    const from = Number(s?.offsets?.from)
    const to = Number(s?.offsets?.to)
    if (typeof s?.text !== 'string' || !Number.isFinite(from) || !Number.isFinite(to)) continue
    segments.push({ from, to, text: s.text })
    words.push(...wordsFromTokens(s.tokens, s.text))
  }
  const language = typeof o?.result?.language === 'string' ? o.result.language : null
  return { segments, words, language }
}

/** Whisper's pieces of words ("Pl" + "ants", "금" + "요" + "일") joined into words: a piece
 *  that starts with a space starts a new word; "[_BEG_]"-style markers are dropped and
 *  pieces that are only punctuation stay with the word before. A rare character can be
 *  split across two pieces part-way through its bytes (it then reads as U+FFFD); then the
 *  words take their text from the piece's own sentence, so they match the paragraphs. */
/** Scripts written without spaces between words (Han, Hiragana, Katakana, Thai). */
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u

export function wordsFromTokens(tokens: unknown, segmentText: string): Word[] {
  if (!Array.isArray(tokens)) return []
  const out: Word[] = []
  for (const t of tokens) {
    const tok = t as { text?: unknown; offsets?: { from?: unknown; to?: unknown } } | null
    if (typeof tok?.text !== 'string') continue
    const text = tok.text
    if (/^\s*\[_[A-Z_]+[^\]]*\]\s*$/.test(text)) continue
    const from = Number(tok.offsets?.from)
    const to = Number(tok.offsets?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    const last = out[out.length - 1]
    // Chinese, Japanese and Thai write no spaces between words: each piece is its own word
    // there (else a whole sentence came back as one "word" — measured 2026-11-06).
    const unspaced = NO_SPACES.test(text) || (last !== undefined && NO_SPACES.test(last.text.slice(-1)))
    if (last && !/^\s/.test(text) && !(unspaced && /^\S*[\p{L}\p{N}]/u.test(text) && !/^[\p{P}]+$/u.test(text))) {
      last.text += text
      last.to = to
    } else if (text.trim()) {
      out.push({ text: text.trim(), from, to })
    }
  }
  if (out.some((w) => w.text.includes('\uFFFD'))) {
    const real = segmentText.trim().split(/\s+/).filter(Boolean)
    if (real.length === out.length) out.forEach((w, i) => (w.text = real[i]))
  }
  return out.filter((w) => clean(w.text) !== '')
}

// --- one recording, several languages ---------------------------------------------------
//
// Whisper decides the language ONCE, from a recording's first 30 seconds, and writes the
// rest in it: a recording that moved from English to Korean came out with its Korean half
// as invented English (2026-11-04). Base itself tells the two apart from as little as 2 s
// (24 of 24 stretches right, measured). So the recording is cut at its pauses into
// stretches, each stretch's language is asked for, neighbours in the same language are
// joined back up, and each run is transcribed in its own language. Where the talking is comes
// from the speech finder (Silero VAD), which also keeps silence away from Whisper (Reuben, 2026-11-05: "it
// should transcribe based on the language"). A recording in one language comes out as one
// run, exactly as before. Words mixed inside one sentence still follow that stretch's language.

/** Stretches of talk shorter than Whisper's own 30 s window, for asking the language. */
export const STRETCH_MAX_MS = 30_000
/** Talk with less quiet than this between it is one stretch. */
export const JOIN_GAP_MS = 1_000
/** Quiet this long between two runs keeps them apart even in the same language, so the
 *  silence is never handed to Whisper (it invents words in silence) and a new paragraph starts. */
export const LONG_GAP_MS = 3_000
/** A little sound kept either side of each stretch, so a first or last word isn't clipped. */
export const PAD_MS = 200

/** Where the talking is → the stretches whose language is asked. Gaps under a second are
 *  joined; nothing runs past 30 s (a long unbroken stretch is cut every 30 s); each is
 *  padded a little, never past the recording or into its neighbour. */
export function stretchesFromSpeech(speech: { from: number; to: number }[], totalMs: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  for (const seg of speech) {
    let from = Math.max(0, seg.from)
    const to = Math.min(totalMs, seg.to)
    if (to <= from) continue
    const last = out[out.length - 1]
    if (last && from - last.to < JOIN_GAP_MS && to - last.from <= STRETCH_MAX_MS) {
      last.to = to
      continue
    }
    while (to - from > STRETCH_MAX_MS) {
      out.push({ from, to: from + STRETCH_MAX_MS })
      from += STRETCH_MAX_MS
    }
    out.push({ from, to })
  }
  return out.map((st, i) => ({
    from: Math.max(0, i > 0 ? Math.max(out[i - 1].to, st.from - PAD_MS) : st.from - PAD_MS),
    to: Math.min(totalMs, i < out.length - 1 ? Math.min(out[i + 1].from, st.to + PAD_MS) : st.to + PAD_MS)
  }))
}

/** Neighbouring stretches in the same language (with no long quiet between), joined into
 *  the runs that are transcribed. A stretch Whisper wasn't sure about (p < 0.5) takes its neighbour's
 *  language rather than starting a run of its own. */
export function languageRuns(
  stretches: { from: number; to: number; language: string | null; p: number }[]
): { from: number; to: number; language: string }[] {
  const langs = stretches.map((s) => (s.language && s.p >= 0.5 ? s.language : null))
  // fill each unsure stretch from the nearest sure one before it, else after it
  for (let i = 0; i < langs.length; i++) {
    if (langs[i]) continue
    let k = i - 1
    while (k >= 0 && !langs[k]) k--
    if (k >= 0) langs[i] = langs[k]
    else {
      k = i + 1
      while (k < langs.length && !langs[k]) k++
      langs[i] = k < langs.length ? langs[k] : null
    }
  }
  const out: { from: number; to: number; language: string }[] = []
  stretches.forEach((s, i) => {
    const language = langs[i] ?? 'auto'
    const last = out[out.length - 1]
    if (last && last.language === language && s.from - last.to < LONG_GAP_MS) last.to = s.to
    else out.push({ from: s.from, to: s.to, language })
  })
  return out
}
