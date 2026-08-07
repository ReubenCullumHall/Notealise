import { promises as fs } from 'fs'
import path from 'path'
import { createFolder, createNote, setNoteTimes, writeAsset, writeNote } from '../../vault'
import type { ImportPreview, ImportProgress, ImportResult } from '../../../shared/notesImport'
import { importCancelled, type ImportRunner } from '../types'
import { buildImportReport } from '../report'
import { copyLocalAsset, isRemoteUrl } from '../assets'
import { createImportSpace } from '../space'
import { duplicateWarning } from '../duplicates'
import { createConverter } from '../html/turndown'
import { parseNotionExport, type ParsedNode } from './parse'

function countNodes(nodes: ParsedNode[]): { notes: number; folders: number; databases: number } {
  let notes = 0
  let folders = 0
  let databases = 0
  for (const n of nodes) {
    if (n.kind === 'page') {
      notes++
      const c = countNodes(n.children)
      notes += c.notes
      folders += c.folders
      databases += c.databases
    } else if (n.kind === 'database') {
      databases++
      folders++ // the database's own folder
      notes += n.rows.length + 1 // rows + the generated index note
    } else {
      folders++
      const c = countNodes(n.children)
      notes += c.notes
      folders += c.folders
      databases += c.databases
    }
  }
  return { notes, folders, databases }
}

async function preview(paths: string[]): Promise<ImportPreview> {
  const nodes = await parseNotionExport(paths[0])
  const { notes, folders, databases } = countNodes(nodes)
  const notesLines: string[] = []
  if (databases > 0) {
    notesLines.push(
      `${databases} Notion database${databases === 1 ? '' : 's'} found — each row becomes its ` +
        `own note in a subfolder, plus one index note summarising the rows. The original .csv ` +
        `is kept alongside, untouched.`
    )
  }
  const titles: string[] = []
  const collect = (list: ParsedNode[]): void => {
    for (const n of list) {
      titles.push(n.title)
      if (n.kind === 'page' || n.kind === 'folder') collect(n.children)
      else for (const r of n.rows) titles.push(r.title)
    }
  }
  collect(nodes)
  return {
    noteCount: notes,
    folderCount: folders,
    notes: notesLines,
    warnings: await duplicateWarning(titles)
  }
}

/** Not an `.html` link and not `http(s)://` — a local asset reference. */
function isLocalAssetTarget(target: string): boolean {
  return !isRemoteUrl(target) && !target.toLowerCase().endsWith('.html') && !target.startsWith('#')
}

function isLocalPageTarget(target: string): boolean {
  return !isRemoteUrl(target) && target.toLowerCase().endsWith('.html')
}

/** Rewrites `[text](target)` / `![alt](target)` links — already-converted
 *  markdown, one turndown pass after the source .html — into the matching
 *  vault-relative path for page links, or a copied-alongside asset for
 *  everything else. Unresolvable page links are left as-is and reported as
 *  lossy. */
async function rewriteContent(
  markdown: string,
  sourceFilePath: string,
  vaultRelPath: string,
  sourceToVaultPath: Map<string, string>,
  lossy: { path: string; note: string }[]
): Promise<string> {
  const sourceDir = path.dirname(sourceFilePath)
  const vaultDir = path.dirname(vaultRelPath)
  const linkPattern = /(!?\[[^\]]*\]\()([^)]+)(\))/g
  const matches = [...markdown.matchAll(linkPattern)]
  let out = markdown

  for (const m of matches) {
    const target = decodeURIComponent(m[2])
    if (isLocalPageTarget(target)) {
      const resolvedSource = path.resolve(sourceDir, target)
      const targetVaultPath = sourceToVaultPath.get(resolvedSource)
      if (targetVaultPath) {
        const rel = path.relative(vaultDir, targetVaultPath).split(path.sep).join('/')
        out = out.replace(m[0], `${m[1]}${encodeURI(rel)}${m[3]}`)
      } else {
        lossy.push({ path: vaultRelPath, note: `Link to "${target}" could not be resolved` })
      }
    } else if (isLocalAssetTarget(target)) {
      const newName = await copyLocalAsset(target, sourceDir, vaultDir)
      if (newName) {
        out = out.replace(m[0], `${m[1]}${encodeURI(newName)}${m[3]}`)
      } else {
        lossy.push({ path: vaultRelPath, note: `Attachment "${target}" could not be copied` })
      }
    }
  }

  return out
}

async function run(
  paths: string[],
  spaceName: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  onProgress({ phase: 'scanning', current: 0, total: 0, label: 'Reading Notion export…' })
  const nodes = await parseNotionExport(paths[0])
  const { notes: totalNotes } = countNodes(nodes)

  const spaceFolder = await createImportSpace(spaceName)

  const sourceToVaultPath = new Map<string, string>()
  let createdNotes = 0
  let createdFolders = 0
  const skipped: { title: string; reason: string }[] = []

  // Pass 1: mirror the folder/note structure, recording every source .md's
  // written path before any content is copied — so link rewriting in pass 2
  // never depends on write order.
  async function createStructure(nodeList: ParsedNode[], vaultDir: string): Promise<void> {
    for (const node of nodeList) {
      if (node.kind === 'page') {
        const relPath = await createNote(vaultDir, node.title)
        createdNotes++
        sourceToVaultPath.set(node.filePath, relPath)
        if (node.children.length > 0) {
          const childDir = await createFolder(vaultDir, node.title)
          createdFolders++
          await createStructure(node.children, childDir)
        }
      } else if (node.kind === 'database') {
        const dbDir = await createFolder(vaultDir, node.title)
        createdFolders++

        if (node.csvPath) {
          try {
            const csvData = await fs.readFile(node.csvPath)
            await writeAsset(path.posix.join(dbDir, path.basename(node.csvPath)), csvData)
          } catch {
            skipped.push({ title: node.title, reason: 'Could not copy the database .csv' })
          }
        }

        const rowsDir = await createFolder(dbDir, 'Rows')
        createdFolders++
        const rowRelPaths: string[] = []
        for (const row of node.rows) {
          const relPath = await createNote(rowsDir, row.title)
          createdNotes++
          sourceToVaultPath.set(row.filePath, relPath)
          rowRelPaths.push(relPath)
        }

        const indexRelPath = await createNote(dbDir, `${node.title} Index`)
        createdNotes++
        const indexLines = [
          `# ${node.title}`,
          '',
          `${node.rows.length} row${node.rows.length === 1 ? '' : 's'}. Full data: ` +
            `[${path.basename(node.csvPath ?? 'export.csv')}](${encodeURI(path.basename(node.csvPath ?? 'export.csv'))}).`,
          '',
          // The actual written path, not a guess from the source title — a
          // row's name gets " (2)" suffixed on collision same as anything else.
          ...rowRelPaths.map((p) => `- [[${path.basename(p, '.md')}]]`)
        ]
        await writeNote(indexRelPath, indexLines.join('\n'))
      } else {
        const dir = await createFolder(vaultDir, node.title)
        createdFolders++
        await createStructure(node.children, dir)
      }
    }
  }

  await createStructure(nodes, spaceFolder)

  // Pass 2: convert each page's .html to markdown, then rewrite links/assets
  // now that every page's final vault path is known.
  const turndown = createConverter({ dropHeaderChrome: true })
  const lossy: { path: string; note: string }[] = []
  let current = 0
  let cancelled = false
  for (const [sourceFilePath, vaultRelPath] of sourceToVaultPath) {
    if (importCancelled()) { cancelled = true; break }
    current++
    onProgress({ phase: 'writing', current, total: totalNotes, label: path.basename(vaultRelPath) })
    const html = await fs.readFile(sourceFilePath, 'utf8')
    const markdown = turndown.turndown(html)
    const rewritten = await rewriteContent(markdown, sourceFilePath, vaultRelPath, sourceToVaultPath, lossy)
    await writeNote(vaultRelPath, rewritten)
    const st = await fs.stat(sourceFilePath).catch(() => null)
    if (st) await setNoteTimes(vaultRelPath, st.mtimeMs)
  }

  const partialResult = { spaceFolder, createdNotes, createdFolders, skipped, lossy, cancelled }
  const reportRelPath = await createNote(spaceFolder, 'Import Report')
  await writeNote(reportRelPath, buildImportReport(partialResult))

  return { ...partialResult, reportPath: reportRelPath }
}

export const notionZipImporter: ImportRunner = { preview, run }
