// Documents in a folder (docs/plans/file-tabs.md): how they are listed, read for
// their tab, and — text and CSV only — saved back. Against a real temporary
// vault, like vault.test.ts, because the boundary and the bytes on disk are what
// is being checked.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { listTree, setVaultRoot, writeTextDoc } from './vault'
import { csvShape, csvSheet, readDocument, readDocumentResult, xmlText } from './docView'
import { csvText, docViewOf } from '../shared/docs'
import type { TreeNode } from '../shared/types'

let root: string
let outside: string

beforeEach(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'docview-test-')))
  root = path.join(base, 'vault')
  outside = path.join(base, 'outside')
  await fs.mkdir(path.join(root, 'Biology'), { recursive: true })
  await fs.mkdir(outside)
  setVaultRoot(root)
})
afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true }).catch(() => {})
})

const put = (rel: string, data: string | Buffer): Promise<void> => fs.writeFile(path.join(root, rel), data)
const onDisk = (rel: string): Promise<Buffer> => fs.readFile(path.join(root, rel))

/** An .xlsx the way Excel lays one out: two sheets (one hidden), shared words,
 *  a number, a percentage, a date, a custom date, a TRUE, an inline word. */
async function xlsx(): Promise<Buffer> {
  const z = new JSZip()
  z.file('[Content_Types].xml', '<Types/>')
  z.file(
    'xl/workbook.xml',
    '<workbook><workbookPr/><sheets>' +
      '<sheet name="Marks &amp; grades" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/>' +
      '<sheet name="Second" sheetId="3" r:id="rId3"/>' +
      '</sheets></workbook>'
  )
  z.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships>' +
      '<Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="ws" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="ws" Target="/xl/worksheets/sheet3.xml"/>' +
      '</Relationships>'
  )
  z.file(
    'xl/sharedStrings.xml',
    '<sst><si><t>Name</t></si><si><r><t>Sco</t></r><r><t xml:space="preserve">re </t></r></si><si><t>Ada &lt;3</t></si></sst>'
  )
  z.file(
    'xl/styles.xml',
    '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts>' +
      '<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="9"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="2"/></cellXfs></styleSheet>'
  )
  z.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>0.30000000000000004</v></c><c r="C2" s="1"><v>0.75</v></c>' +
      '<c r="D2" s="2"><v>45981</v></c><c r="E2" s="3"><v>45982</v></c><c r="F2" t="b"><v>1</v></c>' +
      '<c r="H2" t="inlineStr"><is><t>far</t></is></c><c r="I2" s="4"><f>B2*2</f><v>3.14159</v></c></row>' +
      '<row r="4"><c r="A4"/></row>' +
      '</sheetData></worksheet>'
  )
  z.file('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden</t></is></c></row></sheetData></worksheet>')
  z.file('xl/worksheets/sheet3.xml', '<worksheet><sheetData><row r="3"><c r="B3"><v>7</v></c></row></sheetData></worksheet>')
  return z.generateAsync({ type: 'nodebuffer' })
}

/** The smallest .docx Word's own reader opens: a paragraph, a heading. */
async function docx(): Promise<Buffer> {
  const z = new JSZip()
  z.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  z.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  z.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>Cells and membranes</w:t></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>underlined</w:t></w:r></w:p>' +
      '</w:body></w:document>'
  )
  return z.generateAsync({ type: 'nodebuffer' })
}

describe('the sidebar lists documents beside notes', () => {
  it('as their own kind, with a size, and leaves pictures out', async () => {
    await put('Biology/Cells.md', '# Cells')
    await put('Biology/Handout.pdf', '%PDF-1.4 fake')
    await put('Biology/Marks.xlsx', 'x')
    await put('Biology/photo.png', 'png')
    await put('Biology/run.sh', 'echo')
    const bio = (await listTree()).find((n) => n.name === 'Biology') as TreeNode
    const kids = bio.children!.map((n) => [n.name, n.type])
    expect(kids).toEqual([
      ['Cells.md', 'file'],
      ['Handout.pdf', 'doc'],
      ['Marks.xlsx', 'doc']
    ])
    expect(bio.children![1].size).toBe(13)
    expect(bio.children![1].preview).toBeUndefined()
  })

  it('folders first, then notes and documents together by name', async () => {
    await fs.mkdir(path.join(root, 'Biology', 'Zoo'))
    await put('Biology/B.md', '')
    await put('Biology/A.pdf', '')
    await put('Biology/C.md', '')
    const bio = (await listTree()).find((n) => n.name === 'Biology') as TreeNode
    expect(bio.children!.map((n) => n.name)).toEqual(['Zoo', 'A.pdf', 'B.md', 'C.md'])
  })
})

describe('reading a document for its tab', () => {
  it('a spreadsheet: shared and rich words, numbers, %, dates, TRUE, gaps; hidden sheets left out', async () => {
    await put('Biology/Marks.xlsx', await xlsx())
    const d = await readDocument('Biology/Marks.xlsx')
    if (d.kind !== 'sheet') throw new Error(d.kind)
    expect(d.editable).toBe(false)
    expect(d.sheets.map((s) => s.name)).toEqual(['Marks & grades', 'Second'])
    expect(d.sheets[0].rows).toEqual([
      ['Name', 'Score '],
      ['Ada <3', '0.3', '75%', '2025-11-20', '2025-11-21', 'TRUE', '', 'far', '3.14']
    ])
    expect(d.sheets[1].rows).toEqual([[], [], ['', '7']])
  })

  it('a Word file becomes a page of HTML, underline kept', async () => {
    await put('Biology/Essay.docx', await docx())
    const d = await readDocument('Biology/Essay.docx')
    if (d.kind !== 'word') throw new Error(d.kind)
    expect(d.html).toContain('Cells and membranes')
    expect(d.html).toContain('<u>underlined</u>')
  })

  it('a text file: editable when it is UTF-8 and whole; not when it is another encoding', async () => {
    await put('Biology/notes.txt', '﻿café\r\nline two\r\n')
    const t = await readDocument('Biology/notes.txt')
    expect(t).toEqual({ kind: 'text', text: 'café\r\nline two\r\n', cut: false, editable: true })
    await put('Biology/old.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9])) // "café" in Windows-1252
    const o = await readDocument('Biology/old.txt')
    expect(o).toMatchObject({ kind: 'text', text: 'café', editable: false })
  })

  it('a CSV: its own separator, quotes, a line break inside quotes', async () => {
    await put('Biology/list.csv', 'name;note\n"Ada";"said ""hi"""\n"Bo";"two\nlines"\n')
    const d = await readDocument('Biology/list.csv')
    if (d.kind !== 'sheet') throw new Error(d.kind)
    expect(d.editable).toBe(true)
    expect(d.csv).toEqual({ sep: ';', endsWithBreak: true })
    expect(d.sheets[0].rows).toEqual([
      ['name', 'note'],
      ['Ada', 'said "hi"'],
      ['Bo', 'two\nlines']
    ])
  })

  it('refuses a note, a picture, a PDF, a missing file and a link out of the vault — saying why, never throwing', async () => {
    await put('Biology/Cells.md', '# Cells')
    await put('Biology/photo.png', 'png')
    await put('Biology/Handout.pdf', '%PDF')
    expect(await readDocumentResult('Biology/Cells.md')).toEqual({ kind: 'error', reason: 'unreadable' })
    expect(await readDocumentResult('Biology/photo.png')).toEqual({ kind: 'error', reason: 'unreadable' })
    expect(await readDocumentResult('Biology/Handout.pdf')).toEqual({ kind: 'error', reason: 'unreadable' })
    expect(await readDocumentResult('Biology/gone.txt')).toEqual({ kind: 'error', reason: 'gone' })
    expect(await readDocumentResult('../outside/x.txt')).toEqual({ kind: 'error', reason: 'unreadable' })
    if (process.platform !== 'win32') {
      // A file link needs admin rights on Windows (CLAUDE.md gotcha); the folder
      // boundary itself is vault.test.ts's.
      await fs.writeFile(path.join(outside, 'secret.txt'), 'PRIVATE')
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'Biology', 'lure.txt'))
      expect(await readDocumentResult('Biology/lure.txt')).toEqual({ kind: 'error', reason: 'unreadable' })
    }
  })

  it('a damaged Excel file says it cannot be shown', async () => {
    await put('Biology/broken.xlsx', 'not a zip at all')
    expect(await readDocumentResult('Biology/broken.xlsx')).toEqual({ kind: 'error', reason: 'unreadable' })
  })
})

describe('saving an edited text or CSV file back where it is', () => {
  it('keeps the file’s Windows line endings and its byte-order mark', async () => {
    await put('Biology/notes.txt', '﻿one\r\ntwo\r\n')
    await writeTextDoc('Biology/notes.txt', 'one\ntwo changed\n')
    expect((await onDisk('Biology/notes.txt')).toString('utf8')).toBe('﻿one\r\ntwo changed\r\n')
  })

  it('a CSV edit round-trips: written in the file’s shape and read back the same', async () => {
    const text = 'name,note\nAda,"a, b"\n'
    await put('Biology/list.csv', text)
    const sheet = csvSheet(text)
    sheet.rows[1][1] = 'said "hi"'
    sheet.rows.push(['Bo', ' padded'])
    await writeTextDoc('Biology/list.csv', csvText(sheet.rows, csvShape(text)))
    const back = (await onDisk('Biology/list.csv')).toString('utf8')
    expect(back).toBe('name,note\nAda,"said ""hi"""\nBo," padded"\n')
    expect(csvSheet(back).rows).toEqual(sheet.rows)
  })

  it('never writes anything but a .txt or .csv, never makes a file, never follows a link out', async () => {
    await put('Biology/Handout.pdf', '%PDF-1.4')
    await put('Biology/Cells.md', '# Cells')
    await expect(writeTextDoc('Biology/Handout.pdf', 'x')).rejects.toThrow()
    await expect(writeTextDoc('Biology/Cells.md', 'x')).rejects.toThrow()
    await expect(writeTextDoc('Biology/new.txt', 'x')).rejects.toThrow()
    await expect(fs.stat(path.join(root, 'Biology', 'new.txt'))).rejects.toThrow()
    expect((await onDisk('Biology/Handout.pdf')).toString()).toBe('%PDF-1.4')
    if (process.platform !== 'win32') {
      await fs.writeFile(path.join(outside, 'secret.txt'), 'PRIVATE')
      symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'Biology', 'lure.txt'))
      await expect(writeTextDoc('Biology/lure.txt', 'pwned')).rejects.toThrow()
      expect(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('PRIVATE')
    }
  })
})

describe('small pieces', () => {
  it('which documents a tab can draw', () => {
    expect(docViewOf('a/b/Handout.PDF')).toBe('pdf')
    expect(docViewOf('Essay.docx')).toBe('word')
    expect(docViewOf('Marks.xlsx')).toBe('sheet')
    expect(docViewOf('list.csv')).toBe('csv')
    expect(docViewOf('notes.txt')).toBe('text')
    expect(docViewOf('Slides.pptx')).toBeNull() // listed, opened in its own app
    expect(docViewOf('Cells.md')).toBeNull()
    expect(docViewOf('.pdf')).toBeNull()
  })

  it('XML text: entities, numbers, Excel’s _x000D_', () => {
    expect(xmlText('a &amp; b &lt;c&gt; &#233; &#x263A; _x000D_')).toBe('a & b <c> é ☺ \r')
    expect(xmlText('&bogus; &#0;')).toBe('&bogus; &#0;')
  })

  it('a CSV with a tab separator, no line break at the end, and a quote mid-cell', () => {
    const t = 'a\tb\nx"y\tz'
    expect(csvShape(t)).toEqual({ sep: '\t', endsWithBreak: false })
    expect(csvSheet(t).rows).toEqual([
      ['a', 'b'],
      ['x"y', 'z']
    ])
  })
})
