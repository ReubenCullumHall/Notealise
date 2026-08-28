import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { getUpdatePrefs } from './config'
import { getSettings } from './settings'
import { listPresets, mergeSharedPresets } from './presets'
import {
  countCustomFonts,
  downloadFont,
  installCustomFontData,
  listDownloadedFontIds,
  readCustomFontsForTransfer
} from './fonts'
import { lookKey, type SharedPreset } from '../shared/presets'
import { spaceLook } from '../shared/settings'
import {
  normalizeBundle,
  TRANSFER_FILE_EXT,
  TRANSFER_FILE_KIND,
  TRANSFER_FILE_VERSION,
  type TransferBundle,
  type TransferExportSummary,
  type TransferImportResult,
  type TransferInventory
} from '../shared/transfer'

// Settings -> Transfer data. The one place the app moves its OWN state (as
// opposed to the notes) between machines. See shared/transfer.ts for what goes
// in the bundle and why the list is so short: nearly everything visual already
// travels inside the vault folder, so this is only the handful of things that
// live in userData -- the preset library, custom fonts, the downloaded-font
// cache, and whether updates install automatically.
//
// Rule 6 still holds -- this reads/writes files, so it lives in main. The
// renderer's page (settings/TransferData.tsx) only ever calls the three IPC
// handlers this backs.

/** Dedup key for a (name, look) pair. `JSON.stringify` of a tuple, not a
 *  delimiter join: every character is legal in a folder name, which is the same
 *  reason App.tsx's preset mirror keys this way. */
function presetKey(name: string, look: SharedPreset['look']): string {
  return JSON.stringify([name, lookKey(look)])
}

async function buildBundle(): Promise<TransferBundle> {
  const [libraryPresets, settings, customFonts, downloadedFontIds, prefs] = await Promise.all([
    listPresets(),
    getSettings(),
    readCustomFontsForTransfer(),
    listDownloadedFontIds(),
    getUpdatePrefs()
  ])

  // Start from the library -- every space of every vault ever opened -- then
  // make sure the CURRENTLY open vault's own spaces are represented even if the
  // 800ms mirror in App.tsx hasn't landed yet. That is what "include this
  // vault's full look" means: a fresh vault on the other device can be poured
  // full from these. Dedup by (name, look) so a space already mirrored verbatim
  // is not listed twice.
  const presets: SharedPreset[] = libraryPresets.map((p) => ({ name: p.name, look: p.look }))
  const seen = new Set(presets.map((p) => presetKey(p.name, p.look)))
  for (const sp of settings.spaces) {
    if (!sp.folder) continue // the unbound whole-vault placeholder has no name
    const look = spaceLook(sp)
    const key = presetKey(sp.folder, look)
    if (seen.has(key)) continue
    seen.add(key)
    presets.push({ name: sp.folder, look })
  }

  return {
    kind: TRANSFER_FILE_KIND,
    version: TRANSFER_FILE_VERSION,
    exportedAt: Date.now(),
    appVersion: app.getVersion(),
    presets,
    customFonts,
    downloadedFontIds,
    updatePrefs: { autoUpdate: prefs.autoUpdate }
  }
}

/** Write the bundle to a file the user picks. Returns the path and a count of
 *  what went in, or null if the save dialog was cancelled. */
export async function exportTransfer(
  win: BrowserWindow
): Promise<{ path: string; summary: TransferExportSummary } | null> {
  const bundle = await buildBundle()
  const stamp = new Date().toISOString().slice(0, 10)
  const res = await dialog.showSaveDialog(win, {
    title: 'Save a Notealise transfer file',
    defaultPath: `Notealise data ${stamp}.${TRANSFER_FILE_EXT}`,
    filters: [{ name: 'Notealise data', extensions: [TRANSFER_FILE_EXT] }]
  })
  if (res.canceled || !res.filePath) return null
  await fs.writeFile(res.filePath, JSON.stringify(bundle, null, 2), 'utf8')
  return {
    path: res.filePath,
    summary: {
      presets: bundle.presets.length,
      customFonts: bundle.customFonts.length,
      downloadedFonts: bundle.downloadedFontIds.length
    }
  }
}

function blank(extra: Partial<TransferImportResult>): TransferImportResult {
  return {
    presetsAdded: 0,
    presetsFound: 0,
    presetsLibraryFull: false,
    customFontsAdded: 0,
    customFontsFound: 0,
    downloadedFontsFetched: 0,
    downloadedFontsFailed: 0,
    updatePrefs: null,
    ...extra
  }
}

/**
 * Read a bundle back in.
 *
 * Two entry points, one merge -- the same shape `importPresets` has: the button
 * opens a native picker here; a drag-and-drop reads the file in the renderer
 * and passes its text.
 *
 * Presets and custom fonts ADD, never overwrite. Downloaded catalogue fonts are
 * re-fetched best-effort -- a space's font *choice* travelled inside the vault,
 * this just restocks the file so it renders. The auto-update setting is NOT
 * applied: a single toggle cannot be "added as a copy", so it comes back in the
 * result for the page to offer an explicit Apply.
 */
export async function importTransfer(
  win: BrowserWindow,
  text?: string
): Promise<TransferImportResult> {
  let body = text
  if (body === undefined) {
    const res = await dialog.showOpenDialog(win, {
      title: 'Open a Notealise transfer file',
      properties: ['openFile'],
      filters: [
        { name: 'Notealise data', extensions: [TRANSFER_FILE_EXT, 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return blank({ cancelled: true })
    body = await fs.readFile(res.filePaths[0], 'utf8')
  }
  if (body.charCodeAt(0) === 0xfeff) body = body.slice(1) // tolerate a UTF-8 BOM

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return blank({ invalid: true })
  }
  const bundle = normalizeBundle(parsed)
  if (!bundle) return blank({ invalid: true })

  const presetRes = await mergeSharedPresets(bundle.presets)

  let customFontsAdded = 0
  for (const f of bundle.customFonts) {
    const r = await installCustomFontData(f)
    if (r.ok) customFontsAdded++
  }

  // Skip anything already cached -- re-downloading it would be wasted bytes and
  // could log a spurious failure on a flaky connection. Fetch the rest in
  // PARALLEL: `downloadFont` gives each a 20s timeout, and a serial loop over a
  // dozen ids with no connection would hang the whole import for minutes.
  const present = new Set(await listDownloadedFontIds())
  const wanted = bundle.downloadedFontIds.filter((id) => !present.has(id))
  const results = await Promise.all(wanted.map((id) => downloadFont(id)))
  const downloadedFontsFetched = results.filter((r) => r.ok).length
  const downloadedFontsFailed = results.length - downloadedFontsFetched

  return {
    presetsAdded: presetRes.added,
    presetsFound: presetRes.found,
    presetsLibraryFull: presetRes.full,
    customFontsAdded,
    customFontsFound: bundle.customFonts.length,
    downloadedFontsFetched,
    downloadedFontsFailed,
    updatePrefs: bundle.updatePrefs
  }
}

/** Live counts for the "on this machine now" panel. */
export async function transferInventory(): Promise<TransferInventory> {
  const [presets, customFonts, downloadedIds, prefs] = await Promise.all([
    listPresets(),
    countCustomFonts(),
    listDownloadedFontIds(),
    getUpdatePrefs()
  ])
  return {
    presets: presets.length,
    customFonts,
    downloadedFonts: downloadedIds.length,
    autoUpdate: prefs.autoUpdate
  }
}
