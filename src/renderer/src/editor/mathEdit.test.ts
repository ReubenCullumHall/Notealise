import { describe, expect, it } from 'vitest'
import { Compartment, EditorState, type Extension, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { insertInlineMath, insertMath } from './formatCommands'
import { closeMathEdit, mathEditField, mathEditOf, mathText } from './mathEdit'
import { rawView } from './rawView'

// The maths box's state half, against a real EditorState — the same stub-view
// harness as formatCommands.test.ts, with the box's field installed. The box
// itself (the text field, the Done button, the click that opens it) is DOM and
// was checked in a real build instead.

function harness(doc: string, from: number, to = from, extra: Extension[] = []) {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [mathEditField, ...extra] })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    focus: () => {}
  } as unknown as EditorView
  return { view, get state() { return state } }
}

describe('mathText', () => {
  it('writes each kind as ordinary Markdown maths', () => {
    expect(mathText('inline', 'x')).toBe('$x$')
    expect(mathText('display', 'x')).toBe('$$x$$')
    expect(mathText('fenced', 'a\nb')).toBe('$$\na\nb\n$$')
  })
  it('writes an empty inline formula as nothing, since `$$` would start a display block', () => {
    expect(mathText('inline', '')).toBe('')
  })
})

describe('the maths commands open the box', () => {
  it('LaTeX formula writes $$$$ and opens the box on it', () => {
    const h = harness('', 0)
    insertMath(h.view)
    expect(h.state.doc.toString()).toBe('$$$$')
    expect(mathEditOf(h.state)).toMatchObject({ from: 0, to: 4, latex: '', kind: 'display', alone: true, open: true })
    // the note's cursor waits past the formula, so nothing reveals the raw text
    expect(h.state.selection.main.head).toBe(4)
  })

  it('wraps a selection and knows whether the formula has the line to itself', () => {
    const h = harness('area is pi r^2 here', 8, 14)
    insertMath(h.view)
    expect(h.state.doc.toString()).toBe('area is $$pi r^2$$ here')
    expect(mathEditOf(h.state)).toMatchObject({ latex: 'pi r^2', kind: 'display', alone: false })
  })

  it('turns several selected lines on a line of their own into a fenced block', () => {
    const h = harness('a\nb', 0, 3)
    insertMath(h.view)
    expect(h.state.doc.toString()).toBe('$$\na\nb\n$$')
    expect(mathEditOf(h.state)).toMatchObject({ kind: 'fenced', latex: 'a\nb', from: 0, to: 9 })
  })

  it('Inline formula writes nothing until something is typed in the box', () => {
    const h = harness('so ', 3)
    insertInlineMath(h.view)
    expect(h.state.doc.toString()).toBe('so ')
    expect(mathEditOf(h.state)).toMatchObject({ from: 3, to: 3, latex: '', kind: 'inline', open: true })
  })

  it('in Markdown pro there is no box: the cursor lands between the $$ as before', () => {
    const h = harness('', 0, 0, [rawView.of(true)])
    insertMath(h.view)
    expect(h.state.doc.toString()).toBe('$$$$')
    expect(h.state.selection.main.head).toBe(2)
    expect(mathEditOf(h.state)).toBeNull()
  })
})

describe('the box lets go when something else moves', () => {
  it('moves with text edited elsewhere, and closes if the formula itself is edited from outside', () => {
    const h = harness('x ', 2)
    insertInlineMath(h.view)
    h.view.dispatch({ changes: { from: 0, to: 1, insert: 'yy' } })
    expect(mathEditOf(h.state)).toMatchObject({ open: true, from: 3, to: 3 })
    h.view.dispatch({ changes: { from: 3, insert: 'z' } })
    expect(mathEditOf(h.state)).toBeNull()
  })

  it('after Done the formula rests, drawn, until the cursor or the text next moves', () => {
    const h = harness('', 0)
    insertMath(h.view)
    const e = mathEditOf(h.state)!
    h.view.dispatch({ effects: closeMathEdit.of({ ...e, open: false }) })
    expect(mathEditOf(h.state)?.open).toBe(false)
    // a transaction that moves nothing (a focus change, say) leaves it resting
    h.view.dispatch({ effects: [] })
    expect(mathEditOf(h.state)?.open).toBe(false)
    h.view.dispatch({ selection: { anchor: 0 } })
    expect(mathEditOf(h.state)).toBeNull()
  })

  it('switching to Markdown pro closes the box', () => {
    const pro = new Compartment()
    const h = harness('', 0, 0, [pro.of([])])
    insertMath(h.view)
    expect(mathEditOf(h.state)?.open).toBe(true)
    h.view.dispatch({ effects: pro.reconfigure(rawView.of(true)) })
    expect(mathEditOf(h.state)).toBeNull()
  })
})
