import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { markEditing } from './markEditing'
import { rawViewOf } from './rawView'
import { bold, italic, underline } from './formatCommands'

// markEditing keeps hidden bold/italic/strike/code/<u> marks whole, against a
// real EditorState (same harness shape as colorCommands.test.ts). Every case
// here was first seen leaking raw marks in the live preview on 2026-09-25.
// `markdownLanguage` (GFM) because ~~strike~~ only parses with it — the app's
// own extensions.ts uses it too.

function harness(doc: string, at: number, head = at, raw = false) {
  let state = EditorState.create({
    doc,
    selection: { anchor: at, head },
    extensions: [markdown({ base: markdownLanguage }), markEditing, rawViewOf(raw)]
  })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    focus: () => {}
  } as unknown as EditorView
  /** Type at the selection, as a keystroke would: one transaction per char. */
  const type = (text: string): void => {
    for (const ch of text) {
      const s = state.selection.main
      state = state.update({
        changes: { from: s.from, to: s.to, insert: ch },
        selection: { anchor: s.from + 1 },
        userEvent: 'input.type'
      }).state
    }
  }
  /** Backspace as the keymap runs it: our binding first, else a plain delete. */
  const backspace = (): void => {
    if (press(view, 'Backspace')) return
    const s = state.selection.main
    state = state.update({
      changes: { from: s.head - 1, to: s.head },
      selection: { anchor: s.head - 1 },
      userEvent: 'delete.backward'
    }).state
  }
  const del = (): void => {
    const s = state.selection.main
    state = state.update({ changes: { from: s.from, to: s.to }, userEvent: 'delete' }).state
  }
  return { view, type, del, backspace, doc: () => state.doc.toString(), sel: () => state.selection.main.head }
}

function press(view: EditorView, key: 'Backspace' | 'Delete'): boolean {
  for (const set of view.state.facet(keymap)) {
    for (const b of set) if (b.key === key && b.run?.(view)) return true
  }
  return false
}

const STYLES: [string, string, string][] = [
  ['bold', '**', '**'],
  ['italic', '*', '*'],
  ['strike', '~~', '~~'],
  ['code', '`', '`'],
  ['underline', '<u>', '</u>'],
  ['superscript', '<sup>', '</sup>'],
  ['highlight', '<mark>', '</mark>']
]

describe.each(STYLES)('%s', (_name, open, close) => {
  const doc = `Plain ${open}two words${close} here`
  const openTo = 6 + open.length
  const closeFrom = openTo + 'two words'.length
  const closeTo = closeFrom + close.length

  it('Backspace just after the hidden close mark takes the style off whole', () => {
    const h = harness(doc, closeTo)
    expect(press(h.view, 'Backspace')).toBe(true)
    expect(h.doc()).toBe('Plain two words here')
    expect(h.sel()).toBe(6 + 'two words'.length) // still at the end of the words
  })

  it('Backspace at the start of the words takes the style off whole', () => {
    const h = harness(doc, openTo)
    expect(press(h.view, 'Backspace')).toBe(true)
    expect(h.doc()).toBe('Plain two words here')
    expect(h.sel()).toBe(6)
  })

  it('Backspace INSIDE the words is an ordinary Backspace', () => {
    const h = harness(doc, closeFrom)
    expect(press(h.view, 'Backspace')).toBe(false)
  })

  it('deleting the words plus the close mark does not strand the open mark', () => {
    const h = harness(doc, openTo + 4, closeTo + 1) // "words" + close + space
    h.del()
    // `**two **` would not parse as bold, so for * ** ~~ the mark goes back
    // INSIDE the space; code and HTML tags don't mind a space before the close.
    const flanked = ['**', '*', '~~'].includes(open)
    expect(h.doc()).toBe(flanked ? `Plain ${open}two${close} here` : `Plain ${open}two ${close}here`)
  })

  it('deleting all the words drops both marks', () => {
    const h = harness(doc, openTo, closeFrom)
    h.del()
    expect(h.doc()).toBe('Plain  here')
  })

  it('Markdown pro leaves the marks alone — they are on screen there', () => {
    const h = harness(doc, closeTo, closeTo, true)
    expect(press(h.view, 'Backspace')).toBe(false)
    const h2 = harness(doc, openTo + 4, closeTo + 1, true)
    h2.del()
    expect(h2.doc()).toBe(`Plain ${open}two here`)
  })
})

describe('a space at the inside edge of bold/italic/strike', () => {
  it('moves outside, so the span still closes — and the next letter pulls it back in', () => {
    const h = harness('A **bold** b', 8) // end of "bold", inside the close
    h.type(' ')
    expect(h.doc()).toBe('A **bold**  b')
    // "bold words" typed in bold stays ONE bold span (the 2026-09-25 fix: the
    // first version ended the bold at every space you typed).
    h.type('xy')
    expect(h.doc()).toBe('A **bold xy** b')
  })

  it('a space typed then Backspaced leaves you still typing in bold', () => {
    const h = harness('A **bold** b', 8)
    h.type(' ')
    h.backspace()
    expect(h.doc()).toBe('A **bold** b')
    h.type('s')
    expect(h.doc()).toBe('A **bolds** b')
  })

  it('Backspace after that deletes a letter, it does not strip the bold', () => {
    const h = harness('A **bold** b', 8)
    h.type(' ')
    h.backspace()
    h.backspace()
    expect(h.doc()).toBe('A **bol** b')
  })

  it('left behind by deleting the last word is also moved out', () => {
    const h = harness('A **two words** b', 8, 13) // select "words"
    h.del()
    expect(h.doc()).toBe('A **two**  b')
  })

  it('does not apply to code or <u>, where a space inside is fine', () => {
    const h = harness('A `code` b', 7)
    h.type(' ')
    expect(h.doc()).toBe('A `code ` b')
    const u = harness('A <u>under</u> b', 10)
    u.type(' ')
    expect(u.doc()).toBe('A <u>under </u> b')
  })
})

describe('typing formatting by hand is left exactly as typed', () => {
  it.each(['**bold** after', '*it* after', '~~gone~~ after', '`code` after', '<u>under</u> after', '**two words** after'])(
    '%s',
    (text) => {
      const h = harness('', 0)
      h.type(text)
      expect(h.doc()).toBe(text)
    }
  )
})

describe('a style shortcut with nothing selected', () => {
  // Reuben, 2026-09-25: Bold with no selection used to write `****` into the
  // note, on screen until you typed. Now it writes nothing until you type.
  it('writes nothing until you type, then the typing comes out bold — spaces and all', () => {
    const h = harness('Say ', 4)
    bold(h.view)
    expect(h.doc()).toBe('Say ')
    h.type('hello world')
    expect(h.doc()).toBe('Say **hello world**')
  })

  it('pressing it again after typing ends the style there', () => {
    const h = harness('Say ', 4)
    bold(h.view)
    h.type('hi')
    bold(h.view)
    h.type(' x')
    expect(h.doc()).toBe('Say **hi** x')
  })

  it('pressing it twice before typing cancels it', () => {
    const h = harness('Say ', 4)
    bold(h.view)
    bold(h.view)
    h.type('a')
    expect(h.doc()).toBe('Say a')
  })

  it('two styles at once nest', () => {
    const h = harness('Say ', 4)
    bold(h.view)
    italic(h.view)
    h.type('a')
    expect(h.doc()).toBe('Say ***a***')
  })

  it('underline keeps the spaces inside, as a word processor would', () => {
    const h = harness('Say ', 4)
    underline(h.view)
    h.type('a b')
    expect(h.doc()).toBe('Say <u>a b</u>')
  })

  it('in the middle of bold text, switches bold off for what you type next', () => {
    const h = harness('A **bold** b', 6) // between "bo" and "ld"
    bold(h.view)
    h.type('X')
    expect(h.doc()).toBe('A **bo**X**ld** b')
  })

  it('Markdown pro keeps the old behaviour — the marks are yours to see there', () => {
    const h = harness('Say ', 4, 4, true)
    bold(h.view)
    expect(h.doc()).toBe('Say ****')
  })
})
