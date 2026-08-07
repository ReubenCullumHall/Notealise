import { Decoration } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { hideDeco, overlapsSelection, type Pass } from './livePreview'

// The plain inline HTML tags markdown has no syntax for: <u>, <sup>, <sub> and
// a bare <mark>. Same shape as colorPass beside it — pair each opening HTMLTag
// with its closing one, style the content, hide the tags off the cursor — but
// for tags carrying no attributes, so colorPass's class/style parsing has
// nothing to say about them.
//
// Why this exists: `<u>` is what this app's own underline command writes, and
// the Word importer now also emits `<u>`, `<sup>` and `<sub>` rather than
// dropping that formatting. Without this pass the tags sit in the note as
// literal visible text — which is worse than losing the formatting, because
// every underlined heading in an imported document reads as `<u>Aim:</u>`.
const TAGS: Record<string, string> = {
  u: 'cm-u',
  sup: 'cm-sup',
  sub: 'cm-sub',
  mark: 'cm-mark'
}

const decoFor = new Map<string, Decoration>()
for (const [tag, cls] of Object.entries(TAGS)) decoFor.set(tag, Decoration.mark({ class: cls }))

export const inlineHtmlPass: Pass = (view, _active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  interface Open {
    tag: string
    openStart: number
    contentStart: number
  }
  const stack: Open[] = []

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'HTMLTag') return
        const text = doc.sliceString(node.from, node.to)

        // Opening tag, attribute-free only: `<mark class="hl-amber">` belongs to
        // colorPass, and claiming it here would fight over the same range.
        const open = /^<([a-z]+)>$/.exec(text)
        if (open && TAGS[open[1]]) {
          stack.push({ tag: open[1], openStart: node.from, contentStart: node.to })
          return
        }

        const close = /^<\/([a-z]+)>$/.exec(text)
        if (!close || !TAGS[close[1]]) return
        const tag = close[1]
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag !== tag) continue
          const o = stack[i]
          stack.splice(i, 1)
          if (node.from > o.contentStart) {
            push(o.contentStart, node.from, decoFor.get(tag)!, false)
            // One check across the whole pair, so typing on past a closing tag
            // re-conceals both — not just the one sharing the cursor's line.
            if (!overlapsSelection(view, o.openStart, node.to)) {
              push(o.openStart, o.contentStart, hideDeco, true)
              push(node.from, node.to, hideDeco, true)
            }
          }
          break
        }
      }
    })
  }
}
