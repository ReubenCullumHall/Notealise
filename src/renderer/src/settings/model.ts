// Renderer-side appearance model: the option lists shown in the Settings panel,
// plus the accent generator ported from legacy/src/settings.js. This is the only
// place that touches the DOM (applying settings as data-* attributes and inline
// accent variables on <html>); persistence goes through IPC (window.api).

import type { AppSettings } from '../../../shared/settings'

export type { AppSettings }

export const THEMES: { id: AppSettings['theme']; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' }
]

export const DENSITIES: {
  id: AppSettings['density']
  label: string
  hint: string
  bar: { h: number; gap: number }
}[] = [
  { id: 'large', label: 'Large', hint: 'Roomy — easy on the eyes', bar: { h: 9, gap: 7 } },
  { id: 'cozy', label: 'Cozy', hint: 'The default', bar: { h: 7, gap: 5 } },
  { id: 'compact', label: 'Compact', hint: 'Tighter rows, still readable', bar: { h: 5, gap: 3 } },
  { id: 'ultra', label: 'Ultra compact', hint: 'Minimal spacing', bar: { h: 3, gap: 1 } }
]

export const ACCENT_MODES: { id: AppSettings['accentMode']; label: string; hint: string }[] = [
  { id: 'text', label: 'Text only', hint: 'Just the writing takes the colour.' },
  { id: 'tint', label: 'Tinted', hint: 'Surfaces and controls take it too.' }
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
const RAMP: Record<'dark' | 'light', Record<string, [number, number]>> = {
  dark: {
    '--paper': [26, 3.5], '--surface': [20, 9], '--code-bg': [22, 6],
    '--brand-50': [30, 8], '--brand-100': [28, 12], '--brand-200': [26, 17],
    '--brand-300': [24, 30], '--brand-400': [30, 39], '--brand-500': [46, 56],
    '--brand-600': [72, 73], '--brand-700': [80, 81],
    '--ink-900': [13, 86], '--ink-800': [12, 80], '--ink-700': [11, 73],
    '--ink-600': [10, 65], '--ink-500': [9, 56], '--ink-400': [9, 47], '--ink-300': [8, 39]
  },
  light: {
    '--paper': [34, 97.5], '--surface': [30, 99.6], '--code-bg': [28, 95],
    '--brand-50': [42, 95], '--brand-100': [40, 91], '--brand-200': [36, 85],
    '--brand-300': [30, 70], '--brand-400': [38, 54], '--brand-500': [46, 42],
    '--brand-600': [60, 25], '--brand-700': [66, 17],
    '--ink-900': [16, 12], '--ink-800': [15, 18], '--ink-700': [13, 28],
    '--ink-600': [12, 38], '--ink-500': [11, 47], '--ink-400': [10, 57], '--ink-300': [10, 66]
  }
}

// Text mode recolours only the ink ramp, and properly — this *is* the text
// colour, so it carries real saturation. Surfaces/controls are left alone.
const TEXT_RAMP: Record<'dark' | 'light', Record<string, [number, number]>> = {
  dark: {
    '--ink-900': [56, 82], '--ink-800': [52, 76], '--ink-700': [48, 70],
    '--ink-600': [44, 62], '--ink-500': [40, 54], '--ink-400': [36, 46], '--ink-300': [32, 39]
  },
  light: {
    '--ink-900': [62, 26], '--ink-800': [58, 31], '--ink-700': [52, 38],
    '--ink-600': [46, 45], '--ink-500': [40, 52], '--ink-400': [34, 60], '--ink-300': [30, 68]
  }
}

const ALL_KEYS = [...new Set([...Object.keys(RAMP.dark), ...Object.keys(TEXT_RAMP.dark)])]

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
  opts: { accent: string; mode: AppSettings['accentMode']; theme: AppSettings['theme']; active: boolean }
): void {
  ALL_KEYS.forEach((k) => el.style.removeProperty(k))
  const hue = ACCENTS.find((a) => a.id === opts.accent)?.hue
  if (!opts.active || hue == null) return
  const ramp = opts.mode === 'text' ? TEXT_RAMP[opts.theme] : RAMP[opts.theme]
  Object.entries(ramp).forEach(([k, [s, l]]) => el.style.setProperty(k, channels(hue, s, l)))
}

/** Apply the whole settings object to the document: theme + density as data-*
 *  attributes, accent as inline variables on <html>. */
export function applySettings(s: AppSettings): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.dataset.density = s.density
  applyAccent(root, {
    accent: s.accent,
    mode: s.accentMode,
    theme: s.theme,
    active: s.accent !== 'default'
  })
}
