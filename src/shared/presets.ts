// Space presets — the look of a space, kept as a file OUTSIDE the vault it came
// from, so changing source folder no longer wipes everything you set up.
//
// THE PROBLEM THIS SOLVES. `spaces` lives in <vault>/.mdnotes/settings.json, per
// vault, by rule 2. Point the app at another folder and it reads that folder's
// settings.json — which has no spaces yet — so `reconcileSpaces` adopts its
// top-level folders as brand-new spaces with default looks. Nothing is lost from
// the folder you left (switch back and it is all there), but nothing crosses
// over either.
//
// THE SHAPE OF THE ANSWER. One library, held **in the app** (userData), never in
// a vault — see the header of `main/presets.ts` for why, and for why the "master
// vault" this briefly used instead was reverted the same day. Every space
// mirrors itself into it automatically — created with the space, rewritten
// whenever you change anything about it — so there is no "save preset" button,
// no way to forget to press one, and nothing to move or be asked about when you
// change source folder: the library was never in the folder you left.
//
// A preset is a MIRROR, not a source of truth. settings.json remains the answer
// for the open vault, exactly as it was; the library is what survives leaving
// it. Same relationship `theme-cache.json` has with the theme.
//
// IDENTITY IS (name, origin), NOT name alone. Two vaults can each hold a
// "Revision" space, and their looks are different things; folding them together
// would mean opening one vault silently overwrote the other's preset. `origin`
// is the *folder name* of the vault, never its absolute path — the same vault on
// OneDrive is `D:\Notes` on Windows and `/Users/…/Notes` on the Mac, and a path
// would read as two different origins and duplicate the whole library.
//
// `id` is a random handle with no meaning; what is displayed is always `name`.

import { normalizeLook, type Space, type SpaceLook, spaceLook } from './settings'

/** One saved look. */
export interface SpacePreset {
  /** a stable random id, minted by main when the preset is first saved and kept
   *  through every rewrite. The renderer's key for applying and deleting. NOT
   *  part of the identity — see `samePreset`. */
  id: string
  /** what it is called: the space's folder name when it was last written */
  name: string
  /** the FOLDER NAME (never the path) of the vault this space lives in */
  origin: string
  /** epoch ms of the last automatic write */
  savedAt: number
  look: SpaceLook
}

/** A preset on its way to disk. Main decides the `id`, because only main can see
 *  the ids already in use. */
export type PresetDraft = Omit<SpacePreset, 'id'>

/** How many presets the library holds. Generous — it accumulates a row per space
 *  per vault you have ever opened, and the point of the feature is that old ones
 *  are still there years later — but not unbounded, since the whole file is read
 *  and rewritten on each sync. */
export const PRESET_CAP = 60

/** The last path segment, on either platform's separator. Deliberately not
 *  `path.basename` — this module is imported by the renderer, which has no
 *  node builtins. */
export function vaultName(p: string): string {
  return p.split(/[\\/]+/).filter(Boolean).pop() ?? p
}

/** Mirror a space into a preset. Unbound spaces (`folder: ''`, the whole-vault
 *  placeholder) have no name and cannot be one — callers filter them out. */
export function presetFromSpace(space: Space, origin: string, at = Date.now()): PresetDraft {
  return { name: space.folder, origin, savedAt: at, look: spaceLook(space) }
}

/** Two presets are the same preset when they describe the same space of the same
 *  vault. The id is deliberately not consulted: it is a random handle for the
 *  UI, and matching on it would make the next sync add a second row for a space
 *  that already has one instead of updating it. */
export function samePreset(a: { name: string; origin: string }, b: { name: string; origin: string }): boolean {
  return a.name === b.name && a.origin === b.origin
}

/** Coerce arbitrary parsed JSON into a preset, or null if it isn't one. A file
 *  without a usable name is dropped rather than shown as a blank row: `name` is
 *  what the user reads, what "new space from this" creates a folder from, and
 *  half of the identity above. */
export function normalizePreset(raw: unknown, fallbackId: string): SpacePreset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' ? r.name.trim() : ''
  // THE STORED ID WINS. `fallbackId` is only for an entry that hasn't got one —
  // a hand-edited file. Using it unconditionally (which this did until it was
  // caught by an integration run) mints a fresh id on EVERY read, so the id the
  // renderer is holding stops matching the moment main re-reads the file: delete
  // and export-one match nothing and silently do nothing, and React remounts
  // every row on each refresh. Nothing about it is visible in the UI until you
  // press one of those two buttons.
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : fallbackId
  if (!name || !id) return null
  return {
    id,
    name,
    origin: typeof r.origin === 'string' ? r.origin.trim() : '',
    savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
    // A preset written by a newer build carries keys this one doesn't know, and
    // one written by an older build is missing keys this one has. Both are
    // ordinary: normalizeLook drops the first and defaults the second, the same
    // loose validation settings.json gets, so a preset can never fail to load.
    look: normalizeLook(r.look)
  }
}

/** Newest first, then by name — what the library list shows. Sorted on read
 *  rather than kept sorted on disk, so the order can change (a preset just
 *  rewritten rises) without the file having to be rearranged. */
export function sortPresets(list: SpacePreset[]): SpacePreset[] {
  return [...list].sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name))
}

/** A stable string for "has this look changed?", used to skip a write when
 *  nothing did. Sorted ENTRIES rather than `JSON.stringify`'s replacer-array
 *  form, which is a key allowlist applied at every depth and would silently
 *  strip the contents of any nested object a `Space` grows later. Order-proof on
 *  purpose: a look read back off disk and the same look held in React state must
 *  produce the same string, or every render rewrites the library. */
export function lookKey(look: SpaceLook): string {
  return JSON.stringify(Object.entries(look).sort(([a], [b]) => a.localeCompare(b)))
}

// --- what moves when you pour a preset onto a space ------------------------
// Applying is not all-or-nothing: you tick which parts to copy, so "give this
// space that one's colours but leave my format buttons alone" is one action
// rather than a trip through four settings pages.

export const LOOK_PARTS = ['appearance', 'colour', 'arranging', 'chrome', 'shortcuts'] as const
export type LookPart = (typeof LOOK_PARTS)[number]

/** Which fields each tick box covers. **Every field of `SpaceLook` must appear
 *  exactly once here** — a field in no group could never be copied by any
 *  combination of ticks, which is a setting that silently ignores presets.
 *  `presets.test.ts` pins that, so adding a key to `Space` fails a test rather
 *  than quietly going missing. */
const PART_KEYS: Record<LookPart, readonly (keyof SpaceLook)[]> = {
  // The emoji rides with appearance: it is the space's marker, and a look
  // without it is half a look (the user's call — applying DOES overwrite it).
  appearance: ['emoji', 'theme', 'textTone', 'buttonDefinition', 'density', 'editorWidth', 'accent', 'accentMode', 'pageLook', 'font', 'uiFont', 'dyslexiaFont', 'tint'],
  colour: ['colorStyle', 'colorAuto', 'colorInherit', 'colorFadeNested', 'colorPalette'],
  arranging: ['freeArrange', 'compactNav'],
  chrome: ['showLinks', 'pinLinks', 'linksPosition', 'showPath', 'showNoteInfo', 'markdownPro'],
  shortcuts: ['toolbarSlots']
}

export const PART_LABELS: Record<LookPart, { label: string; hint: string }> = {
  appearance: { label: 'Appearance', hint: 'emoji, theme, accent, density, button edges' },
  colour: { label: 'Colour', hint: 'how entry colours paint, the palette, auto-colouring' },
  arranging: { label: 'Arranging', hint: 'sidebar order and the nav buttons' },
  chrome: { label: 'Note chrome', hint: 'links strip, path bar, last-edited time, Markdown pro' },
  shortcuts: { label: 'Format buttons', hint: 'the four custom slots' }
}

/** Everything, which is what the tick boxes start on. */
export const ALL_PARTS: readonly LookPart[] = LOOK_PARTS

/** The patch to hand `withSpacePatch`: the ticked parts of `look`, and nothing
 *  else. Arrays are copied — the same "never share a mutable reference" rule
 *  `spaceLook` follows, since a preset stays in the library after being applied
 *  and must not be editable through the space it was poured onto. */
export function pickLook(look: SpaceLook, parts: readonly LookPart[]): Partial<Space> {
  const out: Record<string, unknown> = {}
  for (const part of parts) {
    for (const key of PART_KEYS[part]) {
      const v = look[key]
      out[key] = Array.isArray(v) ? [...v] : v
    }
  }
  return out as Partial<Space>
}

/** Test seam: the grouping above, so a test can prove it covers `SpaceLook`
 *  exactly. Not for production use — call `pickLook`. */
export function partKeysForTest(): Record<LookPart, readonly (keyof SpaceLook)[]> {
  return PART_KEYS
}

// --- the shareable file ----------------------------------------------------
// A preset is a thing you hand to someone, not only a thing you keep. One file
// shape covers both jobs: it holds a LIST, so "export this one look" and "export
// my whole library to my other machine" produce the same kind of file and import
// never has to know which it was reading.

/** Its own extension so a preset is recognisable in a Downloads folder or as an
 *  email attachment, and so double-click-to-install can be added later without
 *  changing the format. The contents are ordinary readable JSON. */
export const PRESET_FILE_EXT = 'mdpreset'
export const PRESET_FILE_KIND = 'notes-space-preset'
export const PRESET_FILE_VERSION = 1

/** One look in a file. Deliberately NOT a `SpacePreset`: `id` is a handle into
 *  one machine's library and means nothing anywhere else, and `origin` is the
 *  name of a folder on the exporter's disk — see `toPresetFile`. */
export interface SharedPreset {
  name: string
  look: SpaceLook
}

export interface PresetFile {
  kind: string
  version: number
  presets: SharedPreset[]
}

/** Package presets for export. **`origin` is dropped**, by the user's call: a
 *  look you share would otherwise carry a folder name off your own machine to
 *  whoever you sent it to. What comes back in reads as "Imported" until it is
 *  poured onto a space. `id` and `savedAt` go for the same reason — they
 *  describe one library's bookkeeping, not the look. */
export function toPresetFile(presets: readonly SpacePreset[]): PresetFile {
  return {
    kind: PRESET_FILE_KIND,
    version: PRESET_FILE_VERSION,
    presets: presets.map((p) => ({ name: p.name, look: p.look }))
  }
}

/** Read a preset file. Accepts what this app writes, a bare array, and a single
 *  preset object — all three are things a person could plausibly hand you, and
 *  refusing two of them would be pedantry rather than safety. Returns [] for
 *  anything else; the caller reports "no presets in that file" rather than
 *  throwing at a user who opened the wrong thing.
 *
 *  `kind` is NOT required to match. It is a label for humans reading the file;
 *  enforcing it would reject a preset someone hand-wrote or a future export
 *  that renamed itself, with nothing gained — the look is validated field by
 *  field by `normalizeLook` regardless, which is the check that actually
 *  protects anything. */
export function fromPresetFile(raw: unknown): SharedPreset[] {
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.presets)
      ? raw.presets
      : isRecord(raw)
        ? [raw]
        : []
  const out: SharedPreset[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : ''
    if (!name) continue
    // A file may carry the look at the top level (a hand-written one) or nested
    // under `look` (what this app writes). Try the nested one first.
    out.push({ name, look: normalizeLook(isRecord(item.look) ? item.look : item) })
    if (out.length >= PRESET_CAP) break
  }
  return out
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** What an import did. Lives here rather than in `main/presets.ts` because the
 *  renderer is the other half of this contract, and `shared/` must never import
 *  from `main/` — that would drag Electron into the renderer bundle. */
export interface PresetImportResult {
  /** how many looks were added */
  added: number
  /** how many were IN the file. `found > 0 && added === 0` is the library being
   *  full, which is a different problem from a file with nothing in it and must
   *  not share its message. */
  found: number
  /** the user closed the file picker without choosing. Distinct from `added: 0`
   *  on purpose: "nothing in that file" and "you changed your mind" are
   *  different messages, and showing the first for the second reads as a bug. */
  cancelled?: boolean
  /** the library afterwards, so the renderer needs no second call */
  presets: SpacePreset[]
}

/** What an imported preset records as its origin. Empty, so it can never be
 *  mistaken for a space of any vault: the mirror matches on (name, origin) with
 *  origin always a real folder name, so an imported look is never overwritten by
 *  a space that happens to share its name. Imported looks are frozen, which is
 *  the behaviour you want from something someone sent you. */
export const IMPORTED_ORIGIN = ''
