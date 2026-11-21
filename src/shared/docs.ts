// Documents in a folder — PDFs, Word and Excel files, slides — shown in the
// sidebar beside the notes and, for the kinds the app can draw, opened in a tab
// of their own (docs/plans/file-tabs.md).
//
// Which files count as a DOCUMENT is shared/attachments.ts's `DOC_EXTS` — the
// same allow-list that decides what a note may link to and open in its own app.
// One list: a file the sidebar shows is a file a click may open.
//
// Which of those the app can SHOW is the shorter list below. Everything else on
// the long list is still listed, and a click opens it in its own app, as a link
// to it in a note always has.
//
// Pure data and string helpers, no fs and no DOM, so main, preload and the
// renderer can all import it.

import { isDocFilename } from './attachments'

/** How a tab draws a document. */
export type DocView = 'pdf' | 'word' | 'sheet' | 'csv' | 'text'

const VIEWS: Record<string, DocView> = {
  pdf: 'pdf',
  docx: 'word',
  xlsx: 'sheet',
  csv: 'csv',
  txt: 'text'
}

function extOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/** A document the sidebar lists (any DOC_EXTS file). */
export const isListedDoc = (name: string): boolean => isDocFilename(name)

/** The hidden `~$Essay.docx` Word and Excel keep beside a file while it is open:
 *  a lock marker, not a document, so it is never listed. */
export function isOfficeLockFile(name: string): boolean {
  return name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1).startsWith('~$')
}

/** How the app draws this file in a tab — null when it can't, and a click
 *  opens it in its own app instead. Notes (.md) are never documents. */
export function docViewOf(name: string): DocView | null {
  if (!isDocFilename(name)) return null
  return VIEWS[extOf(name)] ?? null
}

/** The second line of a document's row in the sidebar: what kind of file it is,
 *  in words. */
export function docLabel(name: string): string {
  const ext = extOf(name)
  if (ext === 'pdf') return 'PDF'
  if (['doc', 'docx', 'rtf', 'odt', 'pages'].includes(ext)) return 'Word document'
  if (['xls', 'xlsx', 'ods', 'numbers'].includes(ext)) return 'Spreadsheet'
  if (ext === 'csv') return 'Spreadsheet (CSV)'
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'Slides'
  if (ext === 'txt') return 'Text file'
  if (ext === 'epub') return 'E-book'
  return 'Document'
}

/** The extension, with its dot, as the file has it ("Handout.PDF" → ".PDF") —
 *  what a rename puts back when the new name is typed without one. */
export function docExt(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot)
}

// --- what main hands a tab to draw ------------------------------------------------

/** The most rows and columns a sheet tab draws. A spreadsheet can hold a million
 *  rows; a table that size would freeze the window, and this is a viewer — the
 *  button beside it opens the whole thing in its own app. */
export const SHEET_MAX_ROWS = 2000
export const SHEET_MAX_COLS = 100

/** The most of a text file a tab shows. */
export const TEXT_MAX_CHARS = 2_000_000

export interface SheetData {
  name: string
  /** rows of cells, already as the words to show; ragged rows are fine */
  rows: string[][]
  /** more rows or columns than were drawn */
  cut: boolean
}

/** A CSV's own way of writing itself, so an edit is saved back the same way. */
export interface CsvShape {
  sep: string
  /** the file ended with a line break */
  endsWithBreak: boolean
}

/** `editable`: the tab may change the file and save it back (text and CSV only —
 *  and only when the whole file was read, as UTF-8; a cut-short or differently
 *  encoded file saved back would lose what wasn't shown). */
export type DocContent =
  | { kind: 'word'; html: string }
  | { kind: 'sheet'; sheets: SheetData[]; csv?: CsvShape; editable: boolean }
  | { kind: 'text'; text: string; cut: boolean; editable: boolean }

/** A CSV cell as written: quoted only when it has to be. */
function csvCell(v: string, sep: string): string {
  return v.includes(sep) || /["\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Rows back to CSV text, in the file's own shape. Line breaks are written as
 *  \n; main puts the file's own back (writeTextDoc). */
export function csvText(rows: string[][], shape: CsvShape): string {
  const body = rows.map((r) => r.map((c) => csvCell(c, shape.sep)).join(shape.sep)).join('\n')
  return shape.endsWithBreak && rows.length ? body + '\n' : body
}

/** What the tab is handed: the document, or why there's nothing to show.
 *  'big' — over the size a tab will read; 'gone' — not there (moved, binned);
 *  'unreadable' — there, but not a file this can make sense of. */
export type DocResult = DocContent | { kind: 'error'; reason: 'big' | 'gone' | 'unreadable' }
