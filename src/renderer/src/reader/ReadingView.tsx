import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'

// The reading view: markdown -> HTML (marked) -> sanitised (DOMPurify) -> math
// typeset in place (KaTeX). Sanitising happens BEFORE the KaTeX HTML is
// inserted, so the math markup is never stripped, while anything from the note
// body is cleaned. The colour syntax (<mark class="hl-*">, <span class="tc-*">)
// survives because `class`/`mark` are allowed.
//
// That ordering used to mean the KaTeX output was TRUSTED rather than checked —
// a sanitiser bypass by construction, because the one thing written into the
// DOM after the sanitiser ran was the one thing nothing had looked at. KaTeX is
// safe as configured (`trust` is unset, so \href and \includegraphics are
// disabled, and 32 payloads produced no anchor, image, id or on* attribute),
// but "safe as configured today" is exactly the assumption a future `trust:
// true`, or a KaTeX regression, would quietly break. So its output goes through
// DOMPurify too, with the MathML and SVG profiles it needs to survive.
//
// NOTE: this file is currently imported by nothing (app.css says so too). It is
// kept because the stack documents `marked` + `dompurify` as the reading-view
// renderer — but if it is ever wired up, read the CSP in electron.vite.config.ts
// first: this is the one component that would emit real <a href> elements, and
// main/index.ts's will-navigate guard is what stands behind it.

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
      span.innerHTML = DOMPurify.sanitize(
        katex.renderToString(tex, {
          displayMode: display,
          throwOnError: false,
          errorColor: '#e5484d',
          // See mathPass.ts: unset, this is Infinity, and one \rule is a
          // 500em-square element.
          maxSize: 100
        }),
        // KaTeX emits MathML alongside its HTML, and SVG for a few constructs;
        // without these profiles the sanitiser would strip the very output it
        // is here to check.
        { USE_PROFILES: { html: true, mathMl: true, svg: true } }
      )
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
