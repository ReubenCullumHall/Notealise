import { promises as fs } from 'fs'
import path from 'path'
import mammoth from 'mammoth'
import { createNote, setNoteTimes, writeAsset, writeNote } from '../../vault'
import type { ImportPreview, ImportProgress, ImportResult } from '../../../shared/notesImport'
import { importCancelled, type ImportRunner } from '../types'
import { buildImportReport } from '../report'
import { createImportSpace } from '../space'
import { duplicateWarning } from '../duplicates'
import { createConverter } from '../html/turndown'

async function preview(paths: string[]): Promise<ImportPreview> {
  const titles = paths.map((p) => path.basename(p).replace(/\.docx$/i, ''))
  return {
    noteCount: paths.length,
    folderCount: 0,
    notes: [],
    warnings: await duplicateWarning(titles)
  }
}

// Word stores an image by content type, never by name, so the extension has to
// come from the MIME type. EMF and WMF are Word's own vector formats and are
// deliberately included: they're copied so nothing is lost, but flagged as
// lossy because nothing outside Windows renders them.
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/x-emf': 'emf',
  'image/x-wmf': 'wmf'
}

const UNRENDERABLE = new Set(['emf', 'wmf', 'tif'])

async function run(
  paths: string[],
  spaceName: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  const spaceFolder = await createImportSpace(spaceName)
  const turndown = createConverter()

  let createdNotes = 0
  const skipped: { title: string; reason: string }[] = []
  const lossy: { path: string; note: string }[] = []

  let cancelled = false
  for (let i = 0; i < paths.length; i++) {
    if (importCancelled()) { cancelled = true; break }
    const filePath = paths[i]
    // .docx carries no reliable document title — the filename is what the user
    // named it, and is what they'll look for in the sidebar.
    const title = path.basename(filePath).replace(/\.docx$/i, '')
    onProgress({ phase: 'writing', current: i + 1, total: paths.length, label: title })

    // The note is created first so images can be written beside it under the
    // name it actually landed at (createNote sanitises and de-duplicates).
    const relPath = await createNote(spaceFolder, title)
    const noteDir = path.posix.dirname(relPath)
    const noteStem = path.basename(relPath, '.md')
    let imageCount = 0

    let html: string
    try {
      // Images are written to disk AS they're converted and replaced by a plain
      // relative link. mammoth's default is a data: URI, which would inline
      // every picture as base64 into the note — a few photos turn a 2 KB note
      // into megabytes of unreadable text.
      const result = await mammoth.convertToHtml(
        { path: filePath },
        {
          // mammoth's defaults DROP underline and highlight outright (verified
          // against a real .docx, 2026-08-05 — they came through as plain
          // text). Underline is dropped by default because it's easily
          // confused with a link, but this app has a real underline of its own
          // (`<u>`), so mapping it is strictly better than losing it.
          //
          // Highlights carry a class from `editor/palette.ts` rather than a
          // bare `<mark>`: the editor's colour pass only recognises the named
          // classes, so an unclassed mark would sit in the note as visible tag
          // text. Word's palette is mapped onto the nearest app colour; the
          // unlisted Word colours (dark variants, and a few it rarely emits)
          // fall through to the catch-all so nothing is lost, just flattened.
          styleMap: [
            'u => u',
            'strike => del',
            "highlight[color='yellow'] => mark.hl-amber",
            "highlight[color='red'] => mark.hl-coral",
            "highlight[color='magenta'] => mark.hl-rose",
            "highlight[color='blue'] => mark.hl-sky",
            "highlight[color='cyan'] => mark.hl-teal",
            "highlight[color='green'] => mark.hl-sage",
            "highlight[color='darkGray'] => mark.hl-slate",
            "highlight[color='lightGray'] => mark.hl-slate",
            'highlight => mark.hl-amber'
          ],
          convertImage: mammoth.images.imgElement(async (image) => {
            const ext = EXT_BY_TYPE[image.contentType] ?? 'bin'
            const name = `${noteStem}-image-${++imageCount}.${ext}`
            const buffer = await image.readAsBuffer()
            await writeAsset(path.posix.join(noteDir, name), buffer)
            if (UNRENDERABLE.has(ext)) {
              lossy.push({
                path: relPath,
                note: `Image "${name}" is a ${ext.toUpperCase()} — copied across, but most editors can't display it`
              })
            }
            return { src: encodeURI(name) }
          })
        }
      )
      html = result.value
      for (const m of result.messages) {
        if (m.type === 'error') lossy.push({ path: relPath, note: m.message })
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Could not read the document'
      skipped.push({ title, reason })
      // The note file already exists — it is created before the conversion so
      // images can be written beside it under the name it actually landed at.
      // Bailing out here used to `continue` and leave that file EMPTY: a note
      // with no content and no explanation, which reads as the import having
      // silently mangled the document. Say what happened instead, in the file
      // itself, so it's answerable without digging out the Import Report.
      await writeNote(
        relPath,
        `# ${title}\n\nThis Word document could not be read, so nothing was imported from it.\n\n> ${reason}\n\nThe original file is untouched at:\n\n\`${filePath}\`\n`
      )
      continue
    }

    createdNotes++
    await writeNote(relPath, turndown.turndown(html))
    // The document's own last-modified time, so imported files keep their place
    // in date order instead of all landing at "now".
    const st = await fs.stat(filePath).catch(() => null)
    if (st) await setNoteTimes(relPath, st.mtimeMs)
  }

  const partialResult = { spaceFolder, createdNotes, createdFolders: 0, skipped, lossy, cancelled }
  const reportRelPath = await createNote(spaceFolder, 'Import Report')
  await writeNote(reportRelPath, buildImportReport(partialResult))

  return { ...partialResult, reportPath: reportRelPath }
}

export const wordImporter: ImportRunner = { preview, run }
