// Voice notes, main's half (voice.ts): who may use the microphone, the
// system's question, which converter runs with exactly which arguments, and
// what a converted recording is called. All pure, apart from the last block,
// which runs the Mac's own converter for real on files written here (it is
// skipped anywhere else), and the openVaultFile block, which uses a real temp
// vault as vault.test.ts does.
//
// Nothing here can raise the system's microphone question: `microphoneAccess`
// itself is never called — its decision is `microphoneAccessFor`, which takes
// the system calls as arguments.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AUDIO_EXTS, IMAGE_EXTS } from '../shared/attachments'
import {
  AFCONVERT,
  MAX_AUDIO_BYTES,
  WINDOWS_CONVERT_SCRIPT,
  afconvertArgs,
  afconvertFailureStage,
  afconvertStereoArgs,
  allowMediaRequest,
  appPageFor,
  convertAudio,
  convertedName,
  converterFor,
  converterTimeoutMs,
  ffmpegArgs,
  isAppPage,
  isRecordingName,
  macOpenFailure,
  micAccessFromStatus,
  microphoneAccessFor,
  powershellArgs,
  recordingExt,
  windowsFailure,
  windowsPowerShell,
  type PermissionAsk
} from './voice'
import { openVaultFile, setVaultRoot } from './vault'

// openVaultFile hands a file to the system through `shell.openPath`; stand in
// for it so a test can see what would have been opened without opening it.
const { openPath } = vi.hoisted(() => ({ openPath: vi.fn(async (_p: string) => '') }))
vi.mock('electron', () => ({ shell: { openPath } }))

// --- which files are recordings ------------------------------------------------

describe('recordingExt', () => {
  it('takes every audio format on the list, and the four recording containers', () => {
    for (const ext of AUDIO_EXTS) expect(recordingExt(`Memo.${ext}`)).toBe(ext)
    for (const ext of ['webm', 'mp4', 'mov', 'm4v']) expect(recordingExt(`clip.${ext}`)).toBe(ext)
  })

  it('reads the extension in any case, and only the last one', () => {
    expect(recordingExt('MEMO.WAV')).toBe('wav')
    expect(recordingExt('a.b.Mp3')).toBe('mp3')
    expect(recordingExt('C:\\Users\\me\\Voice.m4a')).toBe('m4a')
    expect(recordingExt('../../up/there.amr')).toBe('amr')
  })

  it('refuses anything else — programs, pictures, odd extensions', () => {
    for (const name of ['evil.sh', 'Setup.exe', 'run.bat', 'x.ps1', 'Slides.pdf', 'notes.md']) {
      expect(recordingExt(name)).toBeNull()
    }
    for (const ext of IMAGE_EXTS) expect(recordingExt(`pic.${ext}`)).toBeNull()
    // no extension, a bare dotted suffix, an empty one, trailing junk, too long, not ASCII
    for (const name of ['noext', '.wav', 'x.', 'x.wav ', 'x.wav.', 'x.m4aaaa', 'x.wäv', 'x.wav/']) {
      expect(recordingExt(name)).toBeNull()
    }
  })

  it('refuses what isn\'t text at all — it arrives straight off IPC', () => {
    for (const v of [123, null, undefined, ['a.wav'], { name: 'a.wav' }]) {
      expect(recordingExt(v)).toBeNull()
      expect(isRecordingName(v)).toBe(false)
    }
  })
})

describe('convertedName', () => {
  it('is the original name as an .m4a', () => {
    expect(convertedName('Memo.wma')).toBe('Memo.m4a')
    expect(convertedName('Voice note 2026-10-13 14.32.caf')).toBe('Voice note 2026-10-13 14.32.m4a')
    expect(convertedName('a.b.amr')).toBe('a.b.m4a')
  })

  it('says "(converted)" where the name would otherwise not change', () => {
    expect(convertedName('Memo.m4a')).toBe('Memo (converted).m4a')
    expect(convertedName('Memo.M4A')).toBe('Memo (converted).m4a')
  })

  it('never carries a folder through', () => {
    expect(convertedName('some/dir/Memo.caf')).toBe('Memo.m4a')
    expect(convertedName('C:\\dir\\Memo.wma')).toBe('Memo.m4a')
  })
})

// --- the microphone: who may ask ---------------------------------------------------

const MAC_FILE = '/Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/index.html'
const MAC_URL = 'file:///Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/index.html'

describe('appPageFor / isAppPage', () => {
  it('is the built file unless there is a dev server', () => {
    expect(appPageFor(null, MAC_FILE)).toEqual({ file: MAC_FILE })
    expect(appPageFor(undefined, MAC_FILE)).toEqual({ file: MAC_FILE })
    expect(appPageFor('', MAC_FILE)).toEqual({ file: MAC_FILE })
    expect(appPageFor('http://localhost:5173/', MAC_FILE)).toEqual({ origin: 'http://localhost:5173' })
    expect(appPageFor('not a url', MAC_FILE)).toEqual({ file: MAC_FILE })
  })

  it('matches the app\'s own file, whatever its query, fragment or encoding', () => {
    const page = { file: MAC_FILE }
    expect(isAppPage(MAC_URL, page, 'darwin')).toBe(true)
    expect(isAppPage(`${MAC_URL}#/note`, page, 'darwin')).toBe(true)
    expect(isAppPage(`${MAC_URL}?x=1`, page, 'darwin')).toBe(true)
    const spaced = { file: '/Users/Zoë Smith/app/out/renderer/index.html' }
    expect(isAppPage('file:///Users/Zo%C3%AB%20Smith/app/out/renderer/index.html', spaced, 'darwin')).toBe(true)
  })

  it('matches nothing else', () => {
    const page = { file: MAC_FILE }
    for (const url of [
      'file:///etc/passwd',
      'file:///Applications/Notealise.app/Contents/Resources/app.asar/out/renderer/other.html',
      'file://evil-host/share/index.html',
      'about:srcdoc',
      'about:blank',
      'https://www.youtube-nocookie.com/embed/abc',
      'https://player.vimeo.com/video/1',
      'devtools://devtools/bundled/inspector.html',
      'not a url',
      ''
    ]) {
      expect(isAppPage(url, page, 'darwin')).toBe(false)
    }
  })

  it('folds case where the filesystem does, and only there', () => {
    const page = { file: '/opt/Notealise/out/renderer/index.html' }
    expect(isAppPage('file:///opt/notealise/out/renderer/index.html', page, 'darwin')).toBe(true)
    expect(isAppPage('file:///opt/notealise/out/renderer/index.html', page, 'linux')).toBe(false)
    expect(isAppPage('file:///opt/Notealise/out/renderer/index.html', page, 'linux')).toBe(true)
  })

  it('reads a Windows file URL as a Windows path', () => {
    const page = { file: 'C:\\Users\\Zoë\\AppData\\Local\\Programs\\Notealise\\resources\\app.asar\\out\\renderer\\index.html' }
    const url = 'file:///c:/Users/Zo%C3%AB/AppData/Local/Programs/Notealise/resources/app.asar/out/renderer/index.html'
    expect(isAppPage(url, page, 'win32')).toBe(true)
    expect(isAppPage('file:///c:/Windows/win.ini', page, 'win32')).toBe(false)
    expect(isAppPage('file://10.255.255.1/share/index.html', page, 'win32')).toBe(false)
  })

  it('in dev, matches the dev server\'s origin only', () => {
    const page = { origin: 'http://localhost:5173' }
    expect(isAppPage('http://localhost:5173/', page)).toBe(true)
    expect(isAppPage('http://localhost:5173/index.html#x', page)).toBe(true)
    expect(isAppPage('http://localhost:5174/', page)).toBe(false)
    expect(isAppPage('http://127.0.0.1:5173/', page)).toBe(false)
    expect(isAppPage('https://localhost:5173/', page)).toBe(false)
    expect(isAppPage(MAC_URL, page)).toBe(false)
  })
})

describe('allowMediaRequest', () => {
  const page = { file: MAC_FILE }
  const mic: PermissionAsk = {
    permission: 'media',
    mediaTypes: ['audio'],
    isMainFrame: true,
    requestingUrl: MAC_URL,
    fromAppWindow: true
  }
  const allow = (change: Partial<PermissionAsk>): boolean => allowMediaRequest({ ...mic, ...change }, page, 'darwin')

  it('gives the app\'s own page the microphone', () => {
    expect(allow({})).toBe(true)
    expect(allow({ requestingUrl: `${MAC_URL}#/x` })).toBe(true)
  })

  it('never the camera — alone, or asked for with the microphone', () => {
    expect(allow({ mediaTypes: ['video'] })).toBe(false)
    expect(allow({ mediaTypes: ['audio', 'video'] })).toBe(false)
    expect(allow({ mediaTypes: ['video', 'audio'] })).toBe(false)
  })

  it('refuses a request that doesn\'t say what it wants', () => {
    expect(allow({ mediaTypes: [] })).toBe(false)
    expect(allow({ mediaTypes: undefined })).toBe(false)
    expect(allow({ mediaTypes: ['unknown'] })).toBe(false)
  })

  it('never from a frame — a video player, a srcdoc, even the app\'s own page in one', () => {
    expect(allow({ isMainFrame: false })).toBe(false)
    expect(allow({ isMainFrame: false, requestingUrl: 'https://www.youtube-nocookie.com/embed/abc' })).toBe(false)
    expect(allow({ isMainFrame: false, requestingUrl: 'about:srcdoc' })).toBe(false)
  })

  it('never from another page, or from something that isn\'t one of the app\'s windows', () => {
    expect(allow({ requestingUrl: 'https://example.com/' })).toBe(false)
    expect(allow({ requestingUrl: 'file:///tmp/evil.html' })).toBe(false)
    expect(allow({ fromAppWindow: false })).toBe(false)
  })

  it('still refuses everything else the app never asks for', () => {
    for (const permission of [
      'geolocation',
      'notifications',
      'display-capture',
      'speaker-selection',
      'clipboard-read',
      'midiSysex',
      'mediaKeySystem',
      'openExternal',
      'fileSystem',
      'pointerLock',
      'unknown'
    ]) {
      expect(allow({ permission })).toBe(false)
    }
  })
})

// --- the microphone: the system's own question --------------------------------------

describe('micAccessFromStatus', () => {
  it('stops only on a firm no', () => {
    expect(micAccessFromStatus('granted', 'darwin')).toEqual({ ok: true })
    expect(micAccessFromStatus('denied', 'darwin')).toEqual({ ok: false, reason: 'denied', platform: 'darwin' })
    expect(micAccessFromStatus('restricted', 'win32')).toEqual({ ok: false, reason: 'restricted', platform: 'win32' })
    expect(micAccessFromStatus('not-determined', 'win32')).toEqual({ ok: true })
    expect(micAccessFromStatus('unknown', 'win32')).toEqual({ ok: true })
  })
})

describe('microphoneAccessFor', () => {
  const env = (platform: string, statuses: string[], answer = true, fakeDevice = false) => {
    const status = vi.fn(() => statuses.shift() ?? 'unknown')
    const ask = vi.fn(async () => answer)
    return { env: { platform, fakeDevice, status, ask }, status, ask }
  }

  it('under a fake microphone, asks nothing at all — tests must never raise the system\'s box', async () => {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const t = env(platform, ['not-determined'], true, true)
      expect(await microphoneAccessFor(t.env)).toEqual({ ok: true })
      expect(t.status).not.toHaveBeenCalled()
      expect(t.ask).not.toHaveBeenCalled()
    }
  })

  it('on a Mac, asks only an undecided app', async () => {
    const decided = env('darwin', ['granted'])
    expect(await microphoneAccessFor(decided.env)).toEqual({ ok: true })
    expect(decided.ask).not.toHaveBeenCalled()

    const undecided = env('darwin', ['not-determined'], true)
    expect(await microphoneAccessFor(undecided.env)).toEqual({ ok: true })
    expect(undecided.ask).toHaveBeenCalledTimes(1)
  })

  it('on a Mac, reports a no — before asking, or as the answer', async () => {
    const before = env('darwin', ['denied'])
    expect(await microphoneAccessFor(before.env)).toEqual({ ok: false, reason: 'denied', platform: 'darwin' })
    expect(before.ask).not.toHaveBeenCalled()

    const refused = env('darwin', ['not-determined', 'denied'], false)
    expect(await microphoneAccessFor(refused.env)).toEqual({ ok: false, reason: 'denied', platform: 'darwin' })

    const forbidden = env('darwin', ['not-determined', 'restricted'], false)
    expect(await microphoneAccessFor(forbidden.env)).toEqual({ ok: false, reason: 'restricted', platform: 'darwin' })

    // A refusal is a no even if the status somehow still reads undecided.
    const odd = env('darwin', ['not-determined', 'not-determined'], false)
    expect(await microphoneAccessFor(odd.env)).toEqual({ ok: false, reason: 'denied', platform: 'darwin' })
  })

  it('on Windows, reports the privacy switch and never asks', async () => {
    const off = env('win32', ['denied'])
    expect(await microphoneAccessFor(off.env)).toEqual({ ok: false, reason: 'denied', platform: 'win32' })
    const on = env('win32', ['granted'])
    expect(await microphoneAccessFor(on.env)).toEqual({ ok: true })
    expect(off.ask).not.toHaveBeenCalled()
    expect(on.ask).not.toHaveBeenCalled()
  })

  it('on Linux (and anything else), leaves it to the browser\'s own request', async () => {
    for (const platform of ['linux', 'freebsd']) {
      const t = env(platform, ['denied'])
      expect(await microphoneAccessFor(t.env)).toEqual({ ok: true })
      expect(t.status).not.toHaveBeenCalled()
      expect(t.ask).not.toHaveBeenCalled()
    }
  })
})

// --- the converter: which, and with exactly what ----------------------------------

describe('converterFor', () => {
  it('on a Mac, afconvert — except what it was measured unable to open', () => {
    for (const ext of ['m4a', 'caf', 'aiff', 'amr', '3gp', 'qta', 'ogg', 'opus', 'flac', 'wav', 'mov']) {
      expect(converterFor('darwin', ext)).toEqual({ kind: 'afconvert' })
    }
    for (const ext of ['wma', 'webm', 'weba', 'mka']) {
      expect(converterFor('darwin', ext)).toEqual({ kind: 'refuse', reason: 'unsupported' })
    }
  })

  it('on Windows, PowerShell for everything (Media Foundation decides what it reads)', () => {
    for (const ext of ['wma', 'flac', 'm4a', 'webm', 'caf']) expect(converterFor('win32', ext)).toEqual({ kind: 'powershell' })
  })

  it('on Linux, ffmpeg; anywhere else, nothing', () => {
    expect(converterFor('linux', 'wma')).toEqual({ kind: 'ffmpeg' })
    expect(converterFor('freebsd', 'wav')).toEqual({ kind: 'refuse', reason: 'unsupported' })
    expect(converterFor('openbsd', 'wav')).toEqual({ kind: 'refuse', reason: 'unsupported' })
  })
})

describe('converter arguments', () => {
  it('afconvert: AAC in an .m4a, no bit rate, the two paths last and separate', () => {
    expect(AFCONVERT).toBe('/usr/bin/afconvert')
    expect(afconvertArgs('/t/input.wav', '/t/output.m4a')).toEqual(['-f', 'm4af', '-d', 'aac', '/t/input.wav', '/t/output.m4a'])
    expect(afconvertStereoArgs('/t/input.wav', '/t/stereo.caf')).toEqual([
      '-f', 'caff', '-d', 'LEF32', '--mix', '-c', '2', '/t/input.wav', '/t/stereo.caf'
    ])
  })

  it('PowerShell: 5.1 by full path, the script by -File, each path its own argument', () => {
    expect(windowsPowerShell({ SystemRoot: 'C:\\Windows' })).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(windowsPowerShell({ windir: 'D:\\WINNT' })).toBe('D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(windowsPowerShell({})).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    const odd = "C:\\Temp\\notealise-voice-x\\in'; Remove-Item -Recurse ~; '.wav"
    expect(powershellArgs('C:\\Temp\\n\\convert.ps1', odd, 'C:\\Temp\\n\\output.m4a')).toEqual([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\Temp\\n\\convert.ps1', odd, 'C:\\Temp\\n\\output.m4a'
    ])
  })

  it('ffmpeg: sound only, AAC, never reads stdin', () => {
    expect(ffmpegArgs('/t/input.wma', '/t/output.m4a')).toEqual([
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', '/t/input.wma', '-vn', '-c:a', 'aac', '-b:a', '96k', '/t/output.m4a'
    ])
  })

  it('the Windows script takes its paths as parameters and is plain ASCII', () => {
    expect(WINDOWS_CONVERT_SCRIPT.startsWith('param([string]$InPath, [string]$OutPath)')).toBe(true)
    const printable = (c: string): boolean => c === '\t' || c === '\r' || c === '\n' || (c >= ' ' && c <= '~')
    expect([...WINDOWS_CONVERT_SCRIPT].filter((c) => !printable(c))).toEqual([])
    expect(WINDOWS_CONVERT_SCRIPT).toContain('MediaEncodingProfile]::CreateM4a([Windows.Media.MediaProperties.AudioEncodingQuality]::Medium)')
    expect(WINDOWS_CONVERT_SCRIPT).toContain('GetFileFromPathAsync($InPath)')
    // The only places the paths are used are those two parameters.
    expect(WINDOWS_CONVERT_SCRIPT.match(/\$InPath/g)).toHaveLength(2)
    expect(WINDOWS_CONVERT_SCRIPT.match(/\$OutPath/g)).toHaveLength(3)
    // WinRT types are named in the unspaced form every known-working PowerShell
    // 5.1 snippet uses; the spaced one leans on the parser trimming whitespace,
    // which can't be tried from a Mac.
    const typeLines = WINDOWS_CONVERT_SCRIPT.split('\r\n').filter((l) => l.includes('ContentType'))
    expect(typeLines).toHaveLength(8)
    for (const line of typeLines) {
      expect(line).toMatch(/^ {2}\$null = \[Windows\.[\w.]+,Windows\.[\w.]+,ContentType=WindowsRuntime\]$/)
    }
  })

  it('a timeout that grows with the file', () => {
    expect(converterTimeoutMs(0)).toBe(60_000)
    expect(converterTimeoutMs(1)).toBe(70_000)
    expect(converterTimeoutMs(1024 * 1024)).toBe(70_000)
    expect(converterTimeoutMs(MAX_AUDIO_BYTES)).toBe(60_000 + 512 * 10_000)
  })
})

describe('reading a converter\'s failure', () => {
  it('afconvert: could not open, could not encode the channels, or gave up', () => {
    expect(afconvertFailureStage("Error: Couldn't open input file ('typ?')")).toBe('open')
    expect(afconvertFailureStage("Error: Couldn't open input file ('wht?')")).toBe('open')
    expect(afconvertFailureStage("Error: ExtAudioFileSetProperty ('cfmt') failed ('!dat')")).toBe('channels')
    expect(afconvertFailureStage("Error: Couldn't set audio converter property ('!dat')")).toBe('other')
    expect(afconvertFailureStage('')).toBe('other')
  })

  it('"unsupported" only for a kind an older Mac may lack, said in so many words', () => {
    expect(macOpenFailure('ogg', "Error: Couldn't open input file ('typ?')")).toBe('unsupported')
    expect(macOpenFailure('opus', "Error: Couldn't open input file ('fmt?')")).toBe('unsupported')
    expect(macOpenFailure('qta', "Error: Couldn't open input file ('typ?')")).toBe('unsupported')
    expect(macOpenFailure('ogg', "Error: Couldn't open input file ('wht?')")).toBe('failed')
    expect(macOpenFailure('wav', "Error: Couldn't open input file ('typ?')")).toBe('failed')
    expect(macOpenFailure('m4a', "Error: Couldn't open input file ('wht?')")).toBe('failed')
  })

  it('Windows: exit 3 means nothing on that PC reads it', () => {
    expect(windowsFailure(3)).toBe('unsupported')
    for (const code of [1, 2, 255, null]) expect(windowsFailure(code)).toBe('failed')
  })
})

// --- convertAudio: what it refuses before anything runs -------------------------------

describe('convertAudio refuses', () => {
  it('a name that isn\'t text, or bytes that aren\'t bytes', async () => {
    await expect(convertAudio(42, new Uint8Array(4))).rejects.toThrow(TypeError)
    await expect(convertAudio(['a.wav'], new Uint8Array(4))).rejects.toThrow(TypeError)
    for (const data of ['RIFF', [82, 73, 70, 70], new ArrayBuffer(4), { length: 4 }, null, undefined]) {
      await expect(convertAudio('Memo.wav', data)).rejects.toThrow(TypeError)
    }
  })

  it('a name that isn\'t a recording', async () => {
    for (const name of ['evil.sh', 'Setup.exe', 'x.ps1', 'pic.png', '.wav', 'noext']) {
      await expect(convertAudio(name, new Uint8Array(4))).rejects.toThrow(/Not a recording/)
    }
  })

  it('a recording over the limit, without writing it anywhere', async () => {
    // A real 512 MB buffer is not needed to prove the check comes first.
    const huge = new Uint8Array(1)
    Object.defineProperty(huge, 'byteLength', { value: MAX_AUDIO_BYTES + 1 })
    const res = await convertAudio('Memo.wav', huge)
    expect(res).toMatchObject({ ok: false, reason: 'too-big' })
  })

  it('an empty recording', async () => {
    expect(await convertAudio('Memo.wav', new Uint8Array(0))).toMatchObject({ ok: false, reason: 'failed' })
  })
})

// --- convertAudio for real, on a Mac ----------------------------------------------------

/** A 16-bit PCM WAV, written by hand so the test needs no fixture files. With a
 *  `channelMask` it is the WAVE_FORMAT_EXTENSIBLE kind recorders and ffmpeg
 *  write for more than two channels — the mask is what gives it a channel
 *  layout, and a layout the AAC encoder won't take is what breaks the direct
 *  route (a plain 4-channel header has none, and converts directly). */
function wav(channels: number, rate: number, seconds: number, channelMask?: number): Uint8Array {
  const frames = Math.round(rate * seconds)
  const bytes = frames * channels * 2
  const fmtSize = channelMask === undefined ? 16 : 40
  const head = 20 + fmtSize + 8
  const b = Buffer.alloc(head + bytes)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(head - 8 + bytes, 4)
  b.write('WAVEfmt ', 8, 'ascii')
  b.writeUInt32LE(fmtSize, 16)
  b.writeUInt16LE(channelMask === undefined ? 1 : 0xfffe, 20) // PCM, or EXTENSIBLE
  b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate * channels * 2, 28)
  b.writeUInt16LE(channels * 2, 32)
  b.writeUInt16LE(16, 34)
  if (channelMask !== undefined) {
    b.writeUInt16LE(22, 36) // extension size
    b.writeUInt16LE(16, 38) // valid bits
    b.writeUInt32LE(channelMask, 40)
    Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(b, 44) // KSDATAFORMAT_SUBTYPE_PCM
  }
  b.write('data', head - 8, 'ascii')
  b.writeUInt32LE(bytes, head - 4)
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000)
    for (let c = 0; c < channels; c++) b.writeInt16LE(v, head + (i * channels + c) * 2)
  }
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
}

const isM4a = (d: Uint8Array): boolean => Buffer.from(d.subarray(4, 8)).toString('ascii') === 'ftyp'

const onMac = process.platform === 'darwin' && existsSync(AFCONVERT)

describe.skipIf(!onMac)('convertAudio with the Mac\'s own afconvert', () => {
  // Its own temp folder (os.tmpdir() reads TMPDIR each time), so "nothing was
  // left behind" can't be confused by anything else converting at the same time.
  let tmp = ''
  let saved: string | undefined
  beforeEach(() => {
    saved = process.env['TMPDIR']
    tmp = mkdtempSync(path.join(os.tmpdir(), 'voice-test-'))
    process.env['TMPDIR'] = tmp
  })
  afterEach(() => {
    process.env['TMPDIR'] = saved
    if (saved === undefined) delete process.env['TMPDIR']
    rmSync(tmp, { recursive: true, force: true })
  })

  it('turns a WAV into an .m4a and leaves nothing behind', async () => {
    const res = await convertAudio('Memo.wav', wav(1, 48000, 0.5))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.name).toBe('Memo.m4a')
    expect(isM4a(res.data)).toBe(true)
    expect(readdirSync(tmp)).toEqual([])
  })

  it('mixes a four-channel recording down to stereo rather than giving up', async () => {
    // L R Rls Rrs — the layout ffmpeg and four-track recorders write for "quad".
    const quad = wav(4, 48000, 0.5, 0x33)
    // Control: the direct route really does refuse this file, so a pass below
    // can only have come through the stereo route.
    const control = path.join(tmp, 'control.wav')
    writeFileSync(control, quad)
    expect(() =>
      execFileSync(AFCONVERT, afconvertArgs(control, path.join(tmp, 'control.m4a')), { stdio: 'pipe' })
    ).toThrow(/'cfmt'/)
    rmSync(control)
    rmSync(path.join(tmp, 'control.m4a'), { force: true })

    const res = await convertAudio('Field recorder.wav', quad)
    expect(res.ok).toBe(true)
    if (res.ok) expect(isM4a(res.data)).toBe(true)
    expect(readdirSync(tmp)).toEqual([])
  })

  it('answers "unsupported" for a .wma without running anything', async () => {
    expect(await convertAudio('Memo.wma', new Uint8Array([1, 2, 3, 4]))).toEqual({
      ok: false,
      reason: 'unsupported',
      platform: 'darwin'
    })
    expect(readdirSync(tmp)).toEqual([])
  })

  it('answers "failed" for a damaged file, and still leaves nothing behind', async () => {
    const junk = new Uint8Array(4096).map((_, i) => (i * 7919) % 256)
    expect(await convertAudio('Memo.wav', junk)).toMatchObject({ ok: false, reason: 'failed' })
    expect(await convertAudio('Memo.m4a', junk)).toMatchObject({ ok: false, reason: 'failed' })
    expect(readdirSync(tmp)).toEqual([])
  })
})

// --- openVaultFile: recordings open in their own app, programs still don't ----------------

describe('openVaultFile', () => {
  let root = ''
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'voice-open-'))
    setVaultRoot(root)
    openPath.mockClear()
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('opens a recording, and a document as before', async () => {
    writeFileSync(path.join(root, 'Memo.m4a'), 'x')
    writeFileSync(path.join(root, 'Slides.pdf'), 'x')
    expect(await openVaultFile('Memo.m4a')).toBe(true)
    expect(await openVaultFile('Slides.pdf')).toBe(true)
    expect(openPath).toHaveBeenCalledTimes(2)
  })

  it('never opens a program, even one named like a recording', async () => {
    writeFileSync(path.join(root, 'run.sh'), '#!/bin/sh\n')
    expect(await openVaultFile('run.sh')).toBe(false)
    let linked = true
    try {
      symlinkSync(path.join(root, 'run.sh'), path.join(root, 'Memo.m4a'))
    } catch {
      linked = false // no symlinks here (Windows without the right); the name check above still ran
    }
    if (linked) expect(await openVaultFile('Memo.m4a')).toBe(false)
    expect(await openVaultFile('Missing.m4a')).toBe(false)
    expect(openPath).not.toHaveBeenCalled()
  })
})
