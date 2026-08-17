// Pure derivation for the sidebar's organisation layer: it merges the file tree
// (the source of truth) with workspace.json (order / pins / archive) into the
// lists each view renders. No fs, no DOM — that keeps the ordering rules in one
// testable place instead of scattered through the row renderers.

import type { TreeNode } from '../../../shared/types'
import type { EntryMeta, Workspace } from '../../../shared/workspace'
import { isSelfOrDescendant } from '../../../shared/workspace'
import { pickAutoColor } from '../../../shared/color'

export const NO_META: EntryMeta = {}

export const metaOf = (ws: Workspace, path: string): EntryMeta => ws.entries[path] ?? NO_META

/** Archiving a folder carries its whole subtree by inheritance — only the folder
 *  the user dropped is flagged, so restoring it puts the branch back intact. */
export function isArchived(ws: Workspace, path: string): boolean {
  for (const [key, meta] of Object.entries(ws.entries)) {
    if (meta.archived && isSelfOrDescendant(path, key)) return true
  }
  return false
}

/** A row's colour, and where it came from. `own` is false when the row has no
 *  colour of its own and is showing an ancestor's. */
export interface RowColor {
  hex: string
  own: boolean
  /** the path the colour is stored on — the row itself, or the ancestor it was
   *  inherited from. What the picker names when it says where a colour is set. */
  from: string
}

/**
 * What colour a row paints in.
 *
 * NEAREST coloured ancestor wins, unlike `isArchived` just above, where ANY
 * flagged ancestor is enough. The difference is deliberate: archive is a yes/no
 * that can only be turned on, so "any" is the same as "nearest", but two
 * colours in one branch are a real disagreement — colouring `Revision` blue and
 * `Revision/Physics` green has to mean the physics notes are green. Walking up
 * from the row rather than scanning every entry also makes this O(depth)
 * instead of O(entries) per row, which matters: it runs for every visible row
 * on every sidebar render.
 */
export function colorOf(ws: Workspace, path: string, inherit = true): RowColor | null {
  const own = ws.entries[path]?.color
  if (own) return { hex: own, own: true, from: path }
  if (!inherit) return null
  let p = path
  for (;;) {
    const i = p.lastIndexOf('/')
    if (i === -1) return null
    p = p.slice(0, i)
    const hex = ws.entries[p]?.color
    if (hex) return { hex, own: false, from: p }
  }
}

/** The colours already in use by the immediate children of `dir` — what
 *  `pickAutoColor` avoids repeating so a new folder doesn't come out the same
 *  colour as the one above it. */
export function siblingColors(ws: Workspace, dir: string): string[] {
  const prefix = dir ? dir + '/' : ''
  const out: string[] = []
  for (const [key, meta] of Object.entries(ws.entries)) {
    if (!meta.color) continue
    if (!key.startsWith(prefix)) continue
    if (key.slice(prefix.length).includes('/')) continue // a grandchild, not a sibling
    out.push(meta.color)
  }
  return out
}

/**
 * Colours for every folder under `nodes` that hasn't got one — what switching
 * "colour new folders automatically" ON applies to the folders you already have.
 * Returns a `path -> hex` plan rather than writing, so the caller can do it in
 * one round trip and so the rules below are testable without a vault.
 *
 * Three of them, each learned from the alternative looking wrong:
 *  1. **A folder with its own colour is never touched.** The setting is about
 *     folders you have not decided about; overwriting a deliberate choice
 *     because a switch was flipped elsewhere is not something a toggle may do.
 *  2. **Colours already assigned in THIS pass count as taken.** Without that,
 *     every folder in a parent sees the same "used" set and the whole level
 *     comes out one colour — the exact thing auto-colour exists to prevent.
 *  3. **Notes are skipped.** They inherit their folder's colour; colouring each
 *     one individually is what makes a sidebar loud rather than legible.
 */
export function autoColorPlan(
  nodes: TreeNode[],
  ws: Workspace,
  palette: readonly string[],
  /** the folder `nodes` are the children of — '' for the vault root */
  rootDir = '',
  rand: () => number = Math.random
): Record<string, string> {
  const plan: Record<string, string> = {}
  if (!palette.length) return plan

  const walk = (list: TreeNode[], dir: string): void => {
    // What this level has already spoken for. It starts from the colours on
    // disk and grows as this pass hands them out, which is rule 2: reading the
    // used-set once per level would show every sibling the same answer and
    // paint the whole level one colour.
    const used = [...siblingColors(ws, dir)]
    for (const n of list) {
      if (n.type !== 'dir') continue
      if (!ws.entries[n.path]?.color) {
        const hex = pickAutoColor(palette, used, rand)
        if (hex) {
          plan[n.path] = hex
          used.push(hex)
        }
      }
      if (n.children) walk(n.children, n.path)
    }
  }
  walk(nodes, rootDir)
  return plan
}

/** The archived entries that are the *top* of their branch — the only ones the
 *  archive view lists, since everything under them came along for the ride. */
export function archivedRoots(ws: Workspace): string[] {
  const flagged = Object.entries(ws.entries)
    .filter(([, m]) => m.archived)
    .map(([p]) => p)
  return flagged.filter((p) => !flagged.some((other) => other !== p && isSelfOrDescendant(p, other)))
}

/** Sort one level of siblings. `freeArrange` off puts folders above notes (the
 *  familiar default); on, they share one sequence and can interleave. Order is
 *  stored in a single sequence either way, so toggling never scrambles anything. */
export function sortSiblings(
  nodes: TreeNode[],
  ws: Workspace,
  freeArrange: boolean
): TreeNode[] {
  const withOrder = nodes.map((n) => ({
    node: n,
    order: metaOf(ws, n.path).order ?? Number.MAX_SAFE_INTEGER
  }))
  withOrder.sort((a, b) => {
    if (!freeArrange && a.node.type !== b.node.type) return a.node.type === 'dir' ? -1 : 1
    if (a.order !== b.order) return a.order - b.order
    return a.node.name.localeCompare(b.node.name)
  })
  return withOrder.map((x) => x.node)
}

/** Split one level of siblings into entries recently landed here via a
 *  cross-space drag (`EntryMeta.movedAt`) and everything else. The caller
 *  renders `moved` first, under a small "Moved" divider, then `rest` in the
 *  ordinary sort — a cross-space drop is blind (the destination wasn't the
 *  list the user was looking at when they let go), so alphabetical or
 *  free-arrange order would bury it instead of prompting a decision.
 *  Most-recently-moved first among themselves; `rest` keeps `sortSiblings`'s
 *  own rules untouched. */
export function splitMoved(
  nodes: TreeNode[],
  ws: Workspace,
  freeArrange: boolean
): { moved: TreeNode[]; rest: TreeNode[] } {
  const moved: TreeNode[] = []
  const rest: TreeNode[] = []
  for (const n of nodes) {
    if (metaOf(ws, n.path).movedAt) moved.push(n)
    else rest.push(n)
  }
  moved.sort((a, b) => (metaOf(ws, b.path).movedAt ?? 0) - (metaOf(ws, a.path).movedAt ?? 0))
  return { moved, rest: sortSiblings(rest, ws, freeArrange) }
}

/** Hide anything archived (or inside an archived branch) from the notes view. */
export function withoutArchived(nodes: TreeNode[], ws: Workspace): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (isArchived(ws, n.path)) continue
    out.push(n.children ? { ...n, children: withoutArchived(n.children, ws) } : n)
  }
  return out
}

/** Pinned entries hoisted into the Pinned section. An item inside a pinned folder
 *  is not hoisted separately — it is already visible under its parent. */
export function pinnedRoots(nodes: TreeNode[], ws: Workspace): TreeNode[] {
  const found: TreeNode[] = []
  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      if (metaOf(ws, n.path).pinned) {
        found.push(n)
        continue // don't descend: its children travel with it
      }
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return found
}

/** Paths of the entries shown in the Pinned section, so the main tree can skip
 *  them and they don't appear twice. */
export function pinnedPathSet(nodes: TreeNode[], ws: Workspace): Set<string> {
  return new Set(pinnedRoots(nodes, ws).map((n) => n.path))
}

/** Drop the hoisted-pinned entries from the ordinary tree. */
export function withoutPinned(nodes: TreeNode[], hoisted: Set<string>): TreeNode[] {
  const out: TreeNode[] = []
  for (const n of nodes) {
    if (hoisted.has(n.path)) continue
    out.push(n.children ? { ...n, children: withoutPinned(n.children, hoisted) } : n)
  }
  return out
}

/** Every note under `nodes`, flattened. */
export function flattenNotes(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      if (n.type === 'file') out.push(n)
      else if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

/** Find a node anywhere in the tree by its path. */
export function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    if (n.children) {
      const hit = findNode(n.children, path)
      if (hit) return hit
    }
  }
  return null
}

/** The archive's sort is a *view*, never a rewrite of stored order — sorting A–Z
 *  must not change where things land when restored. */
export type ArchiveSort = 'recent' | 'oldest' | 'az' | 'za'

export const ARCHIVE_SORTS: { id: ArchiveSort; label: string; short: string }[] = [
  { id: 'recent', label: 'Recently archived', short: 'Recent' },
  { id: 'oldest', label: 'Oldest first', short: 'Oldest' },
  { id: 'az', label: 'Title A–Z', short: 'A–Z' },
  { id: 'za', label: 'Title Z–A', short: 'Z–A' }
]

const stripMd = (s: string): string => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s)
export const labelOf = (n: TreeNode): string => (n.type === 'dir' ? n.name : stripMd(n.name))

/** Relative-day stamp for the archive/bin subtitle ("Today", "Yesterday", or a
 *  short date). Intl formatting proper is a later settings feature — legacy's
 *  own archive/bin rows don't read the Formatting settings either (see
 *  legacy/src/App.jsx:68), they're a fixed absolute date; this stays as-is. */
export function onDate(ms: number | undefined): string | null {
  if (!ms) return null
  const d = new Date(ms)
  const today = new Date()
  const days = Math.floor(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86400000
  )
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function sortArchived(nodes: TreeNode[], ws: Workspace, sort: ArchiveSort): TreeNode[] {
  const at = (n: TreeNode): number => metaOf(ws, n.path).archivedAt ?? 0
  return [...nodes].sort((a, b) => {
    if (sort === 'recent') return at(b) - at(a)
    if (sort === 'oldest') return at(a) - at(b)
    if (sort === 'az') return labelOf(a).localeCompare(labelOf(b))
    return labelOf(b).localeCompare(labelOf(a))
  })
}

