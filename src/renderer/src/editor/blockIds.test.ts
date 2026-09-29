import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { dropCopiedTags, findHeading, headingAnchor, linkTargets, stateForText, tagFor, targetAtLine } from './blockIds'

// Every case asks "what would someone linking to this note expect to be offered
// or to land on?" — the grip's menu and the `[[` picker both read these answers.

const NOTE = [
  '# Waves', //                       1
  '', //                              2
  'A wave carries', //                3
  'energy along. ^k3x9', //           4
  '', //                              5
  '- one', //                         6
  '- two', //                         7
  '  - nested', //                    8
  '', //                              9
  '> a quote', //                    10
  '', //                             11
  '## Interference', //              12
  'Where waves meet.' //             13
].join('\n')

describe('linkTargets', () => {
  it('lists headings and blocks in order, blocks under a heading marked as nested', () => {
    const t = linkTargets(stateForText(NOTE))
    expect(t.map((x) => [x.kind, x.label, x.line])).toEqual([
      ['heading', 'Waves', 1],
      ['block', 'A wave carries', 3],
      ['block', 'one', 6],
      ['block', 'two', 7],
      ['block', 'nested', 8],
      ['block', 'a quote', 10],
      ['heading', 'Interference', 12],
      ['block', 'Where waves meet.', 13]
    ])
    expect(t[1].nested).toBe(true)
    expect(t[0].level).toBe(1)
    expect(t[6].level).toBe(2)
  })
  it('knows a block that already has a tag, and where its tag is', () => {
    const para = linkTargets(stateForText(NOTE))[1]
    expect(para.id).toBe('k3x9')
    expect(para.tagLine).toBe(4)
  })
  it('a line that is only a tag is not a block of its own', () => {
    const t = linkTargets(stateForText('| a |\n| - |\n\n^tab1'))
    expect(t.map((x) => x.label)).not.toContain('^tab1')
  })
  it('a heading whose text would break the link is left out', () => {
    expect(linkTargets(stateForText('# A | B')).length).toBe(0)
  })
})

describe('awkward notes', () => {
  it('nothing in frontmatter is offered, even a paragraph-looking line', () => {
    const t = linkTargets(stateForText('---\ntitle: Waves\n\ntags: physics\n---\n\nBody text.'))
    expect(t.map((x) => x.label)).toEqual(['Body text.'])
  })
  it('a heading with formatting is offered by its words, linked by what is written', () => {
    const [h] = linkTargets(stateForText('## **Bold** idea'))
    expect(h.label).toBe('Bold idea')
    expect(h.heading).toBe('**Bold** idea')
  })
  it('an empty heading is not offered', () => {
    expect(linkTargets(stateForText('##\n\n## \n\ntext')).filter((t) => t.kind === 'heading')).toEqual([])
  })
  it('a paragraph inside a toggle list is still a block', () => {
    const t = linkTargets(stateForText('<details open><summary>Title</summary>\n\nInside.\n\n</details>'))
    expect(t.map((x) => x.label)).toContain('Inside.')
  })
  it('a task item is its own block', () => {
    expect(targetAtLine(stateForText('- [ ] buy milk\n- [x] done'), 2)?.label).toBe('done')
  })
  it('a maths box is not a block yet — a tag on its closing $$ would break it (stage 3)', () => {
    expect(linkTargets(stateForText('$$\nx ^ 2\n$$')).length).toBe(0)
  })
  it('a code block and a table are not blocks yet (stage 3)', () => {
    expect(linkTargets(stateForText('```\ncode\n```\n\n| a |\n| - |\n| 1 |'))).toEqual([])
  })
})

describe('two headings with the same words (Reuben, 2026-09-29)', () => {
  // His note: a big "testing" heading, a small "testing" heading right under it.
  const NOTE2 = ['# testing', '', '#### testing', '', 'testing the thing', '', '# Other', '', '## Notes', '', '## Notes'].join('\n')
  const all = linkTargets(stateForText(NOTE2))
  const heads = all.filter((t) => t.kind === 'heading')
  it('a link to the SMALL one names the one above it, and lands on the small one', () => {
    const small = heads[1]
    expect(headingAnchor(all, small)).toBe('testing#testing')
    expect(findHeading(all, 'testing#testing')?.line).toBe(3)
  })
  it('works when the heading comes from a separate reading of the note (the grip\u2019s)', () => {
    const fresh = targetAtLine(stateForText(NOTE2), 3)!
    expect(headingAnchor(all, fresh)).toBe('testing#testing')
  })
  it('a link to the big one stays plain, and lands on the big one', () => {
    expect(headingAnchor(all, heads[0])).toBe('testing')
    expect(findHeading(all, 'testing')?.line).toBe(1)
  })
  it('a heading nobody shares stays plain', () => {
    expect(headingAnchor(all, heads[2])).toBe('Other')
  })
  it('two with the same words under the same heading: the words alone (lands on the first, as in Obsidian)', () => {
    expect(headingAnchor(all, heads[4])).toBe('Notes')
  })
  it('a heading with a # in its own words is still found whole', () => {
    const t = linkTargets(stateForText('# Code\n\n## C# tips'))
    expect(findHeading(t, 'C# tips')?.line).toBe(3)
  })
  it('a path that goes nowhere finds nothing', () => {
    expect(findHeading(all, 'Other#testing')).toBeNull()
  })
})

describe('targetAtLine', () => {
  it('picks the list ITEM on that line, not the whole list', () => {
    const t = targetAtLine(stateForText(NOTE), 7)
    expect(t?.label).toBe('two')
  })
  it('any line of a paragraph links to the paragraph', () => {
    expect(targetAtLine(stateForText(NOTE), 4)?.line).toBe(3)
  })
  it('a blank line has nothing to link to', () => {
    expect(targetAtLine(stateForText(NOTE), 2)).toBeNull()
  })
})

describe('tagFor', () => {
  it('adds a tag to the end of the block’s LAST line', () => {
    const state = stateForText(NOTE)
    const target = targetAtLine(state, 7)!
    const { id, changes } = tagFor(state, target)
    const next = state.update({ changes: changes! }).state.doc
    expect(next.line(7).text).toBe('- two ^' + id)
    expect(id).toMatch(/^[a-z0-9]{6}$/)
  })
  it('reuses the tag a block already has, and changes nothing', () => {
    const state = stateForText(NOTE)
    expect(tagFor(state, targetAtLine(state, 3)!)).toEqual({ id: 'k3x9', changes: null })
  })
})

describe('dropCopiedTags', () => {
  const base = (doc: string): EditorState => EditorState.create({ doc, extensions: [dropCopiedTags] })
  it('a pasted COPY of a tagged block loses its tag — the original keeps it', () => {
    const s = base('Para ^k3x9\n\n')
    const next = s.update({ changes: { from: s.doc.length, insert: 'Para ^k3x9' }, userEvent: 'input.paste' }).state
    expect(next.doc.toString()).toBe('Para ^k3x9\n\nPara')
  })
  it('a MOVE keeps it — the block is still the only one with that tag', () => {
    const s = base('Para ^k3x9\n\nOther')
    const next = s.update({
      changes: [
        { from: 0, to: 12 },
        { from: s.doc.length, insert: '\n\nPara ^k3x9' }
      ],
      userEvent: 'input.drop'
    }).state
    expect(next.doc.toString()).toBe('Other\n\nPara ^k3x9')
  })
  it('typing is left alone', () => {
    const s = base('Para ^k3x9\n\n')
    const next = s.update({ changes: { from: s.doc.length, insert: 'x ^k3x9' }, userEvent: 'input.type' }).state
    expect(next.doc.toString()).toBe('Para ^k3x9\n\nx ^k3x9')
  })
})
