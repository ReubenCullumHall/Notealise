import { Decoration } from '@codemirror/view'
import { hideDeco, type Pass } from './livePreview'
import { inlineTagPairs, TAGS } from './inlineTags'

// The plain inline HTML tags markdown has no syntax for: <u>, <sup>, <sub> and
// a bare <mark>. Same shape as colorPass beside it — pair each opening HTMLTag
// with its closing one, style the content, and hide the tags ALWAYS (2026-09-25;
// they used to come back under the cursor, which made selecting an underlined
// phrase to un-underline it jump about) — but for tags carrying no attributes,
// so colorPass's class/style parsing has nothing to say about them.
//
// Why this exists: `<u>` is what this app's own underline command writes, and
// the Word importer now also emits `<u>`, `<sup>` and `<sub>` rather than
// dropping that formatting. Without this pass the tags sit in the note as
// literal visible text — which is worse than losing the formatting, because
// every underlined heading in an imported document reads as `<u>Aim:</u>`.
const decoFor = new Map<string, Decoration>()
for (const [tag, cls] of Object.entries(TAGS)) decoFor.set(tag, Decoration.mark({ class: cls }))

export const inlineHtmlPass: Pass = (view, _active, push) => {
  for (const { from, to } of view.visibleRanges) {
    for (const p of inlineTagPairs(view.state, from, to)) {
      if (p.closeFrom <= p.openTo) continue // empty pair: nothing to style
      push(p.openTo, p.closeFrom, decoFor.get(p.tag)!, false)
      push(p.openFrom, p.openTo, hideDeco, true)
      push(p.closeFrom, p.closeTo, hideDeco, true)
    }
  }
}
