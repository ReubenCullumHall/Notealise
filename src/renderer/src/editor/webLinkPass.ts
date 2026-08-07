import { Decoration, EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { overlapsSelection, type Pass } from './livePreview'

// Web links you can actually click. `[text](url)`, `<https://…>` and a bare
// `https://…` all get a `.cm-weblink` span carrying the target, and clicking
// one opens it in the real browser.
//
// The three shapes, verified against the real @lezer/markdown tree rather than
// assumed:
//   Link     > LinkMark "[" , text , LinkMark "]" , LinkMark "(" , URL , LinkMark ")"
//   Autolink > LinkMark "<" , URL , LinkMark ">"
//   URL                                        <- a bare GFM autolink, no parent
//
// markdownPass already hides the brackets and the URL of a `Link`, so what's
// left on screen is the label; this marks exactly that label. A bare URL is its
// own visible text, so it marks itself.
//
// The `data-href` + class idiom matches `.cm-wikilink` in linkGestures.ts, so
// both kinds of link are found the same way from a DOM event.

const decoCache = new Map<string, Decoration>()
function linkMark(url: string): Decoration {
  let d = decoCache.get(url)
  if (!d) {
    // The URL is passed to main, which re-checks the scheme before opening —
    // this attribute is a carrier, not a trust boundary.
    d = Decoration.mark({ class: 'cm-weblink', attributes: { 'data-href': url } })
    decoCache.set(url, d)
    // A note full of citations would otherwise grow this map forever.
    if (decoCache.size > 500) decoCache.clear()
  }
  return d
}

export const webLinkPass: Pass = (view, _active, push) => {
  const doc = view.state.doc
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'Link' || node.name === 'Autolink') {
          // Leave it alone while the cursor is in it: the raw markdown is
          // showing for editing, and marking it then would make the source
          // text itself clickable.
          if (overlapsSelection(view, node.from, node.to)) return
          let url = ''
          const marks: { from: number; to: number }[] = []
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name === 'URL') url = doc.sliceString(c.from, c.to)
            else if (c.name === 'LinkMark') marks.push({ from: c.from, to: c.to })
          }
          if (!url) return
          if (node.name === 'Autolink') {
            // `<url>` — the URL itself is what stays visible.
            const u = node.node.firstChild?.nextSibling
            if (u) push(u.from, u.to, linkMark(url), false)
            return
          }
          // `[label](url)` — the label sits between the first two LinkMarks.
          if (marks.length >= 2 && marks[1].from > marks[0].to) {
            push(marks[0].to, marks[1].from, linkMark(url), false)
          }
          return
        }

        if (node.name === 'URL') {
          // Only a BARE url — one inside a Link/Autolink is the parent's job,
          // and marking it twice would overlap ranges.
          const parent = node.node.parent
          if (parent && (parent.name === 'Link' || parent.name === 'Autolink')) return
          if (overlapsSelection(view, node.from, node.to)) return
          push(node.from, node.to, linkMark(doc.sliceString(node.from, node.to)), false)
        }
      }
    })
  }
}

/** Click a web link to open it in the real browser. Plain click follows, the
 *  same gesture a `[[wiki link]]` uses — there is only one thing an external
 *  link can do, so no modifier means anything different here. `mousedown` with
 *  preventDefault, so the click doesn't also drop a cursor into the text. */
export const webLinkGestures = EditorView.domEventHandlers({
  mousedown: (event, _view) => {
    if (event.button !== 0) return false
    const el = (event.target as HTMLElement | null)?.closest?.('.cm-weblink')
    const href = el?.getAttribute('data-href')
    if (!href) return false
    event.preventDefault()
    void window.api.openExternal(href)
    return true
  }
})
