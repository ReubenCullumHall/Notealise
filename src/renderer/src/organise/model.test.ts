import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import type { Workspace } from '../../../shared/workspace'
import {
  archivedRoots,
  isArchived,
  pinnedRoots,
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
