import { describe, expect, it } from 'vitest'
import { indexEmbeds } from '../../../shared/attachments'
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
