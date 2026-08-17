import { app, dialog, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { DOWNLOADABLE_FONTS, findFont, type CustomFont, type InstalledFont } from '../shared/fonts'

// Fonts downloaded from the catalogue's CDN, or imported from the user's own
// machine — see shared/fonts.ts for why these are the only two kinds that
// need a runtime record at all (a bundled font is already a real @font-face
// rule in theme.css, nothing to install).
//
// WHY userData AND NOT A VAULT. Same reasoning as main/presets.ts: a font you
// downloaded is a property of *this install*, not of one folder of notes —
// switching vaults shouldn't un-download it, and it has nothing to do with
// any particular vault's content in the first place.
//
//   userData/fonts/downloaded/<id>.woff2   one file per downloaded catalogue
//                                          entry, named by its catalogue id —
//                                          the file's presence on disk IS the
//                                          "is it installed" answer, no
//                                          separate record needed.
//   userData/fonts/custom/<uuid>.<ext>     one file per user-imported font,
//                                          plus...
//   userData/fonts/custom.json             ...its manifest: the id, the
//                                          display name derived from the
//                                          original filename, and that
//                                          filename itself. A custom font has
//                                          no catalogue entry to read a name
//                                          or family back out of, so unlike
//                                          `downloaded/` this needs a real
//                                          record, not just a file on disk.

const fontsRoot = (): string => path.join(app.getPath('userData'), 'fonts')
const downloadedDir = (): string => path.join(fontsRoot(), 'downloaded')
const customDir = (): string => path.join(fontsRoot(), 'custom')
const customManifestPath = (): string => path.join(fontsRoot(), 'custom.json')

const CUSTOM_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'] as const
type CustomExt = (typeof CUSTOM_EXTENSIONS)[number]

function extFallback(ext: string): 'sans-serif' {
  // A user's own font could be anything — there's no catalogue entry to say
  // whether it reads as serif/sans/mono, so the generic fallback is always
  // sans-serif. It only ever matters if the font itself fails to load.
  void ext
  return 'sans-serif'
}

async function readManifest(): Promise<CustomFont[]> {
  try {
    let raw = await fs.readFile(customManifestPath(), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CustomFont[]) : []
  } catch {
    return []
  }
}

// Serialise writes to the manifest, same discipline as main/presets.ts's
// `queue` — two overlapping imports must not let the later write clobber the
// earlier one's entry.
let writeTail: Promise<unknown> = Promise.resolve()
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeTail.then(fn)
  writeTail = run.catch(() => {})
  return run
}

async function writeManifest(list: CustomFont[]): Promise<void> {
  await fs.mkdir(fontsRoot(), { recursive: true })
  await fs.writeFile(customManifestPath(), JSON.stringify(list, null, 2), 'utf8')
}

/** The file for a manifest entry — the extension isn't stored, so this tries
 *  each one main/fonts.ts might have written. Cheap: at most 4 stats, and
 *  only ever called for a font whose manifest entry we already have. */
async function findCustomFile(id: string): Promise<string | null> {
  for (const ext of CUSTOM_EXTENSIONS) {
    const p = path.join(customDir(), `${id}.${ext}`)
    try {
      await fs.access(p)
      return p
    } catch {
      /* try the next extension */
    }
  }
  return null
}

/** Everything installed so far: downloaded catalogue entries whose file is
 *  still on disk, plus every custom import whose file is still on disk.
 *  Never throws — a font that failed to read is just missing from the list,
 *  the same way a removed one would be, rather than failing the whole app's
 *  startup over one bad file. */
export async function listInstalledFonts(): Promise<InstalledFont[]> {
  const out: InstalledFont[] = []

  for (const f of DOWNLOADABLE_FONTS) {
    const p = path.join(downloadedDir(), `${f.id}.woff2`)
    try {
      const buf = await fs.readFile(p)
      out.push({ id: f.id, source: 'downloaded', family: f.family, fallback: f.fallback, base64: buf.toString('base64') })
    } catch {
      /* not downloaded */
    }
  }

  const manifest = await readManifest()
  for (const c of manifest) {
    const p = await findCustomFile(c.id)
    if (!p) continue
    try {
      const buf = await fs.readFile(p)
      out.push({
        id: c.id,
        source: 'custom',
        family: c.displayName,
        fallback: extFallback(path.extname(p)),
        base64: buf.toString('base64')
      })
    } catch {
      /* file listed in the manifest but unreadable — skip it */
    }
  }

  return out
}

/** Fetch a catalogue font's woff2 and cache it. Rejects nothing this build
 *  doesn't already validate — an unknown or already-bundled id is a bug in
 *  the caller, not a user-facing failure, so it comes back as `ok: false`
 *  rather than throwing across the IPC boundary. */
export async function downloadFont(id: string): Promise<
  { ok: true; font: InstalledFont } | { ok: false; error: string }
> {
  const entry = findFont(id)
  if (!entry || entry.source !== 'downloadable' || !entry.cdnUrl) {
    return { ok: false, error: 'Not a downloadable font.' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const res = await fetch(entry.cdnUrl, { signal: controller.signal })
    if (!res.ok) return { ok: false, error: `Download failed (${res.status}).` }
    const buf = Buffer.from(await res.arrayBuffer())

    await fs.mkdir(downloadedDir(), { recursive: true })
    await fs.writeFile(path.join(downloadedDir(), `${id}.woff2`), buf)

    return {
      ok: true,
      font: { id, source: 'downloaded', family: entry.family, fallback: entry.fallback, base64: buf.toString('base64') }
    }
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError' ? 'Timed out.' : 'No connection.'
    return { ok: false, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

/** "Untitled-Font-2 (final) v3" -> "Untitled Font 2 (final) v3" — just enough
 *  cleanup that the common cases (dashes/underscores as word separators) read
 *  as a name, without trying to be clever about capitalisation a real font
 *  name (`IBM Plex Mono`) would depend on getting right. */
function nameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '')
  return stem.replace(/[-_]+/g, ' ').trim() || 'Untitled font'
}

/** Open a native picker for a font file and copy it in. Copies rather than
 *  referencing the original path: the source file could be on a USB drive, a
 *  Downloads folder someone empties, or another app's own storage — none of
 *  which this app controls the lifetime of (the same reasoning importers use
 *  for a picked image, see importers/assets.ts). */
export async function importCustomFont(
  win: BrowserWindow
): Promise<
  { ok: true; font: InstalledFont } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; error: string }
> {
  const res = await dialog.showOpenDialog(win, {
    title: 'Add a font',
    properties: ['openFile'],
    filters: [{ name: 'Fonts', extensions: [...CUSTOM_EXTENSIONS] }]
  })
  if (res.canceled || res.filePaths.length === 0) return { ok: false, cancelled: true }

  const src = res.filePaths[0]
  const ext = path.extname(src).slice(1).toLowerCase() as CustomExt
  if (!CUSTOM_EXTENSIONS.includes(ext)) {
    return { ok: false, error: 'Not a font file (.ttf, .otf, .woff, .woff2).' }
  }

  return queue(async () => {
    const id = randomUUID()
    await fs.mkdir(customDir(), { recursive: true })
    const buf = await fs.readFile(src)
    await fs.writeFile(path.join(customDir(), `${id}.${ext}`), buf)

    const entry: CustomFont = {
      id,
      displayName: nameFromFilename(path.basename(src)),
      originalName: path.basename(src),
      addedAt: Date.now()
    }
    const manifest = await readManifest()
    manifest.push(entry)
    await writeManifest(manifest)

    return {
      ok: true,
      font: { id, source: 'custom', family: entry.displayName, fallback: extFallback(ext), base64: buf.toString('base64') }
    }
  })
}

export function removeCustomFont(id: string): Promise<void> {
  return queue(async () => {
    const manifest = await readManifest()
    const next = manifest.filter((c) => c.id !== id)
    if (next.length === manifest.length) return
    const file = await findCustomFile(id)
    if (file) await fs.unlink(file).catch(() => {})
    await writeManifest(next)
  })
}
