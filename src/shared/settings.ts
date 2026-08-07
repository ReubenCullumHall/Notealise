// App settings — the contract shared by main, preload, and renderer.
// Pure types + validation, no fs and no DOM, so it is safe to import anywhere.
// Persisted per-vault in <vault>/.mdnotes/settings.json (rule 2); a theme+density
// mirror is cached in userData purely for pre-vault first paint.
//
// SPACES. The vault's top-level folders ARE the spaces — the layer between the
// vault and the folders you see in the sidebar:
//
//     <vault>/            the folder picked at onboarding
//       Revision/         a SPACE
//         Physics/        an ordinary folder, shown in the sidebar
//           waves.md
//       Journal/          another space
//
// **The folders on disk are the source of truth** (rule 1): this file only
// decorates them with a look — emoji, theme, accent, density, arranging, the
// four format-bar buttons. `reconcileSpaces` adopts folders that appeared and
// drops entries whose folder is gone, so making a folder in Explorer makes a
// space, and deleting one removes it. A space is identified by its `folder`,
// which is also its display name (renaming a space renames the folder).
//
// `folder: ''` means "the whole vault" — the fallback when a vault has no
// top-level folders yet, so a fresh or flat vault still shows its notes.
//
// DOWNGRADE CAVEAT: an older build reading this file drops the unknown `spaces`
// key and writes a flat file back; upgrading then re-migrates from one space
// only. Unavoidable without a schema-version refusal path — documented rather
// than engineered around.

import { DEFAULT_PALETTE, normalizePalette } from './color'

/** 'black' is Extra dark: the dark ramp with every surface taken to (near)
 *  pitch black, for OLED panels and dim rooms. It is a VARIANT of dark, not a
 *  third independent palette — theme.css only overrides what differs. */
export type ThemeId = 'dark' | 'light' | 'black'
/** How bright body text is on a dark theme. 'grey' is the long-standing soft
 *  ramp (#d6d6d6 at the top); 'white' pushes it to full white for maximum
 *  contrast. Ignored by the light theme, which has no white to give. */
export type TextToneId = 'grey' | 'white'
export type DensityId = 'large' | 'cozy' | 'compact' | 'ultra'
export type AccentMode = 'text' | 'tint'
/** Where a note's or folder's own colour is painted in the sidebar, quietest
 *  first. 'tag' puts it on the grip — the 3×2 dot handle at the head of the row
 *  — so the row is marked without being recoloured. 'row' washes the row at low
 *  alpha, keeping the theme's own text colours. 'solid' fills the row with the
 *  colour outright, and is the only one that has to restate the text colour:
 *  the ink flips to black or white by luminance (`inkOn`), because at full
 *  strength the theme's ramp has nothing to say about what is readable on a
 *  colour the user chose. */
export type ColorStyle = 'tag' | 'row' | 'solid'
export type StartupId = 'empty' | 'last'
export type DateFormatId = 'full' | 'short' | 'mdy' | 'dmy' | 'ymd' | 'relative'
export type NumberFormatId = 'default' | 'comma' | 'dot'

/** Assignable buttons on the format bar: two left of the built-in group, two
 *  right of it. Fixed at four so the bar's shape never depends on the file. */
export const TOOLBAR_SLOTS = 4

/** How many spaces a vault may have. Capped so the sidebar switcher stays a
 *  glanceable row of emoji rather than a crowded strip. */
export const SPACE_CAP = 7

/** One space: a top-level vault folder, plus how the app looks while you're in
 *  it. */
export interface Space {
  /** The top-level folder name, vault-relative — the identity AND the display
   *  name (renaming a space renames the folder). '' is the whole vault, used
   *  when there are no top-level folders yet. */
  folder: string
  emoji: string
  // --- appearance ---
  theme: ThemeId
  /** brightness of body text on the dark themes; the light theme ignores it */
  textTone: TextToneId
  /** stronger edges on buttons and controls. Off is the app's own borders; on
   *  swaps them for a per-theme colour that stands further off the background.
   *  Works in every theme, unlike `textTone`. */
  buttonDefinition: boolean
  /** how tightly the sidebar packs rows */
  density: DensityId
  /** accent id from the renderer palette; 'default' means no accent */
  accent: string
  /** whether the accent recolours just the text or surfaces too */
  accentMode: AccentMode
  // --- entry colour ---
  // The accent above is ONE colour for the whole app. These are about telling
  // individual rows apart from each other, which is a different job: the colour
  // lives on the entry (workspace.json's `EntryMeta.color`) and only how it is
  // PAINTED is decided here, per space — a revision space full of subject
  // folders wants the whole row washed, a journal wants a quiet tag or nothing.
  /** paint an entry's colour on the grip, or across the whole row */
  colorStyle: ColorStyle
  /** give a folder a colour from `colorPalette` the moment it is created, so a
   *  sidebar of folders looks different folder-to-folder with nothing assigned
   *  by hand. Notes are deliberately NOT auto-coloured — they take their
   *  folder's colour by inheritance, and colouring each one individually would
   *  make the sidebar louder, not clearer. */
  colorAuto: boolean
  /** whether a note (or subfolder) with no colour of its own shows the nearest
   *  coloured ancestor's. Off, only what you coloured is coloured. */
  colorInherit: boolean
  /** the hexes offered as quick picks and drawn from by `colorAuto`. Validated
   *  loosely, like `accent` and `toolbarSlots`: junk entries are dropped rather
   *  than failing the file. */
  colorPalette: string[]
  // --- arranging ---
  /** off: folders sit above notes at each level; on: one shared drag order */
  freeArrange: boolean
  /** off: the Note/Folder nav buttons always show their text label.
   *  on: they're icon-only, centred as a group — same look the sidebar
   *  already falls back to on its own once dragged narrower than ~220px. */
  compactNav: boolean
  // --- the note's own chrome ---
  // These three belong to a space rather than the app because how a set of
  // notes READS is a property of that set: a revision space wants its links in
  // front of it and its folder trail visible, a journal wants neither. Settings
  // → Linking content can push any of them to every space at once.
  /** show the strip of this note's links — what it points at, what points back */
  showLinks: boolean
  /** keep that strip on screen while the note scrolls, instead of letting it go */
  pinLinks: boolean
  /** show the `Space › Folder › Note` bar between the tabs and the format bar */
  showPath: boolean
  /** show when the note was made and last edited, beside its word count */
  showNoteInfo: boolean
  /** "Markdown pro": put a button in the corner of every note that switches
   *  between the formatted view and the raw Markdown. Per-space like the rest of
   *  this list — a revision space full of tables wants it, a journal doesn't —
   *  and off by default, because the button is permanent furniture for people
   *  who never want to see a `**`. Which notes are currently RAW is not here:
   *  that is a property of each note, and lives in workspace.json. */
  markdownPro: boolean
  // --- shortcuts ---
  /** The four custom format-bar buttons, in bar order: [farLeft, left, right,
   *  farRight]. Each is an action id from the renderer's catalogue
   *  (`editor/commands.tsx`); '' is an unassigned slot. Validated loosely
   *  for the same reason `accent` is — the catalogue is renderer-side, and an id
   *  this build doesn't know resolves to unassigned rather than being rewritten. */
  toolbarSlots: string[]
  // --- future features: persisted so they land without a second migration,
  //     but nothing reads them yet. '' means unset (there is no catalogue to
  //     hold a 'default' entry, unlike `accent`). ---
  pageLook: string
  font: string
  tint: string
}

/** A space's whole look, with the question of *which folder* removed — every
 *  field of `Space` except its identity. This is what a preset carries
 *  (`shared/presets.ts`), and what pouring one onto a space writes: the folder
 *  and the notes in it are never part of the deal. */
export type SpaceLook = Omit<Space, 'folder'>

/** Split a space into "which folder" and "how it looks".
 *
 *  The arrays are copied, not handed over: guarantee 5 above ("never share a
 *  mutable reference") applies to a look held in the preset library exactly as
 *  it does to one held in settings — a saved look that changed under you because
 *  the space it was taken from was edited afterwards would be a bug nothing in
 *  the type system could see. */
export function spaceLook(s: Space): SpaceLook {
  const { folder: _folder, ...look } = s
  return { ...look, toolbarSlots: [...s.toolbarSlots], colorPalette: [...s.colorPalette] }
}

/** Coerce arbitrary parsed JSON into a valid SpaceLook — a preset file read off
 *  disk, which is as untrusted as settings.json is. Goes through the same
 *  `normalizeSpace` the settings file does rather than repeating its field list:
 *  a new key on `Space` must not be able to validate in one place and not the
 *  other. The `folder` it derives is discarded, which is the whole point. */
export function normalizeLook(raw: unknown): SpaceLook {
  return spaceLook(normalizeSpace(raw))
}

/** The open tabs and the split, as last seen. Shape only — this file validates
 *  that it IS a layout (strings, a number), never that the paths still exist or
 *  that the panes make sense together. That second job is the renderer's
 *  (`tabs/model.ts`'s `restoreLayout`), because it needs the file tree to answer
 *  it, and main has no business knowing what a pane is. */
export interface SessionLayout {
  /** open notes, in tab-strip order */
  tabs: string[]
  /** the note each pane showed, left to right */
  panes: string[]
  /** index into `panes` */
  focus: number
}

export const EMPTY_SESSION: SessionLayout = { tabs: [], panes: [], focus: 0 }

export interface AppSettings {
  /** 1..SPACE_CAP, folders unique. **Never empty**: a vault with no top-level
   *  folders still has one space, unbound (`folder: ''`), standing for the whole
   *  vault. That invariant is what makes every appearance setting writable —
   *  `withSpacePatch` matches on `folder`, so with no space there is nothing to
   *  patch and the theme controls silently do nothing. */
  spaces: Space[]
  /** the `folder` of the active space */
  activeSpaceFolder: string
  // --- global: one app launch, one locale. Deliberately NOT per-space. ---
  /** what to show when a vault opens */
  startup: StartupId
  /** what was open when the app last closed — the tab strip and how it was
   *  split. Drives "Reopen your tabs".
   *  Global on purpose: it's written on EVERY note open, so nesting it would
   *  make each one rewrite the whole spaces array — and switching space
   *  shouldn't change which notes you're looking at. Replaced the single
   *  `lastNotePath`, which an old settings.json is migrated from below. */
  session: SessionLayout
  /** used for edit times and for the archive and bin */
  dateFormat: DateFormatId
  numberFormat: NumberFormatId
  /** an IANA zone name, or "system" to follow the OS */
  timezone: string
}

export const DEFAULT_SPACE: Space = {
  folder: '',
  emoji: '',
  theme: 'dark',
  textTone: 'grey',
  buttonDefinition: false,
  density: 'cozy',
  accent: 'default',
  accentMode: 'text',
  colorStyle: 'tag',
  // Off by default: a fresh vault filling itself with colour nobody asked for
  // is the app making a decision that is the user's. The palette IS pre-filled,
  // so switching it on is one click and not "now go and build a palette".
  colorAuto: false,
  colorInherit: true,
  colorPalette: [...DEFAULT_PALETTE],
  freeArrange: false,
  compactNav: false,
  showLinks: true,
  pinLinks: false,
  // On by default: knowing where the note you're reading actually lives is the
  // kind of thing you want in every space, and a new space starting without it
  // read as the feature being missing rather than switched off.
  showPath: true,
  showNoteInfo: false,
  markdownPro: false,
  toolbarSlots: ['', '', '', ''],
  pageLook: '',
  font: '',
  tint: ''
}

export const DEFAULT_SETTINGS: AppSettings = {
  spaces: [DEFAULT_SPACE],
  activeSpaceFolder: '',
  // Reopening what you had open is the default, as in every comparable editor:
  // with tabs, "start empty" throws away a whole arrangement rather than one
  // note. Still a preference — Settings → General turns it off.
  startup: 'last',
  session: EMPTY_SESSION,
  dateFormat: 'relative',
  numberFormat: 'default',
  timezone: 'system'
}

/** A brand-new space, defaults throughout. Every array on DEFAULT_SPACE is
 *  copied here rather than at each call site — guarantee 5 (never share a
 *  mutable reference with the defaults) was previously re-stated at three
 *  places, and a fourth array added to `Space` would have had to remember all
 *  three. */
export function freshSpace(folder: string): Space {
  return {
    ...DEFAULT_SPACE,
    toolbarSlots: [...DEFAULT_SPACE.toolbarSlots],
    colorPalette: [...DEFAULT_SPACE.colorPalette],
    folder
  }
}

const THEMES: readonly ThemeId[] = ['dark', 'light', 'black']
const TEXT_TONES: readonly TextToneId[] = ['grey', 'white']
const DENSITIES: readonly DensityId[] = ['large', 'cozy', 'compact', 'ultra']
const MODES: readonly AccentMode[] = ['text', 'tint']
const COLOR_STYLES: readonly ColorStyle[] = ['tag', 'row', 'solid']
const STARTUPS: readonly StartupId[] = ['empty', 'last']
const DATE_FORMATS: readonly DateFormatId[] = ['full', 'short', 'mdy', 'dmy', 'ymd', 'relative']
const NUMBER_FORMATS: readonly NumberFormatId[] = ['default', 'comma', 'dot']

const NAME_MAX = 40
/** A ZWJ family emoji is 11 UTF-16 units, so this passes everything real while
 *  stopping a hand-edited 4000-character string blowing out the tab strip. */
const EMOJI_MAX = 16

function isPlainObject(v: unknown): v is Record<string, unknown> {
  // typeof [] === 'object', so the array check is load-bearing: without it a
  // bare [] inside `spaces` would pass as a space.
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function shortString(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, NAME_MAX) : ''
}

/** The longest single path segment every target filesystem accepts (APFS, NTFS
 *  and ext4 all cap a name at 255 bytes). A longer string cannot be the name of
 *  a folder that exists, so it cannot be a space's identity either. */
const SEGMENT_MAX_BYTES = 255

/** A folder name is one path segment: no separators, no traversal. Anything
 *  else is treated as unbound ('') and `reconcileSpaces` will rebind or drop it
 *  — main validates the real path again at the fs boundary regardless.
 *
 *  **`folder` is NEVER truncated.** It is the space's *identity* — the real
 *  folder name on disk — not a label, so shortening it doesn't shorten what the
 *  user reads, it points the space at a folder that does not exist: the sidebar
 *  scopes to nothing and deleting the space fails with "doesn't exist". A
 *  `NAME_MAX` (40) slice here did exactly that to every space whose name ran
 *  long, confirmed 2026-08-05 against a real vault where
 *  "Tracker test Meiosis, DNA and Protein synthesis" was recorded as
 *  "Tracker test Meiosis, DNA and Protein sy". Long names are a *display*
 *  problem, and `.space-tab` already solves it (max-width + ellipsis).
 *  Something too long for the filesystem goes unbound like every other invalid
 *  value here, rather than being reshaped into a plausible-looking lie. */
function normalizeFolder(v: unknown): string {
  if (typeof v !== 'string') return ''
  const f = v.trim()
  if (!f || f === '.' || f === '..' || f.includes('/') || f.includes('\\')) return ''
  return new TextEncoder().encode(f).length > SEGMENT_MAX_BYTES ? '' : f
}

/**
 * What the TOP LEVEL of an older settings.json said about the note's chrome.
 *
 * `showPath` and `pinLinks` shipped as app-wide settings and then moved onto a
 * space, because how a set of notes reads is a property of that set — a revision
 * space wants its links in front of it, a journal doesn't. An existing file has
 * them at the top level; they are handed down here so nobody's choice is
 * silently reset to the default by an update.
 */
interface LegacyChrome {
  showLinks?: unknown
  pinLinks?: unknown
  showPath?: unknown
}

/** Coerce arbitrary parsed JSON into a valid Space, field by field — one bad
 *  field must never discard the good ones beside it. */
function normalizeSpace(raw: unknown, legacy: LegacyChrome = {}): Space {
  const s = isPlainObject(raw) ? raw : {}
  /** A boolean that may have come from the old app-wide setting. `legacy` holds
   *  what the top level of settings.json said before these moved onto a space;
   *  a space that has its own answer always wins. */
  const chrome = (own: unknown, was: unknown, fallback: boolean): boolean =>
    typeof own === 'boolean' ? own : typeof was === 'boolean' ? was : fallback
  return {
    folder: normalizeFolder(s.folder),
    emoji: typeof s.emoji === 'string' ? s.emoji.slice(0, EMOJI_MAX) : DEFAULT_SPACE.emoji,
    theme: THEMES.includes(s.theme as ThemeId) ? (s.theme as ThemeId) : DEFAULT_SPACE.theme,
    textTone: TEXT_TONES.includes(s.textTone as TextToneId)
      ? (s.textTone as TextToneId)
      : DEFAULT_SPACE.textTone,
    buttonDefinition:
      typeof s.buttonDefinition === 'boolean' ? s.buttonDefinition : DEFAULT_SPACE.buttonDefinition,
    density: DENSITIES.includes(s.density as DensityId) ? (s.density as DensityId) : DEFAULT_SPACE.density,
    accent: typeof s.accent === 'string' && s.accent ? s.accent : DEFAULT_SPACE.accent,
    accentMode: MODES.includes(s.accentMode as AccentMode)
      ? (s.accentMode as AccentMode)
      : DEFAULT_SPACE.accentMode,
    colorStyle: COLOR_STYLES.includes(s.colorStyle as ColorStyle)
      ? (s.colorStyle as ColorStyle)
      : DEFAULT_SPACE.colorStyle,
    colorAuto: typeof s.colorAuto === 'boolean' ? s.colorAuto : DEFAULT_SPACE.colorAuto,
    colorInherit: typeof s.colorInherit === 'boolean' ? s.colorInherit : DEFAULT_SPACE.colorInherit,
    // An EMPTY palette is a real answer ("I cleared it"), so it is kept as-is
    // rather than refilled from the default — refilling would make the clear
    // button appear not to work. Only a MISSING key falls back, which is what
    // carries the starter hues to a settings.json written before this feature.
    colorPalette: Array.isArray(s.colorPalette)
      ? normalizePalette(s.colorPalette)
      : [...DEFAULT_SPACE.colorPalette],
    freeArrange: typeof s.freeArrange === 'boolean' ? s.freeArrange : DEFAULT_SPACE.freeArrange,
    compactNav: typeof s.compactNav === 'boolean' ? s.compactNav : DEFAULT_SPACE.compactNav,
    showLinks: chrome(s.showLinks, legacy.showLinks, DEFAULT_SPACE.showLinks),
    pinLinks: chrome(s.pinLinks, legacy.pinLinks, DEFAULT_SPACE.pinLinks),
    showPath: chrome(s.showPath, legacy.showPath, DEFAULT_SPACE.showPath),
    showNoteInfo:
      typeof s.showNoteInfo === 'boolean' ? s.showNoteInfo : DEFAULT_SPACE.showNoteInfo,
    markdownPro: typeof s.markdownPro === 'boolean' ? s.markdownPro : DEFAULT_SPACE.markdownPro,
    toolbarSlots: normalizeSlots(s.toolbarSlots),
    pageLook: shortString(s.pageLook),
    font: shortString(s.font),
    tint: shortString(s.tint)
  }
}

/** Drop spaces that name the same folder twice; the first wins. Unbound spaces
 *  ('') are kept — `reconcileSpaces` binds them to real folders. */
function dedupeFolders(spaces: Space[]): Space[] {
  const seen = new Set<string>()
  return spaces.filter((sp) => {
    if (!sp.folder) return true
    if (seen.has(sp.folder)) return false
    seen.add(sp.folder)
    return true
  })
}

/**
 * Coerce arbitrary parsed JSON into a valid AppSettings. Never throws.
 *
 * Guarantees, all of them relied on elsewhere:
 *  1. `1 <= spaces.length <= SPACE_CAP`. Never empty — see AppSettings.
 *  2. No two spaces name the same folder.
 *  3. Every space is fully populated; `toolbarSlots.length === TOOLBAR_SLOTS`.
 *  4. Idempotent: normalizeSettings(normalizeSettings(x)) deep-equals normalizeSettings(x).
 *  5. Never shares a mutable reference with DEFAULT_SETTINGS.
 *
 * It does NOT check folders against the disk — that's `reconcileSpaces`, which
 * needs the tree and so runs in the renderer once the vault is loaded.
 */
export function normalizeSettings(raw: unknown): AppSettings {
  const s = isPlainObject(raw) ? raw : {}
  const list = Array.isArray(s.spaces) ? s.spaces.filter(isPlainObject) : []
  // MIGRATION. A flat pre-Spaces file is itself a valid raw space, because the
  // per-space keys have the same names at the top level — so the old shape and
  // the new one go through one code path and cannot drift apart. It lands
  // unbound (folder ''), and reconcileSpaces then binds it to the vault's first
  // top-level folder, which is what carries an existing user's theme and
  // density forward instead of resetting them.
  const src: unknown[] = list.length ? list.slice(0, SPACE_CAP) : [s]
  // MIGRATION. `showPath` / `pinLinks` were app-wide before 2026-08-02 and now
  // belong to a space. Handed to every space as a fall-back, so a file written
  // by the older build carries the user's choice into each of them instead of
  // resetting to the default. Idempotent: once a space has its own value that
  // value wins, and the top-level keys are not written back out.
  const legacy: LegacyChrome = { showLinks: s.showLinks, pinLinks: s.pinLinks, showPath: s.showPath }
  const spaces = dedupeFolders(src.map((raw) => normalizeSpace(raw, legacy)))
  const wanted = normalizeFolder(s.activeSpaceFolder)
  return {
    spaces,
    activeSpaceFolder: spaces.some((x) => x.folder === wanted) ? wanted : (spaces[0]?.folder ?? ''),
    startup: STARTUPS.includes(s.startup as StartupId) ? (s.startup as StartupId) : DEFAULT_SETTINGS.startup,
    // MIGRATION, same rule as the spaces one above: a pre-tabs file's single
    // `lastNotePath` IS a one-tab session, so it goes through the same
    // normaliser rather than a separate pass. Idempotent — once `session` is
    // written, `lastNotePath` is never read again.
    session: normalizeSession(s.session ?? lastNoteAsSession(s.lastNotePath)),
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

/** A pre-tabs settings.json remembered one note. That is a session with one tab. */
function lastNoteAsSession(raw: unknown): SessionLayout | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  return { tabs: [raw], panes: [raw], focus: 0 }
}

/** Shape only: strings in, junk out. Whether those notes still exist, and
 *  whether the panes are a sane arrangement, is `restoreLayout`'s job — it can
 *  see the file tree and this can't. */
function normalizeSession(raw: unknown): SessionLayout {
  if (!isPlainObject(raw)) return EMPTY_SESSION
  const paths = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((p): p is string => typeof p === 'string' && !!p)
  const focus = typeof raw.focus === 'number' && Number.isInteger(raw.focus) ? raw.focus : 0
  return { tabs: paths(raw.tabs), panes: paths(raw.panes), focus: Math.max(0, focus) }
}

/** Always exactly TOOLBAR_SLOTS strings — a short, long, or junk-filled array
 *  from a hand-edited settings.json must not change how many buttons render. */
function normalizeSlots(raw: unknown): string[] {
  const a = Array.isArray(raw) ? raw : []
  return Array.from({ length: TOOLBAR_SLOTS }, (_, i) => (typeof a[i] === 'string' ? (a[i] as string) : ''))
}

/** The space in effect. Never returns undefined — with no spaces (a vault whose
 *  top level is empty, or state seeded from DEFAULT_SETTINGS before the first
 *  IPC round-trip) this is the whole-vault space, so the app still paints and
 *  the sidebar still shows the vault. */
export function activeSpace(s: AppSettings): Space {
  return s.spaces.find((x) => x.folder === s.activeSpaceFolder) ?? s.spaces[0] ?? DEFAULT_SPACE
}

/**
 * Bring the saved spaces in line with the folders actually on disk. The folders
 * are the source of truth (rule 1): a folder made in Explorer becomes a space,
 * and a folder deleted outside the app stops being one.
 *
 * Three passes, in this order, and the order is the point:
 *  1. Spaces whose folder still exists keep their settings and their position.
 *  2. Spaces that are UNBOUND (folder '') are bound to the remaining folders in
 *     order. This is what carries settings across a rename done outside the app,
 *     and what lets a migrated pre-Spaces settings file keep its theme/density
 *     instead of resetting to defaults.
 *  3. Any folder still unclaimed becomes a new space with default looks.
 *
 * Returns null when nothing changed, so the caller can skip a pointless write.
 */
export function reconcileSpaces(s: AppSettings, folders: readonly string[]): Partial<AppSettings> | null {
  const present = new Set(folders)
  const claimed = new Set<string>()

  const bound = s.spaces.filter((sp) => sp.folder && present.has(sp.folder))
  bound.forEach((sp) => claimed.add(sp.folder))

  const free = folders.filter((f) => !claimed.has(f))
  const unbound = s.spaces.filter((sp) => !sp.folder || !present.has(sp.folder))

  const next: Space[] = [...bound]
  for (const sp of unbound) {
    const folder = free.shift()
    if (!folder) break // its folder is gone and there's nothing to adopt — drop it
    next.push({ ...sp, folder })
  }
  for (const folder of free) {
    if (next.length >= SPACE_CAP) break
    next.push(freshSpace(folder))
  }
  // Nothing to bind to — a vault whose top level holds only notes, or whose last
  // space folder was just deleted. Keep ONE space as the whole-vault space
  // rather than dropping it: dropping would silently reset the user's theme and
  // density to the defaults, which is a real regression, not a tidy-up.
  // The reference is reused when it is already unbound, or the `same` check
  // below never matches and every single tree load writes settings.json.
  if (next.length === 0 && s.spaces.length > 0) {
    const first = s.spaces[0]
    next.push(first.folder === '' ? first : { ...first, folder: '' })
  }
  const spaces = next.slice(0, SPACE_CAP)

  const activeSpaceFolder = spaces.some((x) => x.folder === s.activeSpaceFolder)
    ? s.activeSpaceFolder
    : (spaces[0]?.folder ?? '')

  const same =
    activeSpaceFolder === s.activeSpaceFolder &&
    spaces.length === s.spaces.length &&
    spaces.every((sp, i) => sp === s.spaces[i])
  return same ? null : { spaces, activeSpaceFolder }
}

// --- edits, as pure functions ---------------------------------------------
// Each returns a Partial<AppSettings> to hand straight to setSettings. They live
// here rather than in the component so the cap / rename / delete rules are
// unit-testable without React — those are the rules with the real edge cases.
// All of them copy; none mutate their input.

/** Patch one space. An unknown folder is a no-op — never appends a phantom
 *  space. `folder` is re-pinned last: it's the identity, and only
 *  `withSpaceRenamed` may change it (it has to move the folder on disk too). */
export function withSpacePatch(s: AppSettings, folder: string, patch: Partial<Space>): Partial<AppSettings> {
  return {
    spaces: s.spaces.map((sp) => (sp.folder === folder ? { ...sp, ...patch, folder: sp.folder } : sp))
  }
}

/** Re-key a space after its folder has been renamed ON DISK. Call this with the
 *  path main actually used — it sanitises names and de-duplicates, so the name
 *  you asked for is not always the name you got. */
export function withSpaceRenamed(s: AppSettings, from: string, to: string): Partial<AppSettings> {
  if (from === to || !s.spaces.some((x) => x.folder === from)) return {}
  return {
    spaces: s.spaces.map((sp) => (sp.folder === from ? { ...sp, folder: to } : sp)),
    activeSpaceFolder: s.activeSpaceFolder === from ? to : s.activeSpaceFolder
  }
}

/** Register a space for a folder main has just created, and switch to it — you
 *  made it, you want to be in it. */
export function withNewSpace(s: AppSettings, folder: string): Partial<AppSettings> {
  if (!folder || s.spaces.some((x) => x.folder === folder)) return {}
  // A lone unbound space stands for "no folders yet" (see AppSettings) — once a
  // real folder exists it must be REBOUND, not appended beside. Appending left a
  // ghost entry in the switcher whose folder is '': indistinguishable from a
  // real space, and clicking it silently sent every new note/folder to the
  // vault root instead of into any space.
  if (s.spaces.length === 1 && s.spaces[0].folder === '') {
    return { spaces: [{ ...s.spaces[0], folder }], activeSpaceFolder: folder }
  }
  if (s.spaces.length >= SPACE_CAP) return {}
  const space: Space = freshSpace(folder)
  return { spaces: [...s.spaces, space], activeSpaceFolder: folder }
}

/** Forget a space, after its folder has gone to the bin. Selects the LEFT
 *  neighbour: the switcher is positional, so selection should land next to
 *  where the finger was.
 *
 *  Both keys come back together deliberately. Two separate writes would leave a
 *  frame where activeSpaceFolder names a deleted space; normalizeSettings would
 *  repair it — but to spaces[0], not the neighbour, so the UI would jump. */
export function withoutSpace(s: AppSettings, folder: string): Partial<AppSettings> {
  const idx = s.spaces.findIndex((x) => x.folder === folder)
  if (idx === -1 || !folder) return {}
  const rest = s.spaces.filter((x) => x.folder !== folder)
  // Removing the last one leaves the vault with no folders, so the space it had
  // becomes the whole-vault space rather than vanishing — `spaces` is never
  // empty (see AppSettings), and this keeps the look you were using.
  const spaces = rest.length ? rest : [{ ...s.spaces[idx], folder: '' }]
  return {
    spaces,
    activeSpaceFolder:
      s.activeSpaceFolder === folder ? (spaces[Math.max(0, idx - 1)]?.folder ?? '') : s.activeSpaceFolder
  }
}

// --- the pre-paint cache ---------------------------------------------------

/** The userData mirror read synchronously before the renderer exists. Flat, and
 *  deliberately NOT an AppSettings: its shape is a contract with
 *  `preload/index.ts` and `renderer/index.html`. Keeping it flat is why neither
 *  of those files changed when Spaces landed, and why an existing
 *  theme-cache.json keeps working with no migration. */
export interface ThemeCache {
  theme: ThemeId
  density: DensityId
  /** Cached alongside the theme because these are *paint* values like the other
   *  two: without them, Extra dark + white text launches grey and brightens a
   *  frame later. The rule for this file is simply "every data-* attribute
   *  index.html sets on <html>". A cache written by an older build lacks the
   *  keys and falls back to the defaults — no migration. */
  textTone: TextToneId
  buttonDefinition: boolean
}

export function normalizeThemeCache(raw: unknown): ThemeCache {
  const c = isPlainObject(raw) ? raw : {}
  return {
    theme: THEMES.includes(c.theme as ThemeId) ? (c.theme as ThemeId) : DEFAULT_SPACE.theme,
    density: DENSITIES.includes(c.density as DensityId) ? (c.density as DensityId) : DEFAULT_SPACE.density,
    textTone: TEXT_TONES.includes(c.textTone as TextToneId)
      ? (c.textTone as TextToneId)
      : DEFAULT_SPACE.textTone,
    buttonDefinition:
      typeof c.buttonDefinition === 'boolean' ? c.buttonDefinition : DEFAULT_SPACE.buttonDefinition
  }
}

/** What to show when no vault is open (the folder picker). Only the cached
 *  theme/density are known then, so they're folded into a default space.
 *  Explicit rather than `{...DEFAULT_SETTINGS, ...cache}` — that spread would
 *  add stale top-level theme/density keys and **compile silently**, because
 *  TypeScript's excess-property check fires on object literals, not on the
 *  spread of a typed variable. */
export function settingsFromThemeCache(c: ThemeCache): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    spaces: [
      {
        ...freshSpace(DEFAULT_SPACE.folder),
        theme: c.theme,
        density: c.density,
        textTone: c.textTone,
        buttonDefinition: c.buttonDefinition
      }
    ]
  }
}
