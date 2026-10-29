// Editor bugs from the 2026-10-27 scan that pure code can check.
import { describe, expect, it } from 'vitest'
import { EditorState, Text } from '@codemirror/state'
import { scanMath } from './mathPass'
import { fencedMathBlocks } from './blockMath'
import { insideTag } from './searchHidden'

const maths = (s: string): string[] => {
  const out: string[] = []
  scanMath(s, 0, (_f, _t, latex) => out.push(latex))
  return out
}

describe('prices are not maths', () => {
  it.each(['Tickets $10-$20 each', 'Lunch $5/$8', 'US$5 or US$6', '$5 and $10'])('%s', (s) => {
    expect(maths(s)).toEqual([])
  })
  it('real inline maths still is', () => {
    expect(maths('so $E=mc^2$ here')).toEqual(['E=mc^2'])
    expect(maths('area $x^2$, then')).toEqual(['x^2'])
  })
})

describe('$$ inside a code block is code', () => {
  it('is not drawn as a maths box', () => {
    expect(fencedMathBlocks(Text.of(['```latex', '$$', 'x^2', '$$', '```']))).toEqual([])
  })
  it('a real $$ block after the code block still is', () => {
    expect(fencedMathBlocks(Text.of(['```', 'code', '```', '$$', 'x^2', '$$']))).toEqual([{ open: 4, close: 6 }])
  })
})

describe('Find & Replace skips the hidden tags', () => {
  const doc = 'See <mark class="hl-amber">exam</mark> and the mark scheme.'
  const st = EditorState.create({ doc })
  it('a word inside a tag is skipped', () => {
    const inTag = doc.indexOf('mark')
    expect(insideTag(st, inTag, inTag + 4)).toBe(true)
  })
  it('the same word in the sentence is found', () => {
    const inText = doc.indexOf('mark scheme')
    expect(insideTag(st, inText, inText + 4)).toBe(false)
  })
})
