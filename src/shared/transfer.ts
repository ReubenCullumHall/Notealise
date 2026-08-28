// The "Transfer data" bundle — everything about the app that lives on ONE
// machine and does NOT travel inside the vault folder. See docs/transfer-data.md.
//
// WHAT IS AND ISN'T IN HERE, and why the list is so short:
//   - Themes, accents, colour tints, density, per-space font *choices*, toolbar
//     buttons, pins, archive, order, the bin — all of that is in
//     <vault>/.mdnotes/ (rule 2) and moves/syncs WITH the folder. Not our job.
//   - What's left, and genuinely device-only, is: the saved-preset library
//     (userData/presets.json — outlives any vault by design), custom fonts the
//     user imported (userData/fonts/custom/ — the file, not the choice), which
//     catalogue fonts were downloaded (userData/fonts/downloaded/ — a re-fetchable
//     cache), and the update channel (userData/config.json).
//
// The file is ordinary readable JSON. It carries a LIST of presets the same way
// a .mdpreset does, so `fromPresetFile` validates them field by field for free.
//
// shared/, so main writes it (main/transfer.ts) and the renderer's page
// (settings/TransferData.tsx) reads the result off the same contract — the two
// can never drift. Never import from main/ here (rule: no Electron in the
// renderer bundle).

import { fromPresetFile, type SharedPreset } from './presets'

/** Its own extension so a transfer file is recognisable in a Downloads folder,
 *  and so a future double-click-to-open can be added without changing the
 *  format. The bytes are plain JSON regardless. */
export const TRANSFER_FILE_EXT = 'notealisedata'
export const TRANSFER_FILE_KIND = 'notealise-transfer'
export const TRANSFER_FILE_VERSION = 1

/** The four font-file types main/fonts.ts accepts for a custom import. */
export const CUSTOM_FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'] as const
export type CustomFontExt = (typeof CUSTOM_FONT_EXTS)[number]

// Guard rails so a hand-edited or corrupt file can't make import allocate
// wildly. A custom font over ~8 MB is already unusual; 40 of them is far more
// than anyone imports by hand.
const MAX_FONTS = 40
const MAX_FONT_B64 = 12_000_000 // ~8.5 MB decoded
const MAX_DOWNLOADED_IDS = 60

/** One custom font, inlined. `data` is base64 of the raw font bytes — a handful
 *  of woff2 files at a few hundred KB each keeps the whole bundle well under a
 *  megabyte; the cap above stops a pathological file. */
export interface TransferFont {
  displayName: string
  originalName: string
  ext: CustomFontExt
  data: string
  addedAt: number
}

export interface TransferUpdatePrefs {
  autoUpdate: boolean
  betaChannel: boolean
}

export interface TransferBundle {
  kind: string
  version: number
  /** epoch ms the file was written — shown on the import screen */
  exportedAt: number
  /** the app version that wrote it — informational, never enforced */
  appVersion: string
  /** the saved-preset library, plus the current vault's own spaces folded in
   *  (so a fresh vault on the other device can be made to match) */
  presets: SharedPreset[]
  customFonts: TransferFont[]
  /** catalogue font ids to re-download on the destination (best effort) */
  downloadedFontIds: string[]
  /** null when the file carried no update setting at all — e.g. a bare
   *  `.mdpreset` read through this path. Import must not offer to "apply" a
   *  channel the file never had an opinion about. */
  updatePrefs: TransferUpdatePrefs | null
}

/** What an export wrote, for the "Saved N presets, N fonts" confirmation. */
export interface TransferExportSummary {
  presets: number
  customFonts: number
  downloadedFonts: number
}

/** The result of an import. `updatePrefs` is what the FILE carried, handed back
 *  so the page can offer an explicit "Apply" — import never changes this
 *  device's update channel on its own (a single toggle can't be "added as a
 *  copy" the way a preset can). */
export interface TransferImportResult {
  /** the picker was closed without choosing */
  cancelled?: boolean
  /** the file parsed but wasn't a transfer file (or a preset file) at all */
  invalid?: boolean
  presetsAdded: number
  presetsFound: number
  /** the 60-preset library filled up before every incoming look could be
   *  added — a different message from "nothing new to add" */
  presetsLibraryFull: boolean
  customFontsAdded: number
  customFontsFound: number
  downloadedFontsFetched: number
  downloadedFontsFailed: number
  updatePrefs: TransferUpdatePrefs | null
}

/** Counts for the "on this Mac right now" panel — read live, refreshed after an
 *  import so the numbers move. */
export interface TransferInventory {
  presets: number
  customFonts: number
  downloadedFonts: number
  autoUpdate: boolean
  betaChannel: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function coerceFonts(raw: unknown): TransferFont[] {
  if (!Array.isArray(raw)) return []
  const out: TransferFont[] = []
  for (const item of raw) {
    if (out.length >= MAX_FONTS) break
    if (!isRecord(item)) continue
    const ext = typeof item.ext === 'string' ? item.ext.toLowerCase() : ''
    if (!(CUSTOM_FONT_EXTS as readonly string[]).includes(ext)) continue
    const data = typeof item.data === 'string' ? item.data : ''
    if (!data || data.length > MAX_FONT_B64) continue
    const displayName =
      typeof item.displayName === 'string' && item.displayName.trim()
        ? item.displayName.trim().slice(0, 120)
        : 'Imported font'
    const originalName =
      typeof item.originalName === 'string' && item.originalName.trim()
        ? item.originalName.trim().slice(0, 200)
        : `${displayName}.${ext}`
    const addedAt = typeof item.addedAt === 'number' && item.addedAt > 0 ? item.addedAt : Date.now()
    out.push({ displayName, originalName, ext: ext as CustomFontExt, data, addedAt })
  }
  return out
}

function coerceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (t && t.length <= 80) seen.add(t)
    if (seen.size >= MAX_DOWNLOADED_IDS) break
  }
  return [...seen]
}

function coerceUpdatePrefs(raw: unknown): TransferUpdatePrefs {
  const r = isRecord(raw) ? raw : {}
  return { autoUpdate: r.autoUpdate === true, betaChannel: r.betaChannel === true }
}

/**
 * Coerce arbitrary parsed JSON into a bundle, or null if it plainly isn't one.
 *
 * Lenient like `fromPresetFile`: `kind` is a label for a human reading the
 * file, not a gate — a bundle that renamed itself, or a plain `.mdpreset`
 * dropped onto the page, should still import what it validly contains. Null is
 * reserved for "this is not that kind of file at all" — nothing that looks like
 * presets, fonts, ids or update prefs anywhere in it — so the page can say so
 * rather than reporting "imported 0" for someone who opened the wrong thing.
 */
export function normalizeBundle(raw: unknown): TransferBundle | null {
  if (!isRecord(raw)) return null

  // fromPresetFile accepts {presets:[...]}, a bare array, or a single preset
  // object — so a .mdpreset file passed straight in still yields its presets.
  const presets = fromPresetFile(Array.isArray(raw.presets) ? { presets: raw.presets } : raw)
  const customFonts = coerceFonts(raw.customFonts)
  const downloadedFontIds = coerceIds(raw.downloadedFontIds)
  const hasUpdatePrefs = isRecord(raw.updatePrefs)

  if (presets.length === 0 && customFonts.length === 0 && downloadedFontIds.length === 0 && !hasUpdatePrefs) {
    return null
  }

  return {
    kind: typeof raw.kind === 'string' ? raw.kind : TRANSFER_FILE_KIND,
    version: typeof raw.version === 'number' ? raw.version : TRANSFER_FILE_VERSION,
    exportedAt: typeof raw.exportedAt === 'number' && raw.exportedAt > 0 ? raw.exportedAt : Date.now(),
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion.slice(0, 40) : '',
    presets,
    customFonts,
    downloadedFontIds,
    updatePrefs: hasUpdatePrefs ? coerceUpdatePrefs(raw.updatePrefs) : null
  }
}
