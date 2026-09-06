// The fixed, named colour palette. Highlight (hl) and text-colour (tc) variants
// of each colour derive from the same base hue so the set stays coherent. The
// actual colour values live as CSS custom properties in app.css (`--hl-NAME` /
// `--tc-NAME`), with distinct light and dark values so every colour is readable
// on both themes — not opacity tricks.

// The names and the two layers are a STORAGE format (they end up in the file),
// so they live in shared/palette.ts and main can validate against them. Only the
// human labels below are UI, and they are derived rather than listed twice.
export {
  COLOR_NAMES as COLOR_NAME_LIST,
  colorToken,
  isColorToken,
  splitToken,
  type ColorName,
  type ColorToken,
  type Layer
} from '../../../shared/palette'
import { COLOR_NAMES as NAMES, type Layer } from '../../../shared/palette'

// Which of the two you reached for last — highlight, or text colour.
//
// The selection toolbar is unmounted the moment a selection clears
// (`{tb && <SelectionToolbar/>}` in CodeEditor), so anything it keeps in
// `useState` is gone by the time you select the next phrase. It therefore
// re-opened on Highlight every time, and colouring three words in a row in text
// colour meant switching the mode three times. Reuben, 2026-08-29: it should
// "stay always as the last one used".
//
// A module-level value rather than a setting: it is a scratch preference about
// the last thing you did, not part of how a space LOOKS (CLAUDE.md's settings
// rule), and nothing in `.mdnotes/` should grow a key for it. It lasts as long
// as the window does and starts at Highlight on a fresh launch.
let lastLayer: Layer = 'hl'
export const getLastLayer = (): Layer => lastLayer
export const setLastLayer = (l: Layer): void => {
  lastLayer = l
}

// The palette itself now lives in shared/palette.ts — one canonical list for
// every colour control in the app (2026-09-05). This file keeps only what is
// EDITOR-specific: the last-used layer above, and the `<mark>`/`<span>` mapping
// below. Re-exported rather than re-derived so there is no second list to keep
// in step; the entries carry `hue` and `hex` as well now, which the editor
// ignores and the accent and tint pickers need.
export { PALETTE, paletteEntry, type PaletteEntry } from '../../../shared/palette'

/** A Set for the hot path — `detectColorOpen` tests every HTMLTag in the
 *  viewport against it. */
export const COLOR_NAMES = new Set<string>(NAMES)

/** Colour applied by the Cmd/Ctrl+Shift+H highlight shortcut. */
export const DEFAULT_HL = 'amber'

/** Highlight is a <mark>, text colour is a <span> — both valid CommonMark. */
export const tagFor = (layer: Layer): 'mark' | 'span' => (layer === 'hl' ? 'mark' : 'span')
