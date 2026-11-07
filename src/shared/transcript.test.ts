import { describe, expect, it } from 'vitest'
import { escapeSpoken, findTranscript, placeTranscript, separatedText, transcriptBlock, transcriptIsStale, unescapeSpoken } from './transcript'

const audio = '<audio controls src="Lecture%203.m4a"></audio>'

describe('transcriptBlock', () => {
  it('writes the fold Reuben picked: details + summary, the paragraphs, blank lines around them', () => {
    expect(transcriptBlock('Lecture%203.m4a', ['First part.', 'Second part.'])).toBe(
      '<details data-transcript="Lecture%203.m4a"><summary>Transcript</summary>\n\nFirst part.\n\nSecond part.\n\n</details>'
    )
  })
  it('reads back as the same recording and paragraphs', () => {
    const lines = [audio, ...transcriptBlock('Lecture%203.m4a', ['한국어 문장입니다.', 'And English.']).split('\n'), 'after']
    const found = findTranscript(lines, 0)!
    expect(found.src).toBe('Lecture%203.m4a')
    expect(found.paragraphs).toEqual(['한국어 문장입니다.', 'And English.'])
    expect(lines[found.close]).toBe('</details>')
    expect(transcriptIsStale(found, 'Lecture%203.m4a')).toBe(false)
    expect(transcriptIsStale(found, 'Lecture%203%20edited.m4a')).toBe(true)
  })
})

describe('escapeSpoken (what was said shows as said)', () => {
  it('money is not maths, a spoken tag cannot close the fold, [[ is not a link', () => {
    expect(escapeSpoken('It costs $5 and $10.')).toBe('It costs \\$5 and \\$10.')
    expect(escapeSpoken('type </details> here')).toBe('type \\</details\\> here')
    expect(escapeSpoken('see [[Biology]]')).toBe('see \\[\\[Biology\\]\\]')
  })
  it('a sentence that starts like a list or heading stays a sentence', () => {
    expect(escapeSpoken('1. Mix the flour')).toBe('1\\. Mix the flour')
    expect(escapeSpoken('2) Then bake')).toBe('2\\) Then bake')
    expect(escapeSpoken('# of people')).toBe('\\# of people')
    expect(escapeSpoken('- and then')).toBe('\\- and then')
  })
  it('ordinary words are untouched, spaces tidied', () => {
    expect(escapeSpoken('  Plants take in   water.  ')).toBe('Plants take in water.')
  })
})

describe('findTranscript', () => {
  it('only a fold DIRECTLY under the voice note is its transcript', () => {
    const block = transcriptBlock('a.m4a', ['x']).split('\n')
    expect(findTranscript([audio, '', ...block], 0)).toBeNull()
    expect(findTranscript([audio, '<details><summary>Notes</summary>', '', 'x', '', '</details>'], 0)).toBeNull()
  })
  it('a fold with no end, or running into another voice note, is left alone', () => {
    expect(findTranscript([audio, '<details data-transcript="a.m4a"><summary>Transcript</summary>', '', 'x'], 0)).toBeNull()
    expect(findTranscript([audio, '<details data-transcript="a.m4a"><summary>Transcript</summary>', 'x', audio, '</details>'], 0)).toBeNull()
  })
  it('hand edits survive, and Separate gives the plain paragraphs', () => {
    const lines = [audio, '<details data-transcript="a.m4a"><summary>Transcript</summary>', '', 'Fixed by hand,', 'two lines.', '', 'Next.', '', '</details>']
    const found = findTranscript(lines, 0)!
    expect(found.paragraphs).toEqual(['Fixed by hand,\ntwo lines.', 'Next.'])
    expect(separatedText(found)).toBe('Fixed by hand,\ntwo lines.\n\nNext.')
  })
  it('an awkward src (a quote or & in a hand-written one) round-trips', () => {
    const lines = [audio, ...transcriptBlock('Tom & "Jo".m4a', ['x']).split('\n')]
    expect(findTranscript(lines, 0)!.src).toBe('Tom & "Jo".m4a')
  })
})

describe('placeTranscript', () => {
  it('a first transcript goes straight under the voice note, before anything else under it', () => {
    const doc = [audio, '[0:12](Lecture%203.m4a#t=12)', 'after']
    const p = placeTranscript(doc, 0, 'Lecture%203.m4a', ['Hello.'])
    expect(p.from).toBe(1)
    expect(p.to).toBe(1)
    const next = [...doc.slice(0, p.from), ...p.lines, ...doc.slice(p.to)]
    expect(findTranscript(next, 0)?.paragraphs).toEqual(['Hello.'])
    expect(next[next.length - 2]).toBe('[0:12](Lecture%203.m4a#t=12)')
  })
  it('Transcribe again: the new words take the fold, the old (maybe hand-corrected) ones stay as text under it', () => {
    const doc = [audio, ...transcriptBlock('old.m4a', ['Fixed by hand.']).split('\n'), 'after']
    const p = placeTranscript(doc, 0, 'Lecture%203.m4a', ['New words.'])
    const next = [...doc.slice(0, p.from), ...p.lines, ...doc.slice(p.to)]
    const found = findTranscript(next, 0)!
    expect(found.src).toBe('Lecture%203.m4a')
    expect(found.paragraphs).toEqual(['New words.'])
    expect(next.slice(found.close + 1)).toEqual(['', 'Fixed by hand.', 'after'])
  })
})

describe('unescapeSpoken', () => {
  it('shows what was said', () => {
    for (const t of ['It costs $5.', '1. Mix', '# of people', 'see [[x]]', 'a < b > c']) expect(unescapeSpoken(escapeSpoken(t))).toBe(t)
  })
})
