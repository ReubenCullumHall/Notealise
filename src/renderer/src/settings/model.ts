// Renderer-side appearance model: the option lists shown in the Settings panel,
// plus the accent generator ported from legacy/src/settings.js. This is the only
// place that touches the DOM (applying settings as data-* attributes and inline
// accent variables on <html>); persistence goes through IPC (window.api).

import { activeSpace, type AppSettings, type ResolvedThemeId, type Space } from '../../../shared/settings'
import { findFont, fontCssValue, type FontFallback } from './fonts'
import { ensureInstalledFontsLoaded, findInstalledFont } from './fontLoader'

/** `id` may name a catalogue entry (bundled or downloaded — shared/fonts.ts)
 *  or a custom import, which has no catalogue entry at all (fontLoader.ts's
 *  runtime registry, populated once its bytes have loaded). Checking the
 *  catalogue first is deliberate: a custom import can never collide with a
 *  catalogue id (main/fonts.ts mints a UUID), so order only matters for which
 *  one resolves the id faster, not for correctness. */
function resolveFont(id: string): { family: string; fallback: FontFallback } | undefined {
  return findFont(id) ?? findInstalledFont(id)
}

export type { AppSettings, Space }
export * from './fonts'
export * from './fontLoader'

export const THEMES: { id: Space['theme']; label: string; hint: string }[] = [
  { id: 'system', label: 'System', hint: "Follows your computer's light or dark setting" },
  { id: 'dark', label: 'Dark', hint: 'Soft charcoal panels' },
  { id: 'black', label: 'Extra dark', hint: 'Pitch black, for OLED' },
  // NOT "paper" — page looks are their own feature later, and this is a plain
  // white page, not a warm one
  { id: 'light', label: 'Light', hint: 'Plain white' }
]

/** Whether the OS is currently in dark mode. Renderer-only (matchMedia), never
 *  called from main/shared — `prefers-color-scheme` tracks Electron's
 *  `nativeTheme`, which defaults to following the OS, so no IPC round-trip is
 *  needed to ask main instead. */
export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/** A space's theme as stored can be 'system'; everything that paints from a
 *  theme (data-theme, the accent ramps below) needs a concrete ramp, so this
 *  is the one place that resolution happens for the running app. */
export function resolveTheme(theme: Space['theme']): ResolvedThemeId {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

export const TEXT_TONES: { id: Space['textTone']; label: string; hint: string; swatch: string }[] = [
  { id: 'grey', label: 'Light grey', hint: 'Softer on the eyes over a long session.', swatch: '#d6d6d6' },
  { id: 'white', label: 'White', hint: 'Maximum contrast — pairs with Extra dark.', swatch: '#ffffff' }
]

export const DENSITIES: {
  id: Space['density']
  label: string
  hint: string
  bar: { h: number; gap: number }
}[] = [
  { id: 'large', label: 'Large', hint: 'Roomy — easy on the eyes', bar: { h: 9, gap: 7 } },
  { id: 'cozy', label: 'Cozy', hint: 'The default', bar: { h: 7, gap: 5 } },
  { id: 'compact', label: 'Compact', hint: 'Tighter rows, still readable', bar: { h: 5, gap: 3 } },
  { id: 'ultra', label: 'Ultra compact', hint: 'Minimal spacing', bar: { h: 3, gap: 1 } }
]

export const EDITOR_WIDTHS: { id: Space['editorWidth']; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'The comfortable reading width used today.' },
  { id: 'wide', label: 'Wide', hint: 'More room per line — good for a big monitor.' },
  { id: 'full', label: 'Full width', hint: 'Uses nearly all the window, edge to edge.' }
]

export const ACCENT_MODES: { id: Space['accentMode']; label: string; hint: string }[] = [
  { id: 'text', label: 'Text only', hint: 'Just the writing takes the colour.' },
  { id: 'tint', label: 'Tinted', hint: 'Surfaces and controls take it too.' }
]

export const LINKS_POSITIONS: { id: Space['linksPosition']; label: string; hint: string }[] = [
  { id: 'top', label: 'Top', hint: 'Under the format bar, above the text — today’s spot.' },
  { id: 'bottom', label: 'Bottom', hint: 'Fixed to the bottom of the note, clear of the tabs, path and title.' }
]

export const STARTUPS: { id: AppSettings['startup']; label: string; hint: string }[] = [
  { id: 'empty', label: 'Start empty', hint: 'Open on the blank screen and pick a note.' },
  {
    id: 'last',
    label: 'Reopen your tabs',
    hint: 'Come back to the notes you left open, split the way you left them.'
  }
]

export const ACCENTS: { id: string; label: string; hue: number | null }[] = [
  { id: 'default', label: 'Default', hue: null },
  { id: 'red', label: 'Red', hue: 6 },
  { id: 'orange', label: 'Orange', hue: 26 },
  { id: 'amber', label: 'Amber', hue: 45 },
  { id: 'lime', label: 'Lime', hue: 96 },
  { id: 'green', label: 'Green', hue: 150 },
  { id: 'teal', label: 'Teal', hue: 182 },
  { id: 'blue', label: 'Blue', hue: 214 },
  { id: 'indigo', label: 'Indigo', hue: 250 },
  { id: 'violet', label: 'Violet', hue: 278 },
  { id: 'pink', label: 'Pink', hue: 328 }
]

// [saturation, lightness] per token. The brand ramp carries the accent at full
// strength (selection, active states); the ink ramp is only lightly tinted, so
// body text stays comfortable. (Ported verbatim from legacy settings.js.)
type Ramp = Record<string, [number, number]>

const DARK_RAMP: Ramp = {
  '--paper': [26, 3.5], '--surface': [20, 9], '--code-bg': [22, 6],
  '--brand-50': [30, 8], '--brand-100': [28, 12], '--brand-200': [26, 17],
  '--brand-300': [24, 30], '--brand-400': [30, 39], '--brand-500': [46, 56],
  '--brand-600': [72, 73], '--brand-700': [80, 81],
  '--ink-900': [13, 86], '--ink-800': [12, 80], '--ink-700': [11, 73],
  '--ink-600': [10, 65], '--ink-500': [9, 56], '--ink-400': [9, 47], '--ink-300': [8, 39]
}

const LIGHT_RAMP: Ramp = {
  '--paper': [34, 97.5], '--surface': [30, 99.6], '--code-bg': [28, 95],
  '--brand-50': [42, 95], '--brand-100': [40, 91], '--brand-200': [36, 85],
  '--brand-300': [30, 70], '--brand-400': [38, 54], '--brand-500': [46, 42],
  '--brand-600': [60, 25], '--brand-700': [66, 17],
  '--ink-900': [16, 12], '--ink-800': [15, 18], '--ink-700': [13, 28],
  '--ink-600': [12, 38], '--ink-500': [11, 47], '--ink-400': [10, 57], '--ink-300': [10, 66]
}

// Extra dark is dark with the surfaces taken to black — the same relationship
// theme.css has, spelled as an override so the two can't drift. Without it a
// tinted accent would lift the page back off black, which is the whole point of
// the theme; the text end of the ramp is untouched.
const BLACK_RAMP: Ramp = {
  ...DARK_RAMP,
  '--paper': [26, 0], '--surface': [20, 4], '--code-bg': [22, 5],
  '--brand-50': [30, 5], '--brand-100': [28, 8], '--brand-200': [26, 12],
  '--brand-300': [24, 23], '--brand-400': [30, 31]
}

const RAMP: Record<ResolvedThemeId, Ramp> = { dark: DARK_RAMP, light: LIGHT_RAMP, black: BLACK_RAMP }

// Text mode recolours only the ink ramp, and properly — this *is* the text
// colour, so it carries real saturation. Surfaces/controls are left alone.
const DARK_TEXT_RAMP: Ramp = {
  '--ink-900': [56, 82], '--ink-800': [52, 76], '--ink-700': [48, 70],
  '--ink-600': [44, 62], '--ink-500': [40, 54], '--ink-400': [36, 46], '--ink-300': [32, 39]
}

const TEXT_RAMP: Record<ResolvedThemeId, Ramp> = {
  dark: DARK_TEXT_RAMP,
  // the accent is a text colour, and text sits at the same brightness on both
  // dark themes — only the surfaces under it changed
  black: DARK_TEXT_RAMP,
  light: {
    '--ink-900': [62, 26], '--ink-800': [58, 31], '--ink-700': [52, 38],
    '--ink-600': [46, 45], '--ink-500': [40, 52], '--ink-400': [34, 60], '--ink-300': [30, 68]
  }
}

/** What the 'white' text tone adds to the accent's ink lightness. An accent
 *  writes --ink-* inline, which beats theme.css's tone block outright, so the
 *  tone has to be folded in here or picking an accent would silently cancel it.
 *  Tapered down the ramp, matching the two ramps' gap in theme.css, so the
 *  steps between heading / body / meta survive the lift. */
const WHITE_LIFT: Record<string, number> = {
  '--ink-900': 16, '--ink-800': 15, '--ink-700': 14, '--ink-600': 12,
  '--ink-500': 10, '--ink-400': 8, '--ink-300': 6
}

const ALL_KEYS = [...new Set([...Object.keys(DARK_RAMP), ...Object.keys(DARK_TEXT_RAMP)])]

/** HSL -> the bare "R G B" channels the CSS variables expect. */
function channels(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)).join(' ')
}

/** Write (or clear) accent variables onto `el`. Every call clears first, so
 *  switching mode can't leave stale variables behind. */
function applyAccent(
  el: HTMLElement,
  opts: {
    accent: string
    mode: Space['accentMode']
    theme: ResolvedThemeId
    tone: Space['textTone']
    active: boolean
  }
): void {
  ALL_KEYS.forEach((k) => el.style.removeProperty(k))
  const hue = ACCENTS.find((a) => a.id === opts.accent)?.hue
  if (!opts.active || hue == null) return
  const ramp = opts.mode === 'text' ? TEXT_RAMP[opts.theme] : RAMP[opts.theme]
  // the light theme has no white to give — see the tone block in theme.css
  const lift = opts.tone === 'white' && opts.theme !== 'light'
  Object.entries(ramp).forEach(([k, [s, l]]) =>
    el.style.setProperty(k, channels(hue, s, Math.min(100, l + (lift ? (WHITE_LIFT[k] ?? 0) : 0))))
  )
}

/** Write (or clear) the font variables onto `el`. Four variables, three
 *  independent picks:
 *   - `uiFont` is a whole-INTERFACE skin — sidebar, settings, buttons,
 *     onboarding — so it sets --font-sans and --font-serif together.
 *   - `font` is the same idea for a NOTE's own body, headings and title, so
 *     it sets --note-font-sans and --note-font-serif together. Kept apart
 *     from --font-sans/--font-serif on purpose: styling your writing
 *     shouldn't restyle the settings window you picked it from.
 *   - `dyslexiaFont` then overrides just --note-font-sans on top of
 *     whatever `font` set, since it's about a note's body text specifically.
 *  --font-mono is never touched by any of this: code stays JetBrains Mono in
 *  every space, skin or no skin. Every property is cleared first, like
 *  `applyAccent`, so switching a pick back to '' actually reverts to
 *  theme.css's own defaults rather than leaving a stale override in place. */
function applyFont(el: HTMLElement, uiFont: string, font: string, dyslexiaFont: string): void {
  el.style.removeProperty('--font-sans')
  el.style.removeProperty('--font-serif')
  el.style.removeProperty('--note-font-sans')
  el.style.removeProperty('--note-font-serif')

  const ui = resolveFont(uiFont)
  if (ui) {
    const value = fontCssValue(ui)
    el.style.setProperty('--font-sans', value)
    el.style.setProperty('--font-serif', value)
  }

  const skin = resolveFont(font)
  if (skin) {
    const value = fontCssValue(skin)
    el.style.setProperty('--note-font-sans', value)
    el.style.setProperty('--note-font-serif', value)
  }

  const dys = resolveFont(dyslexiaFont)
  if (dys) el.style.setProperty('--note-font-sans', fontCssValue(dys))
}

/** Apply the settings to the document: theme + density as data-* attributes,
 *  accent + font as inline variables on <html>. Appearance lives on the ACTIVE
 *  space, resolved here rather than by the caller — this is the only DOM
 *  writer and it has two call sites, so resolving once keeps them from ever
 *  disagreeing. `data-motion` is the one attribute here read from `s` directly
 *  rather than `a`: animationsEnabled is global (see AppSettings), not
 *  per-space. */
export function applySettings(s: AppSettings): void {
  // Fire-and-forget: a downloaded/custom font that hasn't loaded yet just
  // means one repaint at the fallback face once `ensureInstalledFontsLoaded`
  // resolves and the next applySettings runs (settings changes are frequent
  // enough in normal use that this self-corrects almost immediately; a
  // bundled font never has this gap at all). Guarded to run once per
  // session — see fontLoader.ts.
  void ensureInstalledFontsLoaded()

  const root = document.documentElement
  const a = activeSpace(s)
  const theme = resolveTheme(a.theme)
  root.dataset.theme = theme
  root.dataset.density = a.density
  root.dataset.editorWidth = a.editorWidth
  root.dataset.textTone = a.textTone
  root.dataset.buttonDef = a.buttonDefinition ? 'on' : 'off'
  root.dataset.motion = s.animationsEnabled ? 'on' : 'off'
  applyAccent(root, {
    accent: a.accent,
    mode: a.accentMode,
    theme,
    tone: a.textTone,
    active: a.accent !== 'default'
  })
  applyFont(root, a.uiFont, a.font, a.dyslexiaFont)
}
