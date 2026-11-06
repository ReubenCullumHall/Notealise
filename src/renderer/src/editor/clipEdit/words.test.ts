import { describe, expect, it } from 'vitest'
import { cut, moveSection, split, wholeClip } from './model'
import { placeWords, wordAt, wordSelected, wordsSpan } from './words'

// "one two three four", a word a second, with a gap after each.
const WORDS = [
  { text: 'one', from: 0, to: 600 },
  { text: 'two', from: 1000, to: 1600 },
  { text: 'three', from: 2000, to: 2600 },
  { text: 'four', from: 3000, to: 3600 }
]
const texts = (ws: { text: string }[]): string => ws.map((w) => w.text).join(' ')

describe('edit by the words', () => {
  it('places every word on an untouched clip, in seconds', () => {
    const ws = placeWords(WORDS, wholeClip(4))
    expect(texts(ws)).toBe('one two three four')
    expect(ws[1]).toMatchObject({ from: 1, to: 1.6, section: 0 })
  })

  it('drops a word that was cut, and closes up the times after it', () => {
    const ws = placeWords(WORDS, cut(wholeClip(4), 1, 2))
    expect(texts(ws)).toBe('one three four')
    expect(ws[1].from).toBeCloseTo(1)
  })

  it('a moved section takes its words with it, and a section starts a new line', () => {
    let c = split(wholeClip(4), 2)
    c = moveSection(c, 1, 0) // "three four" first
    const ws = placeWords(WORDS, c)
    expect(texts(ws)).toBe('three four one two')
    expect(ws.map((w) => w.section)).toEqual([0, 0, 1, 1])
  })

  it('a word cut across keeps only the part of it in the same stretch as its middle', () => {
    // cut 1.5–2.2: "two" loses its tail, its middle (1.3) survives
    const ws = placeWords(WORDS, cut(wholeClip(4), 1.5, 2.2))
    const two = ws.find((w) => w.text === 'two')!
    expect(two.from).toBeCloseTo(1)
    expect(two.to).toBeLessThanOrEqual(1.5 + 1e-6)
    // "three" (2.0–2.6, middle 2.3) keeps its middle; it starts no earlier than the join
    const three = ws.find((w) => w.text === 'three')!
    expect(three.from).toBeGreaterThanOrEqual(1.5 - 1e-6)
  })

  it('finds the word being said, and the stretch a run of words covers', () => {
    const ws = placeWords(WORDS, wholeClip(4))
    expect(wordAt(ws, 0.5)).toBe(0)
    expect(wordAt(ws, 1.8)).toBe(1) // in the gap after "two": still "two"
    expect(wordAt(ws, -1)).toBe(-1)
    expect(wordsSpan(ws, 2, 1)).toEqual([1, 2.6])
    expect(wordSelected(ws[1], [0.9, 2.1])).toBe(true)
    expect(wordSelected(ws[2], [0.9, 2.1])).toBe(false)
  })

  it('ignores empty words', () => {
    expect(placeWords([{ text: ' ', from: 0, to: 100 }], wholeClip(1))).toEqual([])
  })
})
