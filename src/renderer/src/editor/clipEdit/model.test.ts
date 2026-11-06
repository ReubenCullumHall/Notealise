import { describe, expect, it } from 'vitest'
import {
  appendTake, sectionNumbers, editPoints, moveSection, deleteSection, sectionAt, sectionBounds, cut, joins, keepOnly, lengthOf, originalRanges, shortenPauses, split, splitTimes, takes,
  toClip, toOriginal, trimEnd, trimStart, unsplit, untouched, wholeClip
} from './model'

const close = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-9)

describe('a cut closes up', () => {
  it('cutting the middle joins the two sides and shortens the clip', () => {
    const c = cut(wholeClip(10), 3, 5)
    expect(c.segs).toEqual([[0, 3], [5, 10]])
    close(lengthOf(c), 8)
    expect(joins(c)).toEqual([3])
  })
  it('clip time after a cut maps past the gap', () => {
    const c = cut(wholeClip(10), 3, 5)
    close(toOriginal(c, 3.5), 5.5)
    expect(toClip(c, 4)).toBeNull()
    close(toClip(c, 6)!, 4)
  })
  it('a second cut is in clip time — what is on screen, not the original', () => {
    // On screen after the first cut, 4–6 is original 6–8.
    const c = cut(cut(wholeClip(10), 3, 5), 4, 6)
    expect(c.segs).toEqual([[0, 3], [5, 6], [8, 10]])
  })
  it('a cut across a join takes from both sides', () => {
    const c = cut(cut(wholeClip(10), 3, 5), 2, 4)
    expect(c.segs).toEqual([[0, 2], [6, 10]])
  })
  it('a cut backwards (dragged right to left) is the same cut', () => {
    expect(cut(wholeClip(10), 5, 3).segs).toEqual([[0, 3], [5, 10]])
  })
  it('a cut of nothing, or outside the clip, changes nothing', () => {
    const c = wholeClip(10)
    expect(cut(c, 4, 4)).toBe(c)
    expect(cut(c, 11, 12)).toBe(c)
  })
  it('a sliver under 10 ms is not kept', () => {
    expect(cut(wholeClip(10), 0.005, 10).segs).toEqual([])
  })
})

describe('trim and keep only this', () => {
  it('the handles trim each end', () => {
    expect(trimEnd(trimStart(wholeClip(10), 1), 7).segs).toEqual([[1, 8]])
  })
  it('keep only this keeps just the selection, across joins too', () => {
    const c = keepOnly(cut(wholeClip(10), 3, 5), 2, 4)
    expect(c.segs).toEqual([[2, 3], [5, 6]])
  })
  it('untouched is true only for the whole recording with no splits', () => {
    expect(untouched(wholeClip(10), 10)).toBe(true)
    expect(untouched(trimStart(wholeClip(10), 1), 10)).toBe(false)
    expect(untouched(split(wholeClip(10), 5), 10)).toBe(false)
  })
})

describe('splits', () => {
  it('splitting makes takes, each its own stretches', () => {
    const c = split(split(wholeClip(10), 4), 7)
    expect(splitTimes(c)).toEqual([4, 7])
    expect(takes(c)).toEqual([[[0, 4]], [[4, 7]], [[7, 10]]])
  })
  it('a split follows its moment when something before it is cut', () => {
    const c = cut(split(wholeClip(10), 6), 1, 3)
    expect(splitTimes(c)).toEqual([4])
  })
  it('a split inside a cut goes with it', () => {
    const c = cut(split(wholeClip(10), 6), 5, 7)
    expect(splitTimes(c)).toEqual([])
    expect(takes(c)).toHaveLength(1)
  })
  it('no split at either end or on top of another', () => {
    const c = split(wholeClip(10), 5)
    expect(split(c, 0.02)).toBe(c)
    expect(split(c, 9.95)).toBe(c)
    expect(split(c, 5.05)).toBe(c)
  })
  it('unsplit takes the nearest one back out', () => {
    expect(splitTimes(unsplit(split(split(wholeClip(10), 4), 7), 4.04))).toEqual([7])
  })
  it('a take that spans a join keeps both pieces', () => {
    const c = split(cut(wholeClip(10), 3, 5), 6)
    expect(takes(c)).toEqual([[[0, 3], [5, 8]], [[8, 10]]])
  })
})

describe('shortening pauses', () => {
  it('leaves a third of a second at each pause, half each side', () => {
    const c = shortenPauses(wholeClip(10), [[2, 4], [6, 8]], 1 / 3)
    const third = 1 / 3
    close(lengthOf(c), 10 - 2 * (2 - third))
    expect(c.segs).toHaveLength(3)
    close(c.segs[0][1], 2 + third / 2)
    close(c.segs[1][0], 4 - third / 2)
  })
  it('a pause already shorter than the breath is left alone', () => {
    const c = wholeClip(10)
    expect(shortenPauses(c, [[2, 2.2]], 1 / 3)).toBe(c)
  })
  it('originalRanges covers exactly what plays', () => {
    const c = cut(wholeClip(10), 3, 5)
    expect(originalRanges(c, 2, 4)).toEqual([[2, 3], [5, 6]])
  })
})

describe('deleting a section', () => {
  it('takes the section out and leaves one split where it was, not two', () => {
    const c = deleteSection(split(split(wholeClip(10), 4), 7), 1)
    expect(c.segs).toEqual([[0, 4], [7, 10]])
    expect(splitTimes(c)).toEqual([4])
    expect(takes(c)).toEqual([[[0, 4]], [[7, 10]]])
  })
  it('the first and last sections lose their split too', () => {
    expect(splitTimes(deleteSection(split(wholeClip(10), 4), 0))).toEqual([])
    expect(splitTimes(deleteSection(split(wholeClip(10), 4), 1))).toEqual([])
  })
  it('a plain cut of exactly one section behaves the same', () => {
    const c = split(split(wholeClip(10), 4), 7)
    expect(cut(c, 4, 7)).toEqual(deleteSection(c, 1))
  })
  it('finds the section a moment is in, and its ends', () => {
    const c = split(split(wholeClip(10), 4), 7)
    expect(sectionAt(c, 5)).toBe(1)
    expect(sectionBounds(c, 2)).toEqual([7, 10])
    expect(sectionBounds(c, 3)).toBeNull()
  })
})

describe('moving a section (the table column drag)', () => {
  const three = (): ReturnType<typeof wholeClip> => split(split(wholeClip(10), 4), 7)
  it('moves the last section to the front', () => {
    const c = moveSection(three(), 2, 0)
    expect(takes(c)).toEqual([[[7, 10]], [[0, 4]], [[4, 7]]])
    expect(splitTimes(c)).toEqual([3, 7])
    expect(lengthOf(c)).toBe(10)
  })
  it('moves the first to the end', () => {
    expect(takes(moveSection(three(), 0, 3))).toEqual([[[4, 7]], [[7, 10]], [[0, 4]]])
  })
  it('dropping a section either side of itself changes nothing', () => {
    const c = three()
    expect(moveSection(c, 1, 1)).toBe(c)
    expect(moveSection(c, 1, 2)).toBe(c)
  })
  it('moved back where it came from, it is one stretch again — no join mark', () => {
    const c = moveSection(moveSection(three(), 2, 0), 0, 3)
    expect(c.segs).toEqual([[0, 10]])
    expect(joins(c)).toEqual([])
    expect(splitTimes(c)).toEqual([4, 7])
  })
  it('a cut and a delete still work on a reordered clip', () => {
    const c = moveSection(three(), 2, 0) // 7–10, 0–4, 4–7
    expect(takes(deleteSection(c, 1))).toEqual([[[7, 10]], [[4, 7]]])
    expect(cut(c, 1, 2).segs).toEqual([[7, 8], [9, 10], [0, 7]])
  })
  it('edit points are the ends, the splits and the joins, once each', () => {
    expect(editPoints(cut(split(wholeClip(10), 6), 2, 3))).toEqual([0, 2, 5, 9])
  })
})

describe('section numbers', () => {
  it('count 1, 2, 3 in the order they play', () => {
    expect(sectionNumbers(split(split(wholeClip(10), 4), 7))).toEqual([1, 2, 3])
  })
  it('a moved section keeps its number — its place in the original recording', () => {
    expect(sectionNumbers(moveSection(split(split(wholeClip(10), 4), 7), 2, 0))).toEqual([3, 1, 2])
  })
  it('one section, number 1', () => {
    expect(sectionNumbers(wholeClip(10))).toEqual([1])
  })
})

describe('a take recorded in the editor', () => {
  it('goes on the end as its own section, numbered after the rest', () => {
    const c = appendTake(split(wholeClip(10), 4), 10, 13)
    expect(takes(c)).toEqual([[[0, 4]], [[4, 10]], [[10, 13]]])
    expect(sectionNumbers(c)).toEqual([1, 2, 3])
    expect(lengthOf(c)).toBe(13)
  })
  it('after a reorder it still goes last, and the others keep their numbers', () => {
    const c = appendTake(moveSection(split(wholeClip(10), 4), 1, 0), 10, 12)
    expect(takes(c)).toEqual([[[4, 10]], [[0, 4]], [[10, 12]]])
    expect(sectionNumbers(c)).toEqual([2, 1, 3])
  })
  it('a take after a trimmed-off end is still a section of its own, not joined on', () => {
    const c = appendTake(trimEnd(wholeClip(10), 8), 10, 12)
    expect(takes(c)).toEqual([[[0, 8]], [[10, 12]]])
  })
  it('an empty clip (everything deleted) just becomes the take', () => {
    expect(appendTake({ segs: [], splits: [] }, 10, 12)).toEqual({ segs: [[10, 12]], splits: [] })
  })
})
