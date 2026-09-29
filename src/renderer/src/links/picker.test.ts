import { describe, expect, it } from 'vitest'
import type { NoteRef } from '../../../shared/links'
import { backStep, canStepInto, folderRows, pickerScreen, relinkStep, rootRows, uniqueName } from './model'

// The `[[` picker's screens (model.ts). A vault with two spaces, a folder with a
// folder inside it, and two notes that share a title in different spaces.
const note = (path: string): NoteRef => ({ path, title: path.slice(path.lastIndexOf('/') + 1, -3), kind: 'note' })
const dir = (path: string): NoteRef => ({ path, title: path.slice(path.lastIndexOf('/') + 1), kind: 'dir' })
const REFS: NoteRef[] = [
  dir('School'),
  note('School/Plan.md'),
  dir('School/Term 3'),
  note('School/Term 3/Waves.md'),
  dir('School/Term 3/Labs'),
  note('School/Term 3/Labs/Ripple tank.md'),
  dir('Physics'),
  note('Physics/Waves.md'),
  note('Physics/Optics.md')
]
const SPACES = [
  { folder: 'School', emoji: '🎒' },
  { folder: 'Physics', emoji: '🔭' }
]
const HERE = 'School/Plan.md'

describe('pickerScreen', () => {
  it('nothing typed is the first screen', () => {
    expect(pickerScreen('', REFS, HERE)).toEqual({ kind: 'root' })
  })
  it('a folder in this space and a /', () => {
    expect(pickerScreen('Term 3/', REFS, HERE)).toEqual({
      kind: 'folder',
      folder: 'School/Term 3',
      typed: 'Term 3',
      query: ''
    })
  })
  it('another space by its name', () => {
    expect(pickerScreen('Physics/Wav', REFS, HERE)).toMatchObject({ kind: 'folder', folder: 'Physics', query: 'Wav' })
  })
  it('a # steps inside a note', () => {
    expect(pickerScreen('Waves#Inter', REFS, HERE)).toEqual({ kind: 'note', target: 'Waves', query: 'Inter' })
  })
  it('plain letters are still a search, as they always were', () => {
    expect(pickerScreen('Wav', REFS, HERE)).toEqual({ kind: 'search', typed: 'Wav' })
  })
  it('an alias means the target is chosen — no menu', () => {
    expect(pickerScreen('Waves|the', REFS, HERE)).toBeNull()
  })
})

describe('rootRows', () => {
  it('this space’s top level, folders first, then the other spaces', () => {
    const { here, others } = rootRows(REFS, SPACES, HERE)
    expect(here.map((r) => r.ref.title)).toEqual(['Term 3', 'Plan'])
    expect(others.map((r) => [r.ref.title, r.step, r.emoji])).toEqual([['Physics', 'Physics/', '🔭']])
  })
})

describe('folderRows', () => {
  it('with nothing typed, only what is directly inside', () => {
    expect(folderRows(REFS, 'School/Term 3', '', HERE).map((r) => r.ref.title)).toEqual(['Labs', 'Waves'])
  })
  it('with a query, anything inside at any depth', () => {
    expect(folderRows(REFS, 'School', 'ripple', HERE).map((r) => r.ref.title)).toEqual(['Ripple tank'])
  })
  it('stepping into a folder types its path inside this space', () => {
    expect(folderRows(REFS, 'School/Term 3', '', HERE)[0].step).toBe('Term 3/Labs/')
  })
})

describe('uniqueName', () => {
  it('a title shared by two notes is written as a path, so it finds the right one', () => {
    expect(uniqueName(REFS, note('Physics/Waves.md'))).toBe('Physics/Waves')
    expect(uniqueName(REFS, note('Physics/Optics.md'))).toBe('Optics')
  })
})

describe('backStep', () => {
  it('out of a folder goes to the one above, then the first screen', () => {
    const s = pickerScreen('Term 3/Labs/', REFS, HERE)!
    expect(backStep(s, HERE, null)).toBe('Term 3/')
    expect(backStep(pickerScreen('Term 3/', REFS, HERE)!, HERE, null)).toBe('')
  })
  it('out of a note goes to the folder it is in', () => {
    const s = pickerScreen('Waves#', REFS, HERE)!
    expect(backStep(s, HERE, 'School/Term 3/Waves.md')).toBe('Term 3/')
  })
})

describe('names a link cannot step through', () => {
  it('a # or | in a name would be read as a heading or an alias — no arrow into it', () => {
    expect(canStepInto('C# notes')).toBe(false)
    expect(canStepInto('A | B')).toBe(false)
    expect(canStepInto('Term 3')).toBe(true)
    const refs = [...REFS, note('School/C# notes.md')]
    const row = rootRows(refs, SPACES, HERE).here.find((r) => r.ref.title === 'C# notes')!
    expect(row.step).toBe('')
  })
})

describe('right-click a link to point it somewhere else', () => {
  const link = (target: string, heading: string | null = null) => ({ from: 0, to: 0, target, heading, alias: null, text: '' })
  it('the heading half opens on that note\u2019s headings', () => {
    expect(relinkStep(link('Waves', 'Interference'), REFS, HERE, 'heading')).toBe('Waves#')
  })
  it('the note\u2019s name opens on the folder it sits in', () => {
    expect(relinkStep(link('Waves'), REFS, HERE, 'target')).toBe('Term 3/')
    expect(relinkStep(link('Optics'), REFS, HERE, 'target')).toBe('Physics/')
  })
  it('a note at the top of this space opens on the first screen', () => {
    expect(relinkStep(link('Plan'), REFS, HERE, 'target')).toBe('')
  })
  it('a link to a heading in this note opens on this note\u2019s headings', () => {
    expect(relinkStep(link('', 'Top'), REFS, HERE, 'heading')).toBe('#')
  })
  it('a note not written yet opens on the first screen', () => {
    expect(relinkStep(link('Nope'), REFS, HERE, 'target')).toBe('')
  })
})
