import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { blockRange, canMoveBlock, dropLead, fileDropSpot } from './blockMove'
import { parsed } from './parsedState'

// The same base the real editor uses (extensions.ts), because rule 2 asks the
// syntax tree what a fenced code block is. Without the language the tree is
// empty and every fence test would silently fall through to the paragraph rule
// and pass for the wrong reason.
const state = (doc: string, anchor: number, head = anchor): EditorState =>
  parsed(
    EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [markdown({ base: markdownLanguage })]
    })
  )

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
  it('takes just the line when nothing is selected', () => {
    // Every line its own handle (Reuben, 2026-11-06: "for ALL blocks there
    // should be this"): a run of lines is no longer one paragraph to the grip.
    const at = NOTE.indexOf('first paragraph line two') + 3
    expect(moved(NOTE, at)).toBe('first paragraph line two')
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

  it('takes a table whole', () => {
    const doc = ['Before', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'After'].join('\n')
    const at = doc.indexOf('| 1 | 2 |') + 2
    expect(moved(doc, at)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('takes one list item, with the items nested under it', () => {
    const doc = ['Heading', '', '- one', '- two', '  - two a', '  - two b', '- three', '', 'After'].join('\n')
    expect(moved(doc, doc.indexOf('- two') + 2)).toBe('- two\n  - two a\n  - two b')
    expect(moved(doc, doc.indexOf('- two a') + 4)).toBe('  - two a')
    expect(moved(doc, doc.indexOf('- three') + 2)).toBe('- three')
  })

  it('takes a quote, a formula and the properties at the top whole', () => {
    const doc = ['---', 'type: status', 'tags: x', '---', 'Text', '> quoted one', '> quoted two', '', '$$', 'x^2', '$$', 'After'].join('\n')
    expect(moved(doc, doc.indexOf('tags') + 1)).toBe('---\ntype: status\ntags: x\n---')
    expect(moved(doc, doc.indexOf('quoted two') + 1)).toBe('> quoted one\n> quoted two')
    expect(moved(doc, doc.indexOf('x^2'))).toBe('$$\nx^2\n$$')
    expect(moved(doc, doc.indexOf('Text') + 1)).toBe('Text')
    expect(moved(doc, doc.indexOf('After') + 1)).toBe('After')
  })

  it('takes a link on its own line as just that line', () => {
    const doc = ['Before it', '[Explain it · 0:13](memo.m4a#t=13)', 'After it'].join('\n')
    expect(moved(doc, doc.indexOf('Explain') + 2)).toBe('[Explain it · 0:13](memo.m4a#t=13)')
  })

  it('returns whole-line offsets, never a partial line', () => {
    const s = state(NOTE, NOTE.indexOf('first paragraph line two') + 3)
    const r = blockRange(s)
    expect(s.doc.lineAt(r.from).from).toBe(r.from)
    expect(s.doc.lineAt(r.to).to).toBe(r.to)
  })

  it('offers a grip in any note with something in it', () => {
    // A one-line note still wants the grip's click (select) and right-click
    // (copy a link); only an empty note has nothing to offer it for.
    expect(canMoveBlock(state('', 0))).toBe(false)
    expect(canMoveBlock(state('Just the one line', 0))).toBe(true)
  })
})

describe('the line grip follows the pointer (a line other than the cursor\'s)', () => {
  const doc = ['First', '', 'Second line one', 'second line two', '', '```', 'code', '', 'more code', '```', '', 'Last'].join('\n')
  const at = (needle: string): number => doc.indexOf(needle) + 1
  const hovered = (pos: number, anchor = 0, head = anchor): string => {
    const s = state(doc, anchor, head)
    const r = blockRange(s, pos)
    return s.doc.sliceString(r.from, r.to)
  }

  it('picks up the line under the pointer, whatever the cursor is doing', () => {
    expect(hovered(at('second line two'))).toBe('second line two')
    expect(hovered(at('Last'))).toBe('Last')
  })

  it('takes a blank line as its own block, and a code block whole', () => {
    expect(hovered(doc.indexOf('\n\n') + 1)).toBe('')
    expect(hovered(at('more code'))).toBe('```\ncode\n\nmore code\n```')
  })

  it('lets a selection win when the pointer is on one of its lines, and not otherwise', () => {
    const from = doc.indexOf('Second')
    const to = doc.indexOf('two') + 3
    // pointer on a selected line → the selection
    expect(hovered(at('second line two'), from, to)).toBe('Second line one\nsecond line two')
    // pointer on another line → that line, the selection is left alone
    expect(hovered(at('Last'), from, to)).toBe('Last')
  })

  it('without a pointer position it is the cursor\'s line, as before', () => {
    const s = state(doc, doc.indexOf('Last') + 2)
    const r = blockRange(s)
    expect(s.doc.sliceString(r.from, r.to)).toBe('Last')
  })
})

describe('a voice note, photo or video on its own line is a block of its own', () => {
  // They go into a note on the line straight under the text, with no blank line
  // (voiceRecModel.ts ownLineInsert, attachInput.ts), so the paragraph walk must
  // not glue them to it (Reuben, 2026-10-16: dragging a paragraph took the voice
  // note under it too).
  const doc = [
    'testing around other things that might make noise',
    '<audio controls src="memo.m4a" data-name="Lecture 3"></audio>',
    'A line written straight after it',
    '![](board.png)',
    'and one more',
    '<video controls src="clip.mp4"></video>'
  ].join('\n')
  const at = (needle: string): number => doc.indexOf(needle) + 1
  const hovered = (pos: number): string => {
    const s = state(doc, 0)
    const r = blockRange(s, pos)
    return s.doc.sliceString(r.from, r.to)
  }

  it('grabbing the text takes only the text, not the voice note under it', () => {
    expect(hovered(at('testing around'))).toBe('testing around other things that might make noise')
    expect(hovered(at('A line written'))).toBe('A line written straight after it')
    expect(hovered(at('and one more'))).toBe('and one more')
  })

  it('grabbing the voice note, the photo or the video takes only that line', () => {
    expect(hovered(at('<audio'))).toBe('<audio controls src="memo.m4a" data-name="Lecture 3"></audio>')
    expect(hovered(at('![]'))).toBe('![](board.png)')
    expect(hovered(at('<video'))).toBe('<video controls src="clip.mp4"></video>')
  })

  it('a picture inside a sentence is still part of its paragraph', () => {
    const d = 'Look at this ![](a.png) here\nand the next line'
    const s = state(d, 0)
    const r = blockRange(s, 2)
    expect(s.doc.sliceString(r.from, r.to)).toBe('Look at this ![](a.png) here')
  })
})

describe('a file dropped into a note lands on a new line under the block, never inside it', () => {
  // What the note reads as after an embed lands at the spot — the way a user would see it.
  const dropAt = (doc: string, word: string, offset = 2, selected?: [number, number]): string => {
    const s = state(doc, selected?.[0] ?? 0, selected?.[1])
    const spot = fileDropSpot(s, doc.indexOf(word) + offset)
    // added in the same change, before the embed
    return doc.slice(0, spot.at) + dropLead(spot) + '![](pic.png)\n' + doc.slice(spot.at)
  }

  it('mid-word in a line: under that line, the word untouched, what was below pushed down', () => {
    expect(dropAt('# Title\nSome words here\nNext line\n', 'words')).toBe('# Title\nSome words here\n![](pic.png)\nNext line\n')
  })

  it('on the last line with no newline after it: one is added first', () => {
    expect(dropAt('# Title\nThe end', 'end')).toBe('# Title\nThe end\n![](pic.png)\n')
  })

  it('on an empty line: lands there, above the empty line', () => {
    expect(dropAt('One\n\nTwo\n', '\nTwo', 0)).toBe('One\n![](pic.png)\n\nTwo\n')
  })

  it('inside a table: under the whole table, never between its rows', () => {
    // (A line straight after a table with no gap IS a row of it, so the gap is part of the note.)
    const doc = 'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n'
    // …with an empty line between: straight under a table it would become a row of it.
    expect(dropAt(doc, '| 1')).toBe('Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n![](pic.png)\n\nAfter\n')
  })

  it('on the empty line under a table, quote or list: an empty line first, so it stays apart', () => {
    expect(dropAt('| a |\n| --- |\n| 1 |\n\nAfter\n', '\nAfter', 0)).toBe('| a |\n| --- |\n| 1 |\n\n![](pic.png)\n\nAfter\n')
    expect(dropAt('> quoted\nNext\n', 'quoted')).toBe('> quoted\nNext\n\n![](pic.png)\n')
    expect(dropAt('- one\n- two\n\nAfter\n', 'two')).toBe('- one\n- two\n\n![](pic.png)\n\nAfter\n')
  })

  it('under an ordinary line: straight under it, no empty line (the way a voice note is added)', () => {
    expect(dropAt('One\nTwo\n', 'One')).toBe('One\n![](pic.png)\nTwo\n')
  })

  it('inside a code block: under the closing fence', () => {
    const doc = 'Intro\n```\ncode\n\nmore\n```\nAfter\n'
    expect(dropAt(doc, 'code')).toBe('Intro\n```\ncode\n\nmore\n```\n![](pic.png)\nAfter\n')
  })

  it('a selection elsewhere does not widen it (the drop names its own place)', () => {
    const doc = 'One\nTwo\nThree\n'
    expect(dropAt(doc, 'One', 1, [0, 13])).toBe('One\n![](pic.png)\nTwo\nThree\n')
  })

  it('on a picture already in the note: under that picture', () => {
    expect(dropAt('Text\n![](a.png)\nMore\n', 'a.png')).toBe('Text\n![](a.png)\n![](pic.png)\nMore\n')
  })

  it('names where the block it goes under starts — the band drawn over it — and none on an empty line', () => {
    const doc = 'Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter\n'
    const s = state(doc, 0)
    expect(fileDropSpot(s, doc.indexOf('| 1')).block).toBe(doc.indexOf('| a'))
    expect(fileDropSpot(s, doc.indexOf('\nAfter')).block).toBe(null)
    const para = 'One\nTwo\n\nThree'
    expect(fileDropSpot(state(para, 0), para.indexOf('Three') + 2).block).toBe(para.indexOf('Three'))
  })
})
