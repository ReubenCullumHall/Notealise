// The fixed, named colour palette. Highlight (hl) and text-colour (tc) variants
// of each colour derive from the same base hue so the set stays coherent. The
// actual colour values live as CSS custom properties in app.css (`--hl-NAME` /
// `--tc-NAME`), with distinct light and dark values so every colour is readable
// on both themes — not opacity tricks.

export type Layer = 'hl' | 'tc'

export interface PaletteColor {
  name: string
  label: string
}

export const PALETTE: PaletteColor[] = [
  { name: 'amber', label: 'Amber' },
  { name: 'coral', label: 'Coral' },
  { name: 'rose', label: 'Rose' },
  { name: 'violet', label: 'Violet' },
  { name: 'sky', label: 'Sky' },
  { name: 'teal', label: 'Teal' },
  { name: 'sage', label: 'Sage' },
  { name: 'slate', label: 'Slate' }
]

export const COLOR_NAMES = new Set(PALETTE.map((c) => c.name))

/** Colour applied by the Cmd/Ctrl+Shift+H highlight shortcut. */
export const DEFAULT_HL = 'amber'

/** Highlight is a <mark>, text colour is a <span> — both valid CommonMark. */
export const tagFor = (layer: Layer): 'mark' | 'span' => (layer === 'hl' ? 'mark' : 'span')
