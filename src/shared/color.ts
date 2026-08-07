// Entry colours: the hex a note or folder is tagged with in the sidebar, and
// the maths the picker needs. Pure — no fs, no DOM — so main validates with the
// same code the renderer paints with (mirrors shared/links.ts's reason for
// living here: two implementations of "what is a valid colour" would drift).
//
// WHY A RAW HEX HERE, when the editor's text colours are deliberately NOT hex
// (rule 4, `editor/palette.ts`): those are written INTO the .md file, so they
// have to survive being opened in Obsidian and have to flip between light and
// dark themes — hence `<span class="tc-amber">` against a named palette. An
// entry colour is never written into a note. It is chrome, stored in
// .mdnotes/workspace.json beside pins and order, and the whole point of it is
// that the user picks the exact colour they mean. So: a real hex, and the
// contrast work is done here (`inkOn`) rather than by having two palettes.

/** How many colours a space may keep on its palette. Enough to tell a sidebar
 *  full of folders apart; few enough that the picker stays one glanceable row. */
export const PALETTE_MAX = 12

/** The hues a new space starts with, so turning auto-colour on works
 *  immediately instead of first demanding you build a palette. Mid saturation
 *  and mid lightness on purpose: each one has to read against the near-black
 *  dark themes AND against light's white, and a colour that is only correct on
 *  one of them is a colour the user has to re-pick when they switch theme. */
export const DEFAULT_PALETTE = [
  '#e0605e',
  '#e08b4a',
  '#d4b13f',
  '#7cb356',
  '#46b39a',
  '#4f9ee0',
  '#8a7fe0',
  '#d472ac'
]

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Coerce anything into a `#rrggbb` string, or null. Accepts the 3-digit short
 * form and a missing `#`, because both are what a person types into the hex
 * field — and returns the long lowercase form, so the same colour is always the
 * same string. That matters: `colorPalette` de-duplicates by string equality,
 * and `#FFF` / `#ffffff` are the same colour to a human.
 */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = HEX_RE.exec(v.trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return '#' + (h.length === 3 ? h.replace(/./g, (c) => c + c) : h)
}

/** A list of hexes: junk dropped, duplicates dropped, capped. Never throws — a
 *  hand-edited settings.json must not stop the vault opening. */
export function normalizePalette(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const v of list) {
    const hex = normalizeHex(v)
    if (hex && !out.includes(hex)) out.push(hex)
    if (out.length >= PALETTE_MAX) break
  }
  return out
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex) ?? '#000000'
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16)
  }
}

/** The bare "R G B" triple this app's CSS variables are written in (rule 5), so
 *  a consumer adds its own alpha with `rgb(var(--x) / 0.16)`. Every entry-colour
 *  rule in app.css takes its colour this way rather than as a finished
 *  `background`, which is what lets one stored hex be a 16% row wash in one
 *  place and a solid chip in another. */
export function rgbChannels(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  return `${r} ${g} ${b}`
}

export interface Hsv {
  /** 0–360 */
  h: number
  /** 0–100 */
  s: number
  /** 0–100 */
  v: number
}

/** Hex → HSV, which is what the picker's square-and-slider actually is: the
 *  square is s/v at a fixed hue, the slider is the hue. Round-trips through
 *  `hsvToHex` to within a rounding step, which is what its test pins. */
export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex)
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6
    else if (max === G) h = (B - R) / d + 2
    else h = (R - G) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

export function hsvToHex(h: number, s: number, v: number): string {
  const H = ((h % 360) + 360) % 360
  const S = Math.min(100, Math.max(0, s)) / 100
  const V = Math.min(100, Math.max(0, v)) / 100
  const c = V * S
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1))
  const m = V - c
  const i = Math.floor(H / 60) % 6
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ][i]
  const hex = (n: number): string =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return '#' + hex(r) + hex(g) + hex(b)
}

/**
 * Which ink reads on top of this colour — 'dark' or 'light'.
 *
 * The colour is the user's, not the theme's, so nothing in theme.css can answer
 * this: a pale yellow chip needs black dots on it and a deep indigo one needs
 * white, in every theme alike. Relative luminance (WCAG's coefficients) with the
 * threshold at 0.55 rather than a naive average, because the eye reads green as
 * far brighter than blue at the same channel value.
 */
export function inkOn(hex: string): 'dark' | 'light' {
  const { r, g, b } = hexToRgb(hex)
  const lin = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.55 ? 'dark' : 'light'
}

/**
 * Pick the colour a newly created folder should get.
 *
 * NOT `palette[random]`. The whole reason auto-colour exists is so a sidebar of
 * folders looks different folder to folder without you assigning anything — and
 * uniform random hands out the same colour twice in a row about as often as you
 * would notice. So: only the colours used LEAST by the folder's siblings are
 * candidates, and the random choice happens among those. With a fresh palette
 * every colour is used zero times and it is a plain random pick; once the
 * palette has been round-tripped it cycles, shuffled.
 *
 * `rand` is injectable so the distribution is testable rather than assumed.
 */
export function pickAutoColor(
  palette: readonly string[],
  used: readonly string[] = [],
  rand: () => number = Math.random
): string | null {
  if (!palette.length) return null
  const counts = new Map(palette.map((c) => [c, 0]))
  for (const u of used) {
    const n = counts.get(u)
    if (n !== undefined) counts.set(u, n + 1)
  }
  const fewest = Math.min(...counts.values())
  const candidates = palette.filter((c) => counts.get(c) === fewest)
  return candidates[Math.min(candidates.length - 1, Math.floor(rand() * candidates.length))]
}
