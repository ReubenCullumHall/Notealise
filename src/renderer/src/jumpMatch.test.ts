import { describe, expect, it } from 'vitest'
import { AWKWARD_NAMES } from '../../shared/awkwardNames'
import { findNotes, indexNotes, JUMP_LIMIT, type JumpNote } from './jumpMatch'

const note = (title: string, extra: Partial<JumpNote> = {}): JumpNote => ({
  path: `Study/${title}.md`,
  title,
  where: '',
  spaceFolder: 'Study',
  here: true,
  ...extra
})
const find = (notes: JumpNote[], q: string): string[] => findNotes(indexNotes(notes), q).map((h) => h.note.title)

describe('go to a note', () => {
  it('finds part of a name, in any case, with or without accents', () => {
    const notes = [note('Café ideas'), note('Waves'), note('Weekly plan')]
    expect(find(notes, 'caf')).toEqual(['Café ideas'])
    expect(find(notes, 'WAV')).toEqual(['Waves'])
    expect(find(notes, 'e')).toHaveLength(3)
  })

  it('needs every word, in any order, and also looks at the folders', () => {
    const notes = [note('Waves', { where: 'Physics' }), note('Waves of change'), note('Optics', { where: 'Physics' })]
    expect(find(notes, 'physics waves')).toEqual(['Waves'])
    expect(find(notes, 'change waves')).toEqual(['Waves of change'])
  })

  it('puts the start of a name first, and the space you are in ahead on a tie', () => {
    const notes = [
      note('My plan'),
      note('Plan B', { path: 'Other/Plan B.md', spaceFolder: 'Other', here: false, spaceTag: 'Other' }),
      note('Plan A')
    ]
    expect(find(notes, 'plan')).toEqual(['Plan A', 'Plan B', 'My plan'])
    // the same score either side: the note in this space wins
    const tie = [
      note('Plan B', { path: 'Other/Plan B.md', spaceFolder: 'Other', here: false }),
      note('Plan A')
    ]
    expect(find(tie, 'plan')[0]).toBe('Plan A')
  })

  it('says which letters matched', () => {
    const [hit] = findNotes(indexNotes([note('Waves of change')]), 'wav')
    expect(hit.titleMarks).toEqual([[0, 3]])
  })

  it('finds nothing for an empty or blank query', () => {
    expect(find([note('Waves')], '')).toEqual([])
    expect(find([note('Waves')], '   ')).toEqual([])
  })

  it('finds the awkward names by what they are called', () => {
    const notes = AWKWARD_NAMES.map((n) => note(n))
    for (const n of AWKWARD_NAMES) {
      expect(find(notes, n)).toContain(n)
    }
  })

  it('looks inside the notes only when asked to', () => {
    const notes = [note('Plan A', { text: 'We discuss refraction of light.' }), note('Refraction')]
    const index = indexNotes(notes)
    expect(findNotes(index, 'refraction').map((h) => h.note.title)).toEqual(['Refraction'])
    const deep = findNotes(index, 'refraction', true)
    // a word in the name beats the same word in the text
    expect(deep.map((h) => h.note.title)).toEqual(['Refraction', 'Plan A'])
    expect(deep[0].snippet).toBeUndefined()
    expect(deep[1].snippet?.text).toContain('refraction')
    expect(deep[1].snippet?.marks).toHaveLength(1)
  })

  it('lists no more than the limit', () => {
    const notes = Array.from({ length: JUMP_LIMIT + 30 }, (_, i) => note(`Lecture ${i}`))
    expect(find(notes, 'lecture')).toHaveLength(JUMP_LIMIT)
  })
})
