import DOMPurify from 'dompurify'
import { isInlineDataUrl, kindForFilename, resolveVaultPath } from '../../../shared/attachments'
import { baseName, titleOf } from '../../../shared/links'
import { COLOR_NAMES } from '../../../shared/palette'
import type { InstalledFont } from '../../../shared/fonts'
import type { PrintFontFace, PrintNoteRequest, PrintNoteResult } from '../../../shared/printNote'
import { highlightOnPaper, textOnPaper } from './contrast'
import { noteBodyHtml, startsWithTitle } from './noteHtml'

// A note, as a printed page: the DOM half. noteHtml.ts turns the markdown into
// HTML text; this makes it safe, swaps the things paper can't hold (a voice note,
// a video, a link to another note) for words, puts the note's pictures INTO the
// page, and writes the stylesheet. main/printNote.ts then seals the result in a
// window that can run and fetch nothing, and saves or prints it.
//
// Two looks, chosen each time (Reuben, 2026-11-03):
//   plain  — black on white in a plain font. Prints the same whatever theme the
//            note is in; the one to hand in.
//   look   — the note's own fonts, text size and heading / bold / link colours,
//            read from the running app, on white paper. Not carried over: the
//            paper pattern (lined, squares) and the dark backgrounds — a dark
//            theme prints as its LIGHT version, never as a black page.
// Colour marks written into the note (`hl-amber`, `tc-sky`, a custom hex) are
// content, not look, so both keep them — in their light-theme values, which are
// the ones that read on white.

export type PrintMode = 'plain' | 'look'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

/** Pictures wider than this are shrunk before they go in the page: a 4000px photo
 *  prints no sharper than 1800px on A4, and it is the difference between a 300 KB
 *  PDF and a 20 MB one. */
const MAX_PICTURE_WIDTH = 1800

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** A vault picture as a `data:` URL, shrunk if it is huge. Null if unreadable. */
async function pictureDataUrl(rel: string): Promise<string | null> {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
  const mime = MIME[ext]
  if (!mime) return null
  let bytes: Uint8Array
  try {
    bytes = await window.api.readAsset(rel)
  } catch {
    return null
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: mime })
  if (mime === 'image/svg+xml' || mime === 'image/gif') return dataUrlOf(blob)
  try {
    const bmp = await createImageBitmap(blob)
    if (bmp.width <= MAX_PICTURE_WIDTH) {
      bmp.close()
      return await dataUrlOf(blob)
    }
    const canvas = document.createElement('canvas')
    canvas.width = MAX_PICTURE_WIDTH
    canvas.height = Math.max(1, Math.round((bmp.height * MAX_PICTURE_WIDTH) / bmp.width))
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.85))
    return await dataUrlOf(out ?? blob)
  } catch {
    return await dataUrlOf(blob) // a format the decoder won't take: send it as it is
  }
}

/** "Voice note 2026-10-13 14.32.m4a" (percent-encoded, in a folder) → the name a reader sees. */
function shownName(target: string): string {
  let t = target
  try {
    t = decodeURIComponent(target)
  } catch {
    /* a stray % — use it as written */
  }
  return baseName(t).replace(/\.[A-Za-z0-9]{1,5}$/, '')
}

function placeholder(label: string, target: string): HTMLElement {
  const el = document.createElement('span')
  el.className = 'media-note'
  const name = shownName(target)
  // The app names a recording "Voice note 2026-10-13 14.32" — don't say it twice.
  el.textContent = name.toLowerCase().startsWith(label.toLowerCase()) ? name : `${label}: ${name}`
  return el
}

/** What stands in for a thing paper can't play. */
function standIn(kind: string | null, target: string): HTMLElement {
  return placeholder(kind === 'audio' ? 'Voice note' : kind === 'video' ? 'Video' : 'Picture', target)
}

/**
 * The note's body as safe HTML for the page. `notePath` is where the note lives,
 * for the pictures whose targets are written relative to it.
 */
export async function buildBody(text: string, notePath: string): Promise<string> {
  const frag = DOMPurify.sanitize(noteBodyHtml(text), {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'button', 'select', 'textarea', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcset']
  })
  const root = document.createElement('div')
  root.append(frag)

  // A toggle is printed open: a shut one would hide the very thing being handed in.
  root.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''))

  root.querySelectorAll('audio, video').forEach((el) => {
    const src = el.getAttribute('src') ?? el.querySelector('source')?.getAttribute('src') ?? ''
    el.replaceWith(standIn(el.tagName === 'AUDIO' ? 'audio' : 'video', src))
  })

  // A ticked box drawn by the page itself: a real (disabled) checkbox prints as a
  // faint grey square that is hard to tell ticked from not.
  root.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    const mark = document.createElement('span')
    mark.className = box.hasAttribute('checked') ? 'task-box done' : 'task-box'
    box.replaceWith(mark)
  })

  // Links to another note or file mean nothing on paper; a web link keeps its address.
  root.querySelectorAll('a').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) a.setAttribute('href', href)
    else a.replaceWith(...Array.from(a.childNodes))
  })

  const pictures = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    pictures.map(async (img) => {
      const src = img.getAttribute('src') ?? ''
      if (isInlineDataUrl(src)) {
        if (!/^data:image\//i.test(src)) img.replaceWith(standIn(null, img.getAttribute('alt') ?? 'picture'))
        return
      }
      const rel = resolveVaultPath(src, notePath)
      // A picture on the web (or an absolute path) is not fetched: the page may
      // load nothing, and an offline notes app shouldn't reach out to print.
      if (!rel) {
        img.replaceWith(standIn(null, img.getAttribute('alt') || src))
        return
      }
      const kind = kindForFilename(rel)
      if (kind !== 'image') {
        img.replaceWith(standIn(kind, rel))
        return
      }
      const url = await pictureDataUrl(rel)
      if (!url) img.replaceWith(standIn(null, rel))
      else img.setAttribute('src', url)
    })
  )
  return root.innerHTML
}

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------

interface PrintTheme {
  body: string
  mono: string
  sizePt: number
  leading: number
  ink: string
  muted: string
  rule: string
  heading: [string, string, string, string]
  headingBg: [string, string, string, string]
  bold: string
  italic: string
  link: string
  code: string
  codeBg: string
  hl: Record<string, string>
  tc: Record<string, string>
}

/** The colours the app paints in its LIGHT theme, whatever theme is showing. The
 *  attribute is flipped and put back inside one synchronous run — nothing is
 *  drawn in between, and nothing here listens for a theme change. */
function readLight<T>(read: () => T): T {
  const root = document.documentElement
  const was = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  try {
    return read()
  } finally {
    if (was === null) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', was)
  }
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'system-ui', 'ui-monospace', '-apple-system', 'cursive', 'fantasy'])

/** `'Inter', system-ui, sans-serif` → ['Inter', 'system-ui', 'sans-serif'] */
function familiesOf(stack: string): string[] {
  return stack
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/** The @font-face rules in the app's own stylesheets for these families. */
function bundledFaces(families: string[]): PrintFontFace[] {
  const want = new Set(families.map((f) => f.toLowerCase()))
  const out: PrintFontFace[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const family = rule.style.getPropertyValue('font-family').trim().replace(/^['"]|['"]$/g, '')
      if (!want.has(family.toLowerCase())) continue
      const url = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(rule.style.getPropertyValue('src'))?.[1]
      if (!url) continue
      let abs: string
      try {
        // The rule keeps the address as the stylesheet wrote it ("./Inter-abc.woff2").
        abs = new URL(url, sheet.href ?? location.href).href
      } catch {
        continue
      }
      out.push({
        family,
        weight: rule.style.getPropertyValue('font-weight').trim() || 'normal',
        style: rule.style.getPropertyValue('font-style').trim() || 'normal',
        url: abs
      })
    }
  }
  return out
}

export interface Look {
  theme: PrintTheme
  families: string[]
  faces: PrintFontFace[]
}

/** The plain page's fonts. System fonts only, so nothing needs embedding. */
const PLAIN_BODY = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", sans-serif'
const PLAIN_MONO = 'Menlo, Consolas, "Courier New", monospace'

export function readLook(mode: PrintMode): Look {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none'
  document.body.append(probe)
  try {
    const paint = (prop: 'color' | 'backgroundColor', value: string, cls = '', tag = 'span'): string => {
      const el = document.createElement(tag)
      if (cls) el.className = cls
      if (value) el.style[prop] = value
      probe.append(el)
      const v = getComputedStyle(el)[prop]
      el.remove()
      return v
    }
    const rootStyle = getComputedStyle(document.documentElement)
    const fmt = (kind: string, layer: 'tc' | 'hl'): string => rootStyle.getPropertyValue(`--fmt-${kind}-${layer}`).trim()

    const colours = readLight(() => {
      const hl: Record<string, string> = {}
      const tc: Record<string, string> = {}
      for (const n of COLOR_NAMES) {
        hl[n] = paint('backgroundColor', '', `hl-${n}`, 'mark')
        tc[n] = paint('color', '', `tc-${n}`)
      }
      const h = (n: number): string => paint('color', `var(--fmt-h${n}-tc, rgb(var(--ink-acc-900, var(--ink-900))))`)
      const hb = (n: number): string => (fmt(`h${n}`, 'hl') ? paint('backgroundColor', fmt(`h${n}`, 'hl')) : 'transparent')
      return {
        hl,
        tc,
        ink: paint('color', 'rgb(var(--ink-plain-900, var(--ink-900)))'),
        muted: paint('color', 'rgb(var(--ink-500))'),
        rule: paint('color', 'rgb(var(--ink-300))'),
        heading: [h(1), h(2), h(3), h(4)] as PrintTheme['heading'],
        headingBg: [hb(1), hb(2), hb(3), hb(4)] as PrintTheme['headingBg'],
        bold: fmt('bold', 'tc') ? paint('color', fmt('bold', 'tc')) : '',
        italic: fmt('italic', 'tc') ? paint('color', fmt('italic', 'tc')) : '',
        link: paint('color', `var(--fmt-webLink-tc, var(--ed-link))`),
        code: paint('color', 'var(--ed-code)'),
        codeBg: paint('backgroundColor', 'rgb(var(--code-bg))')
      }
    })

    // Everything lands on white paper, whatever theme it was read in — see
    // contrast.ts for why the light-theme flip alone is not enough.
    const hl = Object.fromEntries(Object.entries(colours.hl).map(([n, c]) => [n, highlightOnPaper(c)]))
    const tc = Object.fromEntries(Object.entries(colours.tc).map(([n, c]) => [n, textOnPaper(c)]))
    const paper = {
      ...colours,
      hl,
      tc,
      ink: textOnPaper(colours.ink, 10),
      muted: textOnPaper(colours.muted),
      rule: colours.rule,
      heading: colours.heading.map((c) => textOnPaper(c)) as PrintTheme['heading'],
      headingBg: colours.headingBg.map((c) => (c === 'transparent' ? c : highlightOnPaper(c))) as PrintTheme['headingBg'],
      bold: colours.bold && textOnPaper(colours.bold),
      italic: colours.italic && textOnPaper(colours.italic),
      link: textOnPaper(colours.link),
      code: textOnPaper(colours.code),
      codeBg: highlightOnPaper(colours.codeBg, 12)
    }

    if (mode === 'plain') {
      // Black on white; the colour marks the note carries are the only colour.
      const black = '#111'
      return {
        families: [],
        faces: [],
        theme: {
          ...paper,
          body: PLAIN_BODY,
          mono: PLAIN_MONO,
          sizePt: 11,
          leading: 1.5,
          ink: black,
          muted: '#555',
          rule: '#bbb',
          heading: [black, black, black, black],
          headingBg: ['transparent', 'transparent', 'transparent', 'transparent'],
          bold: '',
          italic: '',
          link: black,
          code: black,
          codeBg: '#f2f2f2'
        }
      }
    }

    // The running editor is the truth for the font and size (a per-space size
    // setting lands there); the page-level variable is the fallback when no note
    // is open yet.
    const scroller = document.querySelector('.cm-scroller')
    const sc = scroller ? getComputedStyle(scroller) : null
    const body = sc?.fontFamily || rootStyle.getPropertyValue('--note-font-sans').trim() || PLAIN_BODY
    const mono = rootStyle.getPropertyValue('--font-mono').trim() || PLAIN_MONO
    const px = parseFloat(sc?.fontSize ?? '') || 16
    const lh = parseFloat(sc?.lineHeight ?? '')
    const leading = lh && px ? Math.min(2, Math.max(1.3, lh / px)) : 1.6
    const families = [...familiesOf(body), ...familiesOf(mono)].filter((f) => !GENERIC.has(f.toLowerCase()))
    return {
      families,
      faces: bundledFaces(families),
      theme: {
        ...paper,
        body,
        mono,
        sizePt: Math.min(13, Math.max(10, px * 0.75)),
        leading
      }
    }
  } finally {
    probe.remove()
  }
}

/** The stylesheet. The colours and fonts here are PAPER's, not the app's: a
 *  printed page is always light, so the "no hard-coded colours" rule for app
 *  chrome does not reach it (and it can't — a sealed page has no theme.css). */
export function printCss(t: PrintTheme, letter: boolean): string {
  const hl = Object.entries(t.hl).map(([n, c]) => `.hl-${n}{background-color:${c}}`).join('')
  const tc = Object.entries(t.tc).map(([n, c]) => `.tc-${n}{color:${c}}`).join('')
  const head = (n: number, em: string, w: number): string =>
    `h${n}{font-size:${em};font-weight:${w};line-height:1.3;color:${t.heading[n - 1]};` +
    (t.headingBg[n - 1] !== 'transparent' ? `background:${t.headingBg[n - 1]};width:fit-content;` : '') +
    `margin:1.1em 0 .45em}`
  return `
@page{size:${letter ? 'Letter' : 'A4'};margin:18mm 17mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:${t.ink};font:${t.sizePt}pt/${t.leading} ${t.body};overflow-wrap:anywhere}
.note-title{font-size:1.9em;font-weight:700;line-height:1.25;margin:0 0 .7em;color:${t.heading[0]}}
${head(1, '1.7em', 700)}${head(2, '1.4em', 700)}${head(3, '1.2em', 600)}${head(4, '1em', 600)}
h5,h6{font-size:1em;font-weight:600;margin:1em 0 .4em}
h1,h2,h3,h4,h5,h6{break-after:avoid}
p{margin:0 0 .9em;orphans:3;widows:3}
li{orphans:2;widows:2}
ul,ol{margin:0 0 .9em;padding-left:1.5em}
li>p{margin:0}
li:has(>.task-box){list-style:none;margin-left:-1.3em}
li:has(>.task-box)>ul,li:has(>.task-box)>ol{margin-left:1.3em}
.task-box{display:inline-block;position:relative;width:.85em;height:.85em;margin-right:.5em;vertical-align:-.08em;border:1.5px solid ${t.ink};border-radius:2px}
.task-box.done::after{content:'';position:absolute;left:.2em;top:-.02em;width:.26em;height:.52em;border:solid ${t.ink};border-width:0 1.6px 1.6px 0;transform:rotate(45deg)}
strong{font-weight:700;${t.bold ? `color:${t.bold}` : ''}}
em{${t.italic ? `color:${t.italic}` : ''}}
del{color:${t.muted}}
a{color:${t.link};text-decoration:underline}
.wikilink{border-bottom:1px solid ${t.rule}}
blockquote{margin:0 0 .9em;padding:.1em 0 .1em 1em;border-left:3px solid ${t.rule};color:${t.muted};font-style:italic}
code{font-family:${t.mono};font-size:.9em;color:${t.code};background:${t.codeBg};padding:.08em .3em;border-radius:3px}
pre{margin:0 0 .9em;padding:.7em .9em;background:${t.codeBg};border-radius:4px;white-space:pre-wrap;overflow-wrap:anywhere}
pre code{background:none;padding:0;color:${t.ink};font-size:.88em}
table{border-collapse:collapse;margin:0 0 .9em;max-width:100%}
th,td{border:1px solid ${t.rule};padding:.35em .65em;text-align:left;vertical-align:top}
th{background:${t.codeBg};font-weight:600}
tr{break-inside:avoid}
hr{border:0;border-top:1px solid ${t.rule};margin:1.2em 0}
img{display:block;max-width:100%;max-height:235mm;margin:.4em 0 .9em;break-inside:avoid}
details{margin:0 0 .9em}
summary{font-weight:600;margin-bottom:.4em}
details>:not(summary){margin-left:1.2em}
.media-note{display:inline-block;border:1px solid ${t.rule};padding:.1em .6em;color:${t.muted};font-size:.9em}
.math-box{margin:.8em 0;text-align:center;break-inside:avoid}
math{font-size:1.1em}
mark{background-color:#fff3a3;color:inherit;padding:0 .08em}
@media screen{body{max-width:44rem;margin:0 auto;padding:3rem 1.5rem 4rem}}
${hl}${tc}
`.trim()
}

// ---------------------------------------------------------------------------
// Doing it — the Save as window (print/SaveAs.tsx) drives these
// ---------------------------------------------------------------------------

/** US and Canadian machines print on Letter; everyone else on A4. */
export const usesLetter = (): boolean => /^en-(US|CA)$/i.test(navigator.language)

/** What the note says, made once per opening of the window: the look and the
 *  format only change the stylesheet around it. */
export interface PreparedNote {
  title: string
  body: string
  /** a voice note, video or web picture stood in for by a label */
  hasStandIns: boolean
}

export async function prepareNote(text: string, notePath: string): Promise<PreparedNote> {
  const title = titleOf(notePath)
  const head = startsWithTitle(text, title) ? '' : `<h1 class="note-title">${esc(title)}</h1>`
  const body = head + (await buildBody(text, notePath))
  return { title, body, hasStandIns: body.includes('class="media-note"') }
}

export type SaveFormat = 'pdf' | 'html' | 'print'

export function requestFor(note: PreparedNote, look: Look, format: SaveFormat): PrintNoteRequest {
  return {
    action: format,
    title: note.title,
    html: note.body,
    css: printCss(look.theme, usesLetter()),
    faces: look.faces,
    families: look.families,
    letter: usesLetter()
  }
}

/** The preview's page: the same page, drawn in the window itself. Its fonts are
 *  the app's own files (the preview frame shares the app's origin; it runs no
 *  script — SaveAs.tsx's sandbox) plus the installed ones as data. A paper
 *  format is shown as a sheet with the PDF's margins; a web page as the page a
 *  browser would show. */
export function previewDoc(note: PreparedNote, look: Look, format: SaveFormat, installed: InstalledFont[]): string {
  const faces = look.faces
    .map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-style:${f.style};src:url("${f.url}")}`)
    .join('')
  const wanted = new Set(look.families.map((f) => f.toLowerCase()))
  const extra = installed
    .filter((f) => wanted.has(f.family.toLowerCase()))
    .map((f) => `@font-face{font-family:'${f.family}';src:url(data:font/woff2;base64,${f.base64})}`)
    .join('')
  const sheet = format === 'html' ? '' : 'body{max-width:none;margin:0;padding:18mm 17mm}'
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${faces}${extra}\n` +
    `${printCss(look.theme, usesLetter())}\n${sheet}html{overflow-x:hidden}::-webkit-scrollbar{display:none}</style></head><body>${note.body}</body></html>`
  )
}

export async function saveNote(note: PreparedNote, look: Look, format: SaveFormat): Promise<PrintNoteResult> {
  return window.api.printNote(requestFor(note, look, format))
}
