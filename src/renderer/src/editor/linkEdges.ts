import { Prec, type EditorState } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { scanLinks } from '../../../shared/links'
import { isRaw } from './rawView'
import { inCode } from './mathPass'

// Backspace and Delete right beside a link (Reuben, 2026-09-27).
//
// A cursor sitting just outside a link no longer shows the link's code
// (livePreview.ts `cursorWithin` and wikiPass stopped counting the edges as
// "inside"). But the brackets and the address are hidden, and a hidden run is
// atomic, so the plain Backspace after `[label](url)` deleted the hidden `)`
// and left `[label](url` on screen — and after `[[Waves]]`, the hidden `]]`.
// Here, Backspace just after a link deletes the last letter you can SEE, and
// Delete just before one the first, with the link kept intact around them —
// the way a word processor edits a link's text. A link down to its last
// letter goes as a whole. Bare URLs have no hidden parts and need none of this.

/** A link drawn beside the cursor: its whole extent, and the part you can see. */
interface Drawn {
  from: number
  to: number
  textFrom: number
  textTo: number
}

function linkBeside(state: EditorState, pos: number, forward: boolean): Drawn | null {
  const tree = syntaxTree(state)
  // `[label](url)` and `<url>`
  for (let n: SyntaxNode | null = tree.resolveInner(pos, forward ? 1 : -1); n; n = n.parent) {
    if (n.name !== 'Link' && n.name !== 'Autolink') continue
    if ((forward ? n.from : n.to) !== pos) break
    const marks: { from: number; to: number }[] = []
    let hasUrl = n.name === 'Autolink'
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === 'LinkMark') marks.push({ from: c.from, to: c.to })
      if (c.name === 'URL') hasUrl = true
    }
    // A `[1]` with nowhere to point is plain text (livePreview leaves its
    // brackets showing), so ordinary Backspace is right for it.
    if (!hasUrl || marks.length < 2) break
    const textTo = n.name === 'Link' ? marks[1].from : marks[marks.length - 1].from
    return { from: n.from, to: n.to, textFrom: marks[0].to, textTo }
  }
  // `[[Note]]`, `[[Folder/Note]]`, `[[Note|alias]]`, `[[Note#Heading]]` — what
  // shows is worked out the way wikiPass works it out.
  const line = state.doc.lineAt(pos)
  for (const l of scanLinks(line.text, line.from)) {
    if ((forward ? l.from : l.to) !== pos) continue
    if (inCode(tree.resolveInner(l.from, 1))) continue
    const innerFrom = l.from + 2
    const innerTo = l.to - 2
    const inner = state.doc.sliceString(innerFrom, innerTo)
    let textFrom = innerFrom
    if (l.alias !== null) textFrom = innerFrom + inner.indexOf('|') + 1
    else {
      const hash = inner.indexOf('#')
      const slash = inner.lastIndexOf('/', hash === -1 ? inner.length : hash)
      if (slash !== -1) textFrom = innerFrom + slash + 1
    }
    return { from: l.from, to: l.to, textFrom, textTo: innerTo }
  }
  return null
}

const editBeside =
  (forward: boolean) =>
  (view: EditorView): boolean => {
    const { state } = view
    if (isRaw(state) || state.selection.ranges.length > 1 || !state.selection.main.empty) return false
    const head = state.selection.main.head
    const l = linkBeside(state, head, forward)
    if (!l) return false
    const whole = l.textTo - l.textFrom <= 1
    const changes = whole
      ? { from: l.from, to: l.to }
      : forward
        ? { from: l.textFrom, to: l.textFrom + 1 }
        : { from: l.textTo - 1, to: l.textTo }
    // The cursor stays beside the link: just after it (one letter shorter now)
    // for Backspace, just before it for Delete.
    const anchor = whole ? l.from : forward ? head : head - 1
    view.dispatch({
      changes,
      selection: { anchor },
      userEvent: forward ? 'delete.forward' : 'delete.backward',
      scrollIntoView: true
    })
    return true
  }

export const linkEdges = Prec.high(
  keymap.of([
    { key: 'Backspace', run: editBeside(false) },
    { key: 'Delete', run: editBeside(true) }
  ])
)
