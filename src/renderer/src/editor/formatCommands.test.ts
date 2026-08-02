import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  codeBlock,
  horizontalRule,
  inlineCode,
  link,
  table,
  toggleBlock,
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

  it('inserts a table with the first header cell selected', () => {
    const { view, read } = harness('', 0)
    table(view)
    expect(read()).toBe('| «Column» | Column |\n| --- | --- |\n|  |  |')
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
