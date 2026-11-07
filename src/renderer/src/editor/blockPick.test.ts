// Picking several blocks (blockPick.ts — Reuben, 2026-11-07: "command/control + click should allow
// you to select multiple blocks not just one, like the sidebar"), and what copy, cut and delete
// then do with them.
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'
import { blockAt, blockGroup, extendPicked, isMultiPick, moveGroupSpec, pickedGroup, pickedText, removePicked, togglePicked } from './blockPick'

const V1 = '<audio controls src="a.m4a" data-name="Untitled 1"></audio>'
const V2 = '<audio controls src="b.m4a" data-name="Take 1"></audio>'
const DOC = ['Intro line', '', V1, '', V2, '', 'After the voice notes.', '', 'The end.'].join('\n')

const make = (doc = DOC, selection?: EditorSelection): EditorState =>
  EditorState.create({ doc, selection, extensions: [markdown(), EditorState.allowMultipleSelections.of(true)] })
const at = (s: EditorState, text: string): number => s.doc.toString().indexOf(text)
const stubView = (state: EditorState): EditorView & { state: EditorState } => {
  const v = {
    state,
    dispatch(spec: TransactionSpec) {
      v.state = v.state.update(spec).state
    }
  }
  return v as unknown as EditorView & { state: EditorState }
}

describe('picking blocks', () => {
  it('Cmd/Ctrl+click adds a block, a second one adds another, clicking a picked one takes it out', () => {
    let s = make()
    const b1 = blockAt(s, at(s, V1))
    const b2 = blockAt(s, at(s, 'After'))
    s = s.update({ selection: togglePicked(s, b1) }).state
    s = s.update({ selection: togglePicked(s, b2) }).state
    expect(s.selection.ranges.map((r) => s.sliceDoc(r.from, r.to))).toEqual([V1, 'After the voice notes.'])
    expect(isMultiPick(s)).toBe(true)
    s = s.update({ selection: togglePicked(s, b1) }).state
    expect(s.selection.ranges.map((r) => s.sliceDoc(r.from, r.to))).toEqual(['After the voice notes.'])
  })

  it('a block picked by its own dots and by the line’s dots is the same block', () => {
    let s = make()
    const from = at(s, V1)
    s = s.update({ selection: togglePicked(s, { from, to: from + V1.length }) }).state
    const line = s.doc.lineAt(from)
    s = s.update({ selection: togglePicked(s, { from: line.from, to: line.to }) }).state
    expect(s.selection.ranges.every((r) => r.empty)).toBe(true)
  })

  it('a plain cursor is replaced, not kept, when the first block is picked', () => {
    let s = make(DOC, EditorSelection.single(2))
    s = s.update({ selection: togglePicked(s, blockAt(s, at(s, V2))) }).state
    expect(s.selection.ranges.length).toBe(1)
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toBe(V2)
  })

  it('Shift+click picks every line from the first picked block down to this one', () => {
    let s = make()
    s = s.update({ selection: togglePicked(s, blockAt(s, at(s, V1))) }).state
    s = s.update({ selection: extendPicked(s, blockAt(s, at(s, 'After'))) }).state
    expect(s.sliceDoc(s.selection.main.from, s.selection.main.to)).toBe([V1, '', V2, '', 'After the voice notes.'].join('\n'))
  })

  it('a text selection is not a pick — CodeMirror keeps its own copy and delete', () => {
    const s = make(DOC, EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(at(make(), 'The'), at(make(), 'The') + 3)]))
    expect(isMultiPick(s)).toBe(false)
  })
})

describe('copy, cut and delete of picked blocks', () => {
  const picked = (): EditorState => {
    let s = make()
    for (const t of [V1, V2, 'The end.']) s = s.update({ selection: togglePicked(s, blockAt(s, at(s, t))) }).state
    return s
  }

  it('copy holds each block with a blank line between, so a voice note stays a voice note when pasted', () => {
    expect(pickedText(picked())).toBe([V1, '', V2, '', 'The end.'].join('\n'))
  })

  it('delete takes the blocks out whole, closing the gaps they leave', () => {
    const v = stubView(picked())
    removePicked(v)
    expect(v.state.doc.toString()).toBe(['Intro line', '', 'After the voice notes.'].join('\n'))
    expect(v.state.selection.main.empty).toBe(true)
  })

  it('two picked blocks that end the note go together, gap and all', () => {
    let s = make()
    for (const t of ['After', 'The end.']) s = s.update({ selection: togglePicked(s, blockAt(s, at(s, t))) }).state
    const v = stubView(s)
    removePicked(v)
    expect(v.state.doc.toString()).toBe(['Intro line', '', V1, '', V2].join('\n'))
  })

  it('a note that ended with a line break still does', () => {
    let s = make(DOC + '\n')
    s = s.update({ selection: togglePicked(s, blockAt(s, at(s, 'The end.'))) }).state
    s = s.update({ selection: togglePicked(s, blockAt(s, at(s, V1))) }).state
    const v = stubView(s)
    removePicked(v)
    expect(v.state.doc.toString()).toBe(['Intro line', '', V2, '', 'After the voice notes.', ''].join('\n'))
  })

  it('one change: one undo puts them all back', () => {
    const before = picked()
    let count = 0
    const v = {
      state: before,
      dispatch(spec: TransactionSpec) {
        count++
        v.state = v.state.update(spec).state
      }
    }
    removePicked(v as unknown as EditorView)
    expect(count).toBe(1)
  })
})

describe('dragging picked blocks together', () => {
  const pick = (doc: string, texts: string[]): EditorState => {
    let s = make(doc)
    for (const t of texts) s = s.update({ selection: togglePicked(s, blockAt(s, at(s, t))) }).state
    return s
  }
  const drop = (s: EditorState, grab: string, before: string | 'end'): EditorState => {
    const g = blockAt(s, at(s, grab))
    const group = pickedGroup(s, g)
    expect(group).not.toBeNull()
    const pos = before === 'end' ? s.doc.length : s.doc.lineAt(at(s, before)).from
    const spec = moveGroupSpec(s, group!, pos)
    expect(spec).not.toBeNull()
    return s.update({ changes: spec!.changes, selection: spec!.selection }).state
  }

  it('two picked voice notes dropped under the paragraph both move, a blank line apart, still picked', () => {
    const s = drop(pick(DOC, [V1, V2]), V2, 'The end.')
    expect(s.doc.toString()).toBe(['Intro line', '', 'After the voice notes.', '', V1, '', V2, '', 'The end.'].join('\n'))
    expect(s.selection.ranges.map((r) => s.sliceDoc(r.from, r.to))).toEqual([V1, V2])
  })

  it('dropped at the very end of the note', () => {
    const s = drop(pick(DOC, [V1, 'Intro line']), V1, 'end')
    expect(s.doc.toString()).toBe(['After the voice notes.', '', 'The end.', '', 'Intro line', '', V1, ''].join('\n').replace(/^/, V2 + '\n\n'))
  })

  it('dropped at the top', () => {
    const s = drop(pick(DOC, [V2, 'The end.']), V2, 'Intro line')
    expect(s.doc.toString()).toBe([V2, '', 'The end.', '', 'Intro line', '', V1, '', 'After the voice notes.'].join('\n'))
  })

  it('dropped back on one of their own places: not a move', () => {
    const s = pick(DOC, [V1, V2])
    const group = pickedGroup(s, blockAt(s, at(s, V1)))!
    expect(moveGroupSpec(s, group, s.doc.lineAt(at(s, V2)).from)).toBeNull()
  })

  it('a block that is not one of the picked ones moves alone', () => {
    const s = pick(DOC, [V1, V2])
    expect(pickedGroup(s, blockAt(s, at(s, 'The end.')))).toBeNull()
  })
})

describe('moving one block keeps the note’s spacing (a 100-drag check, 2026-11-07)', () => {
  const moveOne = (doc: string, grab: string, before: string | 'end'): string => {
    const s = make(doc)
    const line = s.doc.lineAt(at(s, grab))
    const b = blockAt(s, line.from)
    const pos = before === 'end' ? s.doc.length : s.doc.lineAt(at(s, before)).from
    const spec = moveGroupSpec(s, blockGroup(s, [{ from: s.doc.lineAt(b.from).from, to: s.doc.lineAt(b.to).to }]), pos)
    return spec ? s.update({ changes: spec.changes }).state.doc.toString() : doc
  }
  const P = ['Para A', '', 'Para B', '', 'Para C', ''].join('\n')

  it('a paragraph moved to the top stays its own paragraph — no merging, no leftover gap', () => {
    expect(moveOne(P, 'Para C', 'Para A')).toBe(['Para C', '', 'Para A', '', 'Para B', ''].join('\n'))
  })

  it('a voice note dropped under a table keeps a blank line, so the table can’t swallow it', () => {
    const doc = ['| a | b |', '| - | - |', '| 1 | 2 |', '', 'Words', '', V1, ''].join('\n')
    expect(moveOne(doc, V1, 'Words')).toBe(['| a | b |', '| - | - |', '| 1 | 2 |', '', V1, '', 'Words', ''].join('\n'))
  })

  it('a list item moves tight, and the list stays one list', () => {
    const doc = ['- one', '- two', '- three', ''].join('\n')
    expect(moveOne(doc, '- three', '- one')).toBe(['- three', '- one', '- two', ''].join('\n'))
  })

  it('twenty moves later the note has no doubled gaps and nothing run together', () => {
    let doc = DOC + '\n'
    const names = ['Intro line', V1, V2, 'After the voice notes.', 'The end.']
    for (let i = 0; i < 20; i++) {
      const grab = names[i % names.length]
      const dest = names[(i * 3 + 2) % names.length]
      if (grab !== dest) doc = moveOne(doc, grab, dest)
    }
    expect(doc).not.toMatch(/\n\n\n/)
    for (const n of names) expect(doc.split(n).length).toBe(2)
    const lines = doc.split('\n')
    for (let i = 1; i < lines.length; i++) expect(lines[i] !== '' && lines[i - 1] !== '').toBe(false)
  })
})

describe('dropping blocks into another note (a split view)', () => {
  const from = make()
  const group = blockGroup(from, [
    { from: from.doc.lineAt(at(from, V1)).from, to: from.doc.lineAt(at(from, V1)).to },
    { from: from.doc.lineAt(at(from, V2)).from, to: from.doc.lineAt(at(from, V2)).to }
  ])
  const land = (doc: string, pos: (s: EditorState) => number): string => {
    const into = make(doc)
    const spec = moveGroupSpec(into, group, pos(into), true)!
    return into.update({ changes: spec.changes, selection: spec.selection }).state.doc.toString()
  }
  it('land set apart between two paragraphs, never welded to them', () => {
    expect(land('One\n\nTwo', (s) => s.doc.line(3).from)).toBe(`One\n\n${V1}\n\n${V2}\n\nTwo`)
  })
  it('land on a line of their own at the end of a note', () => {
    expect(land('One', (s) => s.doc.length)).toBe(`One\n\n${V1}\n\n${V2}\n`)
  })
  it('never leave a doubled blank line', () => {
    for (const doc of ['One\n\nTwo\n', 'One\nTwo', '\n\nOne\n\n\nTwo']) {
      const into = make(doc)
      for (let n = 1; n <= into.doc.lines; n++) expect(land(doc, (s) => s.doc.line(n).from)).not.toContain('\n\n\n\n')
    }
  })
})
