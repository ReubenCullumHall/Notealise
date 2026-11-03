// Colours that must read on white paper. Pure — no DOM — so it is unit-tested.
//
// Why it exists (Reuben, 2026-11-03: "Keep my look" printed a blank page). The
// look is read from the running app with the page flipped to the light theme
// (page.ts `readLight`), but an accent colour is written as INLINE variables on
// <html> for the theme you are in (settings/model.ts `applyAccent`), and inline
// beats the light theme's rules. In a dark space with an accent, the text came
// back cream and went onto white paper. Rather than chase every way a colour can
// be set, each colour is checked against the paper it lands on: too light to read
// is darkened (its hue kept — a gold heading becomes a deep gold, not black), and
// a highlight too dark to read black text on is lightened.

type RGB = [number, number, number]

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` / `rgb(1 2 3 / 50%)` / `#rrggbb` →
 *  channels and alpha. Null for anything else (a named colour, `transparent`). */
export function parseColour(css: string): { rgb: RGB; a: number } | null {
  const s = css.trim()
  const hex = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 }
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i.exec(s)
  if (!m) return null
  const a = m[4] === undefined ? 1 : m[5] ? parseFloat(m[4]) / 100 : parseFloat(m[4])
  return { rgb: [+m[1], +m[2], +m[3]], a }
}

const lin = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: RGB): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

/** WCAG contrast between two colours, 1 to 21. */
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The colour over white paper, for a translucent one. */
const onWhite = ({ rgb, a }: { rgb: RGB; a: number }): RGB =>
  rgb.map((c) => Math.round(c * a + 255 * (1 - a))) as RGB

const WHITE: RGB = [255, 255, 255]
/** The ink the page is written in when a highlight sits behind it. */
const INK: RGB = [26, 26, 25]

const css = ([r, g, b]: RGB): string => `rgb(${r}, ${g}, ${b})`

/** Mix toward black (or white) in small steps until `ok` — the hue stays. */
function shift(rgb: RGB, toward: 0 | 255, ok: (c: RGB) => boolean): RGB {
  let c = rgb
  for (let t = 0; t <= 1 && !ok(c); t += 0.04) {
    c = rgb.map((v) => Math.round(v + (toward - v) * t)) as RGB
  }
  return ok(c) ? c : (rgb.map(() => toward) as RGB)
}

/** A text colour that reads on white: at least `min`:1 (4.5 is the usual line
 *  for body-size text). Unreadable input keeps its value. */
export function textOnPaper(colour: string, min = 4.5): string {
  const p = parseColour(colour)
  if (!p) return colour
  const seen = onWhite(p)
  if (contrast(seen, WHITE) >= min) return colour
  return css(shift(seen, 0, (c) => contrast(c, WHITE) >= min))
}

/** A highlight that dark ink still reads on. A clear one stays clear. */
export function highlightOnPaper(colour: string, min = 7): string {
  const p = parseColour(colour)
  if (!p || p.a === 0) return colour
  const seen = onWhite(p)
  if (contrast(seen, INK) >= min) return colour
  return css(shift(seen, 255, (c) => contrast(c, INK) >= min))
}
