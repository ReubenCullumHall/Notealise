import { describe, expect, it } from 'vitest'
import { blockIdOf, blockLabel, blockLineOf, headingShown, indexBlocks, indexHeadings, newBlockId, tagOf } from './blocks'
import { countWords } from './plainText'

describe('blockIdOf', () => {
  it('reads the id out of a block link, and nothing out of a heading link', () => {
    expect(blockIdOf('^k3x9')).toBe('k3x9')
    expect(blockIdOf('Interference')).toBeNull()
    expect(blockIdOf(null)).toBeNull()
    // Obsidian's characters only — anything else is a heading that starts with ^
    expect(blockIdOf('^not an id')).toBeNull()
    expect(blockIdOf('^2')).toBeNull()
  })
})

describe('tagOf', () => {
  it('finds a tag ending a line, with the space in front of it', () => {
    expect(tagOf('A wave carries energy. ^k3x9')).toEqual({ id: 'k3x9', start: 22, own: false })
  })
  it('hides only the ONE space before the ^, so a space typed at the line end stays yours', () => {
    expect(tagOf('A wave.  ^k3x9')).toEqual({ id: 'k3x9', start: 8, own: false })
  })
  it('finds a tag that is the whole line', () => {
    expect(tagOf('^k3x9')).toEqual({ id: 'k3x9', start: 0, own: true })
  })
  it('needs a space before the ^, so maths and superscripts are left alone', () => {
    expect(tagOf('x^2')).toBeNull()
    expect(tagOf('e = mc^2')).toBeNull()
  })
  it('a short or all-digit ^ at a line end is writing, not a tag ("E = mc ^2")', () => {
    expect(tagOf('E = mc ^2')).toBeNull()
    expect(tagOf('see note ^12')).toBeNull()
    expect(tagOf('see note ^123')).toBeNull()
    expect(tagOf('x ^ab')).toBeNull()
    expect(tagOf('x ^abc')).toEqual({ id: 'abc', start: 1, own: false })
  })
  it('only at the END of a line — a ^ word mid-sentence is prose', () => {
    expect(tagOf('see ^k3x9 for more')).toBeNull()
  })
})

describe('newBlockId', () => {
  it('never hands out an id the note already uses', () => {
    let n = 0
    // a "random" source that repeats the first id once before moving on
    const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    const id = newBlockId(['aaaaaa'], () => seq[n++ % seq.length])
    expect(id).not.toBe('aaaaaa')
    expect(id).toMatch(/^[a-z0-9]{6}$/)
  })
})

describe('blockLabel', () => {
  it('shows the words a reader sees, not the marks', () => {
    expect(blockLabel('- **Bold** point about [[Waves]] ^k3x9')).toBe('Bold point about Waves')
  })
  it('calls a picture on its own a picture', () => {
    expect(blockLabel('![](beach.png) ^k3x9')).toBe('Picture')
  })
  it('clips a long block so a link stays one line', () => {
    const label = blockLabel('word '.repeat(40))
    expect(label.length).toBeLessThanOrEqual(48)
    expect(label.endsWith('…')).toBe(true)
  })
})

describe('indexBlocks', () => {
  it('lands on the FIRST line of a paragraph whose tag is on its last', () => {
    const text = ['# Waves', '', 'A wave carries', 'energy along. ^k3x9', '', 'Next.'].join('\n')
    expect(indexBlocks(text)).toEqual([{ id: 'k3x9', line: 3, label: 'A wave carries' }])
  })
  it('a list item is its own block, not the whole list', () => {
    const text = ['- one', '- two ^b22', '- three'].join('\n')
    expect(indexBlocks(text)).toEqual([{ id: 'b22', line: 2, label: 'two' }])
  })
  it('a tag on its own line names the table above it', () => {
    const text = ['| a | b |', '| - | - |', '| 1 | 2 |', '', '^tab1'].join('\n')
    expect(indexBlocks(text)).toEqual([{ id: 'tab1', line: 1, label: 'Table' }])
  })
  it('…and the code block or maths box above it', () => {
    const code = ['```js', 'let a = 1 ^xyz', '```', '', '^code1'].join('\n')
    expect(indexBlocks(code)).toEqual([{ id: 'code1', line: 1, label: 'Code block' }])
    const maths = ['$$', 'a ^bcd', '$$', '', '^maths1'].join('\n')
    expect(indexBlocks(maths)).toEqual([{ id: 'maths1', line: 1, label: 'Formula' }])
  })
  it('never reads a tag out of code or maths — `a ^b` is LaTeX there', () => {
    expect(indexBlocks(['```', 'text ^nope', '```'].join('\n'))).toEqual([])
    expect(indexBlocks(['$$', 'x ^nope', '$$'].join('\n'))).toEqual([])
  })
})

describe('awkward notes', () => {
  it('a note written on Windows (CRLF line ends) still has its tags found', () => {
    expect(indexBlocks('# Waves\r\n\r\nA wave. ^k3x9\r\n')).toEqual([{ id: 'k3x9', line: 3, label: 'A wave.' }])
  })
  it('never reads a tag out of frontmatter', () => {
    expect(indexBlocks('---\ntitle: x ^nope\n---\n\nText ^real')).toEqual([{ id: 'real', line: 5, label: 'Text' }])
  })
  it('the word count ignores a tag on a CRLF line too', () => {
    expect(countWords('A wave carries energy. ^k3x9\r\nNext line')).toBe(6)
  })
  it('"mc ^2" is still counted — it is somebody\u2019s maths, not a tag', () => {
    expect(countWords('E equals mc ^2')).toBe(4)
  })
})

describe('headings in the index', () => {
  it('lists every heading, not the ones in code or frontmatter', () => {
    expect(indexHeadings('---\ntitle: x\n---\n# A\n\n```\n# not one\n```\n## B\r\n')).toEqual(['A', 'B'])
  })
  it('a heading path shows just the heading it lands on', () => {
    expect(headingShown('testing#testing', ['testing', 'testing'])).toBe('testing')
  })
  it('a heading with a # in its own words shows whole', () => {
    expect(headingShown('C# tips', ['C# tips'])).toBe('C# tips')
  })
  it('without the note\u2019s headings, it shows what is written', () => {
    expect(headingShown('a#b', undefined)).toBe('a#b')
  })
})

describe('blockLineOf', () => {
  it('finds the block a link points at, whatever case the link was typed in', () => {
    expect(blockLineOf('a\n\nb ^K3x9', 'k3x9')).toBe(3)
  })
  it('says so when the block has gone', () => {
    expect(blockLineOf('a\n\nb', 'k3x9')).toBeNull()
  })
})

describe('word count', () => {
  it('does not count the hidden tag — a reader never sees it', () => {
    expect(countWords('A wave carries energy. ^k3x9')).toBe(4)
  })
})
