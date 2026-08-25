import { describe, expect, it } from 'vitest'
import {
  indexEmbeds,
  lineOfEmbed,
  relativeTarget,
  resolveVaultPath,
  retargetEmbeds
} from '../../../shared/attachments'
import type { LinkRow } from '../../../shared/links'
import { mediaUsage, otherNotesUsing } from './usage'

const row = (path: string, text: string): LinkRow => ({
  path,
  links: [],
  embeds: indexEmbeds(text)
})

describe('indexEmbeds', () => {
  it('finds both forms in one pass', () => {
    expect(
      indexEmbeds('# Hi\n\n![](a.png)\n\ntext <video controls src="b.mp4"></video> more\n')
    ).toEqual(['a.png', 'b.mp4'])
  })

  it('keeps the target as written, escapes and all', () => {
    expect(indexEmbeds('![alt](my%20holiday.png)')).toEqual(['my%20holiday.png'])
  })

  // Shapes attachInput never writes but a person can type.
  it('handles a title and an angle-bracketed destination', () => {
    expect(indexEmbeds('![](a.png "Look")')).toEqual(['a.png'])
    expect(indexEmbeds('![](<my holiday.png>)')).toEqual(['my holiday.png'])
  })

  it('ignores an embed with nothing in it', () => {
    expect(indexEmbeds('![]()\n<video controls></video>')).toEqual([])
  })
})

describe('mediaUsage', () => {
  it('resolves each target against the note that holds it', () => {
    const usage = mediaUsage([
      row('Space/Sub/Note.md', '![](photo.png)'),
      row('Space/Other.md', '![](Sub/photo.png)')
    ])
    expect(usage.get('Space/Sub/photo.png')).toEqual(['Space/Sub/Note.md', 'Space/Other.md'])
  })

  it('counts a note once however many times it embeds the same file', () => {
    const usage = mediaUsage([row('A.md', '![](p.png)\n![](p.png)\n![](p.png)')])
    expect(usage.get('p.png')).toEqual(['A.md'])
  })

  it('drops targets with no file behind them', () => {
    const usage = mediaUsage([
      row('A.md', '![](https://example.com/x.png)'),
      row('A.md', '![](/absolute.png)'),
      row('A.md', '![](../../escape.png)')
    ])
    expect(usage.size).toBe(0)
  })

  it('survives a row from before embeds were indexed', () => {
    expect(mediaUsage([{ path: 'A.md', links: [] }]).size).toBe(0)
  })
})

describe('otherNotesUsing', () => {
  const usage = mediaUsage([row('A.md', '![](p.png)'), row('B.md', '![](p.png)')])

  it('excludes the note being deleted from', () => {
    expect(otherNotesUsing(usage, 'p.png', 'A.md')).toEqual(['B.md'])
  })

  // The index can lag the removal that has just happened, so the answer must not
  // depend on whether it has caught up.
  it('is right whether or not the index has caught up', () => {
    expect(otherNotesUsing(usage, 'p.png', 'B.md')).toEqual(['A.md'])
    expect(otherNotesUsing(mediaUsage([row('A.md', '![](p.png)')]), 'p.png', 'A.md')).toEqual([])
  })

  it('says nothing when there is no file', () => {
    expect(otherNotesUsing(usage, null, 'A.md')).toEqual([])
  })
})

describe('re-pointing an embed when its text moves to another note', () => {
  it('writes a bare filename when both notes share a folder', () => {
    expect(relativeTarget('School/stare.png', 'School/Other.md')).toBe('stare.png')
  })

  it('climbs out with .. when the destination is deeper', () => {
    expect(relativeTarget('School/stare.png', 'School/2026/Notes.md')).toBe('../stare.png')
    expect(relativeTarget('School/stare.png', 'School/2026/May/Notes.md')).toBe('../../stare.png')
  })

  it('descends when the file is deeper than the destination', () => {
    expect(relativeTarget('School/media/stare.png', 'School/Notes.md')).toBe('media/stare.png')
  })

  it('handles the vault root at either end', () => {
    expect(relativeTarget('stare.png', 'Notes.md')).toBe('stare.png')
    expect(relativeTarget('stare.png', 'School/Notes.md')).toBe('../stare.png')
    expect(relativeTarget('School/stare.png', 'Notes.md')).toBe('School/stare.png')
  })

  it('encodes each segment the same way an embed is written', () => {
    // Parens matter most: an unescaped ")" closes a `![](…)` destination early.
    expect(relativeTarget('School/stare (2).png', 'School/N.md')).toBe('stare%20%282%29.png')
    expect(relativeTarget('My Folder/a b.png', 'N.md')).toBe('My%20Folder/a%20b.png')
  })

  it('leaves the text byte-identical when the two notes are in the same folder', () => {
    // The common case. Anything else would rewrite a note for no reason and
    // show up as a spurious diff in the user's vault.
    const text = 'Look ![](stare.png) at this'
    expect(retargetEmbeds(text, 'School/A.md', 'School/B.md')).toBe(text)
  })

  it('re-points an image and a video across folders, and only the target', () => {
    const text = 'Before ![alt](stare.png) and <video controls src="clip.mp4"></video> after'
    const out = retargetEmbeds(text, 'School/A.md', 'School/2026/B.md')
    expect(out).toBe(
      'Before ![alt](../stare.png) and <video controls src="../clip.mp4"></video> after'
    )
  })

  it('leaves a remote URL and a data: URI alone — there is no file to re-point', () => {
    const text = '![](https://example.com/a.png) ![](data:image/png;base64,AAAA)'
    expect(retargetEmbeds(text, 'School/A.md', 'Other/B.md')).toBe(text)
  })

  it('survives a round trip: what it writes is what resolveVaultPath reads back', () => {
    // The property that actually matters, and the one a hand-checked expectation
    // above could still get wrong in the same direction twice.
    for (const [file, note] of [
      ['School/stare (2).png', 'School/2026/May/N.md'],
      ['a b/c d.png', 'N.md'],
      ['School/media/x.mp4', 'School/N.md']
    ] as const) {
      expect(resolveVaultPath(relativeTarget(file, note), note)).toBe(file)
    }
  })
})


describe('finding the line a picture sits on', () => {
  const NOTE = [
    '# Trip',
    '',
    'Some words.',
    '',
    '![](photos/beach.png)',
    '',
    'More words <video controls src="clip.mp4"></video> here.',
    ''
  ].join('\n')

  it('gives the 1-based line of the embed pointing at the file', () => {
    expect(lineOfEmbed(NOTE, 'School/Trip.md', 'School/photos/beach.png')).toBe(5)
    expect(lineOfEmbed(NOTE, 'School/Trip.md', 'School/clip.mp4')).toBe(7)
  })

  it('answers 0 when nothing in the note points at that file', () => {
    // 0 rather than -1 so the caller can treat it as falsy: "no line" and "do
    // not jump" are the same instruction.
    expect(lineOfEmbed(NOTE, 'School/Trip.md', 'School/photos/other.png')).toBe(0)
  })

  it('matches on the resolved FILE, not on the text of the target', () => {
    // The same file written two ways from two different notes has to be found
    // both times, which is the whole reason this resolves before comparing.
    const deep = '![](../photos/beach.png)'
    expect(lineOfEmbed(deep, 'School/2026/Trip.md', 'School/photos/beach.png')).toBe(1)
  })

  it('finds an embed whose name needed escaping', () => {
    expect(lineOfEmbed('![](stare%20%282%29.png)', 'School/N.md', 'School/stare (2).png')).toBe(1)
  })

  it('ignores a remote URL, which has no file to be the line of', () => {
    expect(lineOfEmbed('![](https://example.com/a.png)', 'N.md', 'a.png')).toBe(0)
  })
})
