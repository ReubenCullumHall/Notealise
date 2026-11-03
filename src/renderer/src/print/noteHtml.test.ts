import { describe, expect, it } from 'vitest'
import { AWKWARD_NAMES } from '../../../shared/awkwardNames'
import { cleanNoteText, noteBodyHtml, startsWithTitle, wikiLinkLabel } from './noteHtml'

describe('wikiLinkLabel', () => {
  it('reads like the editor: label, else note, else note › heading', () => {
    expect(wikiLinkLabel('Waves')).toBe('Waves')
    expect(wikiLinkLabel('Physics/Waves|the waves note')).toBe('the waves note')
    expect(wikiLinkLabel('Physics/Waves.md')).toBe('Waves')
    expect(wikiLinkLabel('Waves#Energy')).toBe('Waves › Energy')
    expect(wikiLinkLabel('Waves#^k3x9')).toBe('Waves')
  })
})

describe('cleanNoteText', () => {
  it('drops frontmatter and block tags, keeps code as written', () => {
    const t = '---\ntags: [a]\n---\nA wave carries energy. ^k3x9\n\n| a | b |\n\n^tbl123\n\n```\nx ^abc123\n```\nE = mc ^2\n'
    expect(cleanNoteText(t)).toBe('A wave carries energy.\n\n| a | b |\n\n\n```\nx ^abc123\n```\nE = mc ^2\n')
  })
  it('leaves $$ boxes alone', () => {
    expect(cleanNoteText('$$\nx ^abc123\n$$\n')).toBe('$$\nx ^abc123\n$$\n')
  })
})

describe('noteBodyHtml', () => {
  it('turns note links into plain words and never leaves [[ ]]', () => {
    const h = noteBodyHtml('See [[Physics/Waves#Energy]] and [[Waves|w]].')
    expect(h).toContain('Waves › Energy')
    expect(h).toContain('>w<')
    expect(h).not.toContain('[[')
  })
  it('draws maths, inline and boxed, but not prices or code', () => {
    const h = noteBodyHtml('Inline $x^2$ and a price of $5 or $6, `$a$`.\n\n$$\n\\frac{a}{b}\n$$\n')
    expect(h.match(/<math/g)?.length).toBe(2)
    expect(h).toContain('$5 or $6')
    expect(h).toContain('<code>$a$</code>')
  })
  it('keeps single line breaks, tasks, tables and toggles', () => {
    const h = noteBodyHtml('one\ntwo\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<details open><summary>T</summary>\n\nbody\n\n</details>\n')
    expect(h).toContain('one<br>two')
    expect(h).toContain('type="checkbox"')
    expect(h).toContain('<table>')
    expect(h).toContain('<details open><summary>T</summary>')
  })
  it('passes colour tags through for the DOM half', () => {
    expect(noteBodyHtml('a <mark class="hl-amber">b</mark> c')).toContain('<mark class="hl-amber">b</mark>')
  })
})

describe('startsWithTitle', () => {
  it('sees a first heading that is the note name, after frontmatter', () => {
    expect(startsWithTitle('---\ntags: [a]\n---\n\n# Waves\ntext', 'Waves')).toBe(true)
    expect(startsWithTitle('# waves ##\n', 'Waves')).toBe(true)
  })
  it('does not when the note opens with anything else', () => {
    expect(startsWithTitle('Intro\n# Waves', 'Waves')).toBe(false)
    expect(startsWithTitle('# Waves and more', 'Waves')).toBe(false)
    expect(startsWithTitle('', 'Waves')).toBe(false)
  })
})

describe('awkward note names', () => {
  it('a heading that says the name is found, whatever the name holds', () => {
    for (const name of AWKWARD_NAMES) {
      expect(startsWithTitle(`# ${name}\ntext`, name)).toBe(true)
      // and the name in a heading is text, never links or maths
      const h = noteBodyHtml(`# ${name}\n`)
      expect(h).not.toContain('<math')
    }
  })
})
