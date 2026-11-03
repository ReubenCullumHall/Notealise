import { app, BrowserWindow, dialog, net } from 'electron'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sanitizeFilename } from '../shared/filenames'
import {
  PRINT_CSP,
  PRINT_MAX_BYTES,
  cssWord,
  ownFontUrl,
  type PrintFontFace,
  type PrintNoteRequest,
  type PrintNoteResult
} from '../shared/printNote'
import { listInstalledFonts } from './fonts'

// Save as (PDF or a web page) / Print. The renderer sends the note as a finished
// page body plus a stylesheet (shared/printNote.ts); this file seals it in a
// hidden window and does the job — or, for a web page, writes it as it is.
//
// THE SEALED WINDOW. A note can arrive from someone else, and its text can carry
// HTML. The renderer sanitises it, but the safety does not rest on that alone:
// the page is shown in a window with no Node, no preload, a content-security
// policy that allows nothing but `data:` pictures and fonts (PRINT_CSP), no way
// to navigate and no way to open another window. Nothing in the page can run or
// fetch, so it can only ever be drawn.
//
// THE PAGE LIVES IN A TEMP FILE, not a `data:` URL: Chromium refuses navigations
// to very large `data:` URLs, and a note with a few photos is well past them.
// The file is removed in `finally`, whatever happens.

async function readOwnFont(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('file:')) return await fs.readFile(fileURLToPath(url.split(/[?#]/)[0]))
    const res = await net.fetch(url)
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  } catch {
    return null
  }
}

const mimeOf = (url: string): string => {
  const e = url.split(/[?#]/)[0].toLowerCase()
  return e.endsWith('.woff2') ? 'font/woff2' : e.endsWith('.woff') ? 'font/woff' : e.endsWith('.otf') ? 'font/otf' : 'font/ttf'
}

async function fontCss(req: PrintNoteRequest, pageUrl: string): Promise<string> {
  const out: string[] = []
  for (const f of (req.faces as PrintFontFace[]).slice(0, 24)) {
    if (!ownFontUrl(f.url, pageUrl)) continue
    const buf = await readOwnFont(f.url)
    if (!buf || buf.length > 8 * 1024 * 1024) continue
    out.push(
      `@font-face{font-family:'${cssWord(f.family)}';font-weight:${cssWord(f.weight) || 'normal'};` +
        `font-style:${cssWord(f.style) || 'normal'};src:url(data:${mimeOf(f.url)};base64,${buf.toString('base64')})}`
    )
  }
  const wanted = new Set(req.families.slice(0, 12).map((x) => String(x).toLowerCase()))
  if (wanted.size) {
    for (const f of await listInstalledFonts().catch(() => [])) {
      if (!wanted.has(f.family.toLowerCase())) continue
      out.push(`@font-face{font-family:'${cssWord(f.family)}';src:url(data:font/woff2;base64,${f.base64})}`)
    }
  }
  return out.join('\n')
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function printNote(parent: BrowserWindow, req: PrintNoteRequest): Promise<PrintNoteResult> {
  if (
    !req ||
    (req.action !== 'pdf' && req.action !== 'html' && req.action !== 'print') ||
    typeof req.html !== 'string' ||
    typeof req.css !== 'string' ||
    typeof req.title !== 'string' ||
    !Array.isArray(req.faces) ||
    !Array.isArray(req.families)
  ) {
    return { ok: 'failed', reason: 'bad request' }
  }
  if (req.html.length + req.css.length > PRINT_MAX_BYTES) {
    return { ok: 'failed', reason: 'This note is too big to print in one go.' }
  }
  const title = req.title.trim() || 'Note'

  // Ask where to save BEFORE doing any work, so Cancel is instant.
  let savePath = ''
  if (req.action !== 'print') {
    const ext = req.action === 'pdf' ? 'pdf' : 'html'
    const res = await dialog.showSaveDialog(parent, {
      title: req.action === 'pdf' ? 'Save as PDF' : 'Save as a web page',
      defaultPath: path.join(app.getPath('documents'), `${sanitizeFilename(title).name}.${ext}`),
      filters: [req.action === 'pdf' ? { name: 'PDF', extensions: ['pdf'] } : { name: 'Web page', extensions: ['html', 'htm'] }]
    })
    if (res.canceled || !res.filePath) return { ok: 'cancelled' }
    savePath = res.filePath
  }

  const doc =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}">` +
    `<title>${escapeHtml(title)}</title><style>${await fontCss(req, parent.webContents.getURL())}\n${req.css}</style>` +
    `</head><body>${req.html}</body></html>`

  // A web page is this same sealed page, kept as one file: pictures and fonts
  // are already inside it, and its policy still lets it load and run nothing
  // when it is opened in a browser.
  if (req.action === 'html') {
    try {
      await fs.writeFile(savePath, doc, 'utf8')
      return { ok: 'saved', path: savePath }
    } catch (e) {
      return { ok: 'failed', reason: e instanceof Error ? e.message : String(e) }
    }
  }

  let dir = ''
  let w: BrowserWindow | null = null
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notealise-print-'))
    const file = path.join(dir, 'note.html')
    await fs.writeFile(file, doc, 'utf8')

    w = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false
      }
    })
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await w.loadFile(file)
    // Fonts and pictures are data: URLs but still decode after load; printing
    // before they do gives a page in the wrong font.
    await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)')

    if (req.action === 'pdf') {
      const pdf = await w.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true
      })
      await fs.writeFile(savePath, pdf)
      return { ok: 'saved', path: savePath }
    }

    return await new Promise<PrintNoteResult>((resolve) => {
      w!.webContents.print({ silent: false, printBackground: true, pageSize: req.letter ? 'Letter' : 'A4' }, (ok, why) => {
        // Closing the dialog without printing reports failure with this word.
        if (!ok && /cancel/i.test(why)) resolve({ ok: 'cancelled' })
        else if (!ok) resolve({ ok: 'failed', reason: why })
        else resolve({ ok: 'printed' })
      })
    })
  } catch (e) {
    return { ok: 'failed', reason: e instanceof Error ? e.message : String(e) }
  } finally {
    if (w && !w.isDestroyed()) w.destroy()
    if (dir) void fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
