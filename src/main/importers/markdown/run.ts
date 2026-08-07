import { promises as fs } from 'fs'
import path from 'path'
import { createFolder, createNote, setNoteTimes, writeAsset, writeNote } from '../../vault'
import type { ImportPreview, ImportProgress, ImportResult } from '../../../shared/notesImport'
import { importCancelled, type ImportRunner } from '../types'
import { buildImportReport } from '../report'
import { createImportSpace } from '../space'
import { duplicateWarning } from '../duplicates'
import { collectFiles, type FoundFile } from '../files'

const NOTE_EXTS = ['.md', '.markdown', '.txt']
/** Copied so images in an Obsidian-style vault keep working. */
const ASSET_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.pdf']

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
    // the HTML converter would only risk mangling it.
    await writeNote(relPath, text)
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

export const markdownImporter: ImportRunner = { preview, run }
