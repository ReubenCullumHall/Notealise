import katex from 'katex'

// What a table cell SHOWS when it isn't being edited (bug scan 2026-10-27). It
// used to be the raw text, so `**Waves**`, `[[Second]]`, `$E=mc^2$`, a
// highlight's `<mark …>` tag and `` `lens` `` all appeared as typed. Clicking a
// cell still opens the raw text for editing, exactly as before — this only
// changes the drawing.
//
// Built from DOM nodes, never from innerHTML of the cell's text: a cell is the
// user's file content and nothing in it may become live markup. KaTeX's own
// output is the one exception, and it is what the maths pass already inserts.

type Token = { re: RegExp; make: (m: RegExpExecArray) => Node }

const COLOUR_CLASS = /^(hl|tc)-[a-z]+$/
const HEX = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/

function wrap(tag: string, inner: string, cls?: string): HTMLElement {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  el.appendChild(formatCell(inner))
  return el
}

/** A colour tag's look, kept only when it is one this app writes. */
function colourTag(tag: 'mark' | 'span', attrs: string, inner: string): HTMLElement {
  const el = wrap(tag, inner)
  const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
  if (cls && COLOUR_CLASS.test(cls)) el.className = cls
  const style = /\bstyle\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? ''
  const bg = /background-color:\s*(#[0-9a-fA-F]{3,6})/i.exec(style)?.[1]
  const fg = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,6})/i.exec(style)?.[1]
  if (bg && HEX.test(bg)) el.style.backgroundColor = bg
  if (fg && HEX.test(fg)) el.style.color = fg
  return el
}

const TOKENS: Token[] = [
  { re: /<br\s*\/?>/iy, make: () => document.createElement('br') },
  { re: /`([^`]+)`/y, make: (m) => Object.assign(document.createElement('code'), { textContent: m[1] }) },
  {
    re: /\$([^\s$](?:[^$]*[^\s$])?)\$(?![0-9])/y,
    make: (m) => {
      const span = document.createElement('span')
      span.className = 'cm-math'
      span.innerHTML = katex.renderToString(m[1], { throwOnError: false, maxSize: 100 })
      return span
    }
  },
  { re: /\*\*(.+?)\*\*/y, make: (m) => wrap('strong', m[1]) },
  { re: /__(.+?)__/y, make: (m) => wrap('strong', m[1]) },
  { re: /~~(.+?)~~/y, make: (m) => wrap('s', m[1]) },
  { re: /\*([^*\s](?:[^*]*[^*\s])?)\*/y, make: (m) => wrap('em', m[1]) },
  { re: /_([^_\s](?:[^_]*[^_\s])?)_/y, make: (m) => wrap('em', m[1]) },
  {
    re: /\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/y,
    make: (m) => Object.assign(document.createElement('span'), { className: 'cm-wikilink', textContent: (m[2] || m[1]).trim() })
  },
  { re: /\[([^\]]+)\]\([^)\s]*\)/y, make: (m) => wrap('span', m[1], 'cm-weblink') },
  { re: /<u>(.*?)<\/u>/iy, make: (m) => wrap('u', m[1]) },
  { re: /<mark\b([^>]*)>(.*?)<\/mark>/iy, make: (m) => colourTag('mark', m[1], m[2]) },
  { re: /<span\b([^>]*)>(.*?)<\/span>/iy, make: (m) => colourTag('span', m[1], m[2]) }
]

/** One cell's text as formatted nodes. */
export function formatCell(text: string): DocumentFragment {
  const out = document.createDocumentFragment()
  let plain = ''
  const flush = (): void => {
    if (plain) out.appendChild(document.createTextNode(plain))
    plain = ''
  }
  let i = 0
  outer: while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      plain += text[i + 1] // an escaped character is just that character
      i += 2
      continue
    }
    for (const t of TOKENS) {
      t.re.lastIndex = i
      const m = t.re.exec(text)
      if (m) {
        flush()
        out.appendChild(t.make(m))
        i += m[0].length
        continue outer
      }
    }
    plain += text[i]
    i++
  }
  flush()
  return out
}
