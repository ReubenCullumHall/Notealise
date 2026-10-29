import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { exitEmptyItem, listIndentChange } from './listIndent'

const at = (doc: string, from: number, to = from): EditorState =>
  EditorState.create({ doc, selection: EditorSelection.single(from, to) })

describe('Tab / Shift+Tab on list lines (bug scan 2026-10-27)', () => {
  it('Tab nests a bullet by its marker width', () => {
    const s = at('- milk\n- eggs', 10)
    expect(listIndentChange(s, 1)!.state.doc.toString()).toBe('- milk\n  - eggs')
  })
  it('Tab nests a numbered line by three', () => {
    const s = at('1. one\n2. two', 9)
    expect(listIndentChange(s, 1)!.state.doc.toString()).toBe('1. one\n   2. two')
  })
  it('Shift+Tab brings a nested line back, cursor kept with its text', () => {
    const s = at('- milk\n  - eggs', 14)
    const tr = listIndentChange(s, -1)!
    expect(tr.state.doc.toString()).toBe('- milk\n- eggs')
    expect(tr.state.selection.main.head).toBe(12)
  })
  it('works across several selected lines', () => {
    const s = at('- a\n- b\n- c', 4, 11)
    expect(listIndentChange(s, 1)!.state.doc.toString()).toBe('- a\n  - b\n  - c')
  })
  it('a checklist line counts as a list line', () => {
    expect(listIndentChange(at('- [ ] a\n- [ ] b', 10), 1)!.state.doc.toString()).toBe('- [ ] a\n  - [ ] b')
  })
  it('does nothing on plain text (the key is still kept in the note)', () => {
    expect(listIndentChange(at('Just a sentence', 3), 1)).toBeNull()
    expect(listIndentChange(at('Just a sentence', 3), -1)).toBeNull()
  })
  it('Shift+Tab on a line that is not nested changes nothing', () => {
    expect(listIndentChange(at('- milk', 3), -1)).toBeNull()
  })
})

describe('Enter on an empty list line ends the list, with a blank line after it', () => {
  // The blank line is the point: words straight under the last bullet are read by
  // Obsidian and GitHub as more of that bullet (Reuben, 2026-10-29).
  it('after a ONE-item list, one Enter leaves it', () => {
    const tr = exitEmptyItem(at('- one\n- ', 8))!
    expect(tr.state.doc.toString()).toBe('- one\n\n')
    expect(tr.state.selection.main.head).toBe(7)
  })
  it('after a longer list, the same', () => {
    const tr = exitEmptyItem(at('- milk\n- eggs\n- ', 16))!
    expect(tr.state.doc.toString()).toBe('- milk\n- eggs\n\n')
    expect(tr.state.selection.main.head).toBe(15)
  })
  it('typing on then starts its own paragraph', () => {
    const tr = exitEmptyItem(at('- milk\n- ', 9))!
    const typed = tr.state.update({ changes: { from: tr.state.selection.main.head, insert: 'A sentence' } }).state
    expect(typed.doc.toString()).toBe('- milk\n\nA sentence')
  })
  it('an empty checklist or numbered line too', () => {
    expect(exitEmptyItem(at('- [ ] a\n- [ ] ', 14))!.state.doc.toString()).toBe('- [ ] a\n\n')
    expect(exitEmptyItem(at('1. a\n2. ', 8))!.state.doc.toString()).toBe('1. a\n\n')
  })
  it('leaves a line with text, and a nested empty line, to the normal Enter', () => {
    expect(exitEmptyItem(at('- one', 5))).toBeNull()
    expect(exitEmptyItem(at('- one\n  - ', 10))).toBeNull()
  })
})
