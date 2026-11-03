import { Marked, type TokenizerAndRendererExtension } from 'marked'
import katex from 'katex'
import { frontmatterEnd, tagOf } from '../../../shared/blocks'
import { scanMath } from '../editor/mathPass'

// A note's markdown, as the body of a printed page. Pure text in, HTML text out —
// no DOM, so it is unit-tested. The DOM half (sanitising, pictures, voice notes,
// links) is print/page.ts.
//
// This is NOT the editor's renderer, and it can't be: the editor draws the
// syntax tree live and virtualises what is off screen, so there is no "the whole
// note, drawn" to print. It is `marked` plus the handful of things this app
// writes that plain markdown doesn't know: [[note links]], $maths$, the hidden
// ` ^k3x9` block tags, and frontmatter. Toggles (`<details>`), colour (`<mark
// class="hl-…">`) and voice/video tags are ordinary inline HTML and pass through
// to the DOM half.
//
// Single line breaks stay line breaks (`breaks: true`): the editor shows a note
// line by line, and a printout that glued two lines into one paragraph would not
// be the note.

/** `[[Note]]`, `[[Note|label]]`, `[[Note#Heading]]`, `[[Note#^k3x9]]` — the words
 *  a reader sees in the app, with no link left in them (a printed page can't
 *  follow one). Same reading as shared/plainText.ts. */
export function wikiLinkLabel(inner: string): string {
  const bar = inner.indexOf('|')
  if (bar >= 0 && inner.slice(bar + 1).trim()) return inner.slice(bar + 1).trim()
  const target = bar >= 0 ? inner.slice(0, bar) : inner
  const hash = target.indexOf('#')
  const note = (hash >= 0 ? target.slice(0, hash) : target).trim()
  const heading = hash >= 0 ? target.slice(hash + 1).trim() : ''
  const base = note.slice(note.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  if (!heading || heading.startsWith('^')) return base || heading.replace(/^\^/, '')
  return base ? `${base} › ${heading}` : heading
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const wikiLink: TokenizerAndRendererExtension = {
  name: 'wikiLink',
  level: 'inline',
  start: (src) => {
    const i = src.indexOf('[[')
    return i < 0 ? undefined : i
  },
  tokenizer(src) {
    const m = /^\[\[([^[\]\n]+)\]\]/.exec(src)
    return m ? { type: 'wikiLink', raw: m[0], text: wikiLinkLabel(m[1]) } : undefined
  },
  renderer: (t) => `<span class="wikilink">${esc(String(t.text))}</span>`
}

/** MathML, not KaTeX's HTML: the printed page can't load KaTeX's stylesheet or
 *  fonts, and Chromium draws MathML natively. */
function mathHtml(latex: string, display: boolean): string {
  return katex.renderToString(latex, { displayMode: display, throwOnError: false, maxSize: 100, output: 'mathml' })
}

const inlineMath: TokenizerAndRendererExtension = {
  name: 'inlineMath',
  level: 'inline',
  start: (src) => {
    const i = src.indexOf('$')
    return i < 0 ? undefined : i
  },
  tokenizer(src) {
    if (src[0] !== '$') return undefined
    let hit: { to: number; latex: string; display: boolean } | null = null
    // The editor's own scanner, so a price like "$5 or $6" is text here exactly
    // where it is text on screen. It is shown only the text before the next
    // backtick: the editor never scans inside `code`, and a `$` in a code span
    // must not close a formula that opened before it.
    scanMath(src.split('`')[0], 0, (from, to, latex, display) => {
      if (!hit && from === 0) hit = { to, latex, display }
    })
    const h = hit as { to: number; latex: string; display: boolean } | null
    return h ? { type: 'inlineMath', raw: src.slice(0, h.to), text: h.latex, display: h.display } : undefined
  },
  renderer: (t) => mathHtml(String(t.text), !!t.display)
}

/** A maths box: `$$` alone on a line, the formula, `$$` alone on a line. */
const blockMath: TokenizerAndRendererExtension = {
  name: 'blockMath',
  level: 'block',
  start: (src) => {
    const m = /(^|\n)\$\$[ \t]*\n/.exec(src)
    return m ? m.index + m[1].length : undefined
  },
  tokenizer(src) {
    const m = /^\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src)
    return m ? { type: 'blockMath', raw: m[0], text: m[1] } : undefined
  },
  renderer: (t) => `<div class="math-box">${mathHtml(String(t.text), true)}</div>\n`
}

const marked = new Marked({ gfm: true, breaks: true })
marked.use({ extensions: [wikiLink, inlineMath, blockMath] })

const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const MATH_FENCE = /^\s*\$\$\s*$/

/** The note without what a reader never sees: frontmatter, and the hidden
 *  ` ^k3x9` tag that ends a block (or sits alone under a table / box). Code and
 *  maths boxes are left exactly as written. */
export function cleanNoteText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence: string | null = null
  let maths = false
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const line = lines[i]
    const f = FENCE.exec(line)
    if (fence) {
      out.push(line)
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null
      continue
    }
    if (maths) {
      out.push(line)
      if (MATH_FENCE.test(line)) maths = false
      continue
    }
    if (f) {
      fence = f[1]
      out.push(line)
      continue
    }
    if (MATH_FENCE.test(line)) {
      maths = true
      out.push(line)
      continue
    }
    const tag = tagOf(line)
    if (!tag) out.push(line)
    else if (!tag.own) out.push(line.slice(0, tag.start).replace(/[ \t]+$/, ''))
    // an own-line tag is dropped whole
  }
  return out.join('\n')
}

/** The note's markdown as HTML — UNSANITISED. print/page.ts sanitises it. */
export function noteBodyHtml(text: string): string {
  return marked.parse(cleanNoteText(text), { async: false })
}

/** Does the note already open with a heading that says its name? Then the page
 *  doesn't add the name above it a second time. */
export function startsWithTitle(text: string, title: string): boolean {
  const first = cleanNoteText(text).split('\n').find((l) => l.trim() !== '')
  const m = first ? /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(first) : null
  return !!m && m[1].trim().toLowerCase() === title.trim().toLowerCase()
}
