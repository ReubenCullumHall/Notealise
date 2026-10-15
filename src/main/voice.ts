// Voice notes, main's half: who may use the microphone, the question the system
// asks before it, the converter that turns a recording the player can't play
// into an .m4a, and the "Add a voice note" picker. The renderer records, plays
// and saves; see docs/feature-editor.md "Voice notes" for the whole feature and
// docs/security.md "Voice notes: the microphone and the converter" for why each
// rule below is what it is.
//
// Nothing here writes into the vault. The converter works on a private copy in
// the system's temp folder and hands the result back; the voice-note path saves
// it like any pasted file (writeAsset), through the same checks as everything
// else.
//
// No top-level `electron` import, for the reason vault.ts gives: the pure parts
// below are unit-tested (voice.test.ts), and vault.ts reads `isRecordingName`
// from here, so this file has to load outside Electron.

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow } from 'electron'
import { AUDIO_EXTS } from '../shared/attachments'
import type { ConvertedAudio, MicAccess, PickedAudio, VoicePlatform } from '../shared/types'

// --- which files are recordings ----------------------------------------------

/** Containers a recording can arrive in that are on the VIDEO list rather than
 *  the audio one: what the browser's own recorder writes (.webm, .mp4), and a
 *  phone or camera clip someone wants as a voice note (.mov, .m4v). Only the
 *  sound is kept when one of these is converted. */
const RECORDING_VIDEO_EXTS = ['webm', 'mp4', 'mov', 'm4v']

/** Every extension the voice-note picker offers and the converter accepts. */
export const RECORDING_EXTS: readonly string[] = [...AUDIO_EXTS, ...RECORDING_VIDEO_EXTS]

/** The last part of a name, whichever separator it was written with — the
 *  renderer sends a file NAME, but nothing stops it sending a path. */
const baseName = (name: string): string =>
  name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)

/** The recording extension of `name` (lowercase, no dot), or null when it isn't
 *  one we take. Strict on purpose, because it becomes part of a file name the
 *  converter opens: 1–5 lowercase letters or digits after lowercasing, and on
 *  the list above. A name that is nothing but a dotted suffix (`.wav`) has no
 *  extension, the same rule as `kindForFilename`. `unknown` because it is read
 *  straight off IPC: a type annotation is not a check (docs/security.md). */
export function recordingExt(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const base = baseName(name)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = base.slice(dot + 1).toLowerCase()
  if (!/^[a-z0-9]{1,5}$/.test(ext)) return null
  return RECORDING_EXTS.includes(ext) ? ext : null
}

export const isRecordingName = (name: unknown): boolean => recordingExt(name) !== null

/** What a converted recording is called: the original's name with `.m4a`.
 *
 *  An original that is ALREADY an .m4a (Apple Lossless from Voice Memos, say)
 *  gets " (converted)" as well. Otherwise the copy would carry exactly the
 *  original's name, and where both end up in one folder — the original was
 *  already in the vault — the save would de-duplicate it to "Memo (2).m4a",
 *  which says nothing about which is which. "(converted)" says what happened to
 *  it, plainly, and is only ever added where the name would otherwise not
 *  change. */
export function convertedName(name: string): string {
  const base = baseName(name)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return dot > 0 && base.slice(dot + 1).toLowerCase() === 'm4a' ? `${stem} (converted).m4a` : `${stem}.m4a`
}

// --- limits --------------------------------------------------------------------

const MB = 1024 * 1024

/** The largest recording main takes into memory, for either conversion or the
 *  picker. The bytes cross IPC whole (measured on Electron 43: 1 GB went across
 *  in each direction, ~3 s), so the limit is memory, not transport — a recording
 *  this size exists in the renderer, in main and in the converter's temp copy at
 *  once, and the save sends it over again. 512 MB is about an hour and a half
 *  of uncompressed 48 kHz mono WAV, 48 minutes of CD-quality stereo WAV, and
 *  many hours of anything compressed (an hour of Voice Memos AAC is ~30 MB). */
export const MAX_AUDIO_BYTES = 512 * MB

/** The most one pick returns at once. Several big files picked together arrive
 *  as ONE message, and a few hundred MB each adds up to more than any machine
 *  should be asked to hold twice; past this, the rest are listed as too big. */
export const MAX_PICK_BYTES = 1024 * MB

/** How long a converter may run: a minute to start (PowerShell and WinRT take a
 *  few seconds on their own) plus 10 s per MB. afconvert did 10 minutes of
 *  stereo audio in 4 s on an M-series Mac (150x real time); the slack is for an
 *  old Intel machine, and for low-bit-rate files (an Opus voice message holds
 *  ~9 minutes per MB). It only exists so a converter that hangs is stopped. */
export function converterTimeoutMs(bytes: number): number {
  return 60_000 + Math.ceil(bytes / MB) * 10_000
}

// --- the microphone: who may ask -----------------------------------------------

/** Which computer this is, as far as a voice-note message needs to know. */
export function voicePlatform(p: string): VoicePlatform {
  return p === 'darwin' || p === 'win32' || p === 'linux' ? p : 'other'
}

/** The app's own page, as the permission check knows it: the built
 *  `renderer/index.html` (packaged, or any plain build), or the dev server's
 *  origin under `npm run dev`. Built from the SAME two values createWindow loads
 *  (index.ts), so the page the window shows and the page allowed the microphone
 *  cannot drift apart. */
export type AppPage = { file: string } | { origin: string }

export function appPageFor(devUrl: string | null | undefined, rendererFile: string): AppPage {
  if (devUrl) {
    try {
      const origin = new URL(devUrl).origin
      if (origin !== 'null') return { origin }
    } catch {
      // A malformed dev URL loads nothing; fall through to the file, which the
      // window is not showing, so nothing is allowed.
    }
  }
  return { file: rendererFile }
}

/** Is `url` the app's own page? A file URL is compared by the PATH it names
 *  (case-folded where the filesystem folds case, as vault.ts does), so a query
 *  or `#fragment` doesn't matter and neither does how either side
 *  percent-encoded it. Anything else must match the dev server's origin. */
export function isAppPage(url: string, page: AppPage, platform: string = process.platform): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if ('origin' in page) return u.origin === page.origin
  if (u.protocol !== 'file:') return false
  const win = platform === 'win32'
  let asked: string
  try {
    asked = fileURLToPath(u, { windows: win })
  } catch {
    return false
  }
  const p = win ? path.win32 : path.posix
  const fold = win || platform === 'darwin' ? (s: string): string => s.toLowerCase() : (s: string): string => s
  return fold(p.normalize(asked)) === fold(p.normalize(page.file))
}

/** One permission request, as Electron describes it (`setPermissionRequestHandler`). */
export interface PermissionAsk {
  permission: string
  /** `details.mediaTypes` — absent on anything that isn't a 'media' request */
  mediaTypes?: readonly unknown[]
  isMainFrame: boolean
  requestingUrl: string
  /** the request came from one of the app's own windows, not a DevTools page
   *  or any other web contents */
  fromAppWindow: boolean
}

/** Should this permission request be granted?
 *
 *  Yes for exactly one thing: the MICROPHONE alone ('media' with every media
 *  type 'audio' — a request that also wants the camera is refused whole), asked
 *  for by the app's own page, in the MAIN frame of one of its own windows.
 *  Everything else stays denied, as it always was: nothing in the app asks for
 *  a camera, a location or notifications, and the video players' frames
 *  (YouTube/Vimeo, the only frames the CSP admits) must never be handed the
 *  microphone — the main-frame rule is what stops that, whatever a frame's
 *  `allow` attribute or a future change to it says. */
export function allowMediaRequest(ask: PermissionAsk, page: AppPage, platform: string = process.platform): boolean {
  if (ask.permission !== 'media') return false
  if (!ask.fromAppWindow || ask.isMainFrame !== true) return false
  const types = ask.mediaTypes
  if (!Array.isArray(types) || types.length === 0 || !types.every((t) => t === 'audio')) return false
  return typeof ask.requestingUrl === 'string' && isAppPage(ask.requestingUrl, page, platform)
}

// --- the microphone: the system's own question ----------------------------------

/** What `systemPreferences.getMediaAccessStatus('microphone')` answered, as the
 *  renderer needs it. Only a firm no stops recording: "granted", and the
 *  answers that can't tell ("not-determined" on Windows, "unknown"), let the
 *  recorder try — the browser's own request then succeeds or says why not. */
export function micAccessFromStatus(status: string, platform: VoicePlatform): MicAccess {
  if (status === 'denied') return { ok: false, reason: 'denied', platform }
  if (status === 'restricted') return { ok: false, reason: 'restricted', platform }
  return { ok: true }
}

export interface MicEnvironment {
  platform: string
  /** launched with Chromium's `use-fake-device-for-media-stream` (tests) */
  fakeDevice: boolean
  status(): string
  ask(): Promise<boolean>
}

/** `microphoneAccess`'s decision, with the system calls passed in so it can be
 *  tested without a real one ever being made.
 *
 *  A fake microphone means a test run: the real one can never open, so there
 *  is nothing to ask and the system's question must never appear on the
 *  screen of the person running the tests. On a Mac, an undecided app is asked
 *  — the system's own "would like to access the microphone" box, worded by
 *  NSMicrophoneUsageDescription (electron-builder.yml) — and only here, when
 *  recording starts, never at launch. Windows' answer reflects its privacy
 *  switches. Linux has no such switch: the browser's own request decides. */
export async function microphoneAccessFor(env: MicEnvironment): Promise<MicAccess> {
  const platform = voicePlatform(env.platform)
  if (env.fakeDevice) return { ok: true }
  if (env.platform === 'darwin') {
    const now = env.status()
    if (now !== 'not-determined') return micAccessFromStatus(now, platform)
    if (await env.ask()) return { ok: true }
    // Asked and refused. Read it again only to tell a "no" from a profile that
    // forbids it; anything else after a refusal is a no.
    return micAccessFromStatus(env.status() === 'restricted' ? 'restricted' : 'denied', platform)
  }
  if (env.platform === 'win32') return micAccessFromStatus(env.status(), platform)
  return { ok: true }
}

/** One question at a time: two recordings started together share the one box. */
let asking: Promise<boolean> | null = null

export async function microphoneAccess(): Promise<MicAccess> {
  const { app, systemPreferences } = await import('electron')
  return microphoneAccessFor({
    platform: process.platform,
    fakeDevice: app.commandLine.hasSwitch('use-fake-device-for-media-stream'),
    status: () => systemPreferences.getMediaAccessStatus('microphone'),
    ask: () =>
      (asking ??= systemPreferences.askForMediaAccess('microphone').finally(() => {
        asking = null
      }))
  })
}

// --- the converter ---------------------------------------------------------------

/** Formats afconvert cannot open on any Mac — measured 2026-10-13 on macOS 27.2,
 *  the newest there is, with every other format the voice-note list takes
 *  converting cleanly: "Couldn't open input file ('typ?')" for WMA, WebM and
 *  Matroska. Refused up front so the answer is "this Mac can't", not "damaged". */
const MAC_NEVER = new Set(['wma', 'webm', 'weba', 'mka'])

/** Formats this Mac reads but an OLDER macOS may not: Ogg (Vorbis, Opus) arrived
 *  in Core Audio late, and QuickTime-family files are only read because they are
 *  shaped like MPEG-4. When afconvert can't even open one of these, the honest
 *  answer is "unsupported" on that Mac. Everything else on the list (WAV, AIFF,
 *  CAF, M4A, MP3, AAC, AMR, 3GP, FLAC, MP4) every supported macOS reads, so a
 *  file of those kinds that won't open is damaged: "failed". */
const MAC_MAYBE = new Set(['ogg', 'oga', 'opus', 'qta', 'mov', 'm4v'])

export type ConverterPlan =
  | { kind: 'refuse'; reason: 'unsupported' }
  | { kind: 'afconvert' }
  | { kind: 'powershell' }
  | { kind: 'ffmpeg' }

/** Which converter this computer has for `ext`. The computer's OWN tool every
 *  time — nothing is bundled (no new dependency in this pass, by decision). */
export function converterFor(platform: string, ext: string): ConverterPlan {
  if (platform === 'darwin') return MAC_NEVER.has(ext) ? { kind: 'refuse', reason: 'unsupported' } : { kind: 'afconvert' }
  if (platform === 'win32') return { kind: 'powershell' }
  // Linux only, never "not Windows" (rule 7): ffmpeg if the person has it.
  if (platform === 'linux') return { kind: 'ffmpeg' }
  return { kind: 'refuse', reason: 'unsupported' }
}

export const AFCONVERT = '/usr/bin/afconvert'

/** afconvert, straight to AAC in an .m4a. No bit rate is given ON PURPOSE: a
 *  fixed one was measured to break things — 64 kbps refused an 8 kHz AMR file
 *  outright ('!dat') and quietly halved a stereo file to 32 kHz, and VBR quality
 *  ('-u vbrq') refused every compressed source ('prop'). The encoder's own
 *  choice is modest and right for each input: ~67 kbps for 48 kHz mono, ~117
 *  kbps stereo, 17 kbps for an 8 kHz phone recording. Channels and sample rate
 *  are kept (mono stays mono); above 48 kHz it comes down to 48. */
export function afconvertArgs(input: string, output: string): string[] {
  return ['-f', 'm4af', '-d', 'aac', input, output]
}

/** The second try, for a file afconvert OPENS but can't hand to the AAC encoder
 *  as it is: multichannel audio with no channel layout the encoder accepts (a
 *  3-, 4-, 5.1- or 7.1-channel WAV/AIFF/CAF — a four-track field recorder makes
 *  these). Measured: the direct route fails with "ExtAudioFileSetProperty
 *  ('cfmt') failed ('!dat')", and asking for fewer channels in that same step
 *  fails with 'cclo'; mixing down to a stereo float file first and encoding
 *  THAT works for all of them. The middle file is at most ~1.3x the original
 *  for 16-bit sound (it only happens to files of three channels or more), and
 *  lives in the same private temp folder. */
export function afconvertStereoArgs(input: string, mid: string): string[] {
  return ['-f', 'caff', '-d', 'LEF32', '--mix', '-c', '2', input, mid]
}

/** How to read an afconvert failure. 'open' — it couldn't open the input at all
 *  (a type it doesn't know, or not audio); 'channels' — it opened it, but the
 *  encoder refused the sound's format as it stands, the multichannel case the
 *  stereo route above fixes; 'other' — give up. Low and high sample rates are
 *  not a failure: afconvert brings 4 kHz up to 8 kHz and 192 kHz down to 48 kHz
 *  on its own (measured). */
export function afconvertFailureStage(stderr: string): 'open' | 'channels' | 'other' {
  if (/couldn't open input file/i.test(stderr)) return 'open'
  if (/\('cfmt'\)/.test(stderr)) return 'channels'
  return 'other'
}

/** The answer for a file afconvert could not open: "unsupported" only where an
 *  older Mac may genuinely lack the reader (MAC_MAYBE) and afconvert said so in
 *  as many words ('typ?' unknown file type, 'fmt?' unknown data format);
 *  otherwise the file is damaged or isn't what its name says. */
export function macOpenFailure(ext: string, stderr: string): 'unsupported' | 'failed' {
  return MAC_MAYBE.has(ext) && /'(typ|fmt)\?'/.test(stderr) ? 'unsupported' : 'failed'
}

/** Windows PowerShell 5.1 — always this one, by full path: PowerShell 7 cannot
 *  load WinRT types, and a bare `powershell` would be looked up through PATH and
 *  the current folder first. */
export function windowsPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  const root = env['SystemRoot'] || env['windir'] || 'C:\\Windows'
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** `-File` with the two paths as their own arguments: PowerShell binds them to
 *  the script's `param()`, so a path is only ever a value, never code. Bypass is
 *  for this one process only (it changes no setting); a machine whose policy is
 *  enforced by an administrator still refuses, and that reads as "failed". */
export function powershellArgs(script: string, input: string, output: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, input, output]
}

/** ffmpeg (Linux), from PATH. Sound only, AAC at 96 kbps; never reads stdin. */
export function ffmpegArgs(input: string, output: string): string[] {
  return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '96k', output]
}

/** The Windows converter: WinRT's MediaTranscoder, which reads whatever Media
 *  Foundation on that PC reads (WMA, MP3, AAC/M4A, WAV, FLAC, ALAC, and more
 *  with the store's media extensions), into AAC in an .m4a at the "Medium"
 *  preset (44.1 kHz stereo, 128 kbps; a mono recording comes out as stereo).
 *
 *  NOT TRIED ON WINDOWS — written on a Mac, where it cannot run. It uses the
 *  established pattern for awaiting WinRT from Windows PowerShell 5.1: load the
 *  types by name, then turn each IAsyncOperation into a .NET Task through
 *  `WindowsRuntimeSystemExtensions.AsTask`, found by reflection. Exit codes:
 *  0 done; 3 nothing on this PC reads it (no codec, an unknown container, or a
 *  Windows "N" edition without the Media Feature Pack); anything else failed.
 *  The paths arrive as parameters — nothing is ever interpolated into this text.
 *  Plain ASCII, because PowerShell 5.1 reads a file without a byte-order mark in
 *  the system's code page. */
export const WINDOWS_CONVERT_SCRIPT = [
  'param([string]$InPath, [string]$OutPath)',
  "$ErrorActionPreference = 'Stop'",
  'try {',
  '  Add-Type -AssemblyName System.Runtime.WindowsRuntime',
  '  $null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]',
  '  $null = [Windows.Storage.StorageFolder,Windows.Storage,ContentType=WindowsRuntime]',
  '  $null = [Windows.Storage.CreationCollisionOption,Windows.Storage,ContentType=WindowsRuntime]',
  '  $null = [Windows.Media.Transcoding.MediaTranscoder,Windows.Media,ContentType=WindowsRuntime]',
  '  $null = [Windows.Media.Transcoding.PrepareTranscodeResult,Windows.Media,ContentType=WindowsRuntime]',
  '  $null = [Windows.Media.Transcoding.TranscodeFailureReason,Windows.Media,ContentType=WindowsRuntime]',
  '  $null = [Windows.Media.MediaProperties.MediaEncodingProfile,Windows.Media,ContentType=WindowsRuntime]',
  '  $null = [Windows.Media.MediaProperties.AudioEncodingQuality,Windows.Media,ContentType=WindowsRuntime]',
  '  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq \'AsTask\' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 }',
  '  $forOperation = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\' } | Select-Object -First 1',
  '  $forProgress = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncActionWithProgress`1\' } | Select-Object -First 1',
  '  function Await($operation, [Type]$resultType) {',
  '    $task = $forOperation.MakeGenericMethod($resultType).Invoke($null, @($operation))',
  '    $task.Wait()',
  '    $task.Result',
  '  }',
  '  $source = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($InPath)) ([Windows.Storage.StorageFile])',
  '  $folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync([System.IO.Path]::GetDirectoryName($OutPath))) ([Windows.Storage.StorageFolder])',
  '  $target = Await ($folder.CreateFileAsync([System.IO.Path]::GetFileName($OutPath), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])',
  '  $encoding = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::Medium)',
  '  $transcoder = [Windows.Media.Transcoding.MediaTranscoder]::new()',
  '  $prepared = Await ($transcoder.PrepareFileTranscodeAsync($source, $target, $encoding)) ([Windows.Media.Transcoding.PrepareTranscodeResult])',
  '  if (-not $prepared.CanTranscode) {',
  "    [Console]::Error.WriteLine('Cannot convert: ' + $prepared.FailureReason)",
  '    if ($prepared.FailureReason -eq [Windows.Media.Transcoding.TranscodeFailureReason]::CodecNotFound) { exit 3 }',
  '    exit 2',
  '  }',
  '  $running = $forProgress.MakeGenericMethod([double]).Invoke($null, @($prepared.TranscodeAsync()))',
  '  $running.Wait()',
  '  exit 0',
  '} catch {',
  '  $err = $_.Exception',
  '  while ($err.InnerException) { $err = $err.InnerException }',
  "  $code = '{0:X8}' -f $err.HResult",
  "  [Console]::Error.WriteLine($code + ' ' + $err.Message)",
  '  # Unsupported byte stream, no codec, invalid media type, class not registered',
  "  if ('C00D36C4', 'C00D5212', 'C00D36B4', '80040154' -contains $code) { exit 3 }",
  '  exit 2',
  '}',
  ''
].join('\r\n')

/** The answer for a PowerShell run that didn't succeed. */
export function windowsFailure(exitCode: number | null): 'unsupported' | 'failed' {
  return exitCode === 3 ? 'unsupported' : 'failed'
}

interface RunResult {
  ok: boolean
  /** the process could not be started at all (ENOENT: no such program) */
  missing: boolean
  /** stopped by the timeout */
  timedOut: boolean
  code: number | null
  stderr: string
}

/** Run one converter: no shell, fixed arguments, the paths as arguments of
 *  their own, a timeout, its stdin closed (nothing must be able to sit waiting
 *  for an answer — see extractZip.ts's `run` for the hang that taught this),
 *  and its folder the private temp folder. Never throws. */
function runConverter(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * MB, encoding: 'utf8' },
      (err, _stdout, stderr) => {
        if (!err) return resolve({ ok: true, missing: false, timedOut: false, code: 0, stderr })
        const e = err as { code?: number | string | null; killed?: boolean }
        resolve({
          ok: false,
          missing: e.code === 'ENOENT',
          timedOut: e.killed === true,
          code: typeof e.code === 'number' ? e.code : null,
          stderr: `${stderr ?? ''}${err.message}`
        })
      }
    )
    child.stdin?.end()
  })
}

/** `convertAudio`, the IPC handler. Both arguments come straight off IPC, so
 *  both are checked here: a recording's name and a Uint8Array, or it throws (a
 *  caller that sends anything else is not the voice-note path). A recording
 *  this computer can't convert, or one over the limit, is an ANSWER, not an
 *  error — see ConvertedAudio. */
export async function convertAudio(filename: unknown, data: unknown): Promise<ConvertedAudio> {
  if (typeof filename !== 'string') throw new TypeError('convertAudio: the file name must be text')
  if (!(data instanceof Uint8Array)) throw new TypeError('convertAudio: the recording must be bytes')
  const ext = recordingExt(filename)
  if (!ext) throw new Error(`Not a recording: ${baseName(filename).slice(0, 80)}`)
  const platform = voicePlatform(process.platform)
  if (data.byteLength > MAX_AUDIO_BYTES) return { ok: false, reason: 'too-big', platform }
  if (data.byteLength === 0) return { ok: false, reason: 'failed', platform }
  const plan = converterFor(process.platform, ext)
  if (plan.kind === 'refuse') return { ok: false, reason: plan.reason, platform }

  // A fresh folder only this user can read (mkdtemp makes it 0700 on a Mac or
  // Linux; %TEMP% is per-user on Windows). Fixed names inside it — the person's
  // file name is never part of a path the converter is given.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notealise-voice-'))
  try {
    const input = path.join(dir, `input.${ext}`)
    const output = path.join(dir, 'output.m4a')
    await fs.writeFile(input, Buffer.from(data.buffer, data.byteOffset, data.byteLength), { flag: 'wx' })
    const timeout = converterTimeoutMs(data.byteLength)

    let failure: 'unsupported' | 'failed' | null = null
    if (plan.kind === 'afconvert') {
      const first = await runConverter(AFCONVERT, afconvertArgs(input, output), dir, timeout)
      const stage = first.ok || first.missing || first.timedOut ? null : afconvertFailureStage(first.stderr)
      if (first.missing) failure = 'unsupported'
      else if (first.timedOut || stage === 'other') failure = 'failed'
      else if (stage === 'open') failure = macOpenFailure(ext, first.stderr)
      else if (stage === 'channels') {
        const mid = path.join(dir, 'stereo.caf')
        const down = await runConverter(AFCONVERT, afconvertStereoArgs(input, mid), dir, timeout)
        const again = down.ok ? await runConverter(AFCONVERT, afconvertArgs(mid, output), dir, timeout) : down
        if (!again.ok) failure = 'failed'
      }
    } else if (plan.kind === 'powershell') {
      const script = path.join(dir, 'convert.ps1')
      await fs.writeFile(script, WINDOWS_CONVERT_SCRIPT, { flag: 'wx' })
      const run = await runConverter(windowsPowerShell(), powershellArgs(script, input, output), dir, timeout)
      if (run.missing) failure = 'unsupported'
      else if (!run.ok) failure = windowsFailure(run.code)
    } else {
      const run = await runConverter('ffmpeg', ffmpegArgs(input, output), dir, timeout)
      if (run.missing) failure = 'unsupported'
      else if (!run.ok) failure = 'failed'
    }
    if (failure) return { ok: false, reason: failure, platform }

    // A converter that "succeeded" without writing anything is a failure too.
    const made = await fs.stat(output).catch(() => null)
    if (!made?.isFile() || made.size === 0) return { ok: false, reason: 'failed', platform }
    if (made.size > MAX_AUDIO_BYTES) return { ok: false, reason: 'too-big', platform }
    const out = await fs.readFile(output)
    return { ok: true, name: convertedName(filename), data: new Uint8Array(out.buffer, out.byteOffset, out.byteLength) }
  } finally {
    // Always, whatever happened above. Retries cover Windows, where a converter
    // that was just stopped can hold its files for a moment.
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}

// --- the picker ---------------------------------------------------------------------

/** "Add a voice note": a native picker filtered to recordings. Returns the
 *  chosen files' names and bytes and writes nothing — the voice-note path
 *  checks each one (can it play? does it need converting?) and saves it. Only
 *  `openFile`, never with `openDirectory` (CLAUDE.md: Windows and Linux would
 *  silently drop the file half). The filter is advisory on some systems, so
 *  each result is checked again. */
export async function pickAudioFiles(win: BrowserWindow): Promise<PickedAudio | null> {
  const { dialog } = await import('electron')
  const res = await dialog.showOpenDialog(win, {
    title: 'Add a voice note',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Recordings', extensions: [...RECORDING_EXTS] }]
  })
  if (res.canceled || res.filePaths.length === 0) return null
  const files: PickedAudio['files'] = []
  const tooBig: string[] = []
  let total = 0
  for (const abs of res.filePaths) {
    const name = path.basename(abs)
    if (!isRecordingName(name)) continue
    try {
      const fh = await fs.open(abs, 'r')
      try {
        const st = await fh.stat()
        if (!st.isFile()) continue
        if (st.size > MAX_AUDIO_BYTES || total + st.size > MAX_PICK_BYTES) {
          tooBig.push(name)
          continue
        }
        const data = await fh.readFile()
        // It may have grown since the stat; the limit is on what was read.
        if (data.byteLength > MAX_AUDIO_BYTES || total + data.byteLength > MAX_PICK_BYTES) {
          tooBig.push(name)
          continue
        }
        total += data.byteLength
        files.push({ name, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
      } finally {
        await fh.close()
      }
    } catch {
      // One unreadable file (permissions, gone since it was picked) must not
      // lose the others picked with it — the same rule as pickAttachment.
    }
  }
  return { files, tooBig }
}
