// What "Search notes" remembers of each note's text, and what it forgets when
// something changes outside the app.
//
// Searching inside notes reads every note once and keeps the text (App.tsx
// `contentCache`), so the next search is instant. Until 2026-11-12 ANY change
// made outside the app threw the whole lot away — and in a folder that syncs
// (OneDrive bringing in one note from the other computer) that is all day long,
// so the next search read every note again (docs/app-check-2026-11-09.md,
// "Search notes forgets everything on any outside change"). The watcher already
// says exactly which notes and folders changed; only those are forgotten.

/** The same path however it was spelled: two machines can write one name with
 *  different letter-case or a different form of "é", and a change that was missed
 *  for that would leave Search showing a note's OLD words. Forgetting one note
 *  too many only costs reading it again. */
const fold = (p: string): string => p.normalize('NFC').toLowerCase()

/** Forget the text of every note in `changed`, and of every note inside a
 *  folder in `changed` (a folder renamed, moved or deleted outside the app is
 *  reported by its own path). */
export function forgetChanged(cache: Map<string, string>, changed: readonly string[]): void {
  if (!cache.size || !changed.length) return
  const exact = new Set<string>()
  const folders: string[] = []
  for (const p of changed) {
    if (!p) {
      // The vault's own folder was reported: anything may have changed.
      cache.clear()
      return
    }
    const f = fold(p)
    exact.add(f)
    folders.push(f + '/')
  }
  for (const key of [...cache.keys()]) {
    const k = fold(key)
    if (exact.has(k) || folders.some((dir) => k.startsWith(dir))) cache.delete(key)
  }
}
