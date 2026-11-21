// Reading a document for its tab (docs/plans/file-tabs.md): a Word file becomes
// a page of HTML, a spreadsheet becomes rows of words, a text file its text.
// PDFs are not read here — the window shows them from the media address with
// Chromium's own PDF reader (mediaProtocol.ts).
//
// Nothing here writes. The file is checked the way every read is (`resolveReal`
// — inside the vault, after links are followed), must be a plain file, and its
// name must be one the tab knows how to show, before a byte of it is read.
//
// A document arrives from anywhere — a download, an email, a shared folder — so
// sizes are capped before anything is unpacked: a .docx or .xlsx is a zip, and
// a small zip can unpack to gigabytes.
//
// The Excel reader is written here rather than added as a library: the parts of
// an .xlsx a viewer needs (the sheet names, the shared words, the cells, which
// cells are dates) are a few regular XML files Excel writes the same way every
// time, and jszip — already inside the app, as mammoth's own zip reader — opens
// the zip. What it leaves out is listed in `docs/plans/file-tabs.md`.

import { promises as fs } from 'node:fs'
import { resolveDocFile } from './vault'
import {
  docViewOf,
  SHEET_MAX_COLS,
  SHEET_MAX_ROWS,
  TEXT_MAX_CHARS,
  type CsvShape,
  type DocContent,
  type DocResult,
  type SheetData
} from '../shared/docs'

/** Bigger than this and the tab says so and offers the file's own app. */
const MAX_FILE = 100 * 1024 * 1024
/** The most a zip may unpack to before it is refused. */
const MAX_UNPACKED = 400 * 1024 * 1024

export class DocTooBig extends Error {
  constructor() {
    super('This file is too big to show here.')
  }
}

/** `readDocument` for the window: never rejects (an IPC rejection arrives as a
 *  long "Error invoking remote method…" string), says why instead. */
export async function readDocumentResult(relPath: string): Promise<DocResult> {
  try {
    return await readDocument(relPath)
  } catch (e) {
    if (e instanceof DocTooBig) return { kind: 'error', reason: 'big' }
    const code = (e as NodeJS.ErrnoException).code
    return { kind: 'error', reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'gone' : 'unreadable' }
  }
}

export async function readDocument(relPath: string): Promise<DocContent> {
  const abs = await resolveDocFile(relPath)
  const view = docViewOf(abs)
  if (!view || view === 'pdf') throw new Error('Not a document a tab reads')
  const st = await fs.stat(abs)
  if (st.size > MAX_FILE) throw new DocTooBig()
  const bytes = await fs.readFile(abs)
  if (view === 'text') {
    const t = textOf(bytes)
    return { kind: 'text', text: t.text, cut: t.cut, editable: t.utf8 && !t.cut }
  }
  if (view === 'csv') {
    const t = textOf(bytes)
    const sheet = csvSheet(t.text)
    return { kind: 'sheet', sheets: [sheet], csv: csvShape(t.text), editable: t.utf8 && !t.cut && !sheet.cut }
  }
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  let unpacked = 0
  zip.forEach((_p, f) => {
    // jszip keeps each entry's size as written in the zip's own directory; a
    // zip that lies about it is caught by the inflate stopping at the real end.
    unpacked += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
  })
  if (unpacked > MAX_UNPACKED) throw new DocTooBig()
  if (view === 'word') return { kind: 'word', html: await wordHtml(bytes) }
  return { kind: 'sheet', sheets: await xlsxSheets(zip), editable: false }
}

// --- text and CSV ------------------------------------------------------------------

/** `utf8` false: the file isn't UTF-8 (an older Windows CSV often isn't), so it
 *  is shown as well as it can be and never saved back — saving would replace
 *  every accented letter with a question mark. */
function textOf(bytes: Buffer): { text: string; cut: boolean; utf8: boolean } {
  let text: string
  let utf8 = true
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    utf8 = false
    text = bytes.toString('latin1')
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const cut = text.length > TEXT_MAX_CHARS
  return { text: cut ? text.slice(0, TEXT_MAX_CHARS) : text, cut, utf8 }
}

function separatorOf(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const counts = [',', ';', '\t'].map((s) => [s, firstLine.split(s).length] as const)
  return counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
}

export function csvShape(text: string): CsvShape {
  return { sep: separatorOf(text), endsWithBreak: /\r?\n$/.test(text) }
}

/** A CSV as rows. Quotes, doubled quotes and line breaks inside quotes are
 *  honoured; the separator is whichever of , ; or tab the first line uses most
 *  (Excel in much of Europe writes `;`). */
export function csvSheet(text: string, name = 'Sheet 1'): SheetData {
  const sep = separatorOf(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let cut = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (rows.length >= SHEET_MAX_ROWS) {
        cut = i < text.length - 1
        break
      }
    } else cell += ch
  }
  if (!cut && (cell !== '' || row.length)) {
    row.push(cell)
    rows.push(row)
  }
  return capCols({ name, rows, cut })
}

function capCols(sheet: SheetData): SheetData {
  let cut = sheet.cut
  const rows = sheet.rows.map((r) => {
    if (r.length <= SHEET_MAX_COLS) return r
    cut = true
    return r.slice(0, SHEET_MAX_COLS)
  })
  return { ...sheet, rows, cut }
}

// --- Word ----------------------------------------------------------------------------

async function wordHtml(bytes: Buffer): Promise<string> {
  const { default: mammoth } = await import('mammoth')
  // Pictures come through as data: addresses, which the window's policy allows for
  // pictures; underline is kept (mammoth drops it by default — the Word importer's
  // finding, importers/word/run.ts). The window cleans the HTML before showing it.
  const result = await mammoth.convertToHtml({ buffer: bytes }, { styleMap: ['u => u'] })
  return result.value
}

// --- Excel ----------------------------------------------------------------------------

type Zip = { file(name: string): { async(kind: 'string'): Promise<string> } | null }

const read = async (zip: Zip, name: string): Promise<string | null> => {
  const f = zip.file(name)
  return f ? f.async('string') : null
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** XML text to plain text: entities, and Excel's own `_x000D_` escapes. */
export function xmlText(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
      }
      return ENTITY[e.toLowerCase()] ?? whole
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_w, h: string) => String.fromCharCode(parseInt(h, 16)))
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return m ? xmlText(m[1]) : null
}

/** Every `<t>` inside, joined — a rich-text string is several runs. Phonetic
 *  guides (`<rPh>`, Japanese) are not part of the words. */
function runsText(xml: string): string {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')
  let out = ''
  for (const m of plain.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += xmlText(m[1])
  return out
}

/** "AB" → 27 (0-based column). */
function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

// Excel's built-in number formats that are dates or times.
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

type Fmt = { kind: 'date'; time: boolean; dateToo: boolean } | { kind: 'percent'; places: number } | { kind: 'fixed'; places: number } | { kind: 'general' }

function fmtOf(id: number, code: string | undefined): Fmt {
  if (id === 9) return { kind: 'percent', places: 0 }
  if (id === 10) return { kind: 'percent', places: 2 }
  if (id === 2 || id === 4) return { kind: 'fixed', places: 2 }
  if (id === 1 || id === 3) return { kind: 'fixed', places: 0 }
  if (DATE_IDS.has(id)) {
    const time = [18, 19, 20, 21, 22, 45, 46, 47].includes(id)
    return { kind: 'date', time, dateToo: !(id >= 18 && id <= 21) && id !== 45 && id !== 46 && id !== 47 }
  }
  if (!code) return { kind: 'general' }
  // Only the first section (positive numbers), with quoted words, escapes and
  // [colour]/[$-locale] blocks taken out, says what kind of format it is.
  const first = code.split(';')[0].replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
  if (/[dy]/i.test(first) || (/m/i.test(first) && !/0/.test(first)) || /h/i.test(first)) {
    const time = /h|s/i.test(first)
    return { kind: 'date', time, dateToo: /[dy]/i.test(first) || /m{3,}/i.test(first) }
  }
  const places = (/0\.(0+)/.exec(first)?.[1].length ?? 0)
  if (first.includes('%')) return { kind: 'percent', places }
  if (/0/.test(first)) return { kind: 'fixed', places }
  return { kind: 'general' }
}

const pad = (n: number): string => String(n).padStart(2, '0')

function dateText(serial: number, f: Extract<Fmt, { kind: 'date' }>, date1904: boolean): string {
  // Day 0 is 1899-12-30 (Excel counts a 29 Feb 1900 that never was; from March
  // 1900 on, which is every date anyone has, this lands right), or 1904-01-01.
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const d = new Date(base + Math.round(serial * 86400000))
  if (Number.isNaN(d.getTime())) return String(serial)
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  if (f.time && !f.dateToo) return time
  return f.time ? `${day} ${time}` : day
}

/** A number as a short, ordinary figure: no floating-point noise (0.1+0.2). */
function numberText(n: number, f: Fmt): string {
  if (f.kind === 'percent') return `${(n * 100).toFixed(f.places)}%`
  if (f.kind === 'fixed') return n.toFixed(f.places)
  return String(parseFloat(n.toPrecision(15)))
}

export async function xlsxSheets(zip: Zip): Promise<SheetData[]> {
  const workbook = await read(zip, 'xl/workbook.xml')
  if (!workbook) throw new Error('This doesn’t look like an Excel file.')
  const rels = (await read(zip, 'xl/_rels/workbook.xml.rels')) ?? ''
  const targets = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id')
    const target = attr(m[0], 'Target')
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook)

  const shared: string[] = []
  const sst = await read(zip, 'xl/sharedStrings.xml')
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? runsText(m[1]) : '')

  const fmts: Fmt[] = []
  const styles = await read(zip, 'xl/styles.xml')
  if (styles) {
    const codes = new Map<number, string>()
    for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) {
      const id = Number(attr(m[0], 'numFmtId'))
      const code = attr(m[0], 'formatCode')
      if (Number.isFinite(id) && code != null) codes.set(id, code)
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
    for (const m of xfs.matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attr(m[0], 'numFmtId') ?? 0)
      fmts.push(fmtOf(id, codes.get(id)))
    }
  }

  const sheets: SheetData[] = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    if (/\sstate="(hidden|veryHidden)"/.test(m[0])) continue
    const name = attr(m[0], 'name') ?? `Sheet ${sheets.length + 1}`
    const rid = attr(m[0], 'r:id')
    const xml = rid && targets.has(rid) ? await read(zip, targets.get(rid)!) : null
    if (xml == null) continue // a chart sheet, or a part that isn't there
    sheets.push(sheetRows(xml, name, shared, fmts, date1904))
  }
  if (!sheets.length) throw new Error('This spreadsheet has no sheets to show.')
  return sheets
}

function sheetRows(xml: string, name: string, shared: string[], fmts: Fmt[], date1904: boolean): SheetData {
  const rows: string[][] = []
  let cut = false
  let nextRow = 0
  const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? ''
  for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(rm[1], 'r'))
    const at = Number.isFinite(r) && r > 0 ? r - 1 : nextRow
    nextRow = at + 1
    if (at >= SHEET_MAX_ROWS) {
      cut = true
      break
    }
    const cells: string[] = []
    let nextCol = 0
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r')
      const col = ref ? colIndex(/^[A-Z]+/i.exec(ref)?.[0] ?? 'A') : nextCol
      nextCol = col + 1
      if (col >= SHEET_MAX_COLS) {
        cut = true
        continue
      }
      const body = cm[2] ?? ''
      const type = attr(cm[1], 't')
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let text = ''
      if (type === 's') text = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') text = runsText(body)
      else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : ''
      else if (type === 'str' || type === 'e' || type === 'd') text = v != null ? xmlText(v) : ''
      else if (v != null) {
        const n = Number(v)
        const f = fmts[Number(attr(cm[1], 's') ?? 0)] ?? { kind: 'general' }
        text = !Number.isFinite(n) ? xmlText(v) : f.kind === 'date' ? dateText(n, f, date1904) : numberText(n, f)
      }
      while (cells.length < col) cells.push('')
      cells[col] = text
    }
    while (rows.length < at) rows.push([])
    rows[at] = cells
  }
  // Trailing empty rows (formatting with no words) are not part of the table.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return { name, rows, cut }
}
