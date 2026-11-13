// Serving a vault's pictures and videos to the window a piece at a time — the
// main-process half of shared/mediaUrl.ts (read its header first).
//
// Rules, each with its reason (docs/security.md "2f"):
//   - Every request goes through vault.ts's `openAsset`, i.e. `resolveReal`: the
//     same boundary as every other read. The address names a vault-relative
//     path and nothing else can be asked for.
//   - A request without this launch's token is refused before the path is even
//     looked at. The window holds two kinds of page — the app's own, and a video
//     player's frame — and only the first is ever told the token.
//   - GET only, and never a thrown error: a throw inside a protocol handler is an
//     uncaught exception in main, which Electron shows as an error box.
//   - No Content-Type is sent, but for one kind. The window worked out what a
//     file was from its contents when it held the bytes as an untyped blob, and
//     it does the same here — so a picture with an odd extension shows exactly as
//     it did. The exception is `.svg`, which cannot be told from its contents and
//     so showed as "not found" in every build until Reuben's yes of 2026-11-13: it
//     is sent as `image/svg+xml`. Inside an <img>, which is the only place the
//     window's policy lets this address go, an SVG runs no script and fetches
//     nothing; the response also carries a policy of its own that forbids both,
//     for the day anything ever shows one as a page.
//
// No Electron import: `index.ts` does the two registrations, so this file is
// tested against a real folder like vault.ts (mediaProtocol.test.ts).

import { randomBytes } from 'node:crypto'
import { byteRange, mediaPathOf, mediaUrl } from '../shared/mediaUrl'
import { openAsset, type AssetFile } from './vault'

/** New at every launch; never written anywhere. */
const token = randomBytes(16).toString('hex')

/** One piece of a file. Big enough that a film is a few hundred reads, small
 *  enough that five videos loading at once hold a few megabytes between them. */
const PIECE = 1024 * 1024

/** The address the window gives an <img>, <video> or <audio> for a vault file.
 *  Rejects when the file isn't there, as `readAsset` did — that is what the
 *  window's "not found" state hangs on. */
export async function mediaAddress(relPath: string): Promise<string> {
  const file = await openAsset(relPath)
  return mediaUrl(token, relPath, `${Math.round(file.mtimeMs)}-${file.size}`)
}

function piecesOf(file: AssetFile, start: number, end: number): ReadableStream<Uint8Array> {
  let at = start
  let done = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return
      try {
        const want = Math.min(PIECE, end - at + 1)
        const piece = want > 0 ? await file.read(at, want) : new Uint8Array(0)
        if (done) return // cancelled while the read was out
        if (piece.byteLength > 0) {
          at += piece.byteLength
          controller.enqueue(piece)
        }
        // A short piece means the file ended early (it shrank mid-stream).
        if (piece.byteLength < want || at > end) {
          done = true
          controller.close()
        }
      } catch (e) {
        if (done) return
        done = true
        controller.error(e)
      }
    },
    cancel() {
      done = true // the player seeked or went away; nothing is held open to close
    }
  })
}

const refused = (status: number): Response => new Response(null, { status })

export async function serveMedia(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET') return refused(405)
    const rel = mediaPathOf(request.url, token)
    if (rel === null) return refused(403)
    let file: AssetFile
    try {
      file = await openAsset(rel)
    } catch {
      return refused(404) // gone, outside the vault, or not a file — one answer for all three
    }
    // No Access-Control-Allow-Origin: a page may SHOW these, never read them.
    const headers: Record<string, string> = { 'Accept-Ranges': 'bytes' }
    if (/\.svg$/i.test(rel)) {
      headers['Content-Type'] = 'image/svg+xml'
      headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
    }
    const range = byteRange(request.headers.get('range'), file.size)
    if (range === 'none') {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } })
    }
    if (range === 'whole') {
      return new Response(file.size ? piecesOf(file, 0, file.size - 1) : null, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(file.size) }
      })
    }
    return new Response(piecesOf(file, range.start, range.end), {
      status: 206,
      headers: {
        ...headers,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`
      }
    })
  } catch {
    return refused(500)
  }
}
