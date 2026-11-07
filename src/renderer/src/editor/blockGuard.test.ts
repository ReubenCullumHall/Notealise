// No cursor on a block's line (blockGuard.ts — Reuben, 2026-11-07): which lines are blocks, and
// what Enter, Backspace and Delete do beside one.
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import type { EditorView } from '@codemirror/view'
import { backspace, del, embedTailStart, guardedBlocks, guardOf, wholeBlocks } from './blockGuard'

const V = '<audio controls src="a.m4a" data-name="Untitled 1"></audio>'
const make = (doc: string, cursor = 0): EditorState =>
  EditorState.create({ doc, selection: EditorSelection.single(cursor), extensions: [markdown({ extensions: [GFM] })] })
const view = (state: EditorState): EditorView & { state: EditorState } => {
  const v = {
    state,
    dispatch(spec: TransactionSpec) {
      v.state = v.state.update(spec).state
    }
  }
  return v as unknown as EditorView & { state: EditorState }
}

describe('which lines are blocks', () => {
  it('a line of only embeds — or embeds after words, the old `test<audio>` lines', () => {
    expect(embedTailStart(V)).toBe(0)
    expect(embedTailStart(V + V)).toBe(0)
    expect(embedTailStart('![a](p.png)')).toBe(0)
    expect(embedTailStart('test' + V)).toBe(4)
    expect(embedTailStart('a picture ![a](p.png) inside words')).toBeNull()
    expect(embedTailStart('just words')).toBeNull()
  })

  it('tables, and a voice note together with its transcript', () => {
    const doc = ['Hi', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', V, '<details data-transcript="a.m4a"><summary>Transcript</summary>', '', 'Words.', '', '</details>', 'End'].join('\n')
    const s = make(doc)
    const blocks = guardedBlocks(s).map((b) => s.sliceDoc(b.from, b.to).split('\n'))
    expect(blocks[0]).toEqual(['| a | b |', '| - | - |', '| 1 | 2 |'])
    expect(blocks[1][0]).toBe(V)
    expect(blocks[1][blocks[1].length - 1]).toBe('</details>')
  })

  it('the cursor may rest at the end of the line above and the start of the line below, nowhere between', () => {
    const doc = ['Above', V, 'Below'].join('\n')
    const s = make(doc)
    const g = guardOf(s.doc, guardedBlocks(s)[0])
    expect(s.sliceDoc(0, g.from)).toBe('Above')
    expect(s.sliceDoc(g.to)).toBe('Below')
  })

  it('an old `test<audio>` line stays typeable up to the end of its words', () => {
    const s = make('test' + V + '\nnext')
    const g = guardOf(s.doc, guardedBlocks(s)[0])
    expect(s.sliceDoc(0, g.from)).toBe('test')
  })
})

describe('Backspace and Delete beside a block', () => {
  it('Backspace on the blank line under a block removes just that line', () => {
    const doc = ['Text', V, '', 'After'].join('\n')
    const v = view(make(doc, doc.indexOf(V) + V.length + 1))
    backspace(v)
    expect(v.state.doc.toString()).toBe(['Text', V, 'After'].join('\n'))
  })

  it('Backspace at the start of words under a block picks the block — it never joins the words onto it', () => {
    const doc = ['Text', V, 'After'].join('\n')
    const v = view(make(doc, doc.indexOf('After')))
    backspace(v)
    expect(v.state.doc.toString()).toBe(doc)
    expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe(V)
  })

  it('Delete on the blank line over a block removes just that line', () => {
    const doc = ['Text', '', V].join('\n')
    const v = view(make(doc, 5))
    del(v)
    expect(v.state.doc.toString()).toBe(['Text', V].join('\n'))
  })
})

describe('a pointer selection takes a block whole', () => {
  const doc = `Words\n\n${V}\n\nMore`
  const vFrom = doc.indexOf('<audio')
  const vTo = vFrom + V.length
  it('a double-click on the voice note row picks the whole voice note, never its first letter', () => {
    const s = make(doc)
    expect(wholeBlocks(s, EditorSelection.single(vFrom, vFrom + 1))?.main).toMatchObject({ from: vFrom, to: vTo })
  })
  it('a drag that stops part-way into a block reaches its end, in the drag\'s direction', () => {
    const s = make(doc)
    const down = wholeBlocks(s, EditorSelection.single(2, vFrom + 5))!.main
    expect([down.anchor, down.head]).toEqual([2, vTo])
    const up = wholeBlocks(s, EditorSelection.single(doc.length, vTo - 3))!.main
    expect([up.anchor, up.head]).toEqual([doc.length, vFrom])
  })
  it('leaves alone a selection that already has it whole, or misses it', () => {
    const s = make(doc)
    expect(wholeBlocks(s, EditorSelection.single(vFrom, vTo))).toBeNull()
    expect(wholeBlocks(s, EditorSelection.single(0, doc.length))).toBeNull()
    expect(wholeBlocks(s, EditorSelection.single(0, 3))).toBeNull()
  })
})
