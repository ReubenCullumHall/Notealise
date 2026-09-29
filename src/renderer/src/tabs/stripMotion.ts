// Which tabs a layout change just OPENED or CLOSED, so the strip can animate
// the action rather than the button (Reuben, 2026-09-24: "the animation should
// always be tied to the action rather than the input that leads to the
// action"). Every change to the tabs goes through App's `applyLayout`, which
// reports here — so the + button, Cmd/Ctrl+click, a link opened in a new tab, a
// note dropped on the strip, a split, Cmd/Ctrl+W, the x, a middle-click, the
// menu, and a note binned or deleted on disk all read the same way.
//
// Only a change that purely adds or purely removes counts. Both at once is one
// note taking another's place — a plain sidebar click, a rename or a move — and
// nothing is opening or closing. Swapping the whole strip (switching space,
// restoring the last session at launch, changing vault) is not reported at all:
// App passes those through quietly.

const opened = new Set<string>()
const closed = new Set<string>()
// Notes whose column just closed. Most are still in a joined tab (a split
// stepped out of stays one) or have closed outright; the strip keeps only
// the ones now drawn as a tab of their own — a note that LEFT its split (the
// column's x, "take out of split", ending the split) and animates those.
const unsplit = new Set<string>()

export const noteLayoutChange = (prev: string[], next: string[]): void => {
  const added = next.filter((t) => !prev.includes(t))
  const removed = prev.filter((t) => !next.includes(t))
  if (added.length && !removed.length) added.forEach((t) => opened.add(t))
  else if (removed.length && !added.length) removed.forEach((t) => closed.add(t))
}

/** The tabs opened and closed since the strip last looked, and the notes whose
 *  column closed, and forgets them — one render answers for each change. */
export const takeStripChanges = (): { opened: string[]; closed: string[]; unsplit: string[] } => {
  const out = { opened: [...opened], closed: [...closed], unsplit: [...unsplit] }
  opened.clear()
  closed.clear()
  unsplit.clear()
  return out
}

// The same for the columns on screen: the note that just JOINED them as a new
// column, so NotePane can grow THAT column in. The columns are keyed by
// position (App), so the one React mounts is always the last — a note dropped
// on the left edge used to grow the right-hand column, which was showing the
// note you had been reading. The columns a join pushed along start from the
// width they had, so the split still adds up while the new one grows.
//
// Only a change that adds exactly one column and takes none away counts. Going
// back to a split you stepped out of swaps several in at once, and just
// appears; so does a quiet swap (App passes those as `prev = []`).
let joined: { path: string | null; was: Map<string, number> } | null = null

export const notePaneChange = (prev: string[], next: string[], prevSizes: number[]): void => {
  if (prev.length === next.length && prev.every((p, i) => p === next[i])) return
  const added = next.filter((p) => !prev.includes(p))
  const removed = prev.filter((p) => !next.includes(p))
  removed.forEach((p) => unsplit.add(p))
  joined =
    prev.length && added.length === 1 && !removed.length
      ? { path: added[0], was: new Map(prev.map((p, i) => [p, prevSizes[i]])) }
      : null
}

/** Where the column now showing `path` starts from, and forgets it: 0 for the
 *  note that just joined, the old width for one the join pushed along, or null
 *  for a column that has nothing to animate. */
export const takePaneStart = (path: string): number | null => {
  if (!joined) return null
  if (path === joined.path) {
    joined.path = null // answered
    return 0
  }
  const was = joined.was.get(path)
  joined.was.delete(path)
  return was ?? null
}
