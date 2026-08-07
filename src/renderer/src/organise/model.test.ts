import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import type { Workspace } from '../../../shared/workspace'
import {
  archivedRoots,
  autoColorPlan,
  colorOf,
  isArchived,
  pinnedRoots,
  siblingColors,
  sortArchived,
  sortSiblings,
  withoutArchived
} from './model'

// The rules these cover are the ones a user notices immediately when they break:
// an archived folder's children reappearing, a pinned note showing up twice, or
// the sidebar order changing on its own.

const file = (path: string): TreeNode => ({ name: path.split('/').pop()!, path, type: 'file' })
const dir = (path: string, children: TreeNode[] = []): TreeNode => ({
  name: path.split('/').pop()!,
  path,
  type: 'dir',
  children
})
const ws = (entries: Workspace['entries']): Workspace => ({ entries, trash: [] })

describe('isArchived', () => {
  it('inherits down the tree, so a folder carries its subtree', () => {
    const w = ws({ work: { archived: true } })
    expect(isArchived(w, 'work')).toBe(true)
    expect(isArchived(w, 'work/deep/note.md')).toBe(true)
    expect(isArchived(w, 'personal/note.md')).toBe(false)
  })

  it('does not leak across similarly-named siblings', () => {
    const w = ws({ work: { archived: true } })
    expect(isArchived(w, 'workshop/note.md')).toBe(false)
  })

  it('treats archived:false as not archived', () => {
    expect(isArchived(ws({ work: { archived: false } }), 'work')).toBe(false)
  })
})

describe('archivedRoots', () => {
  it('lists only the top of each archived branch', () => {
    // both flagged, but the child came along for the ride — listing it too would
    // show the same thing twice in the archive view
    const w = ws({ work: { archived: true }, 'work/sub': { archived: true } })
    expect(archivedRoots(w)).toEqual(['work'])
  })

  it('keeps independent branches', () => {
    const w = ws({ work: { archived: true }, personal: { archived: true } })
    expect(archivedRoots(w).sort()).toEqual(['personal', 'work'])
  })
})

describe('withoutArchived', () => {
  it('removes archived entries at every depth', () => {
    const tree = [dir('work', [file('work/a.md')]), file('b.md'), file('c.md')]
    const out = withoutArchived(tree, ws({ work: { archived: true }, 'c.md': { archived: true } }))
    expect(out.map((n) => n.path)).toEqual(['b.md'])
  })

  it('keeps a folder but drops its archived child', () => {
    const tree = [dir('work', [file('work/a.md'), file('work/b.md')])]
    const out = withoutArchived(tree, ws({ 'work/a.md': { archived: true } }))
    expect(out[0].children!.map((n) => n.path)).toEqual(['work/b.md'])
  })
})

describe('sortSiblings', () => {
  const nodes = [file('b.md'), dir('zed'), file('a.md'), dir('alpha')]

  it('puts folders first, then alphabetical, when free-arrange is off', () => {
    expect(sortSiblings(nodes, ws({}), false).map((n) => n.path)).toEqual([
      'alpha',
      'zed',
      'a.md',
      'b.md'
    ])
  })

  it('lets notes and folders interleave when free-arrange is on', () => {
    const w = ws({ 'b.md': { order: 0 }, zed: { order: 1 }, 'a.md': { order: 2 } })
    expect(sortSiblings(nodes, w, true).map((n) => n.path)).toEqual([
      'b.md',
      'zed',
      'a.md',
      'alpha' // no order -> sorts last
    ])
  })

  it('respects explicit order within a type when free-arrange is off', () => {
    const w = ws({ 'b.md': { order: 0 }, 'a.md': { order: 1 } })
    expect(sortSiblings([file('a.md'), file('b.md')], w, false).map((n) => n.path)).toEqual([
      'b.md',
      'a.md'
    ])
  })

  it('does not mutate the input array', () => {
    const input = [file('b.md'), file('a.md')]
    const before = input.map((n) => n.path)
    sortSiblings(input, ws({}), false)
    expect(input.map((n) => n.path)).toEqual(before)
  })
})

describe('pinnedRoots', () => {
  it('does not descend into a pinned folder', () => {
    // the child is already visible under its pinned parent; hoisting it too
    // would show it twice
    const tree = [dir('work', [file('work/a.md')])]
    const w = ws({ work: { pinned: true }, 'work/a.md': { pinned: true } })
    expect(pinnedRoots(tree, w).map((n) => n.path)).toEqual(['work'])
  })

  it('finds pinned entries nested inside unpinned folders', () => {
    const tree = [dir('work', [dir('work/sub', [file('work/sub/a.md')])])]
    const w = ws({ 'work/sub/a.md': { pinned: true } })
    expect(pinnedRoots(tree, w).map((n) => n.path)).toEqual(['work/sub/a.md'])
  })
})

describe('colorOf', () => {
  it('prefers the row’s own colour over anything above it', () => {
    const w = ws({ work: { color: '#111111' }, 'work/a.md': { color: '#222222' } })
    expect(colorOf(w, 'work/a.md')).toEqual({ hex: '#222222', own: true, from: 'work/a.md' })
  })

  it('takes the NEAREST coloured ancestor, not just any', () => {
    // This is the one place it deliberately differs from isArchived, where any
    // flagged ancestor is enough. Archive is a flag that can only be turned on,
    // so "any" and "nearest" agree; two colours in one branch are a real
    // disagreement, and colouring a subfolder has to beat its parent or
    // recolouring one subject inside a space would silently do nothing.
    const w = ws({ work: { color: '#111111' }, 'work/sub': { color: '#333333' } })
    expect(colorOf(w, 'work/sub/deep/a.md')).toEqual({
      hex: '#333333',
      own: false,
      from: 'work/sub'
    })
  })

  it('reports where an inherited colour came from', () => {
    // The picker names it ("inheriting from work"), so a user can tell whether
    // clearing this row will leave it grey or fall back to its folder.
    const w = ws({ work: { color: '#111111' } })
    expect(colorOf(w, 'work/a.md')).toEqual({ hex: '#111111', own: false, from: 'work' })
  })

  it('returns nothing when inheritance is off and the row has no colour', () => {
    const w = ws({ work: { color: '#111111' } })
    expect(colorOf(w, 'work/a.md', false)).toBeNull()
    // …but the folder that HAS the colour still shows it. "Off" turns off
    // inheritance, not colour.
    expect(colorOf(w, 'work', false)).toEqual({ hex: '#111111', own: true, from: 'work' })
  })

  it('does not leak across similarly-named siblings', () => {
    // Same trap isSelfOrDescendant exists to avoid: "workshop" is not inside
    // "work", and a prefix comparison would say it was.
    expect(colorOf(ws({ work: { color: '#111111' } }), 'workshop/a.md')).toBeNull()
  })

  it('returns nothing for an uncoloured vault', () => {
    expect(colorOf(ws({ work: { pinned: true } }), 'work/a.md')).toBeNull()
  })
})

describe('siblingColors', () => {
  const w = ws({
    physics: { color: '#111111' },
    maths: { color: '#222222' },
    'physics/waves': { color: '#333333' },
    english: { pinned: true }
  })

  it('lists only the immediate children of the folder', () => {
    // Grandchildren must not count: auto-colour is trying to keep a new folder
    // distinct from the rows it will sit NEXT TO, not from everything under it.
    expect(siblingColors(w, '').sort()).toEqual(['#111111', '#222222'])
    expect(siblingColors(w, 'physics')).toEqual(['#333333'])
  })

  it('skips entries that have no colour', () => {
    expect(siblingColors(w, '')).not.toContain(undefined)
  })

  it('is empty for a folder whose children are uncoloured', () => {
    expect(siblingColors(w, 'maths')).toEqual([])
  })
})

describe('autoColorPlan', () => {
  const palette = ['#aa0000', '#00bb00', '#0000cc']

  it('gives every uncoloured folder a colour and leaves notes alone', () => {
    // Notes inherit their folder's colour. Colouring them individually is what
    // turns a legible sidebar into a loud one, so the plan must never name one.
    const tree = [dir('a', [file('a/x.md')]), dir('b'), file('loose.md')]
    const plan = autoColorPlan(tree, ws({}), palette)
    expect(Object.keys(plan).sort()).toEqual(['a', 'b'])
  })

  it('never overwrites a colour that was chosen by hand', () => {
    // The whole risk of a backfill: a switch flipped on one page silently
    // repainting decisions made on another.
    const tree = [dir('a'), dir('b')]
    const plan = autoColorPlan(tree, ws({ a: { color: '#123456' } }), palette)
    expect(plan.a).toBeUndefined()
    expect(plan.b).toBeDefined()
  })

  it('gives siblings different colours', () => {
    // The bug this guards: reading the used-set once per level shows every
    // sibling the same answer, and the whole level comes out one colour —
    // exactly what auto-colour exists to prevent. Fixed rand() so a pass only
    // succeeds if the used-set really grows as it goes.
    const tree = [dir('a'), dir('b'), dir('c')]
    const plan = autoColorPlan(tree, ws({}), palette, '', () => 0)
    expect(new Set(Object.values(plan)).size).toBe(3)
  })

  it('counts a hand-coloured sibling as taken', () => {
    const tree = [dir('a'), dir('b')]
    const plan = autoColorPlan(tree, ws({ a: { color: '#aa0000' } }), palette, '', () => 0)
    expect(plan.b).not.toBe('#aa0000')
  })

  it('descends into subfolders, scoping siblings to each level', () => {
    // A child may reuse a colour its uncle has — they are never seen side by
    // side. Only true siblings have to differ.
    const tree = [dir('a', [dir('a/one'), dir('a/two')])]
    const plan = autoColorPlan(tree, ws({}), palette, '', () => 0)
    expect(Object.keys(plan).sort()).toEqual(['a', 'a/one', 'a/two'])
    expect(plan['a/one']).not.toBe(plan['a/two'])
  })

  it('scopes the top level to rootDir, so one space does not see another', () => {
    // Called with a space's children and that space's folder. Passing '' would
    // make a space's folders avoid colours used by every OTHER space's folders.
    const tree = [dir('sp/one'), dir('sp/two')]
    const plan = autoColorPlan(tree, ws({ other: { color: '#aa0000' } }), palette, 'sp', () => 0)
    expect(Object.values(plan)).toContain('#aa0000')
  })

  it('plans nothing when the palette is empty', () => {
    // There is nothing to assign, and inventing a colour would be the app
    // deciding something it was not asked to decide.
    expect(autoColorPlan([dir('a')], ws({}), [])).toEqual({})
  })
})

describe('sortArchived', () => {
  const tree = [file('a.md'), file('b.md'), file('c.md')]
  const w = ws({
    'a.md': { archivedAt: 300 },
    'b.md': { archivedAt: 100 },
    'c.md': { archivedAt: 200 }
  })

  it('sorts newest first for "recent"', () => {
    expect(sortArchived(tree, w, 'recent').map((n) => n.path)).toEqual(['a.md', 'c.md', 'b.md'])
  })

  it('sorts oldest first for "oldest"', () => {
    expect(sortArchived(tree, w, 'oldest').map((n) => n.path)).toEqual(['b.md', 'c.md', 'a.md'])
  })

  it('sorts by title without the .md extension', () => {
    expect(sortArchived(tree, w, 'az').map((n) => n.path)).toEqual(['a.md', 'b.md', 'c.md'])
    expect(sortArchived(tree, w, 'za').map((n) => n.path)).toEqual(['c.md', 'b.md', 'a.md'])
  })

  it("is a view only — it never mutates the caller's list", () => {
    const input = [file('a.md'), file('b.md')]
    sortArchived(input, w, 'za')
    expect(input.map((n) => n.path)).toEqual(['a.md', 'b.md'])
  })
})
