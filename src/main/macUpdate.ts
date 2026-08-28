import { app, net } from 'electron'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  RELEASES_API,
  isAllowedReleaseUrl,
  parseFeed,
  pickRelease,
  type FeedRelease
} from '../shared/update'

// The macOS half of updating, and the reason it exists is worth stating plainly:
// Squirrel.Mac REFUSES to apply an unsigned update — a signature check, not a
// dismissible warning — so `electron-updater` can do nothing here and parks in
// `unsupported`. Before this file, that parking happened *before* the feed was
// ever read, so a Mac user was never even told a new version existed. They sat
// on a stale build believing they were current, which is the worst shape of the
// problem: silent, and indistinguishable from being up to date.
//
// So this does everything up to the part macOS forbids: read the public
// releases feed, work out whether there is something newer, fetch the .dmg into
// Downloads, and hand the user the finished file. Installing it is theirs.
//
// No new dependency. Electron's own `net` is used rather than `https` or a
// fetch library: it goes through Chromium's network stack, so a corporate proxy
// or a system-configured PAC file works the same way it does for the rest of
// the app, and there is nothing extra to ship (CLAUDE.md's dependency rule).

/** Electron types `IncomingMessage` as an event emitter, but at runtime it is a
 *  Node Readable — which is how `pipeline` can consume it at all. The cast is
 *  kept to this one place rather than sprinkled at each call site. */
const asStream = (res: Electron.IncomingMessage): Readable => res as unknown as Readable

/** A .dmg is ~100 MB. The cap is deliberately generous but finite: without one,
 *  a wrong URL can fill the user's disk while a progress bar cheerfully counts. */
const MAX_DMG_BYTES = 600 * 1024 * 1024

/** GET a URL through Chromium's stack and resolve the body as text.
 *  Rejects rather than returning a partial body, so a truncated response can
 *  never be parsed as an empty feed and read as "you are up to date". */
function getText(url: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isAllowedReleaseUrl(url)) return reject(new Error(`refusing to fetch ${url}`))
    const req = net.request({ method: 'GET', url })
    // GitHub requires a User-Agent and will 403 without one.
    req.setHeader('User-Agent', `Notealise/${app.getVersion()}`)
    req.setHeader('Accept', 'application/vnd.github+json')
    const timer = setTimeout(() => {
      req.abort()
      reject(new Error('the update check timed out'))
    }, timeoutMs)
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timer)
        asStream(res).resume() // drain, or the socket is held open
        reject(new Error(`the update feed answered ${res.statusCode}`))
        return
      }
      let body = ''
      res.on('data', (c) => (body += c.toString('utf8')))
      res.on('end', () => {
        clearTimeout(timer)
        resolve(body)
      })
      res.on('error', (e: Error) => {
        clearTimeout(timer)
        reject(e)
      })
    })
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

/**
 * Ask GitHub whether there is a newer version for this Mac.
 *
 * Returns null both when the user is current AND when the check could not be
 * made — being offline is the normal state of an offline-first app, not an
 * error worth putting in front of someone writing a note. The caller decides
 * whether to surface anything; a thrown error here would have to be swallowed
 * there anyway.
 */
export async function checkMacUpdate(): Promise<FeedRelease | null> {
  try {
    const body = await getText(`${RELEASES_API}?per_page=20`)
    const feed = parseFeed(JSON.parse(body))
    return pickRelease(feed, app.getVersion())
  } catch {
    return null
  }
}

/** Where a finished download lands, and what it is called. Uses the real
 *  version rather than a fixed name so two downloads never collide, and so the
 *  file in Finder says which version it is without being opened. */
function targetPath(version: string): string {
  return path.join(app.getPath('downloads'), `Notealise-${version}.dmg`)
}

/**
 * Fetch the .dmg into the user's Downloads folder.
 *
 * Written to a `.part` file and renamed only once the whole body has arrived,
 * for the same reason `vault.ts` writes notes that way: a half-downloaded file
 * sitting in Downloads under the real name is indistinguishable from a good one
 * until it fails to mount. A failure removes the partial rather than leaving
 * litter behind.
 *
 * If the finished file is already there, it is handed straight back — someone
 * who downloaded and then clicked again should not wait for 100 MB twice.
 */
export async function downloadMacDmg(
  release: FeedRelease,
  onProgress: (percent: number) => void
): Promise<string> {
  if (!release.dmgUrl || !isAllowedReleaseUrl(release.dmgUrl)) {
    throw new Error('that release has no macOS download')
  }
  const dest = targetPath(release.version)
  try {
    const st = await fs.stat(dest)
    if (st.isFile() && st.size > 0) return dest
  } catch {
    /* not there yet — the normal path */
  }

  const part = `${dest}.part`
  await fs.rm(part, { force: true })

  const res = await new Promise<Electron.IncomingMessage>((resolve, reject) => {
    const req = net.request({ method: 'GET', url: release.dmgUrl as string })
    req.setHeader('User-Agent', `Notealise/${app.getVersion()}`)
    req.on('response', (r) => {
      if (r.statusCode < 200 || r.statusCode >= 300) {
        asStream(r).resume() // drain, or the socket is held open
        reject(new Error(`the download answered ${r.statusCode}`))
        return
      }
      resolve(r)
    })
    req.on('error', reject)
    req.end()
  })

  const total = Number(res.headers['content-length'] ?? 0)
  let seen = 0
  let lastReported = -1
  res.on('data', (chunk: Buffer) => {
    seen += chunk.length
    if (seen > MAX_DMG_BYTES) {
      asStream(res).destroy(new Error('that download is larger than any release'))
    }
    if (!total) return
    // Report whole percentages only. Without this the status is pushed to the
    // renderer thousands of times for one download, and every push re-renders.
    const pct = Math.min(100, Math.floor((seen / total) * 100))
    if (pct !== lastReported) {
      lastReported = pct
      onProgress(pct)
    }
  })

  try {
    await pipeline(asStream(res), createWriteStream(part))
    // `total` is the length GitHub declared, when it declared one at all — a
    // release asset always has, confirmed against the live feed, but a proxy
    // or CDN in front of it is not obliged to forward the header. Rather than
    // skip verification entirely when it's missing, fall back to "not empty":
    // still catches the connection-dropped-immediately case a bare "the
    // pipeline resolved" cannot, without depending on a header the server
    // might not send.
    if (total ? seen !== total : seen === 0) {
      throw new Error('the download ended early — try again')
    }
    await fs.rename(part, dest)
    return dest
  } catch (e) {
    await fs.rm(part, { force: true })
    throw e
  }
}
