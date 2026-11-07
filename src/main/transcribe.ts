// Transcribe a voice note — runs the Whisper program (docs/plans/transcribe.md).
//
// How a transcription goes:
//   1. The renderer decodes the recording to 16 kHz mono itself (any recording that
//      plays, on every computer — no converter) and sends it in pieces:
//      transcribeBegin → transcribeAppend × n → transcribeRun.
//   2. Main writes the pieces into a WAV in a private temp folder, then runs
//      whisper-cli on it as its OWN process: low priority, half the cores, one at a
//      time (the rest wait in line), so the app never slows (Reuben's 6a). The
//      speech finder (Silero VAD) says where the talking is first — silence never
//      reaches Whisper, which invents words in it — and each stretch's language is
//      asked, so a recording that moves between languages is written in each one
//      (transcribeModel.ts "one recording, several languages").
//   3. Progress goes back to the window on CH.transcribeProgress; the answer is
//      paragraphs of plain text (transcribeModel.ts), never written anywhere by main —
//      the renderer puts them in the note as one undo step.
//
// Nothing leaves the computer: the program and the Base file ship inside the app
// (electron-builder.yml extraResources), and nothing here opens a network connection.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs, createWriteStream, type WriteStream } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, type WebContents } from 'electron'
import { CH } from '../shared/channels'
import { accuratePath, accurateReady } from './transcribeAccurate'
import { recordingStamp, writeWordTimes, type RecordingStamp } from './vault'
import type { TranscribeProgress, TranscribeResult } from '../shared/types'
import {
  detectArgs,
  etaMs,
  finderArgs,
  languageRuns,
  MAX_SAMPLES,
  paragraphsFrom,
  parseLanguage,
  parseProgress,
  SAMPLE_RATE,
  segmentsFromJson,
  parseSpeech,
  scriptPrompt,
  stretchesFromSpeech,
  threadsFor,
  wavHeader,
  whisperArgs,
  whisperFiles,
  type Word
} from './transcribeModel'

/** A piece bigger than this is refused (the renderer sends ~5 minutes at a time). */
const MAX_PIECE_SAMPLES = 20 * 60 * 16000
/** No progress for this long and the run is stopped as stuck. Generous: one 30-second
 *  window on a slow laptop's processor can take well over a minute. */
const STALL_MS = 5 * 60 * 1000

interface Job {
  id: string
  sender: WebContents
  dir: string
  wav: string
  out: WriteStream
  samples: number
  state: 'filling' | 'queued' | 'running' | 'done'
  /** the voice note's file (vault path) and its size/time when Transcribe started — for keeping word times */
  recording: { path: string; stamp: RecordingStamp } | null
  child: ChildProcess | null
  cancelled: boolean
  resolve: ((r: TranscribeResult) => void) | null
}

const jobs = new Map<string, Job>()
const queue: Job[] = []
let running: Job | null = null

function send(job: Job, p: Omit<TranscribeProgress, 'job'>): void {
  if (!job.sender.isDestroyed()) job.sender.send(CH.transcribeProgress, { job: job.id, ...p })
}

function files(): { exe: string; finder: string; model: string; vad: string } {
  return whisperFiles({
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  })
}

/** Is Transcribe possible in this copy of the app? (False in a test copy whose
 *  build-whisper/ was never made, or a package that left the program out.) */
export async function transcribeAvailable(): Promise<boolean> {
  const all = Object.values(files())
  const found = await Promise.all(all.map((f) => fs.stat(f).catch(() => null)))
  return found.every((st) => !!st?.isFile())
}

export async function transcribeBegin(sender: WebContents, recording?: unknown): Promise<string> {
  const id = randomUUID()
  // Checked by the vault boundary (recordingStamp → resolveReal); anything else is just "no recording".
  const stamp = typeof recording === 'string' && recording.length < 4096 ? await recordingStamp(recording) : null
  const rec = stamp && typeof recording === 'string' ? { path: recording, stamp } : null
  // A fresh folder only this user can read; fixed names inside it.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notealise-transcribe-'))
  const wav = path.join(dir, 'input.wav')
  const out = createWriteStream(wav, { flags: 'wx' })
  out.write(wavHeader(0)) // the real length is written in at run time
  const job: Job = { id, sender, dir, wav, out, samples: 0, state: 'filling', child: null, cancelled: false, resolve: null, recording: rec }
  jobs.set(id, job)
  // The window going away takes its jobs with it.
  sender.once('destroyed', () => void cancel(job))
  return id
}

function jobFor(id: unknown, sender: WebContents): Job {
  const job = typeof id === 'string' ? jobs.get(id) : undefined
  // A job belongs to the window that began it.
  if (!job || job.sender !== sender) throw new Error('transcribe: no such job')
  return job
}

export async function transcribeAppend(sender: WebContents, id: unknown, samples: unknown): Promise<void> {
  const job = jobFor(id, sender)
  if (job.state !== 'filling') throw new Error('transcribe: job already started')
  if (!(samples instanceof Int16Array)) throw new TypeError('transcribe: samples must be Int16Array')
  if (samples.length > MAX_PIECE_SAMPLES) throw new RangeError('transcribe: piece too big')
  if (job.samples + samples.length > MAX_SAMPLES) throw new RangeError('transcribe: recording too long')
  job.samples += samples.length
  const buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  await new Promise<void>((resolve, reject) => job.out.write(buf, (err) => (err ? reject(err) : resolve())))
}

export async function transcribeRun(sender: WebContents, id: unknown): Promise<TranscribeResult> {
  const job = jobFor(id, sender)
  if (job.state !== 'filling') throw new Error('transcribe: job already started')
  await new Promise<void>((resolve) => job.out.end(resolve))
  if (job.cancelled) return finish(job, { ok: false, reason: 'cancelled' })
  if (job.samples === 0) return finish(job, { ok: false, reason: 'empty' })
  // Write the real length into the header.
  const fh = await fs.open(job.wav, 'r+')
  try {
    await fh.write(wavHeader(job.samples), 0, 44, 0)
  } finally {
    await fh.close()
  }
  if (!(await transcribeAvailable())) return finish(job, { ok: false, reason: 'unavailable' })
  return new Promise<TranscribeResult>((resolve) => {
    job.resolve = resolve
    job.state = 'queued'
    queue.push(job)
    sendQueue()
    next()
  })
}

/** Everyone waiting hears where they are in line. */
function sendQueue(): void {
  queue.forEach((j, i) => send(j, { percent: 0, etaMs: null, waiting: i + (running ? 1 : 0) }))
}

export async function transcribeCancel(sender: WebContents, id: unknown): Promise<void> {
  const job = typeof id === 'string' ? jobs.get(id) : undefined
  if (!job || job.sender !== sender) return
  await cancel(job)
}

async function cancel(job: Job): Promise<void> {
  if (job.state === 'done') return
  job.cancelled = true
  if (job.state === 'filling') {
    job.out.destroy()
    await finish(job, { ok: false, reason: 'cancelled' })
  } else if (job.state === 'queued') {
    const i = queue.indexOf(job)
    if (i >= 0) queue.splice(i, 1)
    sendQueue()
    await finish(job, { ok: false, reason: 'cancelled' })
  } else if (job.child) {
    job.child.kill() // its 'close' finishes the job
  }
}

async function finish(job: Job, result: TranscribeResult): Promise<TranscribeResult> {
  if (job.state === 'done') return result
  job.state = 'done'
  jobs.delete(job.id)
  job.resolve?.(result)
  job.resolve = null
  // Retries cover Windows, where a program that was just stopped holds its files a moment.
  await fs.rm(job.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  return result
}

function next(): void {
  if (running || queue.length === 0) return
  const job = queue.shift()!
  running = job
  sendQueue()
  void run(job).finally(() => {
    running = null
    next()
  })
}

interface Ran {
  code: number | null
  stderr: string
  stdout: string
}

/** One run of the program: low priority, a stuck-run stop, progress passed on.
 *  Never throws. */
function runWhisper(job: Job, exe: string, args: string[], onProgress: (p: number) => void, wantStdout = false): Promise<Ran> {
  return new Promise<Ran>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(exe, args, { cwd: job.dir, windowsHide: true, stdio: ['ignore', wantStdout ? 'pipe' : 'ignore', 'pipe'] })
    } catch {
      return resolve({ code: null, stderr: '', stdout: '' })
    }
    job.child = child
    // Low priority (Windows: "below normal"): the app and everything else go first.
    try {
      if (child.pid) os.setPriority(child.pid, 10)
    } catch {
      /* not allowed here — it still runs, just at normal priority */
    }
    let stderr = ''
    let stdout = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 1024 * 1024) stdout += chunk
    })
    let lastPercent = -1
    let stall: NodeJS.Timeout = setTimeout(() => child.kill(), STALL_MS)
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk
      const p = parseProgress(chunk)
      if (p === null || p === lastPercent) return
      lastPercent = p
      clearTimeout(stall)
      stall = setTimeout(() => child.kill(), STALL_MS)
      onProgress(p)
    })
    const done = (code: number | null): void => {
      clearTimeout(stall)
      job.child = null
      resolve({ code, stderr, stdout })
    }
    child.on('error', () => done(null))
    child.on('close', (c) => done(c))
  })
}

/** The share of the bar finding the speech and asking the languages take; transcribing fills the rest. */
const DETECT_SHARE = 15

async function run(job: Job): Promise<void> {
  job.state = 'running'
  const { exe, finder, model, vad } = files()
  // "More accurate transcription": Turbo does the transcribing when it has been downloaded;
  // the language checks stay on Base (right every time in testing, and much quicker).
  const accurate = await accurateReady()
  const writer = accurate ? accuratePath() : model
  const threads = threadsFor(os.cpus().length)
  const started = Date.now()
  let shown = -1
  const progress = (overall: number): void => {
    const p = Math.max(0, Math.min(100, Math.floor(overall)))
    if (p === shown) return
    shown = p
    send(job, { percent: p, etaMs: etaMs(Date.now() - started, p), waiting: 0 })
  }
  send(job, { percent: 0, etaMs: null, waiting: 0 })
  const fail = (reason: 'failed' | 'cancelled'): Promise<TranscribeResult> =>
    finish(job, { ok: false, reason: job.cancelled ? 'cancelled' : reason })

  const wavBytes = await fs.readFile(job.wav)
  const samples = new Int16Array(wavBytes.buffer, wavBytes.byteOffset + 44, Math.floor((wavBytes.length - 44) / 2))
  const totalMs = (samples.length / SAMPLE_RATE) * 1000

  // 1. Where is someone talking? Nobody at all → "no words heard", without Whisper.
  const found = await runWhisper(job, finder, finderArgs({ vad, wav: job.wav, threads }), () => {}, true)
  if (job.cancelled) return void (await fail('cancelled'))
  if (found.code !== 0) return void (await fail('failed'))
  const stretches = stretchesFromSpeech(parseSpeech(found.stdout), totalMs)
  if (stretches.length === 0) return void (await finish(job, { ok: false, reason: 'empty' }))
  progress(3)

  // 2. Which language is each stretch in? Asked even for one stretch: the language decides
  //    whether a script hint is needed (scriptPrompt).
  let runs: { from: number; to: number; language: string }[]
  {
    const heard: { from: number; to: number; language: string | null; p: number }[] = []
    for (let i = 0; i < stretches.length; i++) {
      if (job.cancelled) return void (await fail('cancelled'))
      const st = stretches[i]
      const a = Math.floor((st.from / 1000) * SAMPLE_RATE)
      const b = Math.min(samples.length, Math.ceil((st.to / 1000) * SAMPLE_RATE))
      const piece = path.join(job.dir, 'stretch.wav')
      const body = samples.subarray(a, b)
      await fs.writeFile(piece, Buffer.concat([wavHeader(body.length), Buffer.from(body.buffer, body.byteOffset, body.byteLength)]))
      const ran = await runWhisper(job, exe, detectArgs({ model, wav: piece, threads }), () => {})
      if (job.cancelled) return void (await fail('cancelled'))
      if (ran.code !== 0) return void (await fail('failed'))
      const lang = parseLanguage(ran.stderr)
      heard.push({ ...st, language: lang?.language ?? null, p: lang?.p ?? 0 })
      progress(3 + ((i + 1) / stretches.length) * (DETECT_SHARE - 3))
    }
    runs = languageRuns(heard)
  }

  // 3. Transcribe each run in its own language. A change of language starts a new paragraph.
  const total = runs.reduce((t, r) => t + (r.to - r.from), 0) || 1
  let doneMs = 0
  const paragraphs: string[] = []
  const words: Word[] = []
  const spoken = new Map<string, number>()
  const base = DETECT_SHARE
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]
    const outBase = path.join(job.dir, `output-${i}`)
    // Only the run's own stretch of sound: the silence around it never reaches Whisper.
    const prompt = scriptPrompt(r.language, app.getPreferredSystemLanguages()[0] ?? '')
    const args = whisperArgs({ model: writer, wav: job.wav, outBase, threads, language: r.language, fromMs: r.from, durationMs: r.to - r.from, prompt })
    const span = r.to - r.from
    const ran = await runWhisper(job, exe, args, (p) =>
      progress(base + ((doneMs + (span * p) / 100) / total) * (100 - base))
    )
    if (job.cancelled) return void (await fail('cancelled'))
    if (ran.code !== 0) return void (await fail('failed'))
    const raw = await fs.readFile(`${outBase}.json`, 'utf8').catch(() => null)
    let parsed: unknown = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }
    const { segments, words: said, language } = segmentsFromJson(parsed)
    paragraphs.push(...paragraphsFrom(segments))
    words.push(...said)
    const lang = language ?? (r.language === 'auto' ? null : r.language)
    if (lang) spoken.set(lang, (spoken.get(lang) ?? 0) + span)
    doneMs += span
  }
  // The language spoken for longest, for the caller's information.
  const language = [...spoken.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null
  if (paragraphs.length && job.recording) await writeWordTimes(job.recording.path, job.recording.stamp, words)
  await finish(job, paragraphs.length ? { ok: true, paragraphs, words, language, accurate } : { ok: false, reason: 'empty' })
}

/** Is any transcription running or waiting? (The Turbo file can't be removed meanwhile.) */
export function transcribeBusy(): boolean {
  return running !== null || queue.length > 0
}

/** Quitting stops whatever is running and clears the temp folders. */
export function stopAllTranscriptions(): void {
  for (const job of [...jobs.values()]) void cancel(job)
}
