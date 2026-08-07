import { promises as fs } from 'fs'
import path from 'path'
import { createFolder, createNote, setNoteTimes, writeAsset, writeNote } from '../../vault'
import type { ImportPreview, ImportProgress, ImportResult } from '../../../shared/notesImport'
import { importCancelled, type ImportRunner } from '../types'
import { buildImportReport } from '../report'
import { createImportSpace } from '../space'
import { duplicateWarning } from '../duplicates'
import { collectFiles } from '../files'

// Google Keep comes out of Google Takeout as one .json PER NOTE, with any
// images sitting beside them and referenced by `attachments[].filePath`.
// Takeout also writes an .html per note, but the JSON is what this reads: it
// carries the checklist state, the labels and the real timestamps as data,
// where the HTML has already flattened all of that into presentation.
//
// Field names confirmed against Google's export schema (2026-08-05). Every one
// is optional in practice — Takeout omits what a note doesn't have — so this
// treats the whole shape as untrusted and defaults each field.
interface KeepNote {
  title?: unknown
  textContent?: unknown
  listContent?: unknown
  isTrashed?: unknown
  isArchived?: unknown
  isPinned?: unknown
  labels?: unknown
  attachments?: unknown
  createdTimestampUsec?: unknown
  userEditedTimestampUsec?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Takeout stores times in MICROseconds. */
const usecToMs = (v: unknown): number => Math.floor(num(v) / 1000)

function firstLabel(note: KeepNote): string {
  if (!Array.isArray(note.labels)) return ''
  for (const l of note.labels) {
    const name = str((l as { name?: unknown } | null)?.name)
    if (name.trim()) return name.trim()
  }
  return ''
}

function toMarkdown(note: KeepNote, assetLinks: string[]): string {
  const parts: string[] = []
  const text = str(note.textContent).trim()
  if (text) parts.push(text)

  // A Keep checklist is data, not text — rendered as real markdown checkboxes
  // rather than the flat lines Takeout's HTML would give.
  if (Array.isArray(note.listContent)) {
    const items = note.listContent
      .map((raw) => {
        const item = raw as { text?: unknown; isChecked?: unknown } | null
        const t = str(item?.text).trim()
        return t ? `- [${item?.isChecked === true ? 'x' : ' '}] ${t}` : ''
      })
      .filter(Boolean)
    if (items.length) parts.push(items.join('\n'))
  }

  for (const link of assetLinks) parts.push(`![](${encodeURI(link)})`)
  return parts.join('\n\n') + '\n'
}

async function readNotes(paths: string[]): Promise<{ file: string; note: KeepNote }[]> {
  const found = await collectFiles(paths, ['.json'])
  const out: { file: string; note: KeepNote }[] = []
  for (const f of found) {
    try {
      const parsed = JSON.parse(await fs.readFile(f.abs, 'utf8')) as KeepNote
      // Takeout drops other .json files in the same tree (labels lists, account
      // metadata); a Keep note is one that actually has note-shaped fields.
      const looksLikeNote =
        'textContent' in parsed || 'listContent' in parsed || 'isTrashed' in parsed
      if (looksLikeNote) out.push({ file: f.abs, note: parsed })
    } catch {
      /* not JSON we understand — ignored rather than failing the whole import */
    }
  }
  return out
}

const titleFor = (note: KeepNote, file: string): string => {
  const t = str(note.title).trim()
  if (t) return t
  // Keep lets a note have no title; its first line is what you'd recognise it
  // by, and the Takeout filename is a timestamp nobody would.
  const firstLine = str(note.textContent).split('\n')[0]?.trim()
  return firstLine ? firstLine.slice(0, 60) : path.basename(file, '.json')
}

async function preview(paths: string[]): Promise<ImportPreview> {
  const all = await readNotes(paths)
  const live = all.filter(({ note }) => note.isTrashed !== true)
  const labels = new Set(live.map(({ note }) => firstLabel(note)).filter(Boolean))
  const notes: string[] = []
  if (all.length !== live.length) {
    notes.push(`${all.length - live.length} note(s) in Keep's Bin are skipped.`)
  }
  if (labels.size) {
    notes.push(
      `Keep has labels rather than folders, so each note goes into a folder named after its ` +
        `FIRST label (${labels.size} in total). A note with several labels lands under the first ` +
        `one and is listed in the Import Report.`
    )
  }
  return {
    noteCount: live.length,
    folderCount: labels.size,
    notes,
    warnings: await duplicateWarning(live.map(({ note, file }) => titleFor(note, file)))
  }
}

async function run(
  paths: string[],
  spaceName: string,
  onProgress: (p: ImportProgress) => void
): Promise<ImportResult> {
  onProgress({ phase: 'scanning', current: 0, total: 0, label: 'Reading Google Keep export…' })
  const all = await readNotes(paths)
  const live = all.filter(({ note }) => note.isTrashed !== true)

  const spaceFolder = await createImportSpace(spaceName)
  let createdNotes = 0
  let createdFolders = 0
  const skipped: { title: string; reason: string }[] = []
  const lossy: { path: string; note: string }[] = []
  let cancelled = false

  for (const { note } of all) {
    if (note.isTrashed === true) {
      skipped.push({ title: 'A note in Keep’s Bin', reason: 'It was already deleted in Keep' })
    }
  }

  const dirFor = new Map<string, string>()
  const labelDir = async (label: string): Promise<string> => {
    if (!label) return spaceFolder
    const hit = dirFor.get(label)
    if (hit) return hit
    const made = await createFolder(spaceFolder, label)
    createdFolders++
    dirFor.set(label, made)
    return made
  }

  for (let i = 0; i < live.length; i++) {
    if (importCancelled()) {
      cancelled = true
      break
    }
    const { note, file } = live[i]
    const title = titleFor(note, file)
    onProgress({ phase: 'writing', current: i + 1, total: live.length, label: title })

    const dir = await labelDir(firstLabel(note))
    const relPath = await createNote(dir, title)
    createdNotes++

    // Images live beside the .json and are named in `attachments[].filePath`.
    const assetLinks: string[] = []
    if (Array.isArray(note.attachments)) {
      for (const raw of note.attachments) {
        const fp = str((raw as { filePath?: unknown } | null)?.filePath)
        if (!fp) continue
        const from = path.resolve(path.dirname(file), fp)
        const name = path.basename(fp)
        try {
          await writeAsset(path.posix.join(path.posix.dirname(relPath), name), await fs.readFile(from))
          assetLinks.push(name)
        } catch {
          lossy.push({ path: relPath, note: `Picture "${name}" wasn’t in the export folder` })
        }
      }
    }

    const labelCount = Array.isArray(note.labels) ? note.labels.length : 0
    if (labelCount > 1) {
      lossy.push({
        path: relPath,
        note: `Had ${labelCount} labels in Keep — filed under the first one only`
      })
    }

    await writeNote(relPath, toMarkdown(note, assetLinks))
    // Keep's own edit time, so imported notes keep their order.
    const edited = usecToMs(note.userEditedTimestampUsec) || usecToMs(note.createdTimestampUsec)
    if (edited) await setNoteTimes(relPath, edited)
  }

  const partialResult = { spaceFolder, createdNotes, createdFolders, skipped, lossy, cancelled }
  const reportRelPath = await createNote(spaceFolder, 'Import Report')
  await writeNote(reportRelPath, buildImportReport(partialResult))
  return { ...partialResult, reportPath: reportRelPath }
}

export const googleKeepImporter: ImportRunner = { preview, run }
