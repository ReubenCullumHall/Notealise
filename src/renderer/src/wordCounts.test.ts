// The word count, worked out off the keystroke's path (wordCounts.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AWKWARD_NAMES } from '../../shared/awkwardNames'
import {
  countDelay,
  countNow,
  countSoon,
  remapWordCounts,
  resetWordCountsForTests,
  subscribeWordCounts,
  wordCountOf
} from './wordCounts'

beforeEach(() => {
  resetWordCountsForTests()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a note just opened', () => {
  it('is counted at once', () => {
    countNow('Bio/Cells.md', 'one two three')
    expect(wordCountOf('Bio/Cells.md')).toBe(3)
  })

  it('a note never counted reads 0', () => {
    expect(wordCountOf('Bio/Unknown.md')).toBe(0)
  })
})

describe('a note being typed in', () => {
  it('is NOT counted in the same instant as the key', () => {
    countNow('n.md', 'one')
    countSoon('n.md', 'one two')
    expect(wordCountOf('n.md')).toBe(1)
  })

  it('is counted a moment later, from the text as of the last key', () => {
    countNow('n.md', 'one')
    countSoon('n.md', 'one t')
    countSoon('n.md', 'one tw')
    countSoon('n.md', 'one two three')
    vi.advanceTimersByTime(countDelay(0))
    expect(wordCountOf('n.md')).toBe(3)
  })

  it('a burst of keys is one count, not one per key', () => {
    const told = vi.fn()
    subscribeWordCounts(told)
    for (let i = 1; i <= 20; i++) countSoon('n.md', 'word '.repeat(i))
    vi.advanceTimersByTime(countDelay(0))
    expect(told).toHaveBeenCalledTimes(1)
    expect(wordCountOf('n.md')).toBe(20)
  })

  it('still follows while you type without a pause — the wait is not restarted by each key', () => {
    countSoon('n.md', 'one')
    vi.advanceTimersByTime(countDelay(0) - 10)
    countSoon('n.md', 'one two') // 10 ms before the count is due
    vi.advanceTimersByTime(10)
    expect(wordCountOf('n.md')).toBe(2) // not pushed back another whole wait
  })

  it('says nothing when the count comes out the same (typing inside a word)', () => {
    countNow('n.md', 'one two')
    const told = vi.fn()
    subscribeWordCounts(told)
    countSoon('n.md', 'one twoo')
    vi.advanceTimersByTime(countDelay(0))
    expect(told).not.toHaveBeenCalled()
  })

  it('two notes typed in together (a split) are both counted', () => {
    countSoon('a.md', 'one')
    countSoon('b.md', 'one two')
    vi.advanceTimersByTime(countDelay(0))
    expect([wordCountOf('a.md'), wordCountOf('b.md')]).toEqual([1, 2])
  })

  it('a reload from disk beats typing that was still waiting to be counted', () => {
    countSoon('n.md', 'typed words here')
    countNow('n.md', 'the text now on disk, which is longer')
    vi.advanceTimersByTime(countDelay(0))
    expect(wordCountOf('n.md')).toBe(8)
  })

  it('an unsubscribed listener is not told', () => {
    const told = vi.fn()
    subscribeWordCounts(told)()
    countNow('n.md', 'one')
    expect(told).not.toHaveBeenCalled()
  })
})

describe('how long the count waits', () => {
  it('about a tenth of a second for an ordinary note', () => {
    expect(countDelay(0)).toBe(120)
    expect(countDelay(4)).toBe(120)
  })

  it('longer for a note so long that counting it is slow — ten times what the count cost', () => {
    expect(countDelay(22)).toBe(220) // a 10,000-line note on the MacBook Air
    expect(countDelay(82)).toBe(820)
  })

  it('never more than a second', () => {
    expect(countDelay(5000)).toBe(1000)
  })
})

describe('a note renamed or moved', () => {
  const map =
    (from: string, to: string) =>
    (p: string): string =>
      p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p

  it('keeps its count under the new name', () => {
    countNow('Bio/Cells.md', 'one two three')
    remapWordCounts(map('Bio/Cells.md', 'Bio/The cell.md'))
    expect(wordCountOf('Bio/The cell.md')).toBe(3)
    expect(wordCountOf('Bio/Cells.md')).toBe(0)
  })

  it('a renamed folder carries the counts of the notes in it', () => {
    countNow('Bio/Topic 1/Cells.md', 'one two')
    countNow('Maths/Sums.md', 'one')
    remapWordCounts(map('Bio', 'Biology'))
    expect(wordCountOf('Biology/Topic 1/Cells.md')).toBe(2)
    expect(wordCountOf('Maths/Sums.md')).toBe(1)
  })

  it('typing still waiting to be counted lands under the new name', () => {
    countSoon('Untitled 4.md', 'typed straight after naming it')
    remapWordCounts(map('Untitled 4.md', 'Lecture 4.md'))
    vi.advanceTimersByTime(countDelay(0))
    expect(wordCountOf('Lecture 4.md')).toBe(5)
    expect(wordCountOf('Untitled 4.md')).toBe(0)
  })
})

describe('the names people really use', () => {
  it('each note keeps its own count, the two spellings of "Café" apart', () => {
    AWKWARD_NAMES.forEach((name, i) => countNow(`Space/${name}.md`, 'word '.repeat(i + 1)))
    AWKWARD_NAMES.forEach((name, i) => expect(wordCountOf(`Space/${name}.md`), name).toBe(i + 1))
  })

  it.each(AWKWARD_NAMES.map((n) => [n]))('a folder called %j can be renamed and its notes keep their counts', (name) => {
    countNow(`${name}/Note.md`, 'one two three')
    countSoon(`${name}/Typing.md`, 'four words typed here')
    remapWordCounts((p) => (p.startsWith(name + '/') ? 'Renamed' + p.slice(name.length) : p))
    vi.advanceTimersByTime(countDelay(0))
    expect(wordCountOf('Renamed/Note.md')).toBe(3)
    expect(wordCountOf('Renamed/Typing.md')).toBe(4)
    expect(wordCountOf(`${name}/Note.md`)).toBe(0)
  })
})

