import { describe, expect, it } from 'vitest'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { colorEditing } from './colorCommands'
import { rawViewOf } from './rawView'

// The two behaviours that keep concealed colour tags editable, driven against a
// real EditorState. CodeMirror's state is pure — only EditorView needs a DOM —
// so this exercises the genuine syntax tree and the genuine transaction filter,
// which is the whole point: both features are built on `colorPairs`, and a tree
// that pairs the tags differently from what the tests assume would be invisible.
//
// Written after trying to verify these through the live app first: a synthetic
// Backspace either deleted the entire document or did nothing at all, on a note
// with no colour in it, so the readings said nothing about the code either way.
// The instrument has to be trusted before its numbers are (CLAUDE.md).

const OPEN = '<mark class="hl-rose">'
const CLOSE = '</mark>'

function harness(doc: string, at: number): { view: EditorView; doc: () => string; sel: () => number } {
  let state = EditorState.create({
    doc,
    selection: { anchor: at },
    // `markdown()` is not optional here — without a language there is no syntax
    // tree, `colorPairs` finds no HTMLTag nodes, and every test below passes by
    // doing nothing.
    extensions: [markdown(), colorEditing]
  })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    focus: () => {}
  }
  return { view: view as unknown as EditorView, doc: () => state.doc.toString(), sel: () => state.selection.main.head }
}

/** Run whatever `colorEditing`'s keymap binds to `key`, reading the binding out
 *  of the real `keymap` facet rather than re-declaring it here — so a binding
 *  that gets renamed or dropped fails these tests instead of passing them. */
function press(view: EditorView, key: 'Backspace' | 'Delete'): boolean {
  for (const set of view.state.facet(keymap)) {
    for (const b of set) {
      if (b.key === key && b.run?.(view)) return true
    }
  }
  return false
}

describe('Backspace / Delete at a colour tag edge', () => {
  it('takes the colour off instead of eating the opening tag', () => {
    const doc = `Keep ${OPEN}colour${CLOSE} end`
    const h = harness(doc, 5 + OPEN.length) // cursor just after the open tag
    expect(press(h.view, 'Backspace')).toBe(true)
    expect(h.doc()).toBe('Keep colour end')
    expect(h.sel()).toBe(5)
  })

  it('does the same from the far edge, after the closing tag', () => {
    const doc = `Keep ${OPEN}colour${CLOSE} end`
    const h = harness(doc, doc.indexOf(CLOSE) + CLOSE.length)
    expect(press(h.view, 'Backspace')).toBe(true)
    expect(h.doc()).toBe('Keep colour end')
  })

  it('never leaves an orphan half of the pair', () => {
    const doc = `Keep ${OPEN}colour${CLOSE} end`
    const h = harness(doc, 5 + OPEN.length)
    press(h.view, 'Backspace')
    expect(h.doc()).not.toContain('<mark')
    expect(h.doc()).not.toContain('</mark>')
  })

  it('Delete works forwards, from just before a tag', () => {
    const doc = `Keep ${OPEN}colour${CLOSE} end`
    const h = harness(doc, 5) // cursor immediately before the open tag
    expect(press(h.view, 'Delete')).toBe(true)
    expect(h.doc()).toBe('Keep colour end')
  })

  it('declines anywhere else, so ordinary deletion is untouched', () => {
    const doc = `Keep ${OPEN}colour${CLOSE} end`
    // in the middle of the coloured word — nothing to do with a tag edge
    const h = harness(doc, 5 + OPEN.length + 3)
    expect(press(h.view, 'Backspace')).toBe(false)
    expect(h.doc()).toBe(doc)
  })

  it('declines when there is a selection, so deleting a range is normal', () => {
    const doc = `Keep ${OPEN}colour${CLOSE} end`
    let state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 4 },
      extensions: [markdown(), colorEditing]
    })
    const view = { get state() { return state }, dispatch: () => {}, focus: () => {} } as unknown as EditorView
    expect(press(view, 'Backspace')).toBe(false)
  })

  it('declines on a plain note with no colour at all', () => {
    const h = harness('abcdef', 6)
    expect(press(h.view, 'Backspace')).toBe(false)
    expect(h.doc()).toBe('abcdef')
  })
})

describe('mending a pair an edit broke', () => {
  const build = (doc: string, raw = false): EditorState =>
    EditorState.create({ doc, extensions: [markdown(), colorEditing, rawViewOf(raw)] })

  // Reuben's report, 2026-08-29: selecting a highlighted word PLUS the space
  // after it and pressing Backspace took the close tag with it, and the orphaned
  // open tag showed as raw HTML. Including the space in FRONT was fine, because
  // that selection covers both tags — the asymmetry is the tell.
  it('drops the whole pair when the selection swallows the close tag and all the content', () => {
    const doc = `Keep ${OPEN}word${CLOSE} end`
    const from = 5 + OPEN.length
    // "word</mark> " — the word, its close tag, and the space after it
    const next = build(doc).update({ changes: { from, to: doc.indexOf(CLOSE) + CLOSE.length + 1 } }).state
    expect(next.doc.toString()).toBe('Keep end')
    expect(next.doc.toString()).not.toContain('<mark')
  })

  it('keeps the colour on whatever survived, re-closing the pair', () => {
    // delete "bc end" — the close tag goes, but "a" was highlighted and stays so
    const doc = `Keep ${OPEN}abc${CLOSE} end`
    const from = 5 + OPEN.length + 1
    const next = build(doc).update({ changes: { from, to: doc.length } }).state
    expect(next.doc.toString()).toBe(`Keep ${OPEN}a${CLOSE}`)
  })

  it('does the same when the OPEN tag is the one deleted', () => {
    // delete "Keep <mark…>ab" — the open tag goes, "c" survives and stays coloured
    const doc = `Keep ${OPEN}abc${CLOSE} end`
    const next = build(doc).update({ changes: { from: 0, to: 5 + OPEN.length + 2 } }).state
    expect(next.doc.toString()).toBe(`${OPEN}c${CLOSE} end`)
  })

  it('never leaves an unmatched tag behind, whichever half was eaten', () => {
    const doc = `Keep ${OPEN}abc${CLOSE} end`
    for (const [from, to] of [[5 + OPEN.length, doc.length], [0, 5 + OPEN.length + 2], [6, doc.length - 2]]) {
      const out = build(doc).update({ changes: { from, to } }).state.doc.toString()
      const opens = (out.match(/<mark/g) ?? []).length
      const closes = (out.match(/<\/mark>/g) ?? []).length
      expect(opens).toBe(closes)
    }
  })

  it('leaves a stray tag the file already had — that is broken markup to show, not to mend', () => {
    // no complete pair existed before the edit, so there is nothing to repair
    const doc = `Keep ${OPEN}orphan and more`
    const next = build(doc).update({ changes: { from: doc.length, insert: '!' } }).state
    expect(next.doc.toString()).toBe(doc + '!')
  })

  it('does nothing at all in Markdown pro, where the tags are visible and yours', () => {
    const doc = `Keep ${OPEN}word${CLOSE} end`
    const from = 5 + OPEN.length
    const next = build(doc, true)
      .update({ changes: { from, to: doc.indexOf(CLOSE) + CLOSE.length + 1 } })
      .state
    // the open tag stays exactly as the edit left it — no mending behind your back
    expect(next.doc.toString()).toBe(`Keep ${OPEN}end`)
  })

  it('removes a pair left holding nothing', () => {
    // delete the four characters of "gone" and the tags should go with them
    const doc = `Keep ${OPEN}gone${CLOSE} end`
    const from = 5 + OPEN.length
    const next = build(doc).update({ changes: { from, to: from + 4 } }).state
    expect(next.doc.toString()).toBe('Keep  end')
  })

  it('leaves a pair that still has content', () => {
    const doc = `Keep ${OPEN}gone${CLOSE} end`
    const from = 5 + OPEN.length
    const next = build(doc).update({ changes: { from, to: from + 1 } }).state
    expect(next.doc.toString()).toContain('<mark class="hl-rose">one</mark>')
  })

  it('sweeps a text-colour span too, not just a highlight', () => {
    const O = '<span class="tc-sky">'
    const doc = `Keep ${O}gone</span> end`
    const from = 5 + O.length
    const next = build(doc).update({ changes: { from, to: from + 4 } }).state
    expect(next.doc.toString()).toBe('Keep  end')
  })

  it('does not touch a document nothing changed in', () => {
    const doc = `Keep ${OPEN}${CLOSE} end`
    const st = build(doc)
    // a selection-only transaction must not rewrite the file
    expect(st.update({ selection: { anchor: 1 } }).state.doc.toString()).toBe(doc)
  })

  // Typing at a tag's own boundary — the case every test above misses, because
  // they all DELETE. Reuben, 2026-09-06: colour a word, leave the cursor at its
  // right-hand edge, press space, and a raw `</span>` appeared. The mend was
  // mapping each tag so it WIDENED over anything inserted at its edge, so the
  // slice no longer equalled the tag text, the tag read as deleted, and a
  // duplicate was inserted. See the assoc comment in colorCommands.ts.
  it('typing at the right-hand edge of the content does not duplicate the close tag', () => {
    const doc = `Keep ${OPEN}yyy${CLOSE} end`
    const at = doc.indexOf(CLOSE)
    const next = build(doc).update({ changes: { from: at, insert: ' ' } }).state
    expect(next.doc.toString()).toBe(`Keep ${OPEN}yyy ${CLOSE} end`)
  })

  it('typing at the left-hand edge does not duplicate the open tag', () => {
    const doc = `Keep ${OPEN}yyy${CLOSE} end`
    const next = build(doc)
      .update({ changes: { from: 5 + OPEN.length, insert: 'X' } })
      .state
    expect(next.doc.toString()).toBe(`Keep ${OPEN}Xyyy${CLOSE} end`)
  })

  // The same mapping, read the other way: replacing ALL the content is not the
  // same as emptying the pair, so the colour stays on what you typed over it.
  it('typing over the whole content keeps the colour rather than sweeping the pair', () => {
    const doc = `Keep ${OPEN}yyy${CLOSE} end`
    const from = 5 + OPEN.length
    const next = build(doc).update({ changes: { from, to: from + 3, insert: 'zz' } }).state
    expect(next.doc.toString()).toBe(`Keep ${OPEN}zz${CLOSE} end`)
  })

  it('leaves ordinary text completely alone', () => {
    const next = build('just words').update({ changes: { from: 4, to: 5 } }).state
    expect(next.doc.toString()).toBe('justwords')
  })
})
