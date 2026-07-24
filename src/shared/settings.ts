// App appearance settings — the contract shared by main, preload, and renderer.
// Pure types + validation, no fs and no DOM, so it is safe to import anywhere.
// Persisted per-vault in <vault>/.mdnotes/settings.json (rule 2); a theme+density
// mirror is cached in userData purely for pre-vault first paint.

export type ThemeId = 'dark' | 'light'
export type DensityId = 'large' | 'cozy' | 'compact' | 'ultra'
export type AccentMode = 'text' | 'tint'

export interface AppSettings {
  theme: ThemeId
  /** how tightly the sidebar packs rows */
  density: DensityId
  /** accent id from the renderer palette; 'default' means no accent */
  accent: string
  /** whether the accent recolours just the text or surfaces too */
  accentMode: AccentMode
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  density: 'cozy',
  accent: 'default',
  accentMode: 'text'
}

const THEMES: readonly ThemeId[] = ['dark', 'light']
const DENSITIES: readonly DensityId[] = ['large', 'cozy', 'compact', 'ultra']
const MODES: readonly AccentMode[] = ['text', 'tint']

/** Coerce arbitrary parsed JSON into a valid AppSettings, filling any missing or
 *  out-of-range field from DEFAULT_SETTINGS. Never throws. */
export function normalizeSettings(raw: unknown): AppSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    theme: THEMES.includes(s.theme as ThemeId) ? (s.theme as ThemeId) : DEFAULT_SETTINGS.theme,
    density: DENSITIES.includes(s.density as DensityId)
      ? (s.density as DensityId)
      : DEFAULT_SETTINGS.density,
    accent: typeof s.accent === 'string' && s.accent ? s.accent : DEFAULT_SETTINGS.accent,
    accentMode: MODES.includes(s.accentMode as AccentMode)
      ? (s.accentMode as AccentMode)
      : DEFAULT_SETTINGS.accentMode
  }
}
