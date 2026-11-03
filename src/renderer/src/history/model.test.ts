import { describe, expect, it } from 'vitest'
import { compare, isSame, putBack, type Piece } from './model'

const PARA = 'The Krebs cycle runs in the matrix and makes NADH and FADH2.'
const removed = (pieces: Piece[]): Extract<Piece, { kind: 'removed' }>[] =>
  pieces.filter((p): p is Extract<Piece, { kind: 'removed' }> => p.kind === 'removed')

describe('compare', () => {
  it('finds nothing between a note and itself', () => {
    const c = compare('a\nb', 'a\nb')
    expect(isSame(c)).toBe(true)
    expect(c.pieces).toEqual([{ kind: 'same', text: 'a\nb' }])
  })

  it('reads Windows line endings in a kept copy as plain ones', () => {
    expect(isSame(compare('a\r\nb\r\n', 'a\nb\n'))).toBe(true)
  })

  it('finds a deleted paragraph, and puts it back exactly where it was', () => {
    const old = ['# Week 4', '', 'Mitochondria make ATP.', '', PARA, '', 'Glycolysis happens first.'].join('\n')
    // The paragraph was selected and deleted; a sentence was typed further down.
    const now = ['# Week 4', '', 'Mitochondria make ATP.', '', '', 'Glycolysis happens first.', 'New line.'].join('\n')
    const c = compare(old, now)
    const [gone] = removed(c.pieces)
    expect(gone.text).toBe(PARA)
    expect(c.addedLines).toBe(1)
    const back = putBack(now, gone)
    expect(back).toBe(['# Week 4', '', 'Mitochondria make ATP.', '', PARA, '', 'Glycolysis happens first.', 'New line.'].join('\n'))
    expect(removed(compare(old, back).pieces)).toEqual([])
  })

  it('puts a removed first and last line back at the very start and end', () => {
    const c = compare('first\nmiddle\nlast', 'middle')
    const [a, b] = removed(c.pieces)
    expect(putBack('middle', a)).toBe('first\nmiddle')
    expect(putBack('middle', b)).toBe('middle\nlast')
  })

  it('keeps going when the note now is empty', () => {
    const c = compare('one\ntwo', '')
    const [all] = removed(c.pieces)
    expect(all.text).toBe('one\ntwo')
    expect(putBack('', all)).toBe('one\ntwo\n')
  })

  it('does not count a line you only added to, or fixed a typo in, as removed', () => {
    const old = 'Intro.\nGlycolysis happens first.\nTeh end.'
    const now = 'Intro.\nGlycolysis happens first. Ten steps.\nThe end.'
    const c = compare(old, now)
    expect(removed(c.pieces)).toEqual([])
    expect(c.addedLines).toBe(0)
  })

  it('still counts a line rewritten into different words as removed', () => {
    const c = compare('Intro.\nThe Krebs cycle makes NADH.\nEnd.', 'Intro.\nPhotosynthesis is in the leaf.\nEnd.')
    expect(removed(c.pieces).map((p) => p.text)).toEqual(['The Krebs cycle makes NADH.'])
  })

  it('tells two removed pieces apart', () => {
    const c = compare('a\nX\nb\nY\nc', 'a\nb\nc')
    expect(removed(c.pieces).map((p) => p.text)).toEqual(['X', 'Y'])
    expect(new Set(removed(c.pieces).map((p) => p.key)).size).toBe(2)
  })

  it('copes with a large note without building a huge table', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`)
    const shuffled = [...big].reverse()
    const t = Date.now()
    const c = compare(big.join('\n'), shuffled.join('\n'))
    expect(Date.now() - t).toBeLessThan(3000)
    expect(c.removedLines).toBeGreaterThan(0)
  })
})
