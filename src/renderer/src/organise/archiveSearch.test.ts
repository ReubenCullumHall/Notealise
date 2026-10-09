import { describe, expect, it } from 'vitest'
import {
  fold,
  marksIn,
  prepare,
  searchArchive,
  searchableText,
  snippetAround,
  words,
  type ArchiveDoc
} from './archiveSearch'

// The archive is long-term storage: you are looking for something you put away
// a while ago and half remember. These pin what "works well" means for that —
// see the header of archiveSearch.ts.

const note = (title: string, extra: Partial<ArchiveDoc> = {}): ArchiveDoc => ({
  path: `Archive/${title}.md`,
  type: 'file',
  title,
  where: '',
  ...extra
})
const find = (docs: ArchiveDoc[], q: string): string[] => searchArchive(docs.map(prepare), q).map((h) => h.doc.title)

describe('fold', () => {
  it('drops capitals and accents and keeps the length, so marks land on the right letters', () => {
    expect(fold('Café Crème')).toBe('cafe creme')
    expect(fold('Café Crème')).toHaveLength('Café Crème'.length)
    // the same word typed with a separate accent character is still one letter per letter
    const decomposed = 'Café'
    expect(fold(decomposed)).toHaveLength(decomposed.length)
    expect(fold(decomposed).startsWith('cafe')).toBe(true)
  })

  it('leaves an emoji whole', () => {
    expect(fold('📚 Reading')).toBe('📚 reading')
  })
})

describe('words', () => {
  it('splits on spaces, folds, and drops repeats', () => {
    expect(words('  Waves  waves PHYSICS ')).toEqual(['physics', 'waves'])
  })
  it('gives nothing for a blank query, so a blank box shows the archive rather than "no matches"', () => {
    expect(words('   ')).toEqual([])
    expect(searchArchive([prepare(note('Anything'))], '   ')).toEqual([])
  })
})

describe('searchArchive', () => {
  it('needs every word, in any order', () => {
    const docs = [note('Waves', { where: 'Physics' }), note('Waves of Hokusai', { where: 'Art' })]
    expect(find(docs, 'physics waves')).toEqual(['Waves'])
    expect(find(docs, 'waves')).toHaveLength(2)
  })

  it('ignores capitals and accents in both directions', () => {
    const docs = [note('Café menu')]
    expect(find(docs, 'cafe')).toEqual(['Café menu'])
    expect(find(docs, 'CAFÉ')).toEqual(['Café menu'])
  })

  it('finds a note by the folder it sits in, or the space it was archived from', () => {
    const docs = [note('Week 3', { where: 'Year 12 › Biology' }), note('Lab', { from: 'Revision › Chemistry' })]
    expect(find(docs, 'biology')).toEqual(['Week 3'])
    expect(find(docs, 'chemistry')).toEqual(['Lab'])
  })

  it('finds words in the text — what a reader sees, not the markup around it', () => {
    const docs = [
      note('Colours', { text: searchableText('A <mark class="hl-rose">bright</mark> idea') }),
      note('Plain', { text: searchableText('nothing here') })
    ]
    expect(find(docs, 'bright')).toEqual(['Colours'])
    // "rose" is only in the colour tag, which nobody sees
    expect(find(docs, 'rose')).toEqual([])
  })

  it('puts the name before the folders, and the folders before the text', () => {
    const docs = [
      note('Diary', { text: 'went to the mitochondria lecture' }),
      note('Cells', { where: 'Mitochondria' }),
      note('Mitochondria')
    ]
    expect(find(docs, 'mitochondria')).toEqual(['Mitochondria', 'Cells', 'Diary'])
  })

  it('puts a word at the start of a name before the same letters in the middle of one', () => {
    const docs = [note('Breakfast plans'), note('Fast facts')]
    expect(find(docs, 'fast')).toEqual(['Fast facts', 'Breakfast plans'])
  })

  it('ranks an exact name first, then a name that starts with what you typed', () => {
    const docs = [note('Exam timetable 2025'), note('Old exam'), note('Exam')]
    expect(find(docs, 'exam')).toEqual(['Exam', 'Exam timetable 2025', 'Old exam'])
  })

  it('breaks ties with the most recently archived first', () => {
    const docs = [note('Notes A', { archivedAt: 100 }), note('Notes B', { archivedAt: 300 }), note('Notes C', { archivedAt: 200 })]
    expect(find(docs, 'notes')).toEqual(['Notes B', 'Notes C', 'Notes A'])
  })

  it('finds folders too', () => {
    const docs: ArchiveDoc[] = [{ path: 'Archive/Year 12', type: 'dir', title: 'Year 12', where: '' }]
    expect(find(docs, 'year')).toEqual(['Year 12'])
  })

  it('marks every match in the name and only shows a text line when the name did not match', () => {
    const [hit] = searchArchive([prepare(note('Waves and wave speed'))], 'wave')
    expect(hit.titleMarks).toEqual([
      [0, 4],
      [10, 14]
    ])
    expect(hit.snippet).toBeUndefined()
    const [inText] = searchArchive([prepare(note('Physics', { text: 'Light is a wave.' }))], 'wave')
    expect(inText.snippet?.text).toBe('Light is a wave.')
    expect(inText.snippet?.marks).toEqual([[11, 15]])
  })
})

describe('marksIn', () => {
  it('merges marks that touch or overlap, so one word is never marked twice', () => {
    expect(marksIn('waves', ['wave', 'aves'])).toEqual([[0, 5]])
  })
})

describe('snippetAround', () => {
  const long =
    'The first lesson covered the basics of the topic in some detail. Then we moved on to photosynthesis and how the light reactions feed the Calvin cycle, which took most of the afternoon.'
  it('cuts on spaces, with an ellipsis where it was cut, and keeps the match inside', () => {
    const s = snippetAround(long, ['photosynthesis'])!
    expect(s.text.startsWith('…')).toBe(true)
    expect(s.text.endsWith('…')).toBe(true)
    expect(s.text).toContain('photosynthesis')
    // no half words at either end
    expect(s.text.slice(1, 2)).not.toBe(' ')
    const [a, b] = s.marks[0]
    expect(s.text.slice(a, b)).toBe('photosynthesis')
  })
  it('starts at the beginning when the match is near it', () => {
    const s = snippetAround(long, ['first'])!
    expect(s.text.startsWith('The first')).toBe(true)
  })
  it('folds whitespace so a match across a line break still reads as one line', () => {
    const s = snippetAround('one\n\ntwo   three', ['two'])!
    expect(s.text).toBe('one two three')
  })
})
