// What counts as an attachable photo or video — in ONE place, for the same
// reason shared/fonts.ts exists: main and the renderer both need this catalogue
// and each keys it differently. Main filters the native "Attach…" picker by
// file EXTENSION (and re-checks the result, because a dialog's type filter is
// advisory on some platforms); the renderer classifies a pasted or dropped file
// by its MIME TYPE, which is all the clipboard and drag data give it. While
// those were two hand-written lists, adding a format to one and forgetting the
// other meant paste silently accepted what the picker rejected, or vice versa.
//
// Pure data and string helpers, no fs and no DOM, so main, preload and the
// renderer can all import it.

export type AttachmentKind = 'image' | 'video'

interface AttachmentFormat {
  kind: AttachmentKind
  /** Accepted extensions, lowercase and without the dot. The FIRST is the
   *  canonical one — what a clipboard paste that carries no filename of its own
   *  gets saved as. */
  exts: string[]
  /** Every MIME type a clipboard or a drag might announce this format as. */
  mimes: string[]
}

const FORMATS: AttachmentFormat[] = [
  { kind: 'image', exts: ['png'], mimes: ['image/png'] },
  { kind: 'image', exts: ['jpg', 'jpeg'], mimes: ['image/jpeg'] },
  { kind: 'image', exts: ['gif'], mimes: ['image/gif'] },
  { kind: 'image', exts: ['webp'], mimes: ['image/webp'] },
  { kind: 'image', exts: ['svg'], mimes: ['image/svg+xml'] },
  { kind: 'image', exts: ['bmp'], mimes: ['image/bmp'] },
  { kind: 'image', exts: ['avif'], mimes: ['image/avif'] },
  { kind: 'video', exts: ['mp4'], mimes: ['video/mp4'] },
  { kind: 'video', exts: ['webm'], mimes: ['video/webm'] },
  { kind: 'video', exts: ['mov'], mimes: ['video/quicktime'] },
  { kind: 'video', exts: ['m4v'], mimes: ['video/x-m4v'] },
  { kind: 'video', exts: ['ogv'], mimes: ['video/ogg'] }
]

const extsOf = (kind: AttachmentKind): string[] =>
  FORMATS.filter((f) => f.kind === kind).flatMap((f) => f.exts)

/** For the picker's filters. Extensions only, no dots — Electron's own shape. */
export const IMAGE_EXTS = extsOf('image')
export const VIDEO_EXTS = extsOf('video')
export const ATTACHMENT_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS]

/** image/video/neither, from a bare extension (no dot, any case). */
export function kindForExt(ext: string): AttachmentKind | null {
  const e = ext.replace(/^\./, '').toLowerCase()
  if (!e) return null
  return FORMATS.find((f) => f.exts.includes(e))?.kind ?? null
}

/** image/video/neither, from a MIME type — what paste and drop have to go on. */
export function kindForMime(mime: string): AttachmentKind | null {
  const m = mime.toLowerCase()
  return FORMATS.find((f) => f.mimes.includes(m))?.kind ?? null
}

/** The extension to save a given MIME type as, or null if it isn't one we take. */
export function extForMime(mime: string): string | null {
  const m = mime.toLowerCase()
  return FORMATS.find((f) => f.mimes.includes(m))?.exts[0] ?? null
}

/** A filename as a markdown/HTML embed target.
 *
 *  Percent-encoding is not decoration: a markdown destination cannot contain an
 *  unescaped space, so `![](my holiday.png)` is not an image at all — it renders
 *  as literal text, which is exactly how "photos won't load" presented before
 *  this existed. `resolveVaultPath` decodes on the way back.
 *
 *  encodeURIComponent leaves `( ) ! ' *` alone; the parens are the ones that
 *  matter, since they close a `![](…)` destination early — `photo (2).jpg` is a
 *  completely ordinary name for a downloaded file.
 *
 *  Shared rather than private to attachInput because writing an embed and
 *  RE-writing one (App's restore, when a file comes back under another name)
 *  have to agree character for character. */
export function encodeTarget(name: string): string {
  return encodeURIComponent(name).replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'))
}

/** Resolve an embed's target against the note holding it. Returns null for
 *  anything that isn't a plain in-vault relative path — a remote URL is left to
 *  the <img>/<video> itself, and a path escaping the vault is refused here as
 *  well as in main.
 *
 *  The exact counterpart of `encodeTarget` above, and kept beside it for that
 *  reason: one writes the destination, the other reads it, and a disagreement
 *  between them is a picture that silently won't load. */
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

/** Every photo/video target a note's text embeds, exactly as written.
 *
 *  This is what lets the app KNOW a picture is in a note, rather than only
 *  knowing what one note's text happened to say at the moment something was
 *  deleted. Both forms in one scan, because the two are the same fact: an image
 *  is markdown and a video is inline HTML only because Markdown has no video
 *  syntax (rule 4), and nothing above this cares which is which.
 *
 *  Text-scanned rather than parsed, matching `attachSelect`'s own reasoning: the
 *  video form has no markdown node to find, so one regex pass covers both. It
 *  over-matches inside fenced code blocks, which is the safe direction — a photo
 *  reported as used by one note too many is a warning you can dismiss; one
 *  reported as used by none is a file deleted out from under a note. */
/** THE pattern for an embed, in both forms this app writes.
 *
 *  One constant because three things now read it — the index, the re-pointer
 *  and the "where is this picture" jump — and three regexes that must agree
 *  character for character is three chances to drift. Built fresh on each use
 *  rather than shared as a `g`-flagged object, since `lastIndex` is per-regex
 *  state and a shared one silently skips matches on its second caller.
 *
 *  It over-matches inside fenced code blocks, which is the safe direction: a
 *  photo reported as used by one note too many is a warning you can dismiss;
 *  one reported as used by none is a file deleted out from under a note. */
const embedPattern = (): RegExp =>
  /!\[[^\]\n]*\]\(([^)\n]*)\)|<video\b[^>\n]*\bsrc=["']([^"']*)["'][^>\n]*>/gi

/** The target out of one regex match, unwrapped from `<…>` and stripped of a
 *  trailing `"title"`. */
const targetOf = (m: RegExpExecArray | RegExpMatchArray): string => {
  const raw = (m[1] ?? m[2] ?? '').trim()
  const inner = /^<(.*)>$/.exec(raw)
  return inner ? inner[1] : raw.split(/\s+/)[0]
}

export function indexEmbeds(text: string): string[] {
  const out: string[] = []
  const scan = embedPattern()
  for (let m = scan.exec(text); m; m = scan.exec(text)) {
    const target = targetOf(m)
    if (target) out.push(target)
  }
  return out
}

/** Which line of `text` holds the first embed pointing at `file`, 1-based, or 0.
 *
 *  What "take me to where this picture is" needs. Line rather than offset
 *  because that is the unit the editor scrolls to and the unit a person means
 *  by "where" — and because it survives the note being edited between the index
 *  being built and the jump being made slightly better than an offset would. */
export function lineOfEmbed(text: string, notePath: string, file: string): number {
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const scan = embedPattern()
    for (let m = scan.exec(lines[i]); m; m = scan.exec(lines[i])) {
      const target = targetOf(m)
      if (target && resolveVaultPath(target, notePath) === file) return i + 1
    }
  }
  return 0
}

/** Write `file` (a vault path) as a target relative to the note at `notePath`,
 *  percent-encoded the way `encodeTarget` writes one.
 *
 *  The exact inverse of `resolveVaultPath`, and the piece that lets a picture
 *  survive being dragged into a note in a different folder: the target it was
 *  written with is relative to the note it CAME from, so re-pointing it is the
 *  only way one file can serve both notes. Climbing with `..` is deliberate and
 *  is what `resolveVaultPath` already understands.
 *
 *  `..` passes through `encodeTarget` untouched (`encodeURIComponent` leaves
 *  dots alone), so the segments can all go through one map without a special
 *  case that would then need its own test. */
export function relativeTarget(file: string, notePath: string): string {
  const fromDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')).split('/') : []
  const to = file.split('/')
  let same = 0
  while (same < fromDir.length && same < to.length - 1 && fromDir[same] === to[same]) same++
  const up = Array.from({ length: fromDir.length - same }, () => '..')
  return [...up, ...to.slice(same)].map(encodeTarget).join('/')
}

/** Re-point every embed in `text` so it still resolves to the same file once
 *  the text is living in `toNote` instead of `fromNote`.
 *
 *  Used when a block or a picture is dragged from one pane into another. Only
 *  targets that resolve to a real in-vault file are touched: a remote URL, a
 *  `data:` URI or a path climbing out of the vault has no file to re-point at,
 *  and rewriting it would break something that was working.
 *
 *  Same regex as `indexEmbeds` on purpose — the two must agree about what an
 *  embed IS, and two patterns would drift. It over-matches inside fenced code
 *  blocks in exactly the same way, which stays the safe direction here too: the
 *  worst case is a path in a code sample being rewritten to point at the same
 *  file from a new location, not a broken picture.
 *
 *  Returns `text` unchanged when the two notes sit in the same folder, which is
 *  the common case and means a same-folder drag produces byte-identical text. */
export function retargetEmbeds(text: string, fromNote: string, toNote: string): string {
  const dir = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  if (dir(fromNote) === dir(toNote)) return text
  return text.replace(embedPattern(), (whole, imgTarget?: string, vidTarget?: string) => {
    const target = targetOf([whole, imgTarget, vidTarget] as unknown as RegExpMatchArray)
    if (!target) return whole
    const file = resolveVaultPath(target, fromNote)
    if (!file) return whole // remote, data:, or outside the vault — leave alone
    return whole.replace(target, relativeTarget(file, toNote))
  })
}

/** image/video/neither, from a filename.
 *
 *  A name that is nothing BUT a dotted suffix — `.png` — deliberately reads as
 *  having no extension at all, matching `path.parse`. It is a hidden,
 *  extensionless file on disk that nothing will open, so refusing it here is
 *  what keeps it from being written into the vault in the first place. */
export function kindForFilename(name: string): AttachmentKind | null {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null // no dot, or a leading dot with nothing before it
  return kindForExt(base.slice(dot + 1))
}
