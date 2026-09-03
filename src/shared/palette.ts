// The eight named colours, and the two layers they can be applied in.
//
// Shared for the same reason `links.ts` and `color.ts` are, and for one more
// that matters here: these names are written INTO the user's files, as
// `<mark class="hl-NAME">` and `<span class="tc-NAME">` (rule 4). They are a
// storage format, not a UI detail — so main can validate a setting that names
// one without importing anything out of `renderer/`.
//
// The colour VALUES are not here and must not be: they live as `--hl-NAME` /
// `--tc-NAME` custom properties in app.css, with separate light and dark values
// so every colour stays readable on both themes (rule 5, and a baked-in hex
// cannot do that). This file is the list of names only.

export const COLOR_NAMES = [
  'amber',
  'coral',
  'rose',
  'violet',
  'sky',
  'teal',
  'sage',
  'slate'
] as const
export type ColorName = (typeof COLOR_NAMES)[number]

/** `hl` paints behind the text, `tc` paints the text itself. */
export type Layer = 'hl' | 'tc'
export const LAYERS = ['hl', 'tc'] as const

/** A layer and a colour in one string — `hl-sage`, `tc-amber` — which is exactly
 *  the form the class names in a note already take, so a setting that stores one
 *  is storing the same token the editor writes. */
export type ColorToken = `${Layer}-${ColorName}`

export const colorToken = (layer: Layer, name: ColorName): ColorToken => `${layer}-${name}`

export function isColorToken(v: unknown): v is ColorToken {
  if (typeof v !== 'string') return false
  const i = v.indexOf('-')
  if (i < 0) return false
  const layer = v.slice(0, i)
  const name = v.slice(i + 1)
  return (
    (layer === 'hl' || layer === 'tc') && (COLOR_NAMES as readonly string[]).includes(name)
  )
}

/** Split a token back into its two halves. Only call it on a validated token. */
export const splitToken = (t: ColorToken): { layer: Layer; name: ColorName } => {
  const i = t.indexOf('-')
  return { layer: t.slice(0, i) as Layer, name: t.slice(i + 1) as ColorName }
}
