import { describe, expect, it } from 'vitest'
import {
  activePath,
  BLANK,
  closePane,
  closeTab,
  closeUnder,
  cycle,
  EMPTY_LAYOUT,
  MAX_PANES,
  movePane,
  moveTab,
  openTab,
  renamePath,
  replaceActive,
  restoreLayout,
  selectTab,
  showInPane,
  splitAt,
  splitBlank,
  swapPanes,
  equalisePanes,
  MIN_PANE_PX,
  paneSizes,
  resizePanes,
  type TabLayout
} from './model'

/** Build a layout the way the app would: open each note in turn. */
const opened = (...paths: string[]): TabLayout => paths.reduce(openTab, EMPTY_LAYOUT)

/** Both invariants the UI depends on, asserted on every result below. */
const invariants = (l: TabLayout): void => {
  for (const p of l.panes) expect(l.tabs).toContain(p)
  expect(new Set(l.panes).size).toBe(l.panes.length)
  if (l.tabs.length) expect(l.panes.length).toBeGreaterThan(0)
  expect(l.panes.length).toBeLessThanOrEqual(MAX_PANES)
  if (l.panes.length) expect(l.focus).toBeLessThan(l.panes.length)
  // 3: a blank tab only exists while a pane is showing it
  if (l.tabs.includes(BLANK)) expect(l.panes).toContain(BLANK)
  // 4: sizes, when present, describe exactly these panes. Asserted HERE rather
  // than only in the resizing block so every operation in this file — including
  // the ones written long before widths existed — proves it maintains them. An
  // operation that changes the pane count and forgets `sizes` fails whichever
  // test exercises it, instead of waiting for someone to write a width test for
  // that specific path.
  if (l.sizes !== undefined) expect(l.sizes).toHaveLength(l.panes.length)
  // and what the UI actually renders is always one usable fraction per pane
  const rendered = paneSizes(l)
  expect(rendered).toHaveLength(l.panes.length)
  if (rendered.length) expect(rendered.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
}

/** Two columns, a.md | b.md. `opened` leaves only the LAST note in a pane, so
 *  the second column comes from splitting in a tab that is open but off screen —
 *  splitting in one already visible MOVES its column instead of adding one. */
const twoCols = (): TabLayout => splitAt(opened('a.md', 'b.md'), 'a.md', 0)

/** Three columns, a.md | b.md | c.md, by the same route. */
const threeCols = (): TabLayout =>
  splitAt(splitAt(opened('a.md', 'b.md', 'c.md'), 'b.md', 0), 'a.md', 0)

/** A two-column layout dragged to `left`:`right`, as the divider would. */
const dragged = (left: number, right: number): TabLayout => resizePanes(twoCols(), 1, left, right)

describe('opening', () => {
  it('adds a tab and shows it in the focused pane', () => {
    const l = opened('a.md', 'b.md')
    expect(l.tabs).toEqual(['a.md', 'b.md'])
    expect(l.panes).toEqual(['b.md']) // one pane: the second note replaced the first
    expect(activePath(l)).toBe('b.md')
    invariants(l)
  })

  it('focuses the pane a note is already in rather than moving it', () => {
    // Not a no-op test: the *layout* is deliberately unchanged, because pulling
    // an already-visible note into the focused pane would empty the pane it came
    // from — clicking a note you can already see should move your attention, not
    // rearrange the screen.
    const split = splitAt(opened('a.md', 'b.md'), 'a.md', 0)
    expect(split.panes).toEqual(['a.md', 'b.md'])
    const l = openTab({ ...split, focus: 0 }, 'b.md')
    expect(l.panes).toEqual(['a.md', 'b.md'])
    expect(l.focus).toBe(1)
    invariants(l)
  })

  it('replaces the focused note on a plain click instead of stacking tabs', () => {
    const l = replaceActive(opened('a.md'), 'b.md')
    expect(l.tabs).toEqual(['b.md']) // a.md closed as b.md opened — pre-tabs behaviour
    expect(l.panes).toEqual(['b.md'])
    invariants(l)
  })

  it('keeps the strip position of the note it replaces', () => {
    const three = opened('a.md', 'b.md', 'c.md') // focused pane shows c.md
    const l = replaceActive({ ...three, tabs: ['a.md', 'b.md', 'c.md'] }, 'd.md')
    expect(l.tabs).toEqual(['a.md', 'b.md', 'd.md'])
  })

  it('only closes the outgoing note when the incoming one is already a tab', () => {
    const split = splitAt(opened('a.md', 'b.md', 'c.md'), 'a.md', 0) // panes: a | c, b open
    const l = replaceActive({ ...split, focus: 1 }, 'b.md')
    expect(l.panes).toEqual(['a.md', 'b.md'])
    expect(l.tabs).toEqual(['a.md', 'b.md']) // c.md left, b.md stayed where it was
    invariants(l)
  })

  it('moves focus rather than the note when it is already on screen', () => {
    // The layout is deliberately untouched: clicking a note you can already see
    // must not empty the pane it is sitting in.
    const split = splitAt(opened('a.md', 'b.md'), 'a.md', 0)
    const l = replaceActive({ ...split, focus: 1 }, 'a.md')
    expect(l.panes).toEqual(['a.md', 'b.md'])
    expect(l.focus).toBe(0)
  })

  it('jumps to the nth tab, and ignores an index that has no tab', () => {
    const l = opened('a.md', 'b.md', 'c.md')
    expect(activePath(selectTab(l, 0))).toBe('a.md')
    // Cmd+7 with three tabs open means "the seventh"; clamping to the last one
    // would silently do something the user didn't ask for.
    expect(selectTab(l, 6)).toBe(l)
  })
})

describe('closing', () => {
  it('hands the pane the tab to the right, else the one to the left', () => {
    const l = closeTab(opened('a.md', 'b.md', 'c.md'), 'c.md')
    expect(l.tabs).toEqual(['a.md', 'b.md'])
    expect(activePath(l)).toBe('b.md') // nothing to the right, so the left neighbour
    const first = closeTab(openTab(l, 'a.md'), 'a.md')
    expect(activePath(first)).toBe('b.md')
    invariants(first)
  })

  it('collapses the pane when no tab is left for it', () => {
    const split = splitAt(opened('a.md', 'b.md'), 'a.md', 0)
    const l = closeTab(split, 'a.md')
    expect(l.panes).toEqual(['b.md']) // the split closes, b.md is untouched
    expect(l.focus).toBe(0)
    invariants(l)
  })

  it('leaves the panes alone when the closed tab was off screen', () => {
    const l = closeTab(opened('a.md', 'b.md', 'c.md'), 'a.md')
    expect(l.tabs).toEqual(['b.md', 'c.md'])
    expect(l.panes).toEqual(['c.md'])
    invariants(l)
  })

  it('closes a pane without closing its tab', () => {
    const split = splitAt(opened('a.md', 'b.md'), 'a.md', 0)
    const l = closePane(split, 0)
    expect(l.panes).toEqual(['b.md'])
    expect(l.tabs).toEqual(['a.md', 'b.md']) // still open, just not on screen
    invariants(l)
  })

  it('refuses to close the only pane', () => {
    // Zero panes with tabs still open would leave the strip pointing at an empty
    // screen: with one pane the tab's own × is what closes things.
    const l = opened('a.md')
    expect(closePane(l, 0)).toBe(l)
  })
})

describe('cycling', () => {
  it('walks the strip and wraps round', () => {
    const l = opened('a.md', 'b.md', 'c.md')
    expect(activePath(cycle(l, 1))).toBe('a.md') // c → wraps to a
    expect(activePath(cycle(l, -1))).toBe('b.md')
  })

  it('skips notes another pane is already showing', () => {
    const l = splitAt(opened('a.md', 'b.md', 'c.md'), 'a.md', 0) // panes: a | c
    const next = cycle({ ...l, focus: 1 }, 1)
    expect(next.panes).toEqual(['a.md', 'b.md']) // a is on screen, so c → b
    invariants(next)
  })

  it('does nothing when every other tab is already on screen', () => {
    // Not "the code happens to return early": showing one note in two panes
    // would give one file two editors and two autosave buffers.
    const l = splitAt(opened('a.md', 'b.md'), 'a.md', 0)
    expect(cycle(l, 1)).toBe(l)
  })
})

describe('splitting', () => {
  it('puts a dropped tab in a new pane on the chosen side', () => {
    const l = splitAt(opened('a.md', 'b.md'), 'a.md', 0)
    expect(l.panes).toEqual(['a.md', 'b.md'])
    expect(l.focus).toBe(0)
    const right = splitAt(l, 'c.md', 2)
    expect(right.panes).toEqual(['a.md', 'b.md', 'c.md'])
    expect(right.tabs).toContain('c.md') // dropping a note that wasn't open opens it
    invariants(right)
  })

  it('splits when the ONE visible tab is dropped on its own edge', () => {
    // The gesture people reach for first, and the one case where dropping an
    // already-visible tab can't mean "reorder the columns" — there is only one.
    const l = splitAt(opened('a.md', 'b.md'), 'b.md', 1) // b is what the pane shows
    expect(l.panes).toEqual(['a.md', 'b.md']) // a backfills the pane b left
    expect(l.focus).toBe(1)
    invariants(l)
    const leftward = splitAt(opened('a.md', 'b.md'), 'b.md', 0)
    expect(leftward.panes).toEqual(['b.md', 'a.md'])
    // With nothing else open there is no note to backfill with, so the drop is
    // refused rather than showing one note in both halves.
    const lone = opened('a.md')
    expect(splitAt(lone, 'a.md', 1)).toBe(lone)
  })

  it('stops at three panes, but still reorders the ones already open', () => {
    const three = splitAt(splitAt(opened('a.md', 'b.md'), 'a.md', 0), 'c.md', 2)
    expect(splitAt(three, 'd.md', 1)).toBe(three) // a fourth column is refused
    const moved = splitAt(three, 'c.md', 0)
    expect(moved.panes).toEqual(['c.md', 'a.md', 'b.md']) // reorder: still three
    invariants(moved)
  })

  it('moves a note between panes rather than duplicating it', () => {
    const l = splitAt(opened('a.md', 'b.md'), 'a.md', 0) // a | b
    const onto = showInPane(l, 'a.md', 1)
    expect(onto.panes).toEqual(['a.md']) // the pane it left had nothing else to show
    expect(onto.tabs).toEqual(['a.md', 'b.md']) // b stays open, just off screen
    invariants(onto)
  })

  it('opens an empty column beside the focused one, and asks nothing of the tabs', () => {
    // Works with a single note open, which the old "move this note across and
    // backfill" version could not: there is nothing to backfill with, and the
    // new column is empty by design — it is a question, not a guess.
    const l = splitBlank(opened('a.md'))
    expect(l.panes).toEqual(['a.md', BLANK])
    expect(l.focus).toBe(1)
    invariants(l)
    // The next note picked fills it, and the placeholder leaves the strip.
    const filled = replaceActive(l, 'b.md')
    expect(filled.panes).toEqual(['a.md', 'b.md'])
    expect(filled.tabs).toEqual(['a.md', 'b.md'])
    invariants(filled)
  })

  it('focuses the empty column already waiting instead of opening a second', () => {
    const once = splitBlank(opened('a.md'))
    const twice = splitBlank(once)
    expect(twice.panes).toEqual(['a.md', BLANK])
    expect(twice.focus).toBe(1)
  })

  it('refuses a fourth column', () => {
    const three = splitAt(splitAt(opened('a.md', 'b.md'), 'a.md', 0), 'c.md', 2)
    expect(splitBlank(three)).toBe(three)
  })

  it('retires a blank that loses its pane', () => {
    // Invariant 3. Cycling, jumping to a tab or dropping another note into the
    // blank's pane all take its pane away; a placeholder tab you cannot see has
    // nothing in it and nothing to return to, so it goes.
    const l = splitBlank(opened('a.md', 'b.md')) // panes: b | blank
    const cycled = cycle(l, 1)
    expect(cycled.tabs).not.toContain(BLANK)
    expect(cycled.panes).toEqual(['b.md', 'a.md'])
    invariants(cycled)
    const jumped = selectTab(l, 0)
    expect(jumped.tabs).not.toContain(BLANK)
    invariants(jumped)
  })
})

describe('rearranging the columns', () => {
  const three = (): TabLayout =>
    splitAt(splitAt(opened('a.md', 'b.md'), 'a.md', 0), 'c.md', 2) // a | b | c

  it('moves a column to another position, opening and closing nothing', () => {
    const l = movePane(three(), 0, 3)
    expect(l.panes).toEqual(['b.md', 'c.md', 'a.md'])
    expect(l.tabs).toEqual(['a.md', 'b.md', 'c.md']) // the strip is a separate order
    expect(l.focus).toBe(2) // focus follows the column you dragged
    invariants(l)
  })

  it('does nothing when a column is dropped back where it started', () => {
    // Both forms of "where it started": onto itself, and into the gap it would
    // leave behind — which is the same position once the column is lifted out.
    const l = three()
    expect(movePane(l, 1, 1)).toBe(l)
    expect(movePane(l, 1, 2)).toBe(l)
  })

  it('swaps two columns when one is dropped on the middle of another', () => {
    const l = swapPanes(three(), 0, 2)
    expect(l.panes).toEqual(['c.md', 'b.md', 'a.md']) // b never moved
    invariants(l)
    const same = three()
    expect(swapPanes(same, 1, 1)).toBe(same)
  })
})

describe('the blank tab', () => {
  it('opens as a tab of its own and is replaced in place by the next note', () => {
    const blank = openTab(opened('a.md'), BLANK)
    expect(blank.tabs).toEqual(['a.md', BLANK])
    expect(activePath(blank)).toBe(BLANK)
    const filled = replaceActive(blank, 'b.md')
    expect(filled.tabs).toEqual(['a.md', 'b.md']) // took the blank's place in the strip
    expect(filled.panes).toEqual(['b.md'])
    invariants(filled)
  })

  it('cannot be opened twice — the second + focuses the one already there', () => {
    const once = openTab(opened('a.md'), BLANK)
    const twice = openTab(once, BLANK)
    expect(twice.tabs.filter((t) => t === BLANK)).toHaveLength(1)
    expect(twice.panes).toEqual(once.panes)
  })

  it('gets out of the way when the note you pick is already on screen', () => {
    const split = splitAt(opened('a.md', 'b.md'), 'a.md', 0) // a | b
    const blank = openTab({ ...split, focus: 1 }, BLANK) // a | (blank), b off screen
    expect(blank.panes).toEqual(['a.md', BLANK])
    const l = replaceActive(blank, 'a.md') // click a.md, which is already shown
    expect(l.tabs).toEqual(['a.md', 'b.md']) // the blank closed itself
    expect(activePath(l)).toBe('a.md')
    invariants(l)
  })

  it('takes its column with it instead of backfilling', () => {
    // The bug this pins: closeTab's normal rule hands a vacated pane the next
    // open tab. For a blank that means opening the split, clicking a note that
    // was already on screen, and finding some unrelated note in the column you
    // opened empty.
    const split = splitAt(opened('a.md', 'b.md', 'c.md'), 'a.md', 0) // a | c, b off screen
    const blank = splitBlank({ ...split, focus: 1 }) // a | c | blank
    expect(blank.panes).toEqual(['a.md', 'c.md', BLANK])
    const l = replaceActive(blank, 'a.md') // pick a note that is already shown
    expect(l.panes).toEqual(['a.md', 'c.md']) // the empty column closed, b did NOT appear
    expect(l.tabs).toEqual(['a.md', 'b.md', 'c.md'])
    expect(activePath(l)).toBe('a.md')
    invariants(l)
  })

  it('still hands over when it is the only column', () => {
    // The exception: collapsing to zero panes with tabs still open would leave
    // the strip pointing at an empty screen.
    const l = closeTab(openTab(opened('a.md'), BLANK), BLANK) // panes: [blank], a off screen
    expect(l.panes).toEqual(['a.md'])
    invariants(l)
  })

  it('closes like any other tab', () => {
    const l = closeTab(openTab(opened('a.md'), BLANK), BLANK)
    expect(l.tabs).toEqual(['a.md'])
    expect(l.panes).toEqual(['a.md'])
    invariants(l)
  })
})

describe('following the vault', () => {
  it('reorders the strip', () => {
    const l = moveTab(opened('a.md', 'b.md', 'c.md'), 'c.md', 'a.md')
    expect(l.tabs).toEqual(['c.md', 'a.md', 'b.md'])
    expect(l.panes).toEqual(['c.md']) // which pane shows what doesn't change
  })

  it('follows a renamed note, and a renamed folder its notes sit in', () => {
    const l = renamePath(opened('n/a.md', 'n/b.md'), 'n', 'notes')
    expect(l.tabs).toEqual(['notes/a.md', 'notes/b.md'])
    expect(l.panes).toEqual(['notes/b.md'])
  })

  it('closes tabs under a binned folder', () => {
    const l = closeUnder(opened('n/a.md', 'n/b.md', 'keep.md'), ['n'])
    expect(l.tabs).toEqual(['keep.md'])
    expect(l.panes).toEqual(['keep.md'])
    invariants(l)
  })

  it('restores a saved session, dropping notes that are no longer there', () => {
    const alive = new Set(['a.md', 'c.md'])
    const l = restoreLayout(
      { tabs: ['a.md', 'b.md', 'c.md'], panes: ['b.md', 'c.md'], focus: 1 },
      (p) => alive.has(p)
    )
    expect(l.tabs).toEqual(['a.md', 'c.md']) // b.md was renamed or binned since
    expect(l.panes).toEqual(['c.md'])
    expect(l.focus).toBe(0) // the pane it pointed at is gone, so clamp
    invariants(l)
  })

  it('repairs a hand-edited session rather than trusting it', () => {
    const l = restoreLayout(
      // duplicated tabs, a pane showing a note that isn't a tab, four panes, and
      // a focus off the end — all of it legal JSON, none of it a valid layout.
      { tabs: ['a.md', 'a.md', 'b.md', 'c.md', 'd.md'], panes: ['x.md', 'a.md', 'b.md', 'c.md', 'd.md'], focus: 9 },
      () => true
    )
    expect(l.tabs).toEqual(['a.md', 'b.md', 'c.md', 'd.md'])
    expect(l.panes).toEqual(['a.md', 'b.md', 'c.md'])
    invariants(l)
  })

  it('falls back to showing one tab when the session recorded no panes', () => {
    const l = restoreLayout({ tabs: ['a.md', 'b.md'], panes: [], focus: 0 }, () => true)
    expect(l.panes).toEqual(['a.md'])
    invariants(l)
  })

  it('opens nothing when every remembered note has gone', () => {
    // Not a technicality: this is the vault-was-emptied case, and it has to end
    // on the blank screen rather than a tab strip full of dead paths.
    expect(restoreLayout({ tabs: ['a.md'], panes: ['a.md'], focus: 0 }, () => false)).toEqual(EMPTY_LAYOUT)
  })

  it('ends with nothing open when the last tab goes', () => {
    const l = closeTab(opened('a.md'), 'a.md')
    expect(l).toEqual(EMPTY_LAYOUT)
    expect(activePath(l)).toBeNull()
  })
})



describe('column widths', () => {
  it('starts a split even, and says so by carrying no sizes at all', () => {
    const l = twoCols()
    // Not [0.5, 0.5]: "never dragged" and "dragged back to even" render the
    // same, so they must BE the same value — otherwise every plain split writes
    // an array into settings.json for a layout nobody touched.
    expect(l.sizes).toBeUndefined()
    expect(paneSizes(l)).toEqual([0.5, 0.5])
    invariants(l)
  })

  it('divides only the pair a divider sits between, leaving the third alone', () => {
    // The predictability the whole gesture rests on: in a three-way split,
    // dragging one seam must not shuffle the column at the far end.
    const l = threeCols()
    expect(l.panes).toEqual(['a.md', 'b.md', 'c.md'])
    const before = paneSizes(l)
    const after = paneSizes(resizePanes(l, 1, 3, 1))
    expect(after[2]).toBeCloseTo(before[2])
    expect(after[0] + after[1]).toBeCloseTo(before[0] + before[1])
    expect(after[0] / after[1]).toBeCloseTo(3)
    invariants(l)
  })

  it('keeps the survivors in proportion when a column closes', () => {
    // The "absorb the difference" rule: close the narrow one of a 3:1 pair and
    // the other takes the room rather than the split snapping back to even.
    const l = dragged(3, 1)
    expect(paneSizes(l)).toEqual([0.75, 0.25])
    const closed = closePane(l, 1)
    expect(paneSizes(closed)).toEqual([1])
    invariants(closed)
  })

  it('preserves the RATIO of the columns that remain, not just their order', () => {
    const sized = { ...threeCols(), sizes: [0.5, 0.2, 0.3] }
    const closed = closePane(sized, 1) // drop the middle
    const after = paneSizes(closed)
    expect(after[0] / after[1]).toBeCloseTo(0.5 / 0.3) // 5:3, as it was
    invariants(closed)
  })

  it('gives a newly opened column an even share and shrinks the rest to fit', () => {
    const wide = { ...threeCols(), panes: ['a.md', 'b.md'], focus: 0, sizes: [0.75, 0.25] }
    const added = splitAt(wide, 'c.md', 2)
    const after = paneSizes(added)
    expect(after[2]).toBeCloseTo(1 / 3) // the new one
    expect(after[0] / after[1]).toBeCloseTo(3) // the other two, still 3:1
    invariants(added)
  })

  it('moves a width WITH its column, but leaves widths put on a swap', () => {
    const l = { ...threeCols(), sizes: [0.5, 0.2, 0.3] }
    // movePane: the column itself travels, so its 0.5 travels with it.
    const moved = movePane(l, 0, 3)
    expect(moved.panes).toEqual(['b.md', 'c.md', 'a.md'])
    expect(paneSizes(moved)).toEqual([0.2, 0.3, 0.5])
    invariants(moved)
    // swapPanes: two NOTES trade columns and the columns stay where they are,
    // which is what makes "nothing else on screen moves" literally true.
    const swapped = swapPanes(l, 0, 2)
    expect(swapped.panes).toEqual(['c.md', 'b.md', 'a.md'])
    expect(paneSizes(swapped)).toEqual([0.5, 0.2, 0.3])
    invariants(swapped)
  })

  it('resets to even by dropping the array, so a reset layout equals a fresh one', () => {
    const l = dragged(3, 1)
    const reset = equalisePanes(l)
    expect(reset.sizes).toBeUndefined()
    // and it is a no-op on a layout that was already even — nothing to persist,
    // and no pointless re-render from a new object identity.
    expect(equalisePanes(reset)).toBe(reset)
    invariants(reset)
    // dragging a two-way split back to dead centre records as the same reset
    expect(dragged(1, 1).sizes).toBeUndefined()
  })

  it('falls back to even for anything it cannot trust, WHOLE rather than per-entry', () => {
    const l = twoCols()
    // A half-repaired array is a layout nobody chose; even is always defensible.
    expect(paneSizes({ ...l, sizes: [1] })).toEqual([0.5, 0.5]) // wrong length
    expect(paneSizes({ ...l, sizes: [0.5, 0] })).toEqual([0.5, 0.5]) // a zero column
    expect(paneSizes({ ...l, sizes: [NaN, 1] })).toEqual([0.5, 0.5])
    expect(paneSizes({ ...l, sizes: [-1, 2] })).toEqual([0.5, 0.5])
    // unnormalised but usable is normalised, not rejected
    expect(paneSizes({ ...l, sizes: [30, 10] })).toEqual([0.75, 0.25])
  })

  it('refuses a resize it cannot make sense of instead of producing a broken split', () => {
    const l = dragged(3, 1)
    expect(resizePanes(l, 0, 1, 1)).toBe(l) // pane 0 has no divider before it
    expect(resizePanes(l, 2, 1, 1)).toBe(l) // past the last pane
    expect(resizePanes(l, 1, 0, 1)).toBe(l) // a zero-width column
    expect(resizePanes(l, 1, NaN, 1)).toBe(l)
  })

  it('reopens a session even when any of its notes did not come back', () => {
    // Drop one note and every index after it describes a different column than
    // the one that was measured. Rather than guess which width belonged to which
    // survivor, the split reopens even — a losable sidecar losing well.
    const saved = { tabs: ['a.md', 'b.md'], panes: ['a.md', 'b.md'], focus: 0, sizes: [0.8, 0.2] }
    const both = restoreLayout(saved, () => true)
    expect(both.sizes).toEqual([0.8, 0.2])
    invariants(both)

    const one = restoreLayout(saved, (p) => p === 'a.md')
    expect(one.panes).toEqual(['a.md'])
    expect(one.sizes).toBeUndefined()
    invariants(one)
  })

  it('exports a minimum wide enough to still be a text column', () => {
    // The clamp itself lives at the drag (only the caller knows how wide a pixel
    // is), but the NUMBER is the model's — it rests on the same judgement
    // MAX_PANES does, and a divider that let a pane below it would undo that cap.
    expect(MIN_PANE_PX).toBeGreaterThanOrEqual(300)
  })
})
