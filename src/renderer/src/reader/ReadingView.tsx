import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'

// The reading view: markdown -> HTML (marked) -> sanitised (DOMPurify) -> math
// typeset in place (KaTeX). Sanitising happens BEFORE the KaTeX HTML is inserted,
// so our own trusted math output is never stripped, while anything from the note
// body is cleaned. The colour syntax (<mark class="hl-*">, <span class="tc-*">)
// survives because `class`/`mark` are allowed.

function toSafeHtml(src: string): string {
  const raw = marked.parse(src, { async: false, gfm: true }) as string
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['mark'],
    ADD_ATTR: ['class', 'type', 'checked', 'disabled'],
    ALLOW_DATA_ATTR: false
  })
}

// display `$$…$$` first, then inline `$…$` (no newline, no bare `$`).
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$/g

/** Replace `$…$` / `$$…$$` in text nodes (never inside code/pre) with KaTeX. */
function typesetMath(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentElement; p; p = p.parentElement) {
        if (p.tagName === 'CODE' || p.tagName === 'PRE') return NodeFilter.FILTER_REJECT
      }
      return node.nodeValue && node.nodeValue.includes('$')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    }
  })
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text)

  for (const node of targets) {
    const text = node.nodeValue ?? ''
    MATH_RE.lastIndex = 0
    if (!MATH_RE.test(text)) continue
    MATH_RE.lastIndex = 0
    const frag = document.createDocumentFragment()
    let last = 0
    let m: RegExpExecArray | null
    while ((m = MATH_RE.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index))
      const display = m[1] != null
      const tex = (display ? m[1] : m[2]) ?? ''
      const span = document.createElement('span')
      span.className = display ? 'cm-math-display' : 'cm-math-inline'
      span.innerHTML = katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        errorColor: '#e5484d'
      })
      frag.append(span)
      last = m.index + m[0].length
    }
    if (last < text.length) frag.append(text.slice(last))
    node.replaceWith(frag)
  }
}

export function ReadingView({ source }: { source: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = toSafeHtml(source)
    typesetMath(el)
  }, [source])
  return <div className="prose-note" ref={ref} />
}
