// One URL cache per kind of embedded asset (images, video, recordings), built
// from a single implementation.
//
// For a picture or a video, what is kept is the file's ADDRESS — a short string
// — never the file. Until 2026-11-11 every file was read whole over IPC and kept
// as a blob until the vault switched, so every picture, video and recording ever
// looked at stayed in memory for as long as the app was open
// (docs/app-check-2026-11-09.md item 2: five 60 MB clips took the app from
// ~440 MB to ~1,100 MB). Main now serves the file from that address a piece at a
// time (shared/mediaUrl.ts, main/mediaProtocol.ts): a video starts at once, and
// what the window holds is whatever the element on screen is showing.
// A recording is still held whole, but only while something is playing or
// showing it (`forget`; voiceAssets.ts has the reason).
//
// Why a factory rather than hand-written copies: the ask goes over the same IPC
// boundary either way, the in-flight de-duplication is the same, and live
// preview rebuilds its decorations on every viewport/selection change, so all
// need the same "don't ask main again while scrolling" cache. When the
// video cache was written as a copy of the image one, its `clear` was never
// wired up to the vault switch that the image one had been wired to for
// months — so switching between two vaults that happened to share a relative
// path (two vaults each with `Import/clip.mp4`) played the OLD vault's video.
// `clearAssetCaches` below exists so that can't happen again: every cache made
// here registers itself, and one call clears all of them.

export interface AssetCache {
  /** The URL for `relPath` if it's already known — for a synchronous first
   *  paint, with `load` filling in behind it. */
  cached(relPath: string): string | undefined
  /** Get a URL an element can show the file from, or null if the file isn't
   *  there. Repeat calls while one is in flight share that single ask. */
  load(relPath: string): Promise<string | null>
  /** Let one file go — and free it, in a cache that holds bytes. */
  forget(relPath: string): void
  /** Let everything go. */
  clear(): void
}

const registered: AssetCache[] = []

/** `holds` is what stays in the window for each file:
 *   - `'address'` (pictures, videos): the address main serves the file from. A
 *     short string; nothing to free.
 *   - `'bytes'` (recordings): the whole file, as a blob. For the one kind that is
 *     kept playing after its note has gone — see voiceAssets.ts — and freed by
 *     `forget` the moment its player is let go, not at the next vault switch. */
export function createAssetCache(holds: 'address' | 'bytes' = 'address'): AssetCache {
  const urls = new Map<string, string>()
  const inFlight = new Map<string, Promise<string | null>>()

  // No type is given either way, and none is needed for <img>, <video> or
  // <audio>: the browser sniffs the format, so we don't need a path-extension →
  // MIME table that would only ever be a worse guess than the decoder's.
  const ask = async (relPath: string): Promise<string> =>
    holds === 'bytes'
      ? URL.createObjectURL(new Blob([(await window.api.readAsset(relPath)) as unknown as BlobPart]))
      : window.api.mediaUrl(relPath)
  const free = (url: string): void => {
    if (holds === 'bytes') URL.revokeObjectURL(url)
  }

  const cache: AssetCache = {
    cached: (relPath) => urls.get(relPath),

    load: (relPath) => {
      const done = urls.get(relPath)
      if (done) return Promise.resolve(done)
      const already = inFlight.get(relPath)
      if (already) return already

      // One retry, then give up.
      //
      // A big video pasted in is still being written when the widget that shows
      // it first asks for it, so the ask fails, `null` is cached as the answer,
      // and the note shows "Video not found" for a file that arrived a moment
      // later. Reported 2026-08-24 as "not a file size problem, a loading time
      // problem", which is exactly right: pasting the same clip again without
      // switching notes worked.
      //
      // Deliberately one retry and a fixed pause, not a growing backoff: the
      // only failure this is meant to cover is a write finishing a beat late,
      // and a file that genuinely is not there should reach its "not found"
      // state promptly rather than after several silent waits.
      const once = async (): Promise<string> => {
        try {
          return await ask(relPath)
        } catch {
          await new Promise((r) => setTimeout(r, 400))
          return ask(relPath)
        }
      }
      const p: Promise<string | null> = once()
        .then((url) => {
          // Forgotten while it was loading: nobody is waiting for it any more,
          // and kept, a blob would sit in memory with nothing to ever free it.
          if (inFlight.get(relPath) !== p) {
            free(url)
            return null
          }
          urls.set(relPath, url)
          return url
        })
        .catch(() => null)
        .finally(() => {
          if (inFlight.get(relPath) === p) inFlight.delete(relPath)
        })

      inFlight.set(relPath, p)
      return p
    },

    forget: (relPath) => {
      const url = urls.get(relPath)
      if (url !== undefined) {
        urls.delete(relPath)
        free(url)
      }
      inFlight.delete(relPath) // one still loading frees itself when it lands
    },

    clear: () => {
      for (const url of urls.values()) free(url)
      urls.clear()
    }
  }

  registered.push(cache)
  return cache
}

/** Let go of every cached file of every kind. Called on a vault switch: the keys
 *  are vault-RELATIVE paths, so `Import/photo.png` names a different file in a
 *  different vault and a kept entry would show the previous vault's content.
 *  Also frees any bytes held. */
export function clearAssetCaches(): void {
  for (const cache of registered) cache.clear()
}
