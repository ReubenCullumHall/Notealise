import { promises as fs } from 'fs'
import path from 'path'
import { createFolder, createNote, setNoteTimes, writeNote } from '../../vault'
import type { ImportPreview, ImportProgress, ImportResult } from '../../../shared/notesImport'
import { importCancelled, type ImportRunner } from '../types'
import { buildImportReport } from '../report'
import { copyLocalAsset, isRemoteUrl } from '../assets'
import { createImportSpace } from '../space'
import { duplicateWarning } from '../duplicates'
import { collectFiles } from '../files'
import { createConverter } from './turndown'

async function preview(paths: string[]): Promise<ImportPreview> {
  const files = await collectFiles(paths, ['.html', '.htm'])
  const folders = new Set(files.filter((f) => f.rel.length).map((f) => f.rel.join('/')))
  return {
    noteCount: files.length,
    folderCount: folders.size,
    notes: folders.size
      ? ['Folders inside the one you picked are kept as folders.']
      : [],
    warnings: await duplicateWarning(
      files.map((f) => path.basename(f.abs).replace(/\.html?$/i, ''))
    )
  }
}

function titleFromHtml(html: string, fallback: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch && titleMatch[1].trim()) return titleMatch[1].trim()
  const h1Match = html.match(/<h1[^>]*>([^<]*)<\/h1>/i)
  if (h1Match && h1Match[1].trim()) return h1Match[1].trim()
  return fallback
}

/** Rewrites markdown image/link syntax pointing at local files, copying them
 *  alongside the note. Remote `http(s)://` targets are left untouched — no
 *  guarantee they're fetchable, and downloading is out of scope for v1. */
async function copyLocalImages(
  markdown: string,
  sourceDir: string,
  vaultDir: string,
  vaultRelPath: string,
  lossy: { path: string; note: string }[]
): Promise<string> {
  const linkPattern = /(!?\[[^\]]*\]\()([^)]+)(\))/g
  const matches = [...markdown.matchAll(linkPattern)]
  let out = markdown
  for (const m of matches) {
    const target = decodeURIComponent(m[2])
    if (isRemoteUrl(target) || target.startsWith('#')) continue
    const newName = await copyLocalAsset(target, sourceDir, vaultDir)
    if (newName) {
      out = out.replace(m[0], `${m[1]}${encodeURI(newName)}${m[3]}`)
    } else {
      lossy.push({ path: vaultRelPath, note: `Local reference "${target}" could not be copied` })
    }
  }
  return out
}

async function run(
  paths: string[],
  spaceName: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  const spaceFolder = await createImportSpace(spaceName)
  const turndown = createConverter()

  let createdNotes = 0
  let createdFolders = 0
  const skipped: { title: string; reason: string }[] = []
  const lossy: { path: string; note: string }[] = []

  // A folder is as valid a source as a file list: a Google Takeout or a saved
  // web archive is a folder of hundreds of pages, and multi-selecting those in
  // a dialog is not an import feature.
  const files = await collectFiles(paths, ['.html', '.htm'])
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

  let cancelled = false
  for (let i = 0; i < files.length; i++) {
    if (importCancelled()) { cancelled = true; break }
    const filePath = files[i].abs
    const fallbackTitle = path.basename(filePath).replace(/\.html?$/i, '')
    onProgress({ phase: 'writing', current: i + 1, total: files.length, label: fallbackTitle })

    let html: string
    try {
      html = await fs.readFile(filePath, 'utf8')
    } catch {
      skipped.push({ title: fallbackTitle, reason: 'Could not read the file' })
      continue
    }

    const title = titleFromHtml(html, fallbackTitle)
    const markdown = turndown.turndown(html)
    const relPath = await createNote(await vaultDir(files[i].rel), title)
    createdNotes++
    const rewritten = await copyLocalImages(
      markdown,
      path.dirname(filePath),
      path.dirname(relPath),
      relPath,
      lossy
    )
    await writeNote(relPath, rewritten)
    const st = await fs.stat(filePath).catch(() => null)
    if (st) await setNoteTimes(relPath, st.mtimeMs)
  }

  const partialResult = { spaceFolder, createdNotes, createdFolders, skipped, lossy, cancelled }
  const reportRelPath = await createNote(spaceFolder, 'Import Report')
  await writeNote(reportRelPath, buildImportReport(partialResult))

  return { ...partialResult, reportPath: reportRelPath }
}

export const htmlImporter: ImportRunner = { preview, run }
