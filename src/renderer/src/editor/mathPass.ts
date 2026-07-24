import { Decoration, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import katex from 'katex'
import type { Pass } from './livePreview'

// LaTeX math via KaTeX. Block math is $$…$$, inline is $…$ (both valid CommonMark
// math, so files still render in Obsidian/GitHub). Off the cursor line the math is
// replaced with a rendered widget; on the cursor line the raw $…$ shows for editing.
class MathWidget extends WidgetType {
  constructor(
    readonly latex: string,
    readonly display: boolean
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.latex === this.latex && other.display === this.display
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.display ? 'cm-math cm-math-display' : 'cm-math'
    try {
      span.innerHTML = katex.renderToString(this.latex, { displayMode: this.display, throwOnError: false })
    } catch {
      span.className = 'math-error'
      const d = this.display ? '$$' : '$'
      span.textContent = d + this.latex + d
    }
    return span
  }
  ignoreEvent(): boolean {
    return false
  }
}

// Don't treat a $ inside code (or raw HTML) as a math delimiter.
const CODE_NODES = new Set([
  'InlineCode',
  'FencedCode',
  'CodeText',
  'CodeBlock',
  'CodeMark',
  'Comment',
  'HTMLBlock'
])
function inCode(node: SyntaxNode | null): boolean {
  for (let n = node; n; n = n.parent) if (CODE_NODES.has(n.name)) return true
  return false
}

// Scan for single-line $$…$$ and inline $…$, emitting absolute offsets. Multi-line
// $$ blocks are left raw (a ViewPlugin cannot replace across line breaks). Escaped
// \$ is skipped; inline delimiters may not be space-adjacent (so "$5 and $10" is
// not math).
function scanMath(
  text: string,
  base: number,
  emit: (from: number, to: number, latex: string, display: boolean) => void
): void {
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch !== '$') {
      i++
      continue
    }
    if (text[i + 1] === '$') {
      const close = text.indexOf('$$', i + 2)
      if (close === -1) {
        i += 2
        continue
      }
      const latex = text.slice(i + 2, close)
      if (latex.trim() && !latex.includes('\n')) emit(base + i, base + close + 2, latex, true)
      i = close + 2
      continue
    }
    const next = text[i + 1]
    if (next === undefined || next === ' ' || next === '\n' || next === '$') {
      i++
      continue
    }
    let j = i + 1
    let found = -1
    while (j < text.length) {
      const c = text[j]
      if (c === '\n') break
      if (c === '\\') {
        j += 2
        continue
      }
      if (c === '$') {
        found = j
        break
      }
      j++
    }
    if (found !== -1 && text[found - 1] !== ' ') {
      const latex = text.slice(i + 1, found)
      if (latex.trim()) {
        emit(base + i, base + found + 1, latex, false)
        i = found + 1
        continue
      }
    }
    i++
  }
}

/** Decoration pass (appended to livePreview's PASSES). */
export const mathPass: Pass = (view, active, push) => {
  const tree = syntaxTree(view.state)
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    scanMath(doc.sliceString(from, to), from, (mFrom, mTo, latex, display) => {
      if (active.has(doc.lineAt(mFrom).number)) return // reveal raw on the cursor line
      if (inCode(tree.resolveInner(mFrom, 1))) return
      push(mFrom, mTo, Decoration.replace({ widget: new MathWidget(latex, display) }), true)
    })
  }
}
