import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { blockRange, canMoveBlock } from './blockMove'

// The same base the real editor uses (extensions.ts), because rule 2 asks the
// syntax tree what a fenced code block is. Without the language the tree is
// empty and every fence test would silently fall through to the paragraph rule
// and pass for the wrong reason.
const state = (doc: string, anchor: number, head = anchor): EditorState =>
  EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown({ base: markdownLanguage })]
  })

/** The text the grip would pick up, so an expectation reads as the lines a user
 *  would see move rather than as two offsets. */
const moved = (doc: string, anchor: number, head = anchor): string => {
  const s = state(doc, anchor, head)
  const r = blockRange(s)
  return s.doc.sliceString(r.from, r.to)
}

const NOTE = ['First paragraph line one', 'first paragraph line two', '', 'A lone second paragraph', ''].join(
  '\n'
)

describe('what the line grip picks up', () => {
  it('takes the whole paragraph when nothing is selected', () => {
    // The cursor is on line two, but a paragraph is the unit somebody means by
    // "this bit of writing" — moving one line of it would split a sentence.
    const at = NOTE.indexOf('first paragraph line two') + 3
    expect(moved(NOTE, at)).toBe('First paragraph line one\nfirst paragraph line two')
  })

  it('stops at the blank line either side, never crossing into the next paragraph', () => {
    const at = NOTE.indexOf('A lone second paragraph') + 2
    expect(moved(NOTE, at)).toBe('A lone second paragraph')
  })

  it('treats a blank line as a block of its own', () => {
    // So an empty line can be pushed around to open up space, rather than being
    // silently glued to whichever paragraph happens to be next to it.
    const at = NOTE.indexOf('\n\n') + 1
    expect(moved(NOTE, at)).toBe('')
  })

  it('lets a selection override the paragraph, which is the only way to move part of one', () => {
    const from = NOTE.indexOf('first paragraph line two')
    const to = from + 5
    expect(moved(NOTE, from, to)).toBe('first paragraph line two')
  })

  it('rounds a selection out to whole lines, however little of them is covered', () => {
    // Half of line one through half of line two still moves both lines whole —
    // a half-line is not something that can be re-inserted anywhere sensible.
    expect(moved(NOTE, 6, NOTE.indexOf('first paragraph line two') + 4)).toBe(
      'First paragraph line one\nfirst paragraph line two'
    )
  })

  it('takes a fenced code block WHOLE, blank lines inside it and all', () => {
    // The one case the paragraph rule cannot do: a fence may legally contain a
    // blank line, so walking outwards from the cursor stops halfway through the
    // code and lets you drag half of it away.
    const doc = ['Intro text', '', '```js', 'const a = 1', '', 'const b = 2', '```', '', 'After'].join('\n')
    const at = doc.indexOf('const b = 2') + 2
    expect(moved(doc, at)).toBe('```js\nconst a = 1\n\nconst b = 2\n```')
  })

  it('takes the fence whole from its opening line too', () => {
    const doc = ['```', 'code', '', 'more', '```', '', 'After'].join('\n')
    expect(moved(doc, 1)).toBe('```\ncode\n\nmore\n```')
  })

  it('takes a table whole, with no rule of its own', () => {
    // A Markdown table cannot contain a blank line, so the paragraph rule
    // already covers it. Asserted so that stays true if the rules are edited.
    const doc = ['Before', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'After'].join('\n')
    const at = doc.indexOf('| 1 | 2 |') + 2
    expect(moved(doc, at)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('takes a whole list, since a list has no blank lines between its items', () => {
    const doc = ['Heading', '', '- one', '- two', '- three', '', 'After'].join('\n')
    expect(moved(doc, doc.indexOf('- two') + 2)).toBe('- one\n- two\n- three')
  })

  it('returns whole-line offsets, never a partial line', () => {
    const s = state(NOTE, NOTE.indexOf('first paragraph line two') + 3)
    const r = blockRange(s)
    expect(s.doc.lineAt(r.from).from).toBe(r.from)
    expect(s.doc.lineAt(r.to).to).toBe(r.to)
  })

  it('offers no grip in a note with only one line', () => {
    // Nothing to reorder — a grip beside the only line there is would be a
    // control that cannot do anything.
    expect(canMoveBlock(state('Just the one line', 0))).toBe(false)
    expect(canMoveBlock(state('One\nTwo', 0))).toBe(true)
  })
})
