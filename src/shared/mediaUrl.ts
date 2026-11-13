// The private address a picture or video in the vault is shown from.
//
// Until 2026-11-11 the window asked main for a file's BYTES (`readAsset`) and kept
// them as a blob for as long as the app stayed open — every picture and video
// ever looked at, about three times its size while it loaded
// (docs/app-check-2026-11-09.md item 2). Now main hands the window an ADDRESS and
// serves the file from it a piece at a time (main/mediaProtocol.ts), so a video
// starts at once and nothing is kept. (Recordings still play from bytes in hand,
// on purpose — renderer/src/editor/voiceAssets.ts says why.)
//
// The address is `notealise-media://<token>/?p=<path>&v=<version>`:
//   - `<token>` is made new at every launch and known only to main and to the
//     app's own page. It is what stops a video player's frame (YouTube, Vimeo —
//     the only other pages the window ever holds) from asking for a file by
//     guessing its name. docs/security.md "2f".
//   - `p` is the vault-relative path, as ONE encoded value. Not the address's own
//     path: a URL parser tidies a path (`..`, a trailing dot, a backslash), and a
//     name must reach main's boundary check exactly as it was written.
//   - `v` changes when the file does, so a picture replaced on disk is not shown
//     from the window's memory of the old one.
//
// Shared because three things must agree on the scheme's name: main (which
// serves it), the window's Content-Security-Policy (electron.vite.config.ts) and
// the tests.

export const MEDIA_SCHEME = 'notealise-media'

export function mediaUrl(token: string, relPath: string, version: string): string {
  return `${MEDIA_SCHEME}://${token}/?p=${encodeURIComponent(relPath)}&v=${encodeURIComponent(version)}`
}

/** The vault-relative path an address names — null unless it is one of ours and
 *  carries this launch's token. */
export function mediaPathOf(url: string, token: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null
  if (!token || parsed.host !== token) return null
  const rel = parsed.searchParams.get('p')
  return rel ? rel : null
}

/** Which bytes a request wants. `whole` when it names no range (or one this does
 *  not understand — a server may ignore those); `none` when the range starts past
 *  the end of the file. */
export function byteRange(
  header: string | null,
  size: number
): { start: number; end: number } | 'whole' | 'none' {
  if (!header) return 'whole'
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return 'whole'
  if (m[1] === '') {
    // "the last N bytes"
    const n = Number(m[2])
    if (n === 0 || size === 0) return 'none'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  if (!Number.isSafeInteger(start) || start >= size) return 'none'
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (!Number.isSafeInteger(end) || end < start) return 'whole'
  return { start, end }
}
