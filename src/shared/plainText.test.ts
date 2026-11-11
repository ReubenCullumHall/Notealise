import { describe, expect, it } from 'vitest'
import { countWords, notePreview, PREVIEW_BYTES, PREVIEW_CHARS, toPlainText, toPreviewLine } from './plainText'

// Every case here is "what would a person reading the rendered note count?", not
// "what does the current implementation return" — see CLAUDE.md on tests that
// canonise the behaviour instead of the intent.

describe('countWords', () => {
  it('counts a colour tag as nothing — the bug this was written for', () => {
    // Reported 2026-08-29. The raw string is 4 whitespace-separated tokens; a
    // reader sees three words.
    expect(countWords('A <mark class="hl-rose">word</mark> B')).toBe(3)
    expect(countWords('A <span class="tc-sky">word</span> B')).toBe(3)
    // and the legacy inline-style form old notes still carry
    expect(countWords('A <span style="color:#d0574a">word</span> B')).toBe(3)
  })

  it('does not count heading, quote or list marks', () => {
    expect(countWords('# One two')).toBe(2)
    expect(countWords('###### One two')).toBe(2)
    expect(countWords('> One two')).toBe(2)
    expect(countWords('- One two')).toBe(2)
    expect(countWords('1. One two')).toBe(2)
    expect(countWords('- [ ] One two')).toBe(2)
    expect(countWords('- [x] One two')).toBe(2)
  })

  it('counts emphasised text once, not once per marker', () => {
    expect(countWords('**bold** *italic* ~~struck~~ `code`')).toBe(4)
  })

  it('counts a link by its label, never its URL', () => {
    expect(countWords('See [the docs](https://example.com/a/very/long/path) now')).toBe(4)
    expect(countWords('See [[Optics]] now')).toBe(3)
    // a piped wiki link shows the label, so that is what counts
    expect(countWords('See [[Optics|the notes]] now')).toBe(4)
    // …and a heading link shows the target when there is no label
    expect(countWords('See [[Optics#Lenses]] now')).toBe(3)
  })

  it('counts an image as nothing — a picture is not words', () => {
    expect(countWords('Before ![a long descriptive alt text](pic.png) after')).toBe(2)
  })

  it('counts maths as nothing rather than counting LaTeX tokens', () => {
    expect(countWords('Recall $e^{i\\pi} + 1 = 0$ exactly')).toBe(2)
    expect(countWords('Before\n\n$$\n\\int_0^1 x^2 dx\n$$\n\nafter')).toBe(2)
  })

  it('keeps fenced code CONTENT but drops the fence and its language tag', () => {
    // The code you wrote is content; ``` and `ts` are not. Three words —
    // `const`, `a`, `1` — because a bare operator carries no letter or digit
    // and is punctuation by the same rule that drops a stranded comma below.
    expect(countWords('```ts\nconst a = 1\n```')).toBe(3)
  })

  it('drops table pipes and the separator row, keeps the cells', () => {
    // Where, What, left, a, column — the pipes and the `---` row score nothing.
    const table = '| Where | What |\n| --- | --- |\n| left | a column |'
    expect(countWords(table)).toBe(5)
  })

  it('drops frontmatter, which is metadata rather than prose', () => {
    expect(countWords('---\ntitle: Some Note\ntags: a, b\n---\n\nReal words here')).toBe(3)
  })

  it('drops a horizontal rule without mistaking it for a list', () => {
    expect(countWords('One\n\n---\n\ntwo')).toBe(2)
    expect(countWords('One\n\n***\n\ntwo')).toBe(2)
  })

  it('counts an escaped marker as the character it stands for', () => {
    // "\*not italic\*" reads as *not italic* — two words, and the asterisks are
    // punctuation attached to them, not separate tokens.
    expect(countWords('\\*not italic\\*')).toBe(2)
  })

  it('does not count punctuation stranded by a stripped tag', () => {
    // "now</span>," strips to "now ," — the comma must not score as a word.
    // Reuben's own line, 2026-08-29, which reported 8 words for 7.
    expect(countWords('be <mark class="hl-sage">try and</mark> <span class="tc-amber">now</span>, **bold** and `code`.')).toBe(7)
    expect(countWords('a <mark class="hl-rose">b</mark>; c')).toBe(3)
  })

  it('still counts an accented or non-Latin word', () => {
    expect(countWords('café Ångström 東京')).toBe(3)
  })

  it('is 0 for an empty or syntax-only document', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('---\ntitle: x\n---\n')).toBe(0)
    expect(countWords('# \n\n> \n\n- \n')).toBe(0)
  })
})

describe('toPlainText', () => {
  it('keeps line structure so a preview can collapse it and a count need not', () => {
    expect(toPlainText('# Title\n\nBody text').split('\n').length).toBeGreaterThan(1)
  })

  it('leaves ordinary prose completely alone', () => {
    const prose = 'A sentence with no markdown in it at all.'
    expect(toPlainText(prose)).toBe(prose)
  })
})

describe('toPreviewLine', () => {
  it('collapses to one clipped line', () => {
    expect(toPreviewLine('# Title\n\nBody   text\nmore', 90)).toBe('Title Body text more')
  })
  it('closes the gap a stripped tag leaves before punctuation', () => {
    // Reuben's line read "be try and now , bold and code." in the sidebar.
    expect(toPreviewLine('be <mark class="hl-sage">try and</mark> <span class="tc-amber">now</span>, **bold**.', 90))
      .toBe('be try and now, bold.')
  })

  it('clips to the limit', () => {
    expect(toPreviewLine('word '.repeat(100), 20)).toHaveLength(20)
  })
})

describe('notePreview — the sidebar line the window works out after its own save', () => {
  /** The long way round: the WHOLE note as bytes, cut to the first PREVIEW_BYTES, decoded,
   *  then made into a line — which is what main does with the file (vault.ts `readPreview`;
   *  src/main/notePreview.test.ts checks this against main's own walk of real files). */
  const asMainReadsIt = (text: string): string | undefined =>
    toPreviewLine(new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, PREVIEW_BYTES)), PREVIEW_CHARS) || undefined

  it('is the opening words, with the markdown taken out', () => {
    expect(notePreview('# Cells\n\nThe **cell** is the [[Unit of life]].')).toBe('Cells The cell is the Unit of life.')
  })

  it('is nothing at all for an empty note, so the row says "Empty note"', () => {
    expect(notePreview('')).toBeUndefined()
    expect(notePreview('\n\n   \n')).toBeUndefined()
    expect(notePreview('---\n')).toBeUndefined()
  })

  it('never runs past the length of the line', () => {
    expect(notePreview('word '.repeat(400))!.length).toBeLessThanOrEqual(PREVIEW_CHARS)
  })

  it('is the line the first 400 bytes of the file give, for every kind of text', () => {
    const texts = [
      '# Typical\n\n## Section 1\n\nThe quick brown fox jumps over the lazy dog.',
      'short',
      'word '.repeat(400),
      // Korean: three bytes a character, so the 400-byte cut falls a third of the way in
      '세포는 생명의 기본 단위이다. '.repeat(40),
      // a cut in the middle of a character, close enough to the start to show
      'é'.repeat(250),
      // emoji (four bytes, two JavaScript characters each)
      '📓 notes '.repeat(80),
      // a head that is mostly markup, so the 400 bytes hold fewer than 90 characters of words
      '<mark class="hl-amber">a</mark> '.repeat(30) + 'the words after the colour',
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n' + 'after the table '.repeat(40),
      // exactly on the boundary, and one either side of it
      'x'.repeat(PREVIEW_BYTES - 1),
      'x'.repeat(PREVIEW_BYTES),
      'x'.repeat(PREVIEW_BYTES + 1),
      ''
    ]
    for (const text of texts) expect(notePreview(text), JSON.stringify(text.slice(0, 40))).toBe(asMainReadsIt(text))
  })
})
