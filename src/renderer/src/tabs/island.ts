// The tab island: the collapsible group at the left of the tab strip holding
// the notes you keep coming back to, so they don't have to be found in the
// folder tree every time. Opera's tab islands are the reference (Reuben,
// 2026-09-17).
//
// Pure arithmetic only, the same split `tabs/model.ts` keeps: this file decides
// what the island CONTAINS and in what order, `Island.tsx` decides what it
// looks like, and `App.tsx` is the only thing that writes to disk.
//
// **One island per space, and it is never stored as a list.** A note's
// membership is a rank on the note itself (`EntryMeta.island`), and the island
// it belongs to is the island of the space its own path sits in. There is no
// islands-to-notes map anywhere, which is the whole point: renaming a note,
// moving it to the bin, or deleting a space already carry `EntryMeta` with them
// (`main/workspace.ts`'s `migrateKey` / `trashEntries` / `deleteSpace`), so
// none of them can leave the island pointing at a note that isn't there. A
// stored list would need all three taught about it, and the one that got missed
// would be a ghost entry nobody could click.

import type { EntryMeta } from '../../../shared/workspace'

/** What the island is called before anyone renames it. */
export const ISLAND_NAME_DEFAULT = 'Commonly accessed'

/** Is `path` inside the space rooted at `folder`? `''` is the whole vault — the
 *  state a vault is in before it has any top-level folders (see App's `space`),
 *  where every note counts.
 *
 *  Segment-wise, not `startsWith`: a space called `Work` must not swallow a
 *  folder called `Workshop`, which the bare string prefix would. Same rule as
 *  the vault boundary in `main/vault.ts`, for the same reason. */
export function inSpace(path: string, folder: string): boolean {
  if (!folder) return true
  return path === folder || path.startsWith(folder + '/')
}

/** This space's island, in island order.
 *
 *  `exists` is the set of note paths the tree currently knows about. Passing it
 *  is what keeps a note deleted in Finder from showing as a chip you can click
 *  but not open — `workspace.json` outlives the file, deliberately (rule 1), so
 *  the entry is still there. The rank is left alone in that case rather than
 *  cleaned up: the file coming back (a sync catching up, an undo in Finder)
 *  should put the note back in the island where it was. */
export function islandNotes(
  entries: Record<string, EntryMeta>,
  folder: string,
  exists?: ReadonlySet<string>
): string[] {
  return Object.entries(entries)
    .filter(
      ([path, meta]) =>
        typeof meta?.island === 'number' && inSpace(path, folder) && (!exists || exists.has(path))
    )
    .sort(
      // Rank first; path only to break a tie. Two notes can share a rank after
      // an interrupted write (each chip is its own IPC call — see App's
      // `writeIsland`), and an unstable order there would make chips swap
      // places on the next render for no reason the user did.
      ([aPath, a], [bPath, b]) => (a.island as number) - (b.island as number) || aPath.localeCompare(bPath)
    )
    .map(([path]) => path)
}

/** `list` after `paths` land in front of `before` (null = at the end).
 *
 *  A path already in the island MOVES rather than duplicating — dragging a chip
 *  along the island and dragging a note in from the sidebar are the same
 *  operation to this function, which is what makes reordering free. */
export function withAdded(list: string[], paths: string[], before: string | null): string[] {
  const arriving = paths.filter((p, i) => p && paths.indexOf(p) === i)
  if (!arriving.length) return list
  const rest = list.filter((p) => !arriving.includes(p))
  // The anchor may itself be one of the things moving (drop a chip onto its own
  // left edge). It has left `rest` by then, so "before it" no longer means
  // anything — the drop is a no-op position, and the end is the honest answer.
  const at = before === null ? -1 : rest.indexOf(before)
  if (at < 0) return [...rest, ...arriving]
  return [...rest.slice(0, at), ...arriving, ...rest.slice(at)]
}

/** `list` without `path`. */
export function withRemoved(list: string[], path: string): string[] {
  return list.filter((p) => p !== path)
}

/** The smallest set of writes that turns `entries` into `next`.
 *
 *  Ranks are renumbered 0..n-1 on every change rather than wedged between two
 *  neighbours: an island holds a handful of notes, and integer positions with
 *  no gaps are the one arrangement that can't drift into needing a rebalance.
 *  Only the paths whose rank actually MOVED are returned, plus `undefined` for
 *  anything dropped out — each one is a separate IPC round trip, so a reorder
 *  at the right-hand end should not rewrite the whole island. `undefined` is
 *  how `EntryMeta` fields are cleared (App's `movedAt` does the same). */
export function rankWrites(
  before: string[],
  next: string[]
): { path: string; island: number | undefined }[] {
  const writes: { path: string; island: number | undefined }[] = []
  for (const path of before) if (!next.includes(path)) writes.push({ path, island: undefined })
  next.forEach((path, i) => {
    if (before.indexOf(path) !== i) writes.push({ path, island: i })
  })
  return writes
}

// --- what a drag is carrying ------------------------------------------------
// Four private MIME types, one per place a note can be picked up from. They are
// private for the reason `application/x-notes-tab` already was: the sidebar
// tree gates its own drops on its own state, and a chip leaving the island must
// not look to it like a note being filed into a folder.
//
// **The island has to decide whether to accept a drag from `dataTransfer.types`
// alone.** `getData` returns an empty string during `dragover` in every browser
// — the payload is only readable on `drop` — so a drop target that needs to
// know "is this for me?" while the pointer is still moving has nothing but the
// type list to read. That is the whole reason the sources below set a typed key
// at all, rather than everything sharing `text/plain`.

/** an open note being dragged from the tab strip, the links strip or a note link */
export const DRAG_TAB = 'application/x-notes-tab'
/** one or more notes being dragged out of the sidebar tree (newline-separated) */
export const DRAG_NOTE = 'application/x-notes-note'
/** a search result being dragged out of the search panel */
export const DRAG_SEARCH = 'application/x-notes-search'
/** a chip being dragged along, or out of, the island it is already in */
export const DRAG_CHIP = 'application/x-notes-island'

const NOTE_TYPES = [DRAG_CHIP, DRAG_TAB, DRAG_SEARCH, DRAG_NOTE] as const

/** Does this drag carry notes the island could take? Readable during `dragover`,
 *  unlike the payload itself. */
export function dragCarriesNotes(types: readonly string[]): boolean {
  return NOTE_TYPES.some((t) => types.includes(t))
}

/** The note paths a drop is carrying, in the order they were picked up. Only
 *  callable on `drop` — see the note above. */
export function pathsFromDrag(data: DataTransfer): string[] {
  for (const type of NOTE_TYPES) {
    const raw = data.getData(type)
    if (raw) return raw.split('\n').filter(Boolean)
  }
  return []
}
