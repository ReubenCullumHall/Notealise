import { listTree } from '../vault'
import type { TreeNode } from '../../shared/types'

/** Every note title already in the vault, lower-cased. Titles rather than
 *  paths, because an import lands in a NEW space every time — the same note
 *  re-imported has a different path but the same name, and the path would
 *  never match. */
async function existingTitles(): Promise<Set<string>> {
  const titles = new Set<string>()
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'file' && n.name.toLowerCase().endsWith('.md')) {
        titles.add(n.name.slice(0, -3).toLowerCase())
      }
      if (n.children) walk(n.children)
    }
  }
  walk(await listTree())
  return titles
}

/** A plain-language warning when a source looks like it has been imported
 *  before, or overlaps notes already here.
 *
 *  Re-running an import always creates a NEW space rather than merging (the
 *  user's call — each import stays one reviewable, deletable unit). That is
 *  safe, but silent: import the same export twice and the vault quietly holds
 *  two copies of everything with nothing saying so. This says so, at preview
 *  time, while it's still one click to back out.
 *
 *  Deliberately advisory: it never blocks, and it never merges — a note titled
 *  "Notes" matching an unrelated one is a coincidence, not a duplicate, and
 *  guessing wrong in either direction is worse than telling the user. */
export async function duplicateWarning(incomingTitles: string[]): Promise<string[]> {
  if (incomingTitles.length === 0) return []
  const existing = await existingTitles()
  if (existing.size === 0) return []

  const seen = new Set<string>()
  let overlap = 0
  for (const t of incomingTitles) {
    const key = t.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (existing.has(key)) overlap++
  }
  if (overlap === 0) return []

  const all = overlap === seen.size
  return [
    `${overlap} of these ${all ? '' : `${seen.size} `}notes already exist somewhere in your vault` +
      `${all ? ' — this looks like the same source imported again' : ''}. Importing makes a ` +
      `second copy in a new space rather than merging; delete that space if it isn’t what you wanted.`
  ]
}
