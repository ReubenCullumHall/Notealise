// Giving every attached photo and video an identity of its own.
//
// Today a picture IS its path: a note says `![](stare.png)` and that string is
// the only thing connecting the two. Rename the file in Finder and the note
// points at nothing, with no way for the app to tell that the file it can now
// see is the one the note just lost. The bytes are fine, the note is fine, and
// they can never be reintroduced.
//
// So a sidecar in `.mdnotes/` remembers, per file, an id that does not change
// when the name does. NOT written into the notes themselves — that was the
// explicit call (2026-08-23): notes stay ordinary Markdown that any other
// editor renders correctly, and everything the app knows about them lives
// beside them, removable without touching a single note.
//
// Pure, and separated from the file system, because "which of these two files
// is the one that moved" is a guess, and a guess is exactly the thing that has
// to be pinned down in tests rather than discovered in someone's vault.

/** What is known about one attached file. */
export interface MediaRecord {
  /** vault-relative path it is at NOW — the mutable half. */
  path: string
  /** bytes. The evidence a renamed file is the same file. */
  size: number
  /** epoch ms first seen. */
  added: number
}

/** id -> record. The id is the stable half and never changes once minted. */
export type MediaIndex = Record<string, MediaRecord>

/** One file, as the vault scan found it. */
export interface MediaOnDisk {
  path: string
  size: number
}

/** A file that is no longer where the index left it, but is recognisably still
 *  here under another name. `from` is what notes still say; `to` is the truth. */
export interface MediaMove {
  id: string
  from: string
  to: string
}

export interface Reconciled {
  index: MediaIndex
  /** Renames/moves worth telling somebody about — every one of these is a note
   *  somewhere with a picture that has stopped loading. */
  moved: MediaMove[]
}

/** The extension, lowercased, or '' — part of deciding whether two files are
 *  the same one. A .png that became a .mp4 of identical length is not a rename
 *  by any reading, and refusing to match across kinds costs nothing. */
function extOf(p: string): string {
  const base = p.slice(p.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** Bring the index up to date against what is actually in the vault.
 *
 *  Three things can have happened to a known file since the last scan: nothing,
 *  it moved or was renamed, or it is gone. Only the middle one is interesting,
 *  and it is the only one that has to be inferred.
 *
 *  **How a move is recognised: same size, same extension, and — the part that
 *  matters — unambiguously so.** If exactly one unaccounted-for file on disk
 *  matches exactly one missing record, that is a rename. If two missing records
 *  or two new files have the same size and extension, nothing is claimed and
 *  both are left alone: two 4 MB photos from the same camera are a completely
 *  ordinary thing to have, and repointing a note at the wrong picture is far
 *  worse than not repointing it at all. Size is a weak signal used only where
 *  it happens to be decisive.
 *
 *  A record whose file is simply missing is KEPT, not dropped. The usual reason
 *  is that it is sitting in `.mdnotes/trash` waiting to be restored, and
 *  forgetting its id would mean it came back as a stranger. */
export function reconcileMedia(index: MediaIndex, onDisk: MediaOnDisk[], now: number, mintId: () => string): Reconciled {
  const next: MediaIndex = {}
  const claimed = new Set<string>()

  // Anything still exactly where it was keeps its id, untouched.
  const byPath = new Map(onDisk.map((f) => [f.path, f]))
  const missing: [string, MediaRecord][] = []
  for (const [id, rec] of Object.entries(index)) {
    const here = byPath.get(rec.path)
    if (here) {
      next[id] = { ...rec, size: here.size }
      claimed.add(rec.path)
    } else {
      missing.push([id, rec])
    }
  }

  // Everything on disk that no record accounts for. One of these may be a
  // missing record under a new name.
  const loose = onDisk.filter((f) => !claimed.has(f.path))
  const moved: MediaMove[] = []

  const key = (size: number, p: string): string => `${size}:${extOf(p)}`
  const count = (list: { size: number; path: string }[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const f of list) m.set(key(f.size, f.path), (m.get(key(f.size, f.path)) ?? 0) + 1)
    return m
  }
  const missingCounts = count(missing.map(([, r]) => r))
  const looseCounts = count(loose)

  const takenLoose = new Set<string>()
  for (const [id, rec] of missing) {
    const k = key(rec.size, rec.path)
    // Exactly one on each side, or it is not decisive and nothing is claimed.
    if (missingCounts.get(k) !== 1 || looseCounts.get(k) !== 1) {
      next[id] = rec // keep it: probably binned, possibly deleted
      continue
    }
    const match = loose.find((f) => !takenLoose.has(f.path) && key(f.size, f.path) === k)
    if (!match) {
      next[id] = rec
      continue
    }
    takenLoose.add(match.path)
    next[id] = { ...rec, path: match.path, size: match.size }
    moved.push({ id, from: rec.path, to: match.path })
  }

  // Whatever is left really is new.
  for (const f of loose) {
    if (takenLoose.has(f.path)) continue
    next[mintId()] = { path: f.path, size: f.size, added: now }
  }

  return { index: next, moved }
}

/** The id for a path, or undefined. Linear because a vault's attachment count
 *  is in the hundreds, not the millions, and an inverted map would be one more
 *  thing to keep honest. */
export function idForPath(index: MediaIndex, path: string): string | undefined {
  return Object.keys(index).find((id) => index[id].path === path)
}
