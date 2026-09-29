import type { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { tagOf } from '../../../shared/blocks'
import { hideDeco, type Pass } from './livePreview'
import { inCode } from './mathPass'

// A block's link tag on screen: hidden, and the cursor kept in front of it
// (cursorSnap.ts). What a tag IS lives in shared/blocks.ts; where one goes in
// blockIds.ts.

/** Hides a block's tag. Never revealed — the user didn't type it, and Markdown
 *  pro is the one way to see it (livePreview.ts turns this hide into a faded
 *  mark there). Only a tag ENDING a line of text: one on a line of its own
 *  (Obsidian's form for tables and the like) stays visible until stage 3 can
 *  hide the whole line. */
export const blockTagPass: Pass = (view, _active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      const tag = tagOf(line.text)
      if (tag && !tag.own && !inCode(tree.resolveInner(line.to, -1))) {
        push(line.from + tag.start, line.to, hideDeco, true)
      }
      pos = line.to + 1
    }
  }
}

/** Where a line's hidden tag starts, or null. The cursor never goes past it —
 *  what you type must land before the tag, or the tag stops ending the block. */
export function tagStartOf(state: EditorState, lineFrom: number, lineText: string): number | null {
  const tag = tagOf(lineText)
  if (!tag || tag.own) return null
  if (inCode(syntaxTree(state).resolveInner(lineFrom + lineText.length, -1))) return null
  return lineFrom + tag.start
}
