// Web addresses a note can show as more than a link — in ONE place, for the same
// reason shared/attachments.ts is: main decides what to look up, the renderer
// decides what to draw, and two hand-written lists of "which sites are videos"
// would drift until a pasted link was looked up as a page and drawn as a player.
//
// Pure string work, no DOM and no Electron, so main, preload and the renderer
// can all import it.

export type VideoProvider = 'youtube' | 'vimeo'

export interface VideoLink {
  provider: VideoProvider
  id: string
  /** The address as someone would paste it. */
  watchUrl: string
  /** The player's address. Only ever loaded after a click — see CLAUDE.md. */
  embedUrl: string
  /** What the card says it is, e.g. "YouTube". */
  label: string
}

/** The hosts a player may be loaded from. The renderer's CSP `frame-src`
 *  (electron.vite.config.ts) lists exactly these — keep the two in step. */
export const PLAYER_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com'] as const

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{6,}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'www.youtube-nocookie.com'
])

/** `1h2m3s`, `90s` or `90` as seconds, or null. YouTube's `t=` takes all three. */
function startSeconds(value: string | null): number | null {
  if (!value) return null
  if (/^\d+$/.test(value)) return Number(value)
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

function youtube(id: string, start: number | null): VideoLink | null {
  if (!YT_ID.test(id)) return null
  const startPart = start ? `&start=${start}` : ''
  return {
    provider: 'youtube',
    id,
    watchUrl: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0${startPart}`,
    label: 'YouTube'
  }
}

function vimeo(id: string, hash: string | null): VideoLink | null {
  if (!VIMEO_ID.test(id)) return null
  const h = hash && /^[0-9a-f]{6,}$/i.test(hash) ? hash : null
  return {
    provider: 'vimeo',
    id,
    watchUrl: `https://vimeo.com/${id}${h ? `/${h}` : ''}`,
    embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1${h ? `&h=${h}` : ''}`,
    label: 'Vimeo'
  }
}

/** Is this address a single YouTube or Vimeo video? Null for anything else —
 *  a channel, a playlist on its own, a search page, a link that merely mentions
 *  one. Only a plain http(s) address counts. */
export function parseVideoUrl(raw: string): VideoLink | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)
  const start = startSeconds(u.searchParams.get('t') ?? u.searchParams.get('start'))

  if (host === 'youtu.be') return parts.length ? youtube(parts[0], start) : null
  if (YOUTUBE_HOSTS.has(host)) {
    if (parts[0] === 'watch') return youtube(u.searchParams.get('v') ?? '', start)
    if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) return youtube(parts[1], start)
    return null
  }

  if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    // vimeo.com/123456789, vimeo.com/123456789/abcdef (unlisted), and the
    // channel/group forms, which end in the id.
    const last = parts[parts.length - 1]
    if (VIMEO_ID.test(last ?? '')) return vimeo(last, null)
    const prev = parts[parts.length - 2]
    if (prev && VIMEO_ID.test(prev)) return vimeo(prev, last)
    return null
  }
  if (host === 'player.vimeo.com' && parts[0] === 'video' && parts[1]) {
    return vimeo(parts[1], u.searchParams.get('h'))
  }
  return null
}

/** The text of a clipboard that is nothing but ONE web address, or null.
 *  Surrounding whitespace is ignored; anything else in it (a second word, a
 *  second address, a line break) means it is a sentence that happens to hold a
 *  link, which is pasted as it is. */
export function singleWebUrl(text: string): string | null {
  const t = text.trim()
  if (!t || /\s/.test(t) || !/^https?:\/\//i.test(t)) return null
  try {
    const u = new URL(t)
    return u.hostname.includes('.') ? t : null
  } catch {
    return null
  }
}

/** A page title, as it should be written between `[` and `]`.
 *
 *  Markdown's own brackets inside a title would end the link early, and a line
 *  break would end the paragraph — so both are flattened — and a site that
 *  stuffs its name on the end ("Waves – BBC News") keeps it, because stripping
 *  that is guessing. Capped, since a few sites put a paragraph in <title>. */
export function cleanTitle(raw: string): string {
  const flat = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))
    .replace(/\\/g, '')
    // `*Star Wars*` would be drawn as italics with the stars gone, and a backtick
    // pair as code. A star with a space each side ("5 * 3") is not emphasis and stays.
    .replace(/(?<!\s)\*|\*(?!\s)/g, '')
    .replace(/`/g, '')
    // A title naming an HTML tag ("<canvas>: the Canvas element") would put a
    // real tag in the note, and the app hides tags — so it lost the word and
    // ended up outside the link (bug scan 2026-10-27). The brackets go, the word stays.
    .replace(/<(\/?[a-zA-Z][^<>]*)>/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return flat.length > 140 ? flat.slice(0, 139).trimEnd() + '…' : flat
}

/** What the renderer gets back from a look-up. */
export interface LinkInfo {
  /** The page's or video's own title, cleaned. Null when none could be read
   *  (offline, a login wall, a file rather than a page, a timeout). */
  title: string | null
  /** Set when the address is a video the app can show. */
  video: VideoLink | null
}
