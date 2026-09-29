// Notes and folders just made with New note / New folder, waiting for their
// sidebar row to appear so it can grow in (Reuben, 2026-09-23: the same slow
// bounce as a new tab). App's newNote/newFolder mark the path the moment main
// returns it; the tree row that first renders it takes it back out.
//
// A plain module-level set rather than state: nothing re-renders because of it,
// and the four ways of making a note (the sidebar buttons, a folder's hover
// buttons, the right-click menu, Ctrl+N) all meet in those two App functions,
// so marking there covers every one — while a note that appears for any OTHER
// reason (a rename, a move, the file watcher) is never marked and never grows.
//
// Marks lapse after a few seconds, like the bin's below. A note made inside a
// folder that is shut has no row to grow, and its mark used to wait — so the
// row bounced in whenever that folder was next opened, minutes later.
const pending = new Map<string, number>()

export const markCreated = (path: string): void => {
  pending.set(path, performance.now())
}

export const pendingCreated = (): string[] => {
  const now = performance.now()
  for (const [p, at] of pending) if (now - at >= 5000) pending.delete(p)
  return [...pending.keys()]
}

export const takeCreated = (path: string): void => {
  pending.delete(path)
}

// The same for leaving: paths just sent to the bin, so their rows can shrink
// shut instead of vanishing. Marked by App's `trash` (every Move to bin route
// goes through it); a row that leaves for any other reason — a move, a rename —
// is not marked and just goes. Marks lapse after a few seconds, so a trash that
// failed can't make some later, unrelated disappearance play as a delete.
const leaving = new Map<string, number>()

export const markDeleted = (paths: string[]): void => {
  const now = performance.now()
  paths.forEach((p) => leaving.set(p, now))
}

/** Whether `path` was just binned. Not forgotten on the first answer: a pinned
 *  note has a row in the Pinned list AND the tree, and both should shrink. */
export const wasDeleted = (path: string): boolean => {
  const at = leaving.get(path)
  if (at === undefined) return false
  if (performance.now() - at < 5000) return true
  leaving.delete(path)
  return false
}

export const anyDeleted = (): boolean => leaving.size > 0
