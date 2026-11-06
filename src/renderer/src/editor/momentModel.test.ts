import { describe, expect, it } from 'vitest'
import { clockOf, isMomentHref, momentLabel, momentMarkdown, parseMoment } from './momentModel'

describe('a link to a moment in a voice note', () => {
  it('writes the time as a clock', () => {
    expect(clockOf(0)).toBe('0:00')
    expect(clockOf(83.9)).toBe('1:23')
    expect(clockOf(3723)).toBe('1:02:03')
  })

  it('is labelled with the voice note’s name, or its file’s when it has none', () => {
    expect(momentLabel('Explain it', 'Bio/memo.m4a', 83)).toBe('Explain it · 1:23')
    expect(momentLabel('', 'Bio/Recording 3.m4a', 5)).toBe('Recording 3 · 0:05')
    // a ] would end the label early
    expect(momentLabel('Take [2]', 'a.m4a', 1)).toBe('Take (2) · 0:01')
  })

  it('is an ordinary Markdown link to the recording, with the time on the end', () => {
    expect(momentMarkdown('Explain it', 'Bio/Explain it.m4a', 83.6, 'Bio/Cells.md')).toBe(
      '[Explain it · 1:23](Explain%20it.m4a#t=83)'
    )
    // written for the note it goes in: from another folder it climbs
    expect(momentMarkdown('', 'Bio/memo.m4a', 10, 'Revision/Cards.md')).toBe('[memo · 0:10](../Bio/memo.m4a#t=10)')
  })

  it('reads back to the same recording and second, from the note it is in', () => {
    expect(parseMoment('../Bio/memo.m4a#t=10', 'Revision/Cards.md')).toEqual({ file: 'Bio/memo.m4a', t: 10 })
    expect(parseMoment('Explain%20it.m4a#t=83', 'Bio/Cells.md')).toEqual({ file: 'Bio/Explain it.m4a', t: 83 })
    // the fragment's other forms: only the start is used
    expect(parseMoment('memo.m4a#t=12.5,20', 'n.md')).toEqual({ file: 'memo.m4a', t: 12.5 })
    expect(parseMoment('memo.m4a#t=npt:7', 'n.md')).toEqual({ file: 'memo.m4a', t: 7 })
  })

  it('is not any other link', () => {
    expect(isMomentHref('https://example.com/a.m4a#t=3')).toBe(false) // a web address
    expect(isMomentHref('memo.m4a')).toBe(false) // a recording with no time
    expect(isMomentHref('Slides.pdf#t=3')).toBe(false) // not a recording
    expect(isMomentHref('Notes.md#Heading')).toBe(false)
    expect(isMomentHref('memo.m4a#t=')).toBe(false)
    expect(isMomentHref('memo.m4a#t=83')).toBe(true)
    // pasted into a note in another folder, it climbs: still a moment
    expect(isMomentHref('../Bio/memo.m4a#t=83')).toBe(true)
  })
})
