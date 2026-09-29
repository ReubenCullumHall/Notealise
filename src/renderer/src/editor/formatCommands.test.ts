import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  bold,
  codeBlock,
  horizontalRule,
  inlineCode,
  italic,
  link,
  strike,
  table,
  toggleBlock,
  underline,
  wikiLink
} from './formatCommands'

// The commands themselves, driven against a real EditorState. CodeMirror's state
// is pure — only EditorView needs a DOM — so a stub view with the two members
// these commands touch exercises the actual document and selection arithmetic,
// which is where the bugs live (an off-by-one leaves the cursor inside a marker).

function harness(doc: string, from: number, to = from): { view: EditorView; read: () => string } {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to } })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    focus: () => {}
  }
  // `read` marks the selection inline: | for a cursor, «…» for a range.
  const read = (): string => {
    const { from: f, to: t } = state.selection.main
    const s = state.doc.toString()
    return f === t ? s.slice(0, f) + '|' + s.slice(f) : s.slice(0, f) + '«' + s.slice(f, t) + '»' + s.slice(t)
  }
  return { view: view as unknown as EditorView, read }
}

describe('block commands', () => {
  it('adds a heading and keeps the cursor on the same word', () => {
    const { view, read } = harness('hello', 2)
    toggleBlock(view, 'h1')
    expect(read()).toBe('# he|llo')
  })

  it('toggles the heading back off', () => {
    const { view, read } = harness('# hello', 4)
    toggleBlock(view, 'h1')
    expect(read()).toBe('he|llo')
  })

  it('never drags the cursor in front of its own line', () => {
    // cursor at the very start of "- one": removing the marker would put it at
    // -2 without the clamp
    const { view, read } = harness('- one', 0)
    toggleBlock(view, 'bullet')
    expect(read()).toBe('|one')
  })

  it('applies across a multi-line selection and keeps it selected', () => {
    const { view, read } = harness('one\ntwo\nthree', 0, 13)
    toggleBlock(view, 'bullet')
    expect(read()).toBe('«- one\n- two\n- three»')
  })

  it('quotes only the lines the selection touches', () => {
    const { view, read } = harness('one\ntwo\nthree', 5, 5)
    toggleBlock(view, 'quote')
    expect(read()).toBe('one\n> t|wo\nthree')
  })
})

describe('insert commands', () => {
  it('inserts a link and selects the placeholder label', () => {
    const { view, read } = harness('', 0)
    link(view)
    expect(read()).toBe('[«text»](url)')
  })

  it('keeps a selection as the label and lands on the url instead', () => {
    const { view, read } = harness('Anthropic', 0, 9)
    link(view)
    expect(read()).toBe('[Anthropic](«url»)')
  })

  it('opens an empty code block with the cursor between the fences', () => {
    const { view, read } = harness('', 0)
    codeBlock(view)
    expect(read()).toBe('```\n|\n```')
  })

  it('wraps a selection in a code block', () => {
    const { view, read } = harness('let x = 1', 0, 9)
    codeBlock(view)
    expect(read()).toBe('```\n«let x = 1»\n```')
  })

  it('breaks out of a line rather than inserting a block mid-sentence', () => {
    // a divider has to own its line at both ends, so the rest of the line moves
    // down rather than ending up on the `---`
    const { view, read } = harness('some text', 4)
    horizontalRule(view)
    expect(read()).toBe('some\n---|\n text')
  })

  it('inserts an EMPTY 2×2 — a header row and one body row', () => {
    // Changed 2026-08-07, when tables became something you click into rather
    // than raw text you edit. Two things this now asserts, and both are the
    // point rather than an implementation detail:
    //
    //   • The cells are empty, not "Column | Column". Placeholder words made
    //     sense while you were typing over visible source; in a rendered grid
    //     they are text you have to select and delete before you can start.
    //   • Nothing is selected. There is no cursor inside a table any more — the
    //     block renders as a widget and a cell opens on click — so leaving a
    //     selection here would put one in a place the user cannot see it.
    //
    // "2×2" is a header plus one body row because Markdown has no table without
    // a header row. Verified against the real @lezer/markdown parser: an
    // all-empty table still parses as a Table (an empty cell produces no
    // TableCell node at all, so it was worth checking the block survives).
    const { view, read } = harness('', 0)
    table(view)
    // The cursor (shown as `|` by the harness) ends up past a BLANK line, two
    // breaks below the table. Both matter:
    //   • not at the end of the last row — that position is inside the block the
    //     widget replaces, so it is invisible;
    //   • not on the line directly under it either, because GFM parses a
    //     non-blank line there as another ROW of the table (verified against the
    //     real parser), so the first word typed would have joined the table.
    expect(read()).toBe('|     |     |\n| --- | --- |\n|     |     |\n\n|')
  })

  it('wraps inline code around the selection', () => {
    const { view, read } = harness('npm run dev', 0, 11)
    inlineCode(view)
    expect(read()).toBe('`«npm run dev»`')
  })

  it('opens empty brackets with the cursor inside, ready for the note picker', () => {
    const { view, read } = harness('', 0)
    wikiLink(view)
    expect(read()).toBe('[[|]]')
  })

  it('makes a selection the link target, leaving the cursor where a title is corrected', () => {
    const { view, read } = harness('Waves', 0, 5)
    wikiLink(view)
    expect(read()).toBe('[[Waves|]]')
  })
})

describe('set vs toggle', () => {
  // The one real semantic difference between the format bar and the "/" menu.
  // Pressing a button a second time is a retraction; typing a command's name is
  // not — so "/h1" on a line that is already a heading must leave a heading.
  it('toggles off when a button asks twice, because that is what a pressed-again button means', () => {
    const { view, read } = harness('# hello', 4)
    toggleBlock(view, 'h1', 'toggle')
    expect(read()).toBe('he|llo')
  })

  it('leaves the heading in place when the command was invoked by name', () => {
    const { view, read } = harness('# hello', 4)
    toggleBlock(view, 'h1', 'set')
    expect(read()).toBe('# he|llo')
  })

  it('replaces a different marker in both modes', () => {
    // Neither gesture means "remove": you asked for an h2 on something that is
    // an h1, and both should give you an h2.
    for (const mode of ['toggle', 'set'] as const) {
      const { view, read } = harness('# hello', 4)
      toggleBlock(view, 'h2', mode)
      expect(read()).toBe('## he|llo')
    }
  })
})

// Bold/italic/strike/underline/code over a selection that does NOT exactly match
// an existing span — the case that used to wrap it twice and show raw marks
// (Reuben, 2026-09-25). Word-processor rule: all selected text already styled →
// take it off; otherwise → put it on all of it. Needs the real markdown parser,
// because the spans already there are found in its syntax tree.
describe('style toggles over a mismatched selection', () => {
  function md(doc: string, sel: string): { view: EditorView; read: () => string } {
    const at = doc.indexOf(sel)
    let state = EditorState.create({
      doc,
      selection: { anchor: at, head: at + sel.length },
      extensions: [markdown({ base: markdownLanguage })]
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
    const read = (): string => {
      const { from: f, to: t } = state.selection.main
      const s = state.doc.toString()
      return s.slice(0, f) + '«' + s.slice(f, t) + '»' + s.slice(t)
    }
    return { view: view as unknown as EditorView, read }
  }

  it('underlines the extra space too, then a second click takes it off everything', () => {
    // What a drag over "styled words " selects: the hidden </u> comes with it.
    const { view, read } = md('Plain <u>styled words</u> here', 'styled words</u> ')
    underline(view)
    expect(read()).toBe('Plain <u>«styled words »</u>here')
    underline(view)
    expect(read()).toBe('Plain «styled words »here')
  })

  it('bold plus one more letter: bolds all of it, then unbolds all of it', () => {
    const { view, read } = md('Plain **styled words** here', 'styled words** h')
    bold(view)
    expect(read()).toBe('Plain **«styled words h»**ere')
    bold(view)
    expect(read()).toBe('Plain «styled words h»ere')
  })

  it('bold plus a trailing space unbolds straight away — a space cannot be bold in Markdown', () => {
    // `**words **` does not parse, so the space can never carry bold; counting it
    // would make the button bold-forever and never able to take it off.
    const { view, read } = md('Plain **styled words** here', 'styled words** ')
    bold(view)
    expect(read()).toBe('Plain «styled words »here')
  })

  it('a plain word plus the start of a styled span styles the lot as ONE span', () => {
    for (const [cmd, o, c] of [
      [bold, '**', '**'],
      [italic, '*', '*'],
      [strike, '~~', '~~'],
      [underline, '<u>', '</u>'],
      [inlineCode, '`', '`']
    ] as const) {
      const { view, read } = md(`Plain ${o}styled words${c} here`, `Plain ${o}styled`)
      cmd(view)
      expect(read()).toBe(`${o}«Plain styled» words${c} here`)
      cmd(view)
      // The space before "words" was styled and wasn't selected, so it stays
      // styled — except for * ** ~~, where a span can't start on a space.
      const flanked = o !== '<u>' && o !== '`'
      expect(read()).toBe(flanked ? `«Plain styled» ${o}words${c} here` : `«Plain styled»${o} words${c} here`)
    }
  })

  it('un-styling part of a span leaves the rest styled, with no mark left on a space', () => {
    const b = md('Plain **styled words** here', 'words')
    bold(b.view)
    expect(b.read()).toBe('Plain **styled** «words» here')
    const u = md('Plain <u>styled words</u> here', 'words')
    underline(u.view)
    expect(u.read()).toBe('Plain <u>styled </u>«words» here')
  })

  it('joins two spans into one when the selection bridges them', () => {
    const { view, read } = md('**one** and **two**', 'one** and **two')
    bold(view)
    expect(read()).toBe('**«one and two»**')
  })

  it('un-bolding a word then bolding it again gives back ONE span, not two', () => {
    const { view, read } = md('Plain **styled words** here', 'words')
    bold(view)
    expect(read()).toBe('Plain **styled** «words» here')
    bold(view)
    expect(read()).toBe('Plain **styled «words»** here')
  })

  it('never puts a style over a list marker on a later line', () => {
    const { view, read } = md('- one\n- two', 'one\n- two')
    bold(view)
    expect(read()).toBe('- **«one**\n- **two»**')
  })

  it('does nothing when only a space is selected for bold', () => {
    const { view, read } = md('a b', ' ')
    bold(view)
    expect(read()).toBe('a« »b')
  })
})
