// Turning a vault-relative image path into something an <img> can show.
//
// Not a `file://` URL on purpose: in dev the renderer is served over http and
// the browser refuses to load one, so images would work in the packaged app and
// silently not in dev. The bytes come through the same IPC boundary as every
// other read instead, and become a blob: URL here.
//
// Cached per path because live preview rebuilds its decorations on every
// viewport/selection change — without a cache, scrolling past an image would
// re-read it from disk and mint a new blob each time.

const urls = new Map<string, string>()
const inFlight = new Map<string, Promise<string | null>>()

export function cachedUrl(relPath: string): string | undefined {
  return urls.get(relPath)
}

export function loadImage(relPath: string): Promise<string | null> {
  const done = urls.get(relPath)
  if (done) return Promise.resolve(done)
  const already = inFlight.get(relPath)
  if (already) return already

  const p = window.api
    .readAsset(relPath)
    .then((bytes) => {
      // `new Blob([bytes])` with no type is enough for an <img>: the browser
      // sniffs the format, so we don't need a path-extension → MIME table that
      // would only ever be a worse guess than the decoder's.
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
      urls.set(relPath, url)
      return url
    })
    .catch(() => null)
    .finally(() => inFlight.delete(relPath))

  inFlight.set(relPath, p)
  return p
}

/** Drop every cached blob. Called on a vault switch — the paths are relative,
 *  so the same "images/x.png" means a different file in a different vault, and
 *  a stale entry would show the previous vault's picture. */
export function clearImageCache(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url)
  urls.clear()
}

/** Resolve a markdown image target against the note holding it. Returns null
 *  for anything that isn't a plain in-vault relative path — a remote URL is
 *  left to the <img> itself, and a path escaping the vault is refused here as
 *  well as in main. */
export function resolveVaultPath(target: string, notePath: string): string | null {
  if (/^[a-z]+:\/\//i.test(target) || target.startsWith('data:') || target.startsWith('#')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(target)
  } catch {
    decoded = target // a stray % that isn't an escape — use it as written
  }
  if (decoded.startsWith('/')) return null

  const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  const parts = dir ? dir.split('/') : []
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null // climbed out of the vault
      parts.pop()
    } else {
      parts.push(seg)
    }
  }
  return parts.length ? parts.join('/') : null
}
