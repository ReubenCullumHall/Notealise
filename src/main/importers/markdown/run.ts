import { promises as fs } from 'fs'
import path from 'path'
import { createFolder, createNote, setNoteTimes, writeAsset, writeNote } from '../../vault'
import type { ImportPreview, ImportProgress, ImportResult } from '../../../shared/notesImport'
import { importCancelled, type ImportRunner } from '../types'
import { buildImportReport } from '../report'
import { createImportSpace } from '../space'
import { duplicateWarning } from '../duplicates'
import { collectFiles, type FoundFile } from '../files'
import { encodeLinkPath } from '../assets'
import { AUDIO_EXTS, DOC_EXTS, IMAGE_EXTS, VIDEO_EXTS } from '../../../shared/attachments'

const NOTE_EXTS = ['.md', '.markdown', '.txt']
/** Copied so pictures, recordings, videos and documents in an Obsidian-style
 *  vault keep working — every kind the app itself takes into a note. Only
 *  pictures and PDFs used to come, so .heic/.m4a/.mp4/.docx were silently left
 *  behind (bug scan 2026-10-27). */
const ASSET_EXTS = [
  ...new Set(
    // .heic/.heif: iPhone photos. The app can't show them in a note, but they
    // are still the person's photos, so they come across as files.
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'pdf', 'heic', 'heif', ...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS, ...DOC_EXTS]
      .filter((e) => e !== 'txt')
      .map((e) => `.${e}`)
  )
]

const titleOf = (f: FoundFile): string => path.basename(f.abs).replace(/\.(md|markdown|txt)$/i, '')

async function preview(paths: string[]): Promise<ImportPreview> {
  const files = await collectFiles(paths, NOTE_EXTS)
  const folders = new Set(files.filter((f) => f.rel.length).map((f) => f.rel.join('/')))
  return {
    noteCount: files.length,
    folderCount: folders.size,
    notes: [
      'Markdown comes across as-is — nothing is converted or reformatted, because it is already ' +
        'the format this app stores. Folders are kept, and any images beside your notes come too.'
    ],
    warnings: await duplicateWarning(files.map(titleOf))
  }
}

async function run(
  paths: string[],
  spaceName: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  onProgress({ phase: 'scanning', current: 0, total: 0, label: 'Looking for Markdown files…' })
  const files = await collectFiles(paths, NOTE_EXTS)
  const assets = await collectFiles(paths, ASSET_EXTS)

  const spaceFolder = await createImportSpace(spaceName)
  let createdNotes = 0
  let createdFolders = 0
  const skipped: { title: string; reason: string }[] = []
  const lossy: { path: string; note: string }[] = []
  let cancelled = false

  // One vault folder per source folder, made once and reused.
  const dirFor = new Map<string, string>()
  const vaultDir = async (rel: string[]): Promise<string> => {
    if (rel.length === 0) return spaceFolder
    const key = rel.join('/')
    const hit = dirFor.get(key)
    if (hit) return hit
    const parent = await vaultDir(rel.slice(0, -1))
    const made = await createFolder(parent, rel[rel.length - 1])
    createdFolders++
    dirFor.set(key, made)
    return made
  }

  for (let i = 0; i < files.length; i++) {
    if (importCancelled()) {
      cancelled = true
      break
    }
    const f = files[i]
    const title = titleOf(f)
    onProgress({ phase: 'writing', current: i + 1, total: files.length, label: title })
    let text: string
    try {
      text = await fs.readFile(f.abs, 'utf8')
    } catch {
      skipped.push({ title, reason: 'Could not read the file' })
      continue
    }
    const dir = await vaultDir(f.rel)
    const relPath = await createNote(dir, title)
    createdNotes++
    // Written through verbatim: this is ALREADY markdown, so running it through
    // the HTML converter would only risk mangling it. The one exception is
    // Obsidian's file embed, `![[pic.png]]`, which isn't markdown at all.
    await writeNote(relPath, obsidianEmbeds(text, f.rel, assets))
    const st = await fs.stat(f.abs).catch(() => null)
    if (st) await setNoteTimes(relPath, st.mtimeMs)
  }

  // Images travel with the notes so relative links keep resolving.
  if (!cancelled) {
    for (const a of assets) {
      const dir = await vaultDir(a.rel)
      try {
        await writeAsset(path.posix.join(dir, path.basename(a.abs)), await fs.readFile(a.abs))
      } catch {
        lossy.push({ path: dir, note: `Could not copy "${path.basename(a.abs)}"` })
      }
    }
  }

  const partialResult = { spaceFolder, createdNotes, createdFolders, skipped, lossy, cancelled }
  const reportRelPath = await createNote(spaceFolder, 'Import Report')
  await writeNote(reportRelPath, buildImportReport(partialResult))
  return { ...partialResult, reportPath: reportRelPath }
}

/** Obsidian's `![[pic.png]]` / `![[pic.png|300]]` / `![[Folder/memo.m4a]]` →
 *  a plain markdown picture (or a link, for a document) pointing at where that
 *  file lands in the space. Left alone it read as a link to a missing NOTE, and
 *  a click made an empty `pic.png.md` (bug scan 2026-10-27). Obsidian finds the
 *  file by name anywhere in the vault, so this does too; a name it can't find,
 *  or one shared by two files, is left exactly as written. */
function obsidianEmbeds(text: string, noteRel: string[], assets: FoundFile[]): string {
  return text.replace(/!\[\[([^\]|#\n]+?)(?:[|#][^\]\n]*)?\]\]/g, (whole, target: string) => {
    const want = target.trim().replace(/\\/g, '/')
    const ext = path.extname(want).toLowerCase()
    if (!ext || ext === '.md') return whole
    const hits = assets.filter((a) => {
      const full = [...a.rel, path.basename(a.abs)].join('/')
      return full === want || full.endsWith('/' + want) || path.basename(a.abs) === want
    })
    if (hits.length !== 1) return whole
    const a = hits[0]
    const rel = path.posix.relative(noteRel.join('/'), [...a.rel, path.basename(a.abs)].join('/'))
    const kind = ext.slice(1)
    const src = encodeLinkPath(rel)
    // The same forms the app writes when you drop each kind in (attachInput.ts).
    if (VIDEO_EXTS.includes(kind)) return `<video controls src="${src}"></video>`
    if (IMAGE_EXTS.includes(kind) || AUDIO_EXTS.includes(kind)) return `![](${src})`
    return `[${path.basename(want)}](${src})`
  })
}

export const markdownImporter: ImportRunner = { preview, run }
