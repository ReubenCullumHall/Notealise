// The app's named colours, and the two layers they can be applied in.
//
// Shared for the same reason `links.ts` and `color.ts` are, and for one more
// that matters here: these names are written INTO the user's files, as
// `<mark class="hl-NAME">` and `<span class="tc-NAME">` (rule 4). They are a
// storage format, not a UI detail — so main can validate a setting that names
// one without importing anything out of `renderer/`.

// ---------------------------------------------------------------------------
// THE canonical palette. Every colour control in the app draws its presets from
// this one list (Reuben, 2026-09-05: "make sure the colour picker is universal
// — has the same preset colours ... in onboarding, on text select and in accent
// colours and tints"). Before this there were three unrelated sets: eight names
// here, eight unrelated hexes in `color.ts`'s DEFAULT_PALETTE, and eleven hues
// in `settings/model.ts`'s ACCENTS — so "green" meant a different green
// depending on which picker you happened to have open.
//
// It went from eight to ten. `lime` and `indigo` are new; every one of the
// original eight kept its name, because those names are written INTO notes and
// renaming one would silently un-colour text in files already on disk.
//
// Each entry carries both forms a surface can need:
//   • `hue`  — for anything that derives a whole readable ramp (the accent).
//   • `hex`  — for anything that paints a literal colour (a sidebar row, a page
//              tint). Hand-tuned per hue rather than one S/L applied to all:
//              equal saturation across the wheel does NOT look equal, and the
//              eight it replaces had been tuned by eye the same way. Every one
//              is dark enough that `inkOn` answers 'light' — pinned by a test
//              in color.test.ts, because a row's name flips to black or white
//              on that answer.
//
// The colour VALUES USED IN A NOTE are still not here and must not be: text and
// highlight need separate light and dark values to stay readable on both themes
// (`--tc-NAME` / `--hl-NAME` in theme.css, one pair per name here). `hex` is the
// palette's identity, not what a highlight paints.
// ---------------------------------------------------------------------------

/** Spectrum order — how every picker lays them out. Changing the ORDER is
 *  safe; changing a NAME is not (see above). */
export const COLOR_NAMES = [
  'coral',
  'amber',
  'lime',
  'sage',
  'teal',
  'sky',
  'slate',
  'indigo',
  'violet',
  'rose'
] as const
export type ColorName = (typeof COLOR_NAMES)[number]

export interface PaletteEntry {
  name: ColorName
  /** Capitalised for display. Derived, never a second list to keep in step. */
  label: string
  /** 0-359, for `applyAccent`'s ramps. Matches the hue of this name's
   *  `--tc-NAME` / `--hl-NAME` in theme.css — if one moves, move both. */
  hue: number
  /** A literal mid-tone, for surfaces that paint a colour rather than derive
   *  one. `inkOn(hex) === 'light'` for every entry. */
  hex: string
}

const ENTRIES: { name: ColorName; hue: number; hex: string }[] = [
  { name: 'coral', hue: 14, hex: '#e07b5c' },
  { name: 'amber', hue: 40, hex: '#d7a542' },
  { name: 'lime', hue: 96, hex: '#7bb654' },
  { name: 'sage', hue: 140, hex: '#4ab56e' },
  { name: 'teal', hue: 178, hex: '#45b0ad' },
  { name: 'sky', hue: 205, hex: '#4ba0dd' },
  { name: 'slate', hue: 218, hex: '#7386a5' },
  { name: 'indigo', hue: 250, hex: '#8e7edd' },
  { name: 'violet', hue: 273, hex: '#b283d8' },
  { name: 'rose', hue: 342, hex: '#d7708f' }
]

export const PALETTE: readonly PaletteEntry[] = ENTRIES.map((e) => ({
  ...e,
  label: e.name[0].toUpperCase() + e.name.slice(1)
}))

/** The palette as plain hexes, in the same order — what a surface that stores a
 *  colour rather than a name seeds itself with. */
export const PALETTE_HEXES: readonly string[] = PALETTE.map((c) => c.hex)

/** Look one up by name. `undefined` for anything not in the palette, which is
 *  what a custom hex is. */
export const paletteEntry = (name: string): PaletteEntry | undefined =>
  PALETTE.find((c) => c.name === name)

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
