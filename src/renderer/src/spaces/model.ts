// Renderer-side spaces model: the named colour palette shown in the picker, the
// deterministic default colour for folders with no metadata, colour conversion
// helpers, and the merge that turns (file tree + spaces.json) into the ordered
// list the rail renders. No fs (that is main via window.api); the only "DOM"
// touch is that App injects the active colour as an inline --space-accent var.

import type { TreeNode } from '../../../shared/types'
import type { SpacesMap } from '../../../shared/spaces'

/** The named palette (same hues as the appearance accents in settings/model.ts),
 *  each rendered to a hex so it can be stored verbatim in spaces.json and shown
 *  as a swatch. Saturation/lightness are fixed at values that read on both
 *  themes. A custom hex from the picker is stored the same way. */
const PALETTE_HUES: { id: string; label: string; hue: number }[] = [
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

const PALETTE_S = 64
const PALETTE_L = 58

export interface NamedColor {
  id: string
  label: string
  hex: string
}

export const NAMED_COLORS: NamedColor[] = PALETTE_HUES.map((h) => ({
  id: h.id,
  label: h.label,
  hex: hslToHex(h.hue, PALETTE_S, PALETTE_L)
}))

/** HSL (h 0-360, s/l 0-100) → '#rrggbb'. */
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  const toHex = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

/** '#rgb' | '#rrggbb' → the bare "R G B" channels our CSS variables consume, so
 *  a consumer can add its own alpha via rgb(var(--space-accent) / <a>). Returns
 *  null for anything that isn't a hex colour. */
export function hexToChannels(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

/** True for what the hex input accepts: '#abc' / '#aabbcc', with or without the
 *  leading '#'. Used to gate live recolouring as the user types. */
export function isValidHexInput(v: string): boolean {
  return /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim())
}

/** A deterministic, pleasant default colour derived from a hash of the folder
 *  name, so a folder created outside the app (Finder/Explorer) still shows an
 *  intentional colour rather than grey. Hue spans the wheel; S/L match the named
 *  palette so defaults and named picks sit together. */
export function defaultSpaceColor(name: string): string {
  // FNV-1a over the name → a stable 32-bit hash → a hue.
  let hash = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  const hue = (hash >>> 0) % 360
  return hslToHex(hue, PALETTE_S, PALETTE_L)
}

/** One space as the rail renders it: a top-level folder plus resolved metadata,
 *  or the synthetic Home space that holds notes sitting loose at the vault root. */
export interface Space {
  /** folder name; '' for the synthetic Home space. */
  name: string
  label: string
  isHome: boolean
  /** resolved hex; null only for Home, which stays neutral (brand fallback). */
  color: string | null
  /** emoji/glyph, or '' to fall back to a monogram of the name. */
  icon: string
  order: number
  collapsed: boolean
  /** the tree to render inside this space. */
  nodes: TreeNode[]
}

const HOME_ORDER = Number.NEGATIVE_INFINITY

/** Merge the vault's top-level tree with spaces.json into the ordered rail list.
 *  Every top-level folder becomes a space (auto-coloured if it has no metadata);
 *  loose root notes go into a Home space pinned first. */
export function deriveSpaces(tree: TreeNode[], meta: SpacesMap): Space[] {
  const home: Space = {
    name: '',
    label: 'Home',
    isHome: true,
    color: null,
    icon: '',
    order: HOME_ORDER,
    collapsed: false,
    nodes: tree.filter((n) => n.type === 'file')
  }

  const spaces: Space[] = tree
    .filter((n) => n.type === 'dir')
    .map((node) => {
      const m = meta[node.name] ?? {}
      return {
        name: node.name,
        label: node.name,
        isHome: false,
        color: m.color ?? defaultSpaceColor(node.name),
        icon: m.icon ?? '',
        order: m.order ?? Number.MAX_SAFE_INTEGER,
        collapsed: m.collapsed ?? false,
        nodes: node.children ?? []
      }
    })

  const ordered = [home, ...spaces]
  ordered.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.label.localeCompare(b.label)))
  return ordered
}

/** A short monogram for a space with no emoji icon (first character, uppercased;
 *  a house for Home). */
export function monogram(space: Space): string {
  if (space.isHome) return '⌂'
  const ch = [...space.label].find((c) => c.trim())
  return ch ? ch.toUpperCase() : '•'
}
