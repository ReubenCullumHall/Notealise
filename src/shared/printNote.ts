// Save as PDF / Print for one note: the contract between the renderer (which
// turns the note into a page) and main (which seals it in a hidden window and
// does the job).
//
// The renderer owns "what the page says" because only it can draw the note the
// way the app does (the markdown parser, KaTeX, the vault's pictures). Main owns
// everything that touches the machine: the save dialog, the file, the printer,
// and the sealed window the page is shown in. That split is also the safety
// story — the page main prints can run nothing and load nothing (see
// main/printNote.ts), so even a note full of hostile HTML is only ever a drawing.

/** One @font-face the renderer found in the app's own stylesheet. Main reads the
 *  file itself (the renderer cannot fetch a `file://` URL in the packaged app)
 *  and only from the app's own folder. */
export interface PrintFontFace {
  family: string
  weight: string
  style: string
  /** the absolute URL the stylesheet resolved the face's `src` to */
  url: string
}

export interface PrintNoteRequest {
  /** 'pdf' / 'html' ask where to save and write the file; 'print' opens the
   *  system's print dialog. */
  action: 'pdf' | 'html' | 'print'
  /** The note's name — the suggested file name and the print job's title. */
  title: string
  /** The sanitised body (pictures already inlined as data: URLs). The HTML file
   *  is this same page, saved as it is: one file, pictures and fonts inside it. */
  html: string
  /** The page's stylesheet: either the plain one or the note's own look. */
  css: string
  /** Bundled fonts the stylesheet names — empty for the plain page. */
  faces: PrintFontFace[]
  /** Downloaded / imported font families the stylesheet names; main embeds the
   *  ones it has installed. Empty for the plain page. */
  families: string[]
  /** US and Canadian machines print on Letter; everyone else on A4. */
  letter: boolean
}

export type PrintNoteResult =
  | { ok: 'saved'; path: string }
  | { ok: 'printed' }
  | { ok: 'cancelled' }
  | { ok: 'failed'; reason: string }

/** The page the print window shows. Built in main, from the pieces above. */
export const PRINT_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

/** Don't let a runaway note (hundreds of full-size photos) build a page the
 *  hidden window cannot hold. 150 MB of text and inlined pictures is far past
 *  any real note. */
export const PRINT_MAX_BYTES = 150 * 1024 * 1024

const FONT_EXT = /\.(woff2?|ttf|otf)$/i

/** A font file the renderer named is read only if it sits in the app's own
 *  folder — beside the page the asking window is showing. Anything else is
 *  ignored, so the request cannot be pointed at an arbitrary file or address. */
export function ownFontUrl(url: string, pageUrl: string): boolean {
  if (typeof url !== 'string' || typeof pageUrl !== 'string') return false
  if (!FONT_EXT.test(url.split(/[?#]/)[0])) return false
  const page = pageUrl.split(/[?#]/)[0]
  const base = page.slice(0, page.lastIndexOf('/') + 1)
  // `..` could climb out of the folder while still starting with it.
  return !!base && url.startsWith(base) && !/(^|\/|%2f)\.\.(\/|%2f|$)/i.test(url.slice(base.length))
}

/** A family or weight word is written into a stylesheet, so it only ever carries
 *  the characters a font name legitimately has. */
export const cssWord = (s: string): string => String(s).replace(/[^\w .-]/g, '').slice(0, 80)
