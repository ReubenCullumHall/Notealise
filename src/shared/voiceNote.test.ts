import { describe, expect, it } from 'vitest'
import {
  VOICE_DEFAULTS,
  audioTag,
  isDefaultVoice,
  normalizeVoice,
  parseAudioOpenTag,
  voiceFileName,
  withVoiceName,
  withVoiceSettings
} from './voiceNote'
import { indexEmbeds, kindForFilename, kindForMime, repointFileLinks, retargetEmbeds, voiceEmbeds } from './attachments'

describe('audioTag', () => {
  it('writes the plain tag when nothing has been changed', () => {
    expect(audioTag('Voice%20note.m4a')).toBe('<audio controls src="Voice%20note.m4a"></audio>')
    expect(audioTag('a.m4a', VOICE_DEFAULTS)).toBe('<audio controls src="a.m4a"></audio>')
  })

  it('writes only the settings that differ from the default, in a fixed order', () => {
    expect(audioTag('a.m4a', { speed: 1.5 })).toBe('<audio controls src="a.m4a" data-speed="1.5"></audio>')
    expect(audioTag('a.m4a', { speed: 2, volume: 1.25, tone: -0.3 })).toBe(
      '<audio controls src="a.m4a" data-volume="1.25" data-tone="-0.3" data-speed="2"></audio>'
    )
  })

  it('never writes a slider rounding error into the note', () => {
    expect(audioTag('a.m4a', { volume: 1.2500000001 })).toContain('data-volume="1.25"')
  })
})

describe('normalizeVoice', () => {
  it('pulls out-of-range values into range rather than refusing them', () => {
    expect(normalizeVoice({ volume: 9, tone: -4, speed: 0.1 })).toEqual({ volume: 2, tone: -1, speed: 0.5 })
  })

  it('reads numbers written as text (they come out of a file) and ignores junk', () => {
    expect(normalizeVoice({ volume: '1.5', tone: 'loud', speed: '' })).toEqual({ volume: 1.5, tone: 0, speed: 1 })
    expect(normalizeVoice(null)).toEqual(VOICE_DEFAULTS)
  })

  it('knows a default when it sees one', () => {
    expect(isDefaultVoice(normalizeVoice({}))).toBe(true)
    expect(isDefaultVoice(normalizeVoice({ speed: 1.25 }))).toBe(false)
  })
})

describe('parseAudioOpenTag', () => {
  it('reads what audioTag writes, settings included', () => {
    const tag = audioTag('Voice%20note.m4a', { volume: 1.5, tone: 0.4, speed: 0.75 })
    const open = tag.slice(0, tag.indexOf('>') + 1)
    expect(parseAudioOpenTag(open)).toEqual({ src: 'Voice%20note.m4a', settings: { volume: 1.5, tone: 0.4, speed: 0.75 }, name: '' })
  })

  it('reads a hand-written tag: any order, single quotes, no controls', () => {
    expect(parseAudioOpenTag(`<AUDIO data-speed='2' src='memo.mp3'>`)).toEqual({
      src: 'memo.mp3',
      settings: { volume: 1, tone: 0, speed: 2 },
      name: ''
    })
  })

  it('refuses a tag with nothing to play, and anything that is not an audio tag', () => {
    expect(parseAudioOpenTag('<audio controls>')).toBeNull()
    expect(parseAudioOpenTag('<video controls src="a.mp4">')).toBeNull()
    expect(parseAudioOpenTag('<audiobook src="a.mp3">')).toBeNull()
  })
})

describe('withVoiceSettings', () => {
  it('replaces the settings and keeps every other attribute where it was', () => {
    const open = '<audio controls src="a.m4a" data-volume="2" preload="none">'
    expect(withVoiceSettings(open, { speed: 1.5 })).toBe('<audio controls src="a.m4a" preload="none" data-speed="1.5">')
  })

  it('goes back to the plain tag when the settings are reset', () => {
    expect(withVoiceSettings('<audio controls src="a.m4a" data-tone="0.5" data-speed="2">', VOICE_DEFAULTS)).toBe(
      '<audio controls src="a.m4a">'
    )
  })

  it('keeps a self-closing slash at the end', () => {
    expect(withVoiceSettings('<audio src="a.m4a" />', { volume: 0.5 })).toBe('<audio src="a.m4a" data-volume="0.5" />')
  })
})

describe('voiceFileName', () => {
  it('names a recording by local date and time, with no character Windows refuses', () => {
    const name = voiceFileName(new Date(2026, 9, 3, 9, 5), 'm4a')
    expect(name).toBe('Voice note 2026-10-03 09.05.m4a')
    expect(name).not.toMatch(/[<>:"/\\|?*]/)
  })
})

describe('audio as an attachment kind', () => {
  it('knows the recording apps’ formats by name and by type', () => {
    for (const n of ['a.m4a', 'b.MP3', 'c.wav', 'd.opus', 'e.ogg', 'f.wma', 'g.flac', 'h.amr', 'i.qta', 'j.caf', 'k.aiff', 'l.3gp']) {
      expect(kindForFilename(n)).toBe('audio')
    }
    expect(kindForMime('audio/x-m4a')).toBe('audio')
    expect(kindForMime('audio/mpeg')).toBe('audio')
    // A .webm is still a video by name — what it holds is decided when it is dropped.
    expect(kindForFilename('rec.webm')).toBe('video')
    expect(kindForMime('audio/webm')).toBe('audio')
  })

  it('finds a voice note as an embed, so it is moved, binned and re-pointed like a photo', () => {
    const text = 'Notes\n<audio controls src="memo%201.m4a" data-speed="1.5"></audio>\n'
    expect(indexEmbeds(text)).toEqual(['memo%201.m4a'])
    // Dragged into a note one folder down: the target climbs back up.
    expect(retargetEmbeds(text, 'Physics/Week 1.md', 'Physics/Labs/Lab 1.md')).toContain('src="../memo%201.m4a"')
    // The note itself moves; the recording stays where it was.
    expect(repointFileLinks(text, 'Physics/Week 1.md', 'Chemistry/Week 1.md')).toContain(
      'src="../Physics/memo%201.m4a" data-speed="1.5"'
    )
  })
})

describe('a voice note\'s name', () => {
  const tag = '<audio controls src="memo.m4a" data-speed="1.5">'

  it('is written on the line, read back exactly, and leaves the rest alone', () => {
    const named = withVoiceName(tag, 'Lecture 3')
    expect(named).toBe('<audio controls src="memo.m4a" data-speed="1.5" data-name="Lecture 3">')
    expect(parseAudioOpenTag(named)).toMatchObject({ src: 'memo.m4a', name: 'Lecture 3', settings: { speed: 1.5 } })
    // renamed in place, then taken off again
    expect(withVoiceName(named, 'Week 2')).toBe('<audio controls src="memo.m4a" data-speed="1.5" data-name="Week 2">')
    expect(withVoiceName(named, '  ')).toBe(tag)
    // a mixer change afterwards keeps the name
    expect(parseAudioOpenTag(withVoiceSettings(named, { volume: 2, tone: 0, speed: 1 }))?.name).toBe('Lecture 3')
    expect(parseAudioOpenTag(tag)?.name).toBe('')
  })

  it('survives any characters, and none of them can break the tag or point it at another file', () => {
    const name = `Tom's "big" <idea> & src='other.m4a' = 2 > 1`
    const named = withVoiceName(tag, name)
    expect(parseAudioOpenTag(named)?.name).toBe(name)
    expect(parseAudioOpenTag(named)?.src).toBe('memo.m4a')
    // the scan every other part of the app uses still finds the one real recording
    expect(indexEmbeds(named + '</audio>')).toEqual(['memo.m4a'])
    expect(voiceEmbeds(named + '</audio>', 'N.md').map((v) => v.file)).toEqual(['memo.m4a'])
  })

  it('is one tidy line', () => {
    expect(parseAudioOpenTag(withVoiceName(tag, '  Lecture\n\n  3  '))?.name).toBe('Lecture 3')
    expect(parseAudioOpenTag(withVoiceName(tag, 'x'.repeat(500)))?.name).toHaveLength(120)
  })
})
