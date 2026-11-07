import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  scriptPrompt,
  wordsFromTokens,
  detectArgs,
  finderArgs,
  parseSpeech,
  languageRuns,
  parseLanguage,
  stretchesFromSpeech,
  etaMs,
  MODEL_FILE,
  paragraphsFrom,
  parseProgress,
  segmentsFromJson,
  threadsFor,
  wavHeader,
  whisperArgs,
  whisperFiles
} from './transcribeModel'

describe('threadsFor', () => {
  it('uses half the processor, at least one, at most eight', () => {
    expect(threadsFor(10)).toBe(5) // Reuben's M4
    expect(threadsFor(4)).toBe(2)
    expect(threadsFor(1)).toBe(1)
    expect(threadsFor(0)).toBe(1)
    expect(threadsFor(32)).toBe(8)
    expect(threadsFor(NaN)).toBe(1)
  })
})

describe('whisperArgs', () => {
  const args = whisperArgs({ model: '/m/base.bin', wav: '/t/in put.wav', outBase: '/t/out', threads: 5 })
  it('always turns off feeding back what it just wrote (-mc 0)', () => {
    // Without it long recordings repeated one sentence up to 40 times (measured 2026-11-04).
    expect(args.join(' ')).toContain('-mc 0')
  })
  it('works out the language itself, and keeps timestamps for the paragraph breaks', () => {
    expect(args.join(' ')).toContain('-l auto')
    expect(args).not.toContain('-nt')
  })
  it('passes a path with a space as one argument', () => {
    expect(args[args.indexOf('-f') + 1]).toBe('/t/in put.wav')
  })
})

describe('whisperFiles', () => {
  it('reads from the app resources when packaged, build-whisper/ in the test copy', () => {
    const packaged = whisperFiles({ platform: 'win32', arch: 'x64', packaged: true, resourcesPath: 'R', appPath: 'A' })
    expect(packaged.exe).toBe(path.join('R', 'whisper', 'whisper-cli.exe'))
    expect(packaged.model).toBe(path.join('R', 'whisper', MODEL_FILE))
    const dev = whisperFiles({ platform: 'darwin', arch: 'arm64', packaged: false, resourcesPath: 'R', appPath: 'A' })
    expect(dev.exe).toBe(path.join('A', 'build-whisper', 'darwin-arm64', 'whisper-cli'))
    expect(dev.finder).toBe(path.join('A', 'build-whisper', 'darwin-arm64', 'whisper-vad-speech-segments'))
    expect(dev.vad).toBe(path.join('A', 'build-whisper', 'ggml-silero-v5.1.2.bin'))
    expect(packaged.finder).toBe(path.join('R', 'whisper', 'whisper-vad-speech-segments.exe'))
  })
})

describe('parseProgress', () => {
  it('takes the last figure and caps the overshoot', () => {
    expect(parseProgress('whisper_print_progress_callback: progress =  29%\n...progress =  59%')).toBe(59)
    expect(parseProgress('progress = 118%')).toBe(100)
    expect(parseProgress('nothing here')).toBeNull()
  })
})

describe('etaMs', () => {
  it('waits until the guess means something', () => {
    expect(etaMs(3000, 50)).toBeNull()
    expect(etaMs(20000, 2)).toBeNull()
    expect(etaMs(13000, 8)).toBeNull() // measured: 150 s guessed for a 33 s run
  })
  it('scales what is left by the pace so far', () => {
    expect(etaMs(10000, 20)).toBe(40000)
    expect(etaMs(10000, 100)).toBeNull()
  })
})

describe('wavHeader', () => {
  it('describes 16 kHz mono 16-bit sound of the given length', () => {
    const h = wavHeader(16000)
    expect(h.length).toBe(44)
    expect(h.toString('ascii', 0, 4)).toBe('RIFF')
    expect(h.readUInt32LE(24)).toBe(16000)
    expect(h.readUInt16LE(22)).toBe(1)
    expect(h.readUInt32LE(40)).toBe(32000)
  })
})

describe('paragraphsFrom', () => {
  const seg = (from: number, to: number, text: string) => ({ from, to, text })
  it('joins pieces into one paragraph until the speaker pauses', () => {
    expect(
      paragraphsFrom([
        seg(0, 4000, ' Plants take in carbon dioxide'),
        seg(4000, 6000, ' through their leaves.'),
        seg(8000, 10000, ' For the maths homework,'),
        seg(10000, 12000, ' question four.')
      ])
    ).toEqual(['Plants take in carbon dioxide through their leaves.', 'For the maths homework, question four.'])
  })
  it('drops Whisper’s markers and empty pieces', () => {
    expect(paragraphsFrom([seg(0, 2000, ' [BLANK_AUDIO]'), seg(2000, 3000, ' (music) Hello.'), seg(3000, 4000, '  ')])).toEqual([
      'Hello.'
    ])
  })
  it('breaks a long run with no pause at a sentence end', () => {
    const pieces = Array.from({ length: 20 }, (_, i) => seg(i * 5000, (i + 1) * 5000, ` Sentence ${i}.`))
    const out = paragraphsFrom(pieces)
    expect(out.length).toBeGreaterThan(1)
    expect(out.every((p) => p.endsWith('.'))).toBe(true)
  })
  it('keeps Korean as it is', () => {
    expect(paragraphsFrom([seg(0, 3000, ' 식물은 물을 흡수해.'), seg(3000, 5000, ' 포도당은 에너지로 쓰여.')])).toEqual([
      '식물은 물을 흡수해. 포도당은 에너지로 쓰여.'
    ])
  })
  it('nothing heard is no paragraphs, not an empty one', () => {
    expect(paragraphsFrom([])).toEqual([])
  })
})

describe('segmentsFromJson', () => {
  it('reads what whisper-cli -oj writes', () => {
    const json = {
      result: { language: 'ko' },
      transcription: [{ offsets: { from: 0, to: 6720 }, text: ' 자, 금요일' }, { offsets: {}, text: 'bad' }]
    }
    expect(segmentsFromJson(json)).toEqual({ segments: [{ from: 0, to: 6720, text: ' 자, 금요일' }], words: [], language: 'ko' })
  })
  it('never throws on junk', () => {
    expect(segmentsFromJson(null)).toEqual({ segments: [], words: [], language: null })
    expect(segmentsFromJson({ transcription: 'x' })).toEqual({ segments: [], words: [], language: null })
  })
})

describe('one recording, several languages', () => {
  it('reads the language line the program prints', () => {
    expect(parseLanguage('whisper_full_with_state: auto-detected language: ko (p = 0.982390)')).toEqual({ language: 'ko', p: 0.98239 })
    expect(parseLanguage('nothing')).toBeNull()
  })
  it('asks the language with -dl on a stretch of its own', () => {
    expect(detectArgs({ model: 'm', wav: 'w', threads: 2 }).join(' ')).toBe('-m m -f w -l auto -dl -t 2')
  })
  it('transcribes a run in its own language, counted from the recording start', () => {
    const a = whisperArgs({ model: 'm', wav: 'w', outBase: 'o', threads: 2, language: 'ko', fromMs: 57000, durationMs: 45000 })
    expect(a.join(' ')).toContain('-l ko -ot 57000 -d 45000')
    expect(a.join(' ')).toContain('-mc 0')
  })
  it('reads where the speech finder heard talking (hundredths of a second)', () => {
    // its real output for the test recording with two 20 s silences, 2026-11-05
    const out = 'Detected 3 speech segments:\nSpeech segment 0: start = 0.00, end = 659.00\nSpeech segment 1: start = 685.00, end = 1203.00\nSpeech segment 2: start = 3197.00, end = 3824.00\n'
    expect(parseSpeech(out)).toEqual([
      { from: 0, to: 6590 },
      { from: 6850, to: 12030 },
      { from: 31970, to: 38240 }
    ])
    expect(parseSpeech('\nDetected 0 speech segments:\n')).toEqual([])
    expect(finderArgs({ vad: 'v', wav: 'w', threads: 2 })).toEqual(['-vm', 'v', '-f', 'w', '-t', '2'])
  })
  it('joins talk with short gaps, keeps long silences out, pads each stretch', () => {
    const st = stretchesFromSpeech(
      [
        { from: 0, to: 6590 },
        { from: 6850, to: 12030 },
        { from: 31970, to: 38240 }
      ],
      76000
    )
    // the 0.26 s gap is joined; the 20 s silence is not — and never handed to Whisper
    expect(st).toEqual([
      { from: 0, to: 12230 },
      { from: 31770, to: 38440 }
    ])
  })
  it('nobody talking means no stretches at all (no invented "You")', () => {
    expect(stretchesFromSpeech([], 30000)).toEqual([])
  })
  it('a long unbroken stretch is cut every 30 s; padding never overlaps', () => {
    const st = stretchesFromSpeech([{ from: 1000, to: 71000 }], 80000)
    expect(st.map((x) => [x.from, x.to])).toEqual([
      [800, 31000],
      [31000, 61000],
      [61000, 71200]
    ])
  })
  it('joins neighbours in the same language; an unsure stretch takes its neighbour’s', () => {
    const st = (from: number, to: number, language: string | null, p: number) => ({ from, to, language, p })
    expect(
      languageRuns([st(0, 10, 'en', 0.99), st(10, 20, 'en', 0.98), st(20, 30, 'ja', 0.3), st(30, 40, 'ko', 0.97), st(40, 50, 'ko', 0.95)])
    ).toEqual([
      { from: 0, to: 30, language: 'en' },
      { from: 30, to: 50, language: 'ko' }
    ])
    expect(languageRuns([st(0, 10, null, 0), st(10, 20, 'ko', 0.9)])).toEqual([{ from: 0, to: 20, language: 'ko' }])
    expect(languageRuns([st(0, 10, null, 0)])).toEqual([{ from: 0, to: 10, language: 'auto' }])
  })
})

describe('wordsFromTokens (the clip editor\u2019s "edit by the words")', () => {
  const tok = (text: string, from: number, to: number) => ({ text, offsets: { from, to } })
  it('joins pieces into words with their times, as whisper-cli -ojf writes them', () => {
    // real pieces from the test clips, 2026-11-05
    expect(
      wordsFromTokens([tok('[_BEG_]', 0, 0), tok(' Pl', 6730, 6840), tok('ants', 6840, 7080), tok(' take', 7090, 7280), tok('.', 7280, 7300)], '')
    ).toEqual([
      { text: 'Plants', from: 6730, to: 7080 },
      { text: 'take.', from: 7090, to: 7300 }
    ])
    expect(wordsFromTokens([tok(' 금', 540, 600), tok('요', 600, 750), tok('일', 750, 880), tok(' 생', 970, 1050), tok('물', 1050, 1200)], '')).toEqual([
      { text: '금요일', from: 540, to: 880 },
      { text: '생물', from: 970, to: 1200 }
    ])
  })
  it('a character split part-way through its bytes takes the sentence\u2019s own word', () => {
    expect(wordsFromTokens([tok(' \uFFFD', 0, 100), tok('\uFFFD', 100, 200), tok(' 물', 200, 300)], ' 鬱 물').map((w) => w.text)).toEqual(['鬱', '물'])
  })
  it('Chinese and Japanese: each piece is a word (no spaces to go by); punctuation stays on', () => {
    expect(
      wordsFromTokens([tok(' 报告', 0, 300), tok('警告', 300, 600), tok('称', 600, 700), tok(',', 700, 720), tok('没有', 800, 1000)], '').map((w) => w.text)
    ).toEqual(['报告', '警告', '称,', '没有'])
    expect(wordsFromTokens([tok(' アマゾン', 0, 400), tok('川', 400, 500), tok('は', 500, 600)], '').map((w) => w.text)).toEqual(['アマゾン', '川', 'は'])
  })
  it('never throws on junk', () => {
    expect(wordsFromTokens(null, '')).toEqual([])
    expect(wordsFromTokens([{ text: 3 }, null], '')).toEqual([])
  })
})

describe('scriptPrompt (Hindi and Chinese come out in the right script)', () => {
  it('Simplified for Mandarin, Traditional on a Taiwan / Hong Kong computer', () => {
    expect(scriptPrompt('zh', 'en-GB')).toBe('以下是普通话的句子。')
    expect(scriptPrompt('zh', 'zh-CN')).toBe('以下是普通话的句子。')
    expect(scriptPrompt('zh', 'zh-TW')).toBe('以下是普通話的句子。')
    expect(scriptPrompt('zh', 'zh-Hant-HK')).toBe('以下是普通話的句子。')
  })
  it('Devanagari for Hindi; nothing for everything else', () => {
    expect(scriptPrompt('hi', 'en-GB')).toMatch(/[\u0900-\u097F]/)
    expect(scriptPrompt('en', 'en-GB')).toBeNull()
    expect(scriptPrompt('ko', 'ko-KR')).toBeNull()
  })
  it('a hint is passed with a little room (-mc 0 would throw it away and return nothing)', () => {
    const a = whisperArgs({ model: 'm', wav: 'w', outBase: 'o', threads: 2, language: 'zh', prompt: '以下是普通话的句子。' }).join(' ')
    expect(a).toContain('-mc 32 --prompt 以下是普通话的句子。')
    expect(whisperArgs({ model: 'm', wav: 'w', outBase: 'o', threads: 2 }).join(' ')).toContain('-mc 0')
  })
})
