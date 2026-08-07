import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { sanitizeFilename } from './filenames'
import {
  fromPresetFile,
  IMPORTED_ORIGIN,
  lookKey,
  normalizePreset,
  PRESET_CAP,
  PRESET_FILE_EXT,
  samePreset,
  sortPresets,
  toPresetFile,
  type PresetDraft,
  type PresetImportResult,
  type SpacePreset
} from '../shared/presets'

// The saved-look library: userData/presets.json. Read `shared/presets.ts` first
// — it explains what a preset is and why identity is (name, origin).
//
// WHY userData AND NOT A VAULT. Rule 2 puts app config in `<vault>/.mdnotes/`,
// with the exceptions in userData being the things that are properties of *this
// install* rather than of a folder of notes — the vault path, the update
// preference. The library is exactly that kind of thing, and for the sharpest
// possible reason: **its whole purpose is to outlive the vault.** A library
// stored in a vault is lost the moment you point the app at a different one,
// which is the bug it exists to fix.
//
// This replaced a "master vault" the user nominated, holding
// `<master>/.mdnotes/presets/*.json` (2026-08-06, same day, after one run in the
// live app). Don't reinstate it. It failed the moment it met a real folder
// switch: with no master pinned yet, the master defaulted to *whichever vault is
// open*, so switching folders quietly moved it too — the library always looked
// like it was already in the right place, the "bring these with you?" prompt
// never fired, and nothing followed the user anywhere. The default made the
// feature a no-op until an explicit action nothing ever prompted for. There is
// no such state here: there is one library, in one place, always.
//
// The trade, and it is a real one: the library no longer travels with a vault,
// so it does not sync between two machines through OneDrive the way the vault
// does. Accepted deliberately — "survives a folder switch" is the thing that was
// asked for, and a library that can be left behind does not survive anything.
//
// Rule 6 holds: this is the only code that touches this file.

const libraryPath = (): string => path.join(app.getPath('userData'), 'presets.json')

/** Stored as an object rather than a bare array so a later key (an export
 *  marker, a schema version) can be added without changing the file's type.
 *  A bare array is still accepted on read — cheaper than a migration. */
interface Library {
  presets: unknown[]
}

/** Every saved look, newest first. Never throws: the library is a convenience
 *  layer over settings.json, which is untouched by any of this, so a file that
 *  cannot be read is an empty library and never a failure to open a vault. */
export async function listPresets(): Promise<SpacePreset[]> {
  try {
    let raw = await fs.readFile(libraryPath(), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // tolerate a UTF-8 BOM
    const parsed: unknown = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : ((parsed as Library)?.presets ?? [])
    const out: SpacePreset[] = []
    for (const raw of Array.isArray(list) ? list : []) {
      // The fallback id only matters for a hand-edited file: everything this
      // module writes carries the id it was given when it was first saved.
      const p = normalizePreset(raw, randomUUID())
      if (p) out.push(p)
    }
    return sortPresets(out)
  } catch {
    return []
  }
}

// Serialise writes. Each one is read-modify-write, so two overlapping calls —
// the debounced mirror landing while the user deletes a row — would otherwise
// let the later write clobber the earlier one's change. Same discipline
// main/settings.ts and main/config.ts follow, and the chain absorbs rejections
// so one failed write can't wedge it.
let writeTail: Promise<unknown> = Promise.resolve()

function queue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeTail.then(fn)
  writeTail = run.catch(() => {})
  return run
}

async function write(list: SpacePreset[]): Promise<void> {
  const body: Library = { presets: list }
  await fs.mkdir(path.dirname(libraryPath()), { recursive: true })
  await fs.writeFile(libraryPath(), JSON.stringify(body, null, 2), 'utf8')
}

/**
 * Bring the library in line with the spaces of the open vault. Called
 * (debounced) whenever anything about a space changes — this is what makes a
 * preset something the user never has to save.
 *
 * Only WRITES; never deletes. A preset whose space no longer exists is the
 * feature working: you deleted the folder, or you are in another vault, and the
 * look is still there to pour onto something else. Removing one is an explicit
 * act (`deletePreset`).
 *
 * A draft whose stored copy is already identical is skipped, and if every draft
 * is skipped nothing is written at all. Without that, every settings write —
 * which includes each click between panes, via `session` — would rewrite the
 * whole library.
 */
export function syncPresets(drafts: PresetDraft[]): Promise<SpacePreset[]> {
  return queue(async () => {
    const list = await listPresets()
    let changed = false

    for (const draft of drafts) {
      if (!draft.name) continue // an unbound space has no name and cannot be one
      const at = list.findIndex((p) => samePreset(p, draft))
      if (at !== -1) {
        // `lookKey`, not a raw JSON.stringify: this compares a look rebuilt by
        // `normalizeLook` on read against one built by `spaceLook` in the
        // renderer, and a key-order difference between those two would make
        // every sync think every preset had changed.
        if (lookKey(list[at].look) === lookKey(draft.look)) continue
        list[at] = { ...draft, id: list[at].id } // keep the id: it is the UI's key
      } else {
        if (list.length >= PRESET_CAP) continue
        list.push({ ...draft, id: randomUUID() })
      }
      changed = true
    }

    if (changed) await write(list)
    return sortPresets(list)
  })
}

/** Rename a space's preset along with its folder, so the library keeps one row
 *  for it rather than growing a stale twin on every rename. */
export function renamePreset(from: string, to: string, origin: string): Promise<SpacePreset[]> {
  return queue(async () => {
    if (from === to) return listPresets()
    const list = await listPresets()
    const at = list.findIndex((p) => samePreset(p, { name: from, origin }))
    if (at === -1) return list
    list[at] = { ...list[at], name: to }
    await write(list)
    return sortPresets(list)
  })
}

export function deletePreset(id: string): Promise<SpacePreset[]> {
  return queue(async () => {
    const list = await listPresets()
    const next = list.filter((p) => p.id !== id)
    if (next.length !== list.length) await write(next)
    return next
  })
}

// --- sharing: export to a file, import from one ----------------------------
// A preset is meant to be handed to someone, so the file is the unit of
// sharing. One shape covers both jobs (`toPresetFile` holds a list), so
// "export this look" and "export my whole library to my other machine" write
// the same kind of file and import never has to know which it was given.

/** Write `ids` (or the whole library when null) to a file the user picks.
 *  Returns the path written, or null if they cancelled. */
export async function exportPresets(win: BrowserWindow, ids: string[] | null): Promise<string | null> {
  const all = await listPresets()
  const chosen = ids ? all.filter((p) => ids.includes(p.id)) : all
  if (chosen.length === 0) return null

  // One preset is named after itself; a library export says what it is. The
  // name is sanitised because it becomes a real filename on both platforms.
  const stem = chosen.length === 1 ? sanitizeFilename(chosen[0].name).name : 'Notes space presets'
  const res = await dialog.showSaveDialog(win, {
    title: chosen.length === 1 ? `Export "${chosen[0].name}"` : `Export ${chosen.length} presets`,
    defaultPath: `${stem}.${PRESET_FILE_EXT}`,
    filters: [{ name: 'Notes preset', extensions: [PRESET_FILE_EXT] }]
  })
  if (res.canceled || !res.filePath) return null
  await fs.writeFile(res.filePath, JSON.stringify(toPresetFile(chosen), null, 2), 'utf8')
  return res.filePath
}

/**
 * Add the presets in `text` — or in a file the user picks, when `text` is
 * omitted — to the library.
 *
 * Two entry points, one merge: the button opens a native picker here, and
 * drag-and-drop reads the file in the renderer (an ordinary `File.text()`) and
 * passes the contents. Reading it renderer-side is why there is no `File.path`
 * or `webUtils` anywhere — Electron removed the former, and the latter is a
 * whole extra bridge surface for something a drop event already hands over.
 *
 * Imports ALWAYS ADD; they never overwrite. A look someone sent you must not be
 * able to silently replace one of yours, and re-importing the same file twice
 * is a mistake with a visible, undoable result (two rows) rather than an
 * invisible one. Same-named arrivals are suffixed so the list stays readable.
 */
export function importPresets(win: BrowserWindow, text?: string): Promise<PresetImportResult> {
  return queue(async () => {
    let body = text
    if (body === undefined) {
      const res = await dialog.showOpenDialog(win, {
        title: 'Import space presets',
        properties: ['openFile'],
        filters: [
          { name: 'Notes preset', extensions: [PRESET_FILE_EXT] },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (res.canceled || res.filePaths.length === 0) {
        return { added: 0, found: 0, cancelled: true, presets: await listPresets() }
      }
      body = await fs.readFile(res.filePaths[0], 'utf8')
    }
    if (body.charCodeAt(0) === 0xfeff) body = body.slice(1) // tolerate a UTF-8 BOM

    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return { added: 0, found: 0, presets: await listPresets() }
    }

    const incoming = fromPresetFile(parsed)
    const list = await listPresets()
    const at = Date.now()
    let added = 0

    for (const p of incoming) {
      if (list.length >= PRESET_CAP) break
      list.push({
        id: randomUUID(),
        name: freeName(p.name, list),
        origin: IMPORTED_ORIGIN,
        savedAt: at,
        look: p.look
      })
      added++
    }
    if (added) await write(list)
    return { added, found: incoming.length, presets: sortPresets(list) }
  })
}

/** A name no other IMPORTED preset is using. Only imported ones are considered:
 *  a space of this vault called "Revision" and an imported look called
 *  "Revision" are different kinds of row, shown in different groups, and
 *  renaming the arrival to "Revision (2)" because a space shares its name would
 *  be renaming it for no reason the user can see. */
function freeName(name: string, list: readonly SpacePreset[]): string {
  const taken = new Set(
    list.filter((p) => p.origin === IMPORTED_ORIGIN).map((p) => p.name.toLowerCase())
  )
  if (!taken.has(name.toLowerCase())) return name
  for (let i = 2; i < 100; i++) {
    const candidate = `${name} (${i})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return name
}
