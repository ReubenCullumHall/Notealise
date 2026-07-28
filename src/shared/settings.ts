// App appearance settings — the contract shared by main, preload, and renderer.
// Pure types + validation, no fs and no DOM, so it is safe to import anywhere.
// Persisted per-vault in <vault>/.mdnotes/settings.json (rule 2); a theme+density
// mirror is cached in userData purely for pre-vault first paint.

export type ThemeId = 'dark' | 'light'
export type DensityId = 'large' | 'cozy' | 'compact' | 'ultra'
export type AccentMode = 'text' | 'tint'
export type StartupId = 'empty' | 'last'
export type DateFormatId = 'full' | 'short' | 'mdy' | 'dmy' | 'ymd' | 'relative'
export type NumberFormatId = 'default' | 'comma' | 'dot'

export interface AppSettings {
  theme: ThemeId
  /** how tightly the sidebar packs rows */
  density: DensityId
  /** accent id from the renderer palette; 'default' means no accent */
  accent: string
  /** whether the accent recolours just the text or surfaces too */
  accentMode: AccentMode
  /** off: folders sit above notes at each level; on: one shared drag order */
  freeArrange: boolean
  /** off: the Note/Folder/Organize nav buttons always show their text label.
   *  on: they're icon-only, centred as a group — same look the sidebar
   *  already falls back to on its own once dragged narrower than ~220px. */
  compactNav: boolean
  /** what to show when a vault opens */
  startup: StartupId
  /** vault-relative path of the last note that was open; drives "Reopen last note" */
  lastNotePath: string | null
  /** used for edit times and for the archive and bin */
  dateFormat: DateFormatId
  numberFormat: NumberFormatId
  /** an IANA zone name, or "system" to follow the OS */
  timezone: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  density: 'cozy',
  accent: 'default',
  accentMode: 'text',
  freeArrange: false,
  compactNav: false,
  startup: 'empty',
  lastNotePath: null,
  dateFormat: 'relative',
  numberFormat: 'default',
  timezone: 'system'
}

const THEMES: readonly ThemeId[] = ['dark', 'light']
const DENSITIES: readonly DensityId[] = ['large', 'cozy', 'compact', 'ultra']
const MODES: readonly AccentMode[] = ['text', 'tint']
const STARTUPS: readonly StartupId[] = ['empty', 'last']
const DATE_FORMATS: readonly DateFormatId[] = ['full', 'short', 'mdy', 'dmy', 'ymd', 'relative']
const NUMBER_FORMATS: readonly NumberFormatId[] = ['default', 'comma', 'dot']

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
      : DEFAULT_SETTINGS.accentMode,
    freeArrange: typeof s.freeArrange === 'boolean' ? s.freeArrange : DEFAULT_SETTINGS.freeArrange,
    compactNav: typeof s.compactNav === 'boolean' ? s.compactNav : DEFAULT_SETTINGS.compactNav,
    startup: STARTUPS.includes(s.startup as StartupId) ? (s.startup as StartupId) : DEFAULT_SETTINGS.startup,
    lastNotePath: typeof s.lastNotePath === 'string' ? s.lastNotePath : null,
    dateFormat: DATE_FORMATS.includes(s.dateFormat as DateFormatId)
      ? (s.dateFormat as DateFormatId)
      : DEFAULT_SETTINGS.dateFormat,
    numberFormat: NUMBER_FORMATS.includes(s.numberFormat as NumberFormatId)
      ? (s.numberFormat as NumberFormatId)
      : DEFAULT_SETTINGS.numberFormat,
    // any IANA string is legal; the picker only ever offers real ones
    timezone: typeof s.timezone === 'string' && s.timezone ? s.timezone : DEFAULT_SETTINGS.timezone
  }
}
