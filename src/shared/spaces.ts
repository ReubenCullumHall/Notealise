// Spaces = the top-level organisational layer of the vault. A space is simply a
// top-level folder inside the vault; this file is the app-level presentation
// metadata attached to it. The metadata NEVER goes in the folder or the notes —
// it lives in <vault>/.mdnotes/spaces.json, keyed by folder name (rule 2).
// Delete that file and only the colours/icons/order are lost, never the notes.
//
// Pure types + validation, no fs and no DOM, so this is safe to import from main,
// preload, and renderer alike (mirrors shared/settings.ts).

/** Presentation metadata for one space, stored keyed by its folder name. Every
 *  field is optional on disk; an absent field falls back to a deterministic
 *  default in the renderer (so a folder made in Finder still looks intentional).
 *  The folder name is the map key and is the single source of truth for `name` —
 *  it is deliberately not duplicated inside the value. */
export interface SpaceMeta {
  /** '#rgb' or '#rrggbb'; absent → colour derived from a hash of the name. */
  color?: string
  /** an emoji/short glyph shown on the rail; absent → a monogram of the name. */
  icon?: string
  /** sort index within the spaces rail; absent → sorts after ordered spaces. */
  order?: number
  /** persisted for forward-compat (a headed-section view); the rail UI does not
   *  surface it, but it round-trips so nothing is lost. */
  collapsed?: boolean
}

/** The whole spaces.json shape: folder name → its metadata. */
export type SpacesMap = Record<string, SpaceMeta>

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** True for a valid CSS hex colour ('#abc' or '#aabbcc'). */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX.test(v)
}

/** Coerce one parsed value into a clean SpaceMeta, dropping anything invalid so a
 *  bad field falls back to a default rather than corrupting the map. */
export function normalizeMeta(raw: unknown): SpaceMeta {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const meta: SpaceMeta = {}
  if (isHexColor(v.color)) meta.color = (v.color as string).toLowerCase()
  // A non-empty string keeps an icon; '' is how the UI clears one back to a monogram.
  if (typeof v.icon === 'string' && v.icon.trim()) meta.icon = (v.icon as string).slice(0, 8)
  if (typeof v.order === 'number' && Number.isFinite(v.order)) meta.order = v.order
  if (typeof v.collapsed === 'boolean') meta.collapsed = v.collapsed
  return meta
}

/** Coerce arbitrary parsed JSON into a valid SpacesMap. Never throws; unknown or
 *  malformed entries are dropped. */
export function normalizeSpaces(raw: unknown): SpacesMap {
  const out: SpacesMap = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !val || typeof val !== 'object') continue
    out[key] = normalizeMeta(val)
  }
  return out
}
