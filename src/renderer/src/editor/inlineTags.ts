import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

// Finding and pairing the attribute-free inline HTML tags (<u>, <sup>, <sub>,
// <mark>). Its own module, like colorTags.ts, because two things need it:
// inlineHtmlPass (hides + styles them) and markEditing (keeps them whole).
// Keeping it free of livePreview is what stops a circular import.

/** Tag name -> the class its content is styled with. */
export const TAGS: Record<string, string> = {
  u: 'cm-u',
  sup: 'cm-sup',
  sub: 'cm-sub',
  mark: 'cm-mark'
}

export interface TagPair {
  tag: string
  openFrom: number
  openTo: number
  closeFrom: number
  closeTo: number
}

/** Every matched `<u>…</u>`-style pair in [from, to). Shared with
 *  markEditing.ts, which keeps these pairs whole now that they are never shown. */
export function inlineTagPairs(state: EditorState, from: number, to: number): TagPair[] {
  const doc = state.doc
  const out: TagPair[] = []
  interface Open {
    tag: string
    openStart: number
    contentStart: number
  }
  const stack: Open[] = []
  syntaxTree(state).iterate({
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
        out.push({ tag, openFrom: o.openStart, openTo: o.contentStart, closeFrom: node.from, closeTo: node.to })
        break
      }
    }
  })
  return out
}
