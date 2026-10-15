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

export type AttachmentKind = 'image' | 'video' | 'audio'

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
  { kind: 'video', exts: ['ogv'], mimes: ['video/ogg'] },
  // Voice notes (docs/feature-editor.md "Voice notes"). Every recording app
  // anyone is likely to drop in: Apple Voice Memos (.m4a, and .qta from recent
  // macOS/iOS), Windows Voice Recorder / Sound Recorder (.m4a .mp3 .wma .flac
  // .wav), WhatsApp and Telegram (.opus .ogg), Android recorders (.m4a .amr
  // .3gp), and the usual music formats. Being on this list means "we take it",
  // not "the player can play it as it is" — some of these (.wma, .amr, .caf…)
  // are converted to .m4a on the way in; see editor/voiceImport.ts.
  //
  // A dropped file's MIME type is often empty or wrong for audio (.opus, .qta
  // and .amr have no type on many machines), so audio is also recognised by its
  // extension — see `kindOfFile` in editor/attachInput.ts.
  { kind: 'audio', exts: ['m4a'], mimes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
  { kind: 'audio', exts: ['mp3'], mimes: ['audio/mpeg', 'audio/mp3'] },
  { kind: 'audio', exts: ['wav'], mimes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  { kind: 'audio', exts: ['aac'], mimes: ['audio/aac', 'audio/x-aac', 'audio/aacp'] },
  { kind: 'audio', exts: ['ogg', 'oga'], mimes: ['audio/ogg', 'application/ogg'] },
  { kind: 'audio', exts: ['opus'], mimes: ['audio/opus'] },
  { kind: 'audio', exts: ['flac'], mimes: ['audio/flac', 'audio/x-flac'] },
  { kind: 'audio', exts: ['weba'], mimes: ['audio/webm'] },
  { kind: 'audio', exts: ['wma'], mimes: ['audio/x-ms-wma'] },
  { kind: 'audio', exts: ['aif', 'aiff', 'aifc'], mimes: ['audio/aiff', 'audio/x-aiff'] },
  { kind: 'audio', exts: ['caf'], mimes: ['audio/x-caf'] },
  { kind: 'audio', exts: ['amr'], mimes: ['audio/amr'] },
  { kind: 'audio', exts: ['awb'], mimes: ['audio/amr-wb'] },
  { kind: 'audio', exts: ['mp2'], mimes: ['audio/mp2'] },
  { kind: 'audio', exts: ['3gp', '3ga'], mimes: ['audio/3gpp', 'audio/3gpp2'] },
  { kind: 'audio', exts: ['qta'], mimes: [] },
  { kind: 'audio', exts: ['m4b'], mimes: ['audio/x-m4b'] },
  { kind: 'audio', exts: ['mka'], mimes: ['audio/x-matroska'] }
]

const extsOf = (kind: AttachmentKind): string[] =>
  FORMATS.filter((f) => f.kind === kind).flatMap((f) => f.exts)

/** For the picker's filters. Extensions only, no dots — Electron's own shape. */
export const IMAGE_EXTS = extsOf('image')
export const VIDEO_EXTS = extsOf('video')
export const AUDIO_EXTS = extsOf('audio')
/** What the "Attach…" picker offers — photos and videos. Voice notes have their
 *  own picker (`pickAudioFiles`), because a recording goes through the voice
 *  note path (a playability check, maybe a conversion) rather than straight in. */
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
/** Is an embed target that ISN'T a vault file still safe to put in a `src`?
 *
 *  Only `data:` is. It carries its own bytes, so it reaches neither the network
 *  nor the disk, and someone pasting a small inline image has done nothing
 *  wrong. Everything else `resolveVaultPath` rejects is a request to somewhere:
 *  `https:` fetched on scroll and told the note's author when it was opened,
 *  and `file:` displayed any picture on the machine, past the boundary every
 *  IPC read honours.
 *
 *  This mirrors `img-src`/`media-src` in the renderer's CSP (see
 *  electron.vite.config.ts), deliberately. The CSP is the control — this is
 *  what stops the app ASKING, so the reader gets the ordinary missing-picture
 *  placeholder instead of a silent console violation. */
export function isInlineDataUrl(target: string): boolean {
  return /^data:/i.test(target)
}

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
/** THE pattern for an embed, in the forms this app writes: a picture is
 *  markdown, a video or a voice note is a one-line `<video>`/`<audio>` tag.
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
  /!\[[^\]\n]*\]\(([^)\n]*)\)|<(?:video|audio)\b[^>\n]*\bsrc=["']([^"']*)["'][^>\n]*>/gi

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

// --- documents -----------------------------------------------------------------
//
// A third kind of thing a note can hold: a file that is neither a picture nor a
// video — a PDF, a Word or Excel file, slides. It is saved beside the note like
// any attachment, written as an ordinary link (`[Slides.pdf](Slides.pdf)`, which
// every other editor shows as a link too), and clicking it opens it in whatever
// the computer opens that kind of file with.
//
// Opening is the dangerous half, so it is an ALLOW-list and a short one: a note
// can arrive from someone else, and "open this file" on `run.sh`, `Setup.exe`,
// `Thing.app` or a macro-enabled `.docm` is a program running. Everything here
// is a document a viewer opens, and nothing a system runs. It is checked in main
// (`openVaultFile`) as well as here — this list is the one place it is written.

export const DOC_EXTS = [
  'pdf',
  'doc', 'docx', 'rtf', 'odt', 'pages',
  'xls', 'xlsx', 'csv', 'ods', 'numbers',
  'ppt', 'pptx', 'odp', 'key',
  'txt', 'epub'
]

/** Is this a document we will save into a note and open on a click? Judged by the
 *  extension alone, any case, same rule as `kindForFilename` for a bare dotted
 *  name (`.pdf` has no extension). */
export function isDocFilename(name: string): boolean {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return DOC_EXTS.includes(base.slice(dot + 1).toLowerCase())
}

/** The vault path a link in a note points at, if it is a link to a document the
 *  vault holds — and null for a web address, a path out of the vault, or any
 *  other file. What decides whether a click opens a file or a browser. */
export function docLinkTarget(href: string, notePath: string): string | null {
  const rel = resolveVaultPath(href, notePath)
  return rel && isDocFilename(rel) ? rel : null
}

// --- a note moves: its links to files follow ------------------------------------

/** Rewrite a destination — `pic.png`, `<my pic.png>` or `pic.png "a title"` — by
 *  handing its target to `fn`. `fn` returns the new target, or null to leave it. */
function swapDestination(raw: string, fn: (target: string) => string | null): string {
  const lead = /^\s*/.exec(raw)![0]
  const body = raw.slice(lead.length)
  if (body.startsWith('<')) {
    const end = body.indexOf('>')
    if (end === -1) return raw
    const next = fn(body.slice(1, end))
    return next === null ? raw : `${lead}<${next}>${body.slice(end + 1)}`
  }
  const token = body.split(/\s/)[0]
  const next = token ? fn(token) : null
  return next === null ? raw : `${lead}${next}${body.slice(token.length)}`
}

/** Make a note's links to photos, videos and documents still reach the same files
 *  after the note has moved from `fromNote` to `toNote`.
 *
 *  The links are RELATIVE (`pic.png`, `../Shared/pic.png`), so a note that changes
 *  folder keeps pointing at where the file was NOT: the file stays put, the link
 *  breaks. This re-points each one — `pic.png` becomes `../Physics/pic.png` — and
 *  leaves the files alone, so a photo two notes share is never pulled from under
 *  the other. (Reuben, 2026-10-05: files stay, links follow.)
 *
 *  `moved` says where a FILE went if the move carried it too — a folder moved with
 *  the notes and photos inside it. Without it, files are taken to have stayed.
 *
 *  Only a target that really is a vault file is touched, and only if it would no
 *  longer resolve to that file — so a note that did not need it comes back
 *  byte-for-byte unchanged, and so does every web address, `data:` URI and
 *  ordinary link. Same shapes `indexEmbeds` reads, plus links to documents. */
export function repointFileLinks(
  text: string,
  fromNote: string,
  toNote: string,
  moved: (file: string) => string = (f) => f
): string {
  const fix = (target: string, docsOnly: boolean): string | null => {
    const file = resolveVaultPath(target, fromNote)
    if (!file || (docsOnly && !isDocFilename(file))) return null
    const now = moved(file)
    if (resolveVaultPath(target, toNote) === now) return null // still reaches it
    return relativeTarget(now, toNote)
  }
  return text
    .replace(
      /(!\[[^\]\n]*\]\()([^)\n]*)(\))|(<(?:video|audio)\b[^>\n]*\bsrc=["'])([^"']*)(["'][^>\n]*>)/gi,
      (whole, a1?: string, dest1?: string, z1?: string, a2?: string, dest2?: string, z2?: string) =>
        dest1 !== undefined
          ? a1 + swapDestination(dest1, (t) => fix(t, false)) + z1
          : a2 !== undefined
            ? a2 + (fix(dest2 as string, false) ?? (dest2 as string)) + z2
            : whole
    )
    .replace(
      /((?<!!)\[[^\]\n]*\]\()([^)\n]*)(\))/g,
      (_whole, a: string, dest: string, z: string) => a + swapDestination(dest, (t) => fix(t, true)) + z
    )
}
