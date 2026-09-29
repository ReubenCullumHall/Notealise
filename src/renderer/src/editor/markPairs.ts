import { Annotation, type EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { inlineTagPairs } from './inlineTags'
import { scanLinks } from '../../../shared/links'

// Every inline style whose marks are hidden (bold, italic, strike, code, <u> and
// the other plain tags), as open/close pairs. Shared by markEditing.ts (keeps
// pairs whole while you edit) and formatCommands.ts (the toolbar toggles).

/** Carried by a format command's own transaction (the Bold/Underline/… toggles).
 *  Those rewrite marks on purpose, so the keep-pairs-whole mends — which exist
 *  for YOUR edits — must leave them alone: seeing a toggle replace a stretch of
 *  text containing another style's `</u>`, a mend read that tag as deleted and
 *  wrote it back a second time, and `here</u></u>` showed in the note. */
export const formatEdit = Annotation.define<boolean>()

export interface MarkPair {
  /** `StrongEmphasis` / `Emphasis` / `Strikethrough` / `InlineCode`, or `tag:u` etc. */
  kind: string
  openFrom: number
  openTo: number
  closeFrom: number
  closeTo: number
  /** `*` `**` `~~` spans: CommonMark rejects them with a space inside an edge. */
  flanked: boolean
}

const MD_SPANS: Record<string, boolean> = {
  Emphasis: true,
  StrongEmphasis: true,
  Strikethrough: true,
  InlineCode: false
}

export function markPairs(state: EditorState, from: number, to: number): MarkPair[] {
  const out: MarkPair[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (!(node.name in MD_SPANS)) return
      const first = node.node.firstChild
      const last = node.node.lastChild
      if (!first || !last || first.from === last.from) return
      if (!first.name.endsWith('Mark') || !last.name.endsWith('Mark')) return
      out.push({
        openFrom: node.from,
        openTo: first.to,
        closeFrom: last.from,
        closeTo: node.to,
        kind: node.name,
        flanked: MD_SPANS[node.name]
      })
    }
  })
  for (const p of inlineTagPairs(state, from, to)) out.push({ ...p, kind: 'tag:' + p.tag, flanked: false })
  return out
}

/** Things a style can only wrap whole, never cut into — inline code, links,
 *  images, `[[wiki links]]`: marks inside them are literal text (or break the
 *  link), which is exactly the raw code this app must never show. */
export function unsplittable(state: EditorState, from: number, to: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (['InlineCode', 'Link', 'Image', 'Autolink'].includes(node.name)) {
        out.push({ from: node.from, to: node.to })
        return false
      }
      return undefined
    }
  })
  // `[[wiki links]]` have no node of their own (the parser sees a bracketed span).
  for (const l of scanLinks(state.doc.sliceString(from, to), from)) out.push({ from: l.from, to: l.to })
  return out
}
