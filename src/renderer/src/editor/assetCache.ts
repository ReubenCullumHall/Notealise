// One blob-URL cache per kind of embedded asset (images, video), built from a
// single implementation.
//
// Why a factory rather than two hand-written copies: the bytes come over the
// same IPC boundary either way, the in-flight de-duplication is the same, and
// live preview rebuilds its decorations on every viewport/selection change, so
// both need the same "don't re-read from disk while scrolling" cache. When the
// video cache was written as a copy of the image one, its `clear` was never
// wired up to the vault switch that the image one had been wired to for
// months — so switching between two vaults that happened to share a relative
// path (two vaults each with `Import/clip.mp4`) played the OLD vault's video.
// `clearAssetCaches` below exists so that can't happen again: every cache made
// here registers itself, and one call clears all of them.

export interface AssetCache {
  /** The blob: URL for `relPath` if it's already loaded — for a synchronous
   *  first paint, with `load` filling in behind it. */
  cached(relPath: string): string | undefined
  /** Read the bytes and mint a blob: URL, or null if the read failed. Repeat
   *  calls while one is in flight share that single read. */
  load(relPath: string): Promise<string | null>
  /** Drop this cache's blobs, revoking each URL. */
  clear(): void
}

const registered: AssetCache[] = []

export function createAssetCache(): AssetCache {
  const urls = new Map<string, string>()
  const inFlight = new Map<string, Promise<string | null>>()

  const cache: AssetCache = {
    cached: (relPath) => urls.get(relPath),

    load: (relPath) => {
      const done = urls.get(relPath)
      if (done) return Promise.resolve(done)
      const already = inFlight.get(relPath)
      if (already) return already

      const p = window.api
        .readAsset(relPath)
        .then((bytes) => {
          // `new Blob([bytes])` with no type is enough for both <img> and
          // <video>: the browser sniffs the format, so we don't need a
          // path-extension → MIME table that would only ever be a worse guess
          // than the decoder's.
          const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
          urls.set(relPath, url)
          return url
        })
        .catch(() => null)
        .finally(() => inFlight.delete(relPath))

      inFlight.set(relPath, p)
      return p
    },

    clear: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }

  registered.push(cache)
  return cache
}

/** Drop every cached blob of every kind. Called on a vault switch: the keys are
 *  vault-RELATIVE paths, so `Import/photo.png` names a different file in a
 *  different vault and a kept entry would show the previous vault's content.
 *  Also frees the blobs. */
export function clearAssetCaches(): void {
  for (const cache of registered) cache.clear()
}
