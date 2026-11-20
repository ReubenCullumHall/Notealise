// A block carried by its six dots (editor/attachMove.ts) over a note in the sidebar: which
// note row is lit, so letting go there moves the block to the end of that note (Reuben,
// 2026-11-19). The drag is the editor's own mouse gesture, not an HTML drag, so the sidebar
// can't see it through drag events — the editor says which row it is over here, and each
// TreeView lights that row the way it lights a folder a note is dropped into.

let target: string | null = null
const listeners = new Set<() => void>()

/** The note row the carried block is over, or null. */
export function setBlockDropTarget(path: string | null): void {
  if (path === target) return
  target = path
  for (const l of listeners) l()
}

export const blockDropTarget = (): string | null => target

export function subscribeBlockDrop(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The sidebar note row under a point, if any — what a block can be dropped onto. Only the
 *  notes list and Pinned (not the archive, search hits or the bin). */
export function noteRowAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  const row = el instanceof Element ? el.closest<HTMLElement>('[data-row-path]') : null
  if (!row) return null
  const list = row.closest<HTMLElement>('[data-tree-mode]')
  const mode = list?.dataset.treeMode
  if ((mode !== 'tree' && mode !== 'pinned') || list?.dataset.archive === '1') return null
  const path = row.dataset.rowPath ?? ''
  return /\.md$/i.test(path) ? path : null
}

/** A note's text with a moved block on the end: after an empty line, so it is a block of its
 *  own and never runs into the last line (a paragraph, or a list it would join). What the note
 *  already has is left exactly as it is — its own trailing empty lines included. */
export function appendBlock(text: string, block: string): string {
  if (!text.trim()) return block + '\n'
  const gap = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return text + gap + block + '\n'
}
