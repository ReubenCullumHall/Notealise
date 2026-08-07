import { promises as fs } from 'fs'
import path from 'path'

// Confirmed against a real "Export > Markdown & CSV" export (2026-08-04):
// despite the name, each page is an .html file, not .md — Notion appends a
// 32-hex-char id to that file's name ("Page Title <32 hex>.html") but NOT to
// the folder holding its children, which keeps the bare title. A database
// exports as a folder containing one .csv (the row index) plus one .html per
// row directly inside it — this part is unconfirmed (the test workspace had
// no databases), so it's still a best-effort guess pending a real example.
const ID_SUFFIX = /\s+[0-9a-f]{32}$/i

export function stripId(name: string): string {
  return name.replace(ID_SUFFIX, '')
}

export interface ParsedPage {
  kind: 'page'
  /** absolute path to the source .html file */
  filePath: string
  /** id-stripped title, used as the note name */
  title: string
  children: ParsedNode[]
}

export interface ParsedDatabase {
  kind: 'database'
  /** absolute path to the database's source folder */
  dirPath: string
  title: string
  /** absolute path to the .csv row index, if one was found */
  csvPath: string | null
  rows: { filePath: string; title: string }[]
}

export interface ParsedFolder {
  kind: 'folder'
  dirPath: string
  title: string
  children: ParsedNode[]
}

export type ParsedNode = ParsedPage | ParsedDatabase | ParsedFolder

export async function parseNotionExport(rootDir: string): Promise<ParsedNode[]> {
  return parseDir(rootDir)
}

async function parseDir(dirPath: string): Promise<ParsedNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name)
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  const htmlNames = fileNames.filter((n) => n.toLowerCase().endsWith('.html'))

  const nodes: ParsedNode[] = []
  const consumedDirs = new Set<string>()

  // Pages: one per top-level .html file. A page with children gets a sibling
  // folder holding them — matched by the id-STRIPPED title, since (unlike the
  // file) the folder never carries the id suffix.
  for (const htmlName of htmlNames) {
    const stem = htmlName.slice(0, -5)
    const title = stripId(stem)
    const siblingDir = dirNames.find((d) => d === title)
    let children: ParsedNode[] = []
    if (siblingDir) {
      consumedDirs.add(siblingDir)
      children = await parseDir(path.join(dirPath, siblingDir))
    }
    nodes.push({
      kind: 'page',
      filePath: path.join(dirPath, htmlName),
      title,
      children
    })
  }

  // Remaining folders: a database (has a .csv directly inside) or a plain
  // organisational folder (recurse).
  for (const dirName of dirNames) {
    if (consumedDirs.has(dirName)) continue
    const subPath = path.join(dirPath, dirName)
    const subEntries = await fs.readdir(subPath, { withFileTypes: true })
    const subFiles = subEntries.filter((e) => e.isFile()).map((e) => e.name)
    const csvName = subFiles.find((n) => n.toLowerCase().endsWith('.csv'))

    if (csvName) {
      const rows = subFiles
        .filter((n) => n.toLowerCase().endsWith('.html'))
        .map((n) => ({ filePath: path.join(subPath, n), title: stripId(n.slice(0, -5)) }))
      nodes.push({
        kind: 'database',
        dirPath: subPath,
        title: stripId(dirName),
        csvPath: path.join(subPath, csvName),
        rows
      })
    } else {
      nodes.push({
        kind: 'folder',
        dirPath: subPath,
        title: stripId(dirName),
        children: await parseDir(subPath)
      })
    }
  }

  return nodes
}
