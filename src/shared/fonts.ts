// The font catalogue: every typeface the app knows how to offer, bundled or
// not. Shared by main (which needs `cdnUrl` to download one, and the id list
// to validate a download/removal request) and the renderer (which needs
// everything, to render the pickers). Pure data + pure functions — no fs, no
// DOM, safe to import anywhere, same discipline as shared/settings.ts.
//
// Three sources:
//   'bundled'     ships in the app itself (assets/fonts/*.woff2, @font-face
//                 in theme.css). Always available, offline, from install.
//   'downloadable' NOT shipped — fetched on demand from `cdnUrl` (see
//                 main/fonts.ts) and cached in userData/fonts/downloaded/.
//                 Previewable without downloading via a pre-rendered image
//                 (assets/font-previews/<id>.png) — see FONT_PREVIEW_IDS.
//   a THIRD kind, 'custom', exists only at runtime: a font the user imported
//   from their own machine (main/fonts.ts's importCustomFont). It has no
//   catalogue entry here at all — see CustomFont below instead.
//
// Bundled ids were deliberately kept to one per role (Inter/OpenDyslexic/
// JetBrains Mono/Fraunces) rather than all 20: the other 16 are a few
// hundred KB total, trivial for a desktop app, but shipping them anyway would
// make "download" a lie — the whole point of a downloadable catalogue is that
// picking one is a real, visible act, not a switch already sitting in the box.

export type FontCategory = 'default' | 'dyslexia' | 'code' | 'eloquent'
export type FontFallback = 'sans-serif' | 'serif' | 'monospace'
export type FontSource = 'bundled' | 'downloadable'

export interface FontOption {
  id: string
  /** the CSS font-family name */
  family: string
  category: FontCategory
  fallback: FontFallback
  blurb: string
  source: FontSource
  /** 'downloadable' only: where main/fonts.ts fetches the woff2 from */
  cdnUrl?: string
}

const jsdelivr = (pkg: string): string =>
  `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}/files/${pkg}-latin-400-normal.woff2`

export const FONTS: FontOption[] = [
  // Default — everyday body/heading skins
  { id: 'inter', family: 'Inter', category: 'default', fallback: 'sans-serif', source: 'bundled',
    blurb: 'The app’s own sans. Picking it explicitly makes headings sans too, instead of Fraunces.' },
  { id: 'source-sans-3', family: 'Source Sans 3', category: 'default', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('source-sans-3'),
    blurb: 'Adobe’s first open-source typeface. Plainer, slightly narrower than Inter.' },
  { id: 'ibm-plex-sans', family: 'IBM Plex Sans', category: 'default', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('ibm-plex-sans'),
    blurb: 'IBM’s corporate face. A technical, drafted feel — squarer curves.' },
  { id: 'work-sans', family: 'Work Sans', category: 'default', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('work-sans'),
    blurb: 'Optimized for small on-screen text. Warmer and rounder than Inter.' },
  { id: 'manrope', family: 'Manrope', category: 'default', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('manrope'),
    blurb: 'Geometric sans-serif with a contemporary, slightly condensed feel.' },

  // Dyslexia-friendly — the separate `dyslexiaFont` picker only
  { id: 'opendyslexic', family: 'OpenDyslexic', category: 'dyslexia', fallback: 'sans-serif', source: 'bundled',
    blurb: 'Purpose-built for dyslexia: heavy-bottomed letters resist flipping/rotating in the eye.' },
  { id: 'lexend', family: 'Lexend', category: 'dyslexia', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('lexend'),
    blurb: 'Built from reading-speed research (not dyslexia-specific) — wide, calm spacing.' },
  { id: 'atkinson-hyperlegible', family: 'Atkinson Hyperlegible', category: 'dyslexia', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('atkinson-hyperlegible'),
    blurb: 'Braille Institute face for low vision. Exaggerates differences between similar letters.' },
  { id: 'andika', family: 'Andika', category: 'dyslexia', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('andika'),
    blurb: 'SIL literacy face for new readers. Very plain, unambiguous letterforms.' },
  { id: 'comic-neue', family: 'Comic Neue', category: 'dyslexia', fallback: 'sans-serif', source: 'downloadable', cdnUrl: jsdelivr('comic-neue'),
    blurb: 'Open redraw of Comic Sans — informal, irregular letters some dyslexic readers prefer.' },

  // Code — shown for browsing; also valid, if unusual, whole-space skins
  { id: 'jetbrains-mono', family: 'JetBrains Mono', category: 'code', fallback: 'monospace', source: 'bundled',
    blurb: 'The app’s own code font. Picking it as a skin makes body and headings monospace too.' },
  { id: 'fira-code', family: 'Fira Code', category: 'code', fallback: 'monospace', source: 'downloadable', cdnUrl: jsdelivr('fira-code'),
    blurb: 'The one with ligatures — => renders as an arrow in editors that enable them.' },
  { id: 'ibm-plex-mono', family: 'IBM Plex Mono', category: 'code', fallback: 'monospace', source: 'downloadable', cdnUrl: jsdelivr('ibm-plex-mono'),
    blurb: 'Mono sibling of Plex Sans. Narrower, more classic terminal proportions.' },
  { id: 'source-code-pro', family: 'Source Code Pro', category: 'code', fallback: 'monospace', source: 'downloadable', cdnUrl: jsdelivr('source-code-pro'),
    blurb: 'Adobe’s monospace. A safe, well-worn choice — low personality, high clarity.' },
  { id: 'space-mono', family: 'Space Mono', category: 'code', fallback: 'monospace', source: 'downloadable', cdnUrl: jsdelivr('space-mono'),
    blurb: 'Quirky, retro mono with distinctive angled terminals.' },

  // Eloquent — expressive serif skins
  { id: 'fraunces', family: 'Fraunces', category: 'eloquent', fallback: 'serif', source: 'bundled',
    blurb: 'The app’s own heading serif. Picking it explicitly makes body text serif too.' },
  { id: 'playfair-display', family: 'Playfair Display', category: 'eloquent', fallback: 'serif', source: 'downloadable', cdnUrl: jsdelivr('playfair-display'),
    blurb: 'High-contrast display serif — dramatic, editorial, very thin hairlines.' },
  { id: 'cormorant-garamond', family: 'Cormorant Garamond', category: 'eloquent', fallback: 'serif', source: 'downloadable', cdnUrl: jsdelivr('cormorant-garamond'),
    blurb: 'Delicate, tall and narrow. Reads as literary rather than businesslike.' },
  { id: 'eb-garamond', family: 'EB Garamond', category: 'eloquent', fallback: 'serif', source: 'downloadable', cdnUrl: jsdelivr('eb-garamond'),
    blurb: 'Faithful revival of Claude Garamond’s 16th-century type.' },
  { id: 'lora', family: 'Lora', category: 'eloquent', fallback: 'serif', source: 'downloadable', cdnUrl: jsdelivr('lora'),
    blurb: 'Contemporary serif with brushed, calligraphic curves — softer than Fraunces.' }
]

export function findFont(id: string): FontOption | undefined {
  return id ? FONTS.find((f) => f.id === id) : undefined
}

/** The CSS `font-family` value for anything with a `family` + `fallback` —
 *  a catalogue FontOption or a runtime InstalledFont, both shaped the same
 *  way on purpose so one function covers either. The face itself, then its
 *  generic fallback, so a font that somehow fails to load still lands on
 *  something in the same family of shapes rather than the browser default. */
export function fontCssValue(f: { family: string; fallback: FontFallback }): string {
  return `'${f.family}', ${f.fallback}`
}

export const SKIN_FONTS = FONTS.filter((f) => f.category !== 'dyslexia')
export const DYSLEXIA_FONTS = FONTS.filter((f) => f.category === 'dyslexia')
export const DOWNLOADABLE_FONTS = FONTS.filter((f) => f.source === 'downloadable')

export const CATEGORY_LABELS: Record<Exclude<FontCategory, 'dyslexia'>, string> = {
  default: 'Default',
  code: 'Code',
  eloquent: 'Eloquent'
}

// --- runtime state: what's actually installed on THIS machine --------------
// A catalogue entry becoming "installed" (downloaded) and a custom import are
// different shapes — a custom font has no category/blurb/cdnUrl, just a name
// someone gave a file on their own disk — so they're unified only at the
// point of use (InstalledFont), never merged into one type.

/** A user-imported font file, copied into userData/fonts/custom/. Its `id` is
 *  generated at import time (main/fonts.ts) and is what a Space's `font` /
 *  `uiFont` / `dyslexiaFont` field stores — same as a catalogue id, just from
 *  a different namespace, which is why both are looked up through the same
 *  `findInstalled` below rather than through two separate pickers. */
export interface CustomFont {
  id: string
  /** derived from the filename at import time; not editable (yet) */
  displayName: string
  /** the original filename, kept only for display ("from Georgia.ttf") */
  originalName: string
  addedAt: number
}

/** One installed, USABLE font — the shape the renderer actually needs to
 *  inject a @font-face for it: `family` to name it, `fallback` for the
 *  generic tail, and its bytes. Bundled fonts never appear here (they're
 *  already real @font-face rules in theme.css); this is only what had to be
 *  fetched or copied in before it could be used. */
export interface InstalledFont {
  id: string
  source: 'downloaded' | 'custom'
  family: string
  fallback: FontFallback
  /** base64 woff2/ttf/otf bytes, read fresh each app launch — see
   *  main/fonts.ts's listInstalledFonts */
  base64: string
}

export type DownloadFontResult =
  | { ok: true; font: InstalledFont }
  | { ok: false; error: string }

export type ImportCustomFontResult =
  | { ok: true; font: InstalledFont }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string }
