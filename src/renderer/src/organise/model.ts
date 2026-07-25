// Pure derivation for the sidebar's organisation layer: it merges the file tree
// (the source of truth) with workspace.json (order / pins / archive) into the
// lists each view renders. No fs, no DOM — that keeps the ordering rules in one
// testable place instead of scattered through the row renderers.

import type { TreeNode } from '../../../shared/types'
import type { EntryMeta, Workspace } from '../../../shared/workspace'
import { isSelfOrDescendant } from '../../../shared/workspace'

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

export function sortArchived(nodes: TreeNode[], ws: Workspace, sort: ArchiveSort): TreeNode[] {
  const at = (n: TreeNode): number => metaOf(ws, n.path).archivedAt ?? 0
  return [...nodes].sort((a, b) => {
    if (sort === 'recent') return at(b) - at(a)
    if (sort === 'oldest') return at(a) - at(b)
    if (sort === 'az') return labelOf(a).localeCompare(labelOf(b))
    return labelOf(b).localeCompare(labelOf(a))
  })
}

/** Relative-day stamp for the archive/bin subtitle ("Today", "Yesterday", or a
 *  short date). Intl formatting proper is a later settings feature. */
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
