import { app, net, type Session } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { cleanTitle, parseVideoUrl, PLAYER_HOSTS, singleWebUrl, type LinkInfo, type VideoLink } from '../shared/embeds'

// Looking up a pasted web address: its title, and for a video its picture.
//
// This is the first place the app asks a website anything on the user's behalf,
// so the rules are tight and each one has a reason:
//
//   - ONLY when the user pastes an address. Never when a note opens, never from
//     what a note contains — a note arrives from other people, and a look-up on
//     open would be a read receipt (see the CSP note in electron.vite.config.ts).
//   - The title is WRITTEN INTO THE NOTE, so it is fetched once and never again.
//   - A page is asked for ~256 KB at most, only HTML is read, nothing is sent but
//     a plain GET — no cookies, no login, no referrer — and a slow site is given
//     six seconds.
//   - Never an address on the user's own machine or network: a pasted link to a
//     router's admin page must not be fetched, and neither must a public page
//     that redirects to one. Every hop of a redirect is checked.
//   - A video's picture comes only from the two hosts the video sites use for
//     theirs, and is kept in userData (not the vault — it is a cache, losable,
//     and not part of anyone's notes).

const TIMEOUT_MS = 6000
const MAX_PAGE = 256 * 1024
const MAX_JSON = 64 * 1024
const MAX_THUMB = 1536 * 1024
const MAX_HOPS = 5

// --- pure helpers (tested in linkPreview.test.ts) ---------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®',
  trade: '™', middot: '·', bull: '•', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è',
  agrave: 'à', uuml: 'ü', ouml: 'ö', auml: 'ä', szlig: 'ß', ccedil: 'ç', ntilde: 'ñ',
  pound: '£', euro: '€', yen: '¥', times: '×', rarr: '→', larr: '←'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

/** A page's bytes as text, in the encoding the page says it is in — the
 *  `Content-Type` header first, then a `<meta charset>` near the top, else UTF-8.
 *  A page in Latin-1 or Shift-JIS read as UTF-8 puts � in the title, which then
 *  gets written into the note. An encoding this runtime doesn't know falls back
 *  to UTF-8 rather than failing: a slightly wrong title beats none. */
export function decodeHtmlBody(body: Buffer, contentType: string): string {
  const named = /charset\s*=\s*["']?([\w-]+)/i
  const label =
    named.exec(contentType)?.[1] ?? named.exec(body.subarray(0, 2048).toString('latin1'))?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(label).decode(body)
  } catch {
    return body.toString('utf8')
  }
}

/** The best title in a page's HTML: the one it gives social sites (`og:title`,
 *  usually without the site's name tacked on), else `<title>`. Null if neither
 *  holds anything. Only the head is worth reading, so a truncated page is fine. */
export function extractTitle(html: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const key of ['og:title', 'twitter:title']) {
    for (const tag of metas) {
      const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
      if (name !== key) continue
      const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
      const text = cleanTitle(decodeEntities(content?.[1] ?? content?.[2] ?? ''))
      if (text) return text
    }
  }
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const text = t ? cleanTitle(decodeEntities(t[1])) : ''
  return text || null
}

/** Is this host somewhere on the open internet — and so fair to ask — rather than
 *  the user's own machine or network? Names with no dot (`router`, `nas`) are
 *  the local network's too. */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h) return false
  if (h.includes(':')) return isPublicV6(h)
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) return isPublicV4(v4.slice(1).map(Number))
  if (!h.includes('.')) return false
  return !/\.(localhost|local|internal|lan|home|home\.arpa|corp|intranet)$/.test(h)
}

function isPublicV4(o: number[]): boolean {
  if (o.some((n) => n > 255)) return false
  const [a, b] = o
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  return true
}

/** The eight 16-bit groups of an IPv6 address, or null if it isn't one. A dotted
 *  IPv4 on the end (`::ffff:1.2.3.4`) counts as the last two groups. */
function v6Groups(h: string): number[] | null {
  let s = h
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s)
  if (dotted) {
    const o = dotted.slice(1).map(Number)
    if (o.some((n) => n > 255)) return null
    s = `${s.slice(0, dotted.index)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if (halves.length === 1 ? head.length !== 8 : head.length + tail.length > 7) return null
  const fill = halves.length === 2 ? new Array<string>(8 - head.length - tail.length).fill('0') : []
  const groups = [...head, ...fill, ...tail].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
  return groups.length === 8 && groups.every((n) => !Number.isNaN(n)) ? groups : null
}

function isPublicV6(h: string): boolean {
  const g = v6Groups(h)
  if (!g) return false
  const embedded = (): number[] => [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]
  // The first 96 bits all zero: `::`, `::1` and the old IPv4-compatible `::a.b.c.d`.
  if (g.slice(0, 6).every((n) => n === 0)) return false
  // ::ffff:a.b.c.d — an IPv4 address in an IPv6 coat. Read by its groups, because
  // `new URL` writes `[::ffff:127.0.0.1]` as `[::ffff:7f00:1]`, never with dots.
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return isPublicV4(embedded())
  // 64:ff9b::/96 — an IPv4 address behind a NAT64 translator.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0)) return isPublicV4(embedded())
  if ((g[0] & 0xfe00) === 0xfc00) return false // fc00::/7, unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false // fe80::/10, link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false // fec0::/10, old site-local
  if ((g[0] & 0xff00) === 0xff00) return false // ff00::/8, multicast
  return true
}

const isThumbHost = (host: string): boolean =>
  host === 'i.ytimg.com' || host === 'img.youtube.com' || host === 'i.vimeocdn.com'

// --- the network ------------------------------------------------------------

interface Got {
  status: number
  type: string
  body: Buffer
}

/** GET `url` and read at most `maxBytes` of it. Resolves null on anything
 *  unusual — never throws — because a failed look-up simply means the address
 *  stays an address. `until` lets a page stop being read once its head is in. */
function get(
  url: string,
  accept: string,
  maxBytes: number,
  allow: (u: URL) => boolean,
  until?: (tail: string) => boolean
): Promise<Got | null> {
  return new Promise((resolve) => {
    let settled = false
    let req: ReturnType<typeof net.request> | null = null
    const finish = (v: Got | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      req?.abort()
      finish(null)
    }, TIMEOUT_MS)
    const ok = (raw: string): boolean => {
      try {
        const u = new URL(raw)
        return (u.protocol === 'https:' || u.protocol === 'http:') && allow(u)
      } catch {
        return false
      }
    }
    if (!ok(url)) return finish(null)
    try {
      // `credentials: 'omit'` and no session cookies: the site learns an address
      // and a browser name, not who is asking.
      req = net.request({ method: 'GET', url, redirect: 'manual', credentials: 'omit', useSessionCookies: false })
    } catch {
      return finish(null)
    }
    req.setHeader('User-Agent', `Mozilla/5.0 (compatible; Notealise/${app.getVersion()})`)
    req.setHeader('Accept', accept)
    req.setHeader('Accept-Language', 'en')
    let hops = 0
    req.on('redirect', (_status, _method, redirectUrl) => {
      if (++hops > MAX_HOPS || !ok(redirectUrl)) {
        req?.abort()
        finish(null)
        return
      }
      req?.followRedirect()
    })
    req.on('response', (res) => {
      const raw = res.headers['content-type']
      const type = (Array.isArray(raw) ? raw[0] : (raw ?? '')).toLowerCase()
      const chunks: Buffer[] = []
      let size = 0
      let tail = ''
      const done = (): void => finish({ status: res.statusCode, type, body: Buffer.concat(chunks) })
      res.on('data', (c: Buffer) => {
        chunks.push(c)
        size += c.length
        tail = (tail + c.toString('latin1')).slice(-4096)
        if (size >= maxBytes || (until && until(tail))) {
          req?.abort()
          done()
        }
      })
      res.on('end', done)
      res.on('error', () => finish(null))
    })
    req.on('error', () => finish(null))
    req.end()
  })
}

const anyPublic = (u: URL): boolean => isPublicHost(u.hostname)

async function pageTitle(url: string): Promise<string | null> {
  const got = await get(url, 'text/html,application/xhtml+xml', MAX_PAGE, anyPublic, (t) => /<\/head\s*>/i.test(t))
  // A challenge page ("Just a moment…") and a login wall both answer with an
  // error status — a title read from one would be written into the note as if
  // it were the page's.
  if (!got || got.status < 200 || got.status >= 300) return null
  if (!/html|xml/.test(got.type)) return null
  return extractTitle(decodeHtmlBody(got.body, got.type))
}

const cacheDir = (): string => path.join(app.getPath('userData'), 'link-previews')
const thumbPath = (v: VideoLink): string =>
  path.join(cacheDir(), `${v.provider}-${createHash('sha1').update(v.id).digest('hex').slice(0, 16)}.img`)

async function videoInfo(v: VideoLink): Promise<string | null> {
  const endpoint =
    v.provider === 'youtube'
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(v.watchUrl)}`
      : `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(v.watchUrl)}`
  const got = await get(endpoint, 'application/json', MAX_JSON, (u) => u.protocol === 'https:' && /^(www\.youtube\.com|vimeo\.com)$/.test(u.hostname))
  if (!got || got.status !== 200) return null
  let data: { title?: unknown; thumbnail_url?: unknown }
  try {
    data = JSON.parse(got.body.toString('utf8'))
  } catch {
    return null
  }
  const title = typeof data.title === 'string' ? cleanTitle(decodeEntities(data.title)) : ''
  if (typeof data.thumbnail_url === 'string') await saveThumb(v, data.thumbnail_url)
  return title || null
}

async function saveThumb(v: VideoLink, url: string): Promise<void> {
  const got = await get(url, 'image/*', MAX_THUMB, (u) => u.protocol === 'https:' && isThumbHost(u.hostname))
  if (!got || got.status !== 200 || !got.type.startsWith('image/') || got.body.length === 0) return
  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(thumbPath(v), got.body)
  } catch {
    // A cache that can't be written is a card without a picture, not an error.
  }
}

/** The look-up the renderer asks for after a paste. Never throws. */
export async function lookUpLink(url: unknown): Promise<LinkInfo> {
  const none: LinkInfo = { title: null, video: null }
  if (typeof url !== 'string' || url.length > 2048) return none
  const clean = singleWebUrl(url)
  if (!clean) return none
  try {
    const video = parseVideoUrl(clean)
    if (video) return { title: await videoInfo(video), video }
    return { title: await pageTitle(clean), video: null }
  } catch {
    return none
  }
}

/** The picture kept for a video, or null if none was saved. Read from disk only —
 *  drawing a card never asks the network for anything. */
export async function readLinkThumb(url: unknown): Promise<Uint8Array | null> {
  if (typeof url !== 'string') return null
  const video = parseVideoUrl(url)
  if (!video) return null
  try {
    return new Uint8Array(await fs.readFile(thumbPath(video)))
  } catch {
    return null
  }
}

const PLAYER_REFERER = 'https://notealise.com/'

/** Tell a video player which app is showing it.
 *
 *  The app's page is a `file://` one, which sends no Referer at all, and YouTube
 *  answers an embed with no Referer with "Error 153 — video player configuration
 *  error" (measured 2026-10-05, in this app, on the very first click). Its own
 *  rule for apps that embed the player is to identify themselves with one, so
 *  the player's frame — and ONLY a frame on one of the two player hosts — is
 *  sent the app's home page. Nothing else the app requests is touched, and the
 *  address says what it is: this app, not another site's.
 *
 *  Called once, when the app is ready. */
export function installPlayerReferer(ses: Session): void {
  ses.webRequest.onBeforeSendHeaders(
    { urls: PLAYER_HOSTS.map((h) => `https://${h}/*`), types: ['subFrame'] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Referer: PLAYER_REFERER } })
    }
  )
}
