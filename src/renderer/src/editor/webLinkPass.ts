import { Decoration, EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { cursorWithin, type Pass } from './livePreview'
import { clickOrDrag } from './clickOrDrag'
import { docLinkTarget, isDocFilename } from '../../../shared/attachments'
import { parseVideoUrl } from '../../../shared/embeds'
import { linkEnv, notifyUser } from './linkEnv'

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

/** A link that is a path to a document beside the note — `[Slides.pdf](Slides.pdf)`
 *  — rather than a web address. Judged on the text alone (no scheme, a document's
 *  extension); whether it really is a file in the vault is decided at click time. */
function isFileHref(url: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return false
  let decoded = url
  try {
    decoded = decodeURIComponent(url)
  } catch {
    // a stray % — judge it as written
  }
  return isDocFilename(decoded)
}

/** A Mac's Ctrl+click is its right-click (linkGestures.ts says the same). */
const IS_MAC = /Mac/.test(navigator.userAgent)

const decoCache = new Map<string, Decoration>()
/** `labelled`: the words of a `[title](address)` link, as opposed to a bare
 *  address. A YouTube or Vimeo title is drawn as a MENTION — the title with the
 *  site's logo in front (app.css) — and a bare address stays just an address. */
function linkMark(url: string, labelled = false): Decoration {
  const key = (labelled ? '[]' : '') + url
  let d = decoCache.get(key)
  if (!d) {
    // The URL is passed to main, which re-checks the scheme before opening —
    // this attribute is a carrier, not a trust boundary. A document link wears
    // a second class so it can look like a file rather than a web page.
    const video = labelled ? parseVideoUrl(url) : null
    d = Decoration.mark({
      class: isFileHref(url)
        ? 'cm-weblink cm-filelink'
        : video
          ? `cm-weblink cm-weblink-video cm-weblink-${video.provider}`
          : 'cm-weblink',
      attributes: { 'data-href': url }
    })
    decoCache.set(key, d)
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
          // Leave it alone while the cursor is in it (a cursor, not a drag-
          // selection passing over it): the raw markdown is
          // showing for editing, and marking it then would make the source
          // text itself clickable.
          if (cursorWithin(view, node.from, node.to)) return
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
            push(marks[0].to, marks[1].from, linkMark(url, true), false)
          }
          return
        }

        if (node.name === 'URL') {
          // Only a BARE url — one inside a Link/Autolink is the parent's job,
          // and marking it twice would overlap ranges.
          const parent = node.node.parent
          if (parent && (parent.name === 'Link' || parent.name === 'Autolink')) return
          if (cursorWithin(view, node.from, node.to)) return
          push(node.from, node.to, linkMark(doc.sliceString(node.from, node.to)), false)
        }
      }
    })
  }
}

/** Click a web link to open it in the real browser — or a link to a document
 *  beside the note to open it in its own app (Preview, Word…). Plain click
 *  follows, the same gesture a `[[wiki link]]` uses — there is only one thing a
 *  link of either kind can do, so no modifier means anything different here. A
 *  drag that starts on one selects text instead (clickOrDrag.ts). */
export const webLinkGestures = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const el = (event.target as HTMLElement | null)?.closest?.('.cm-weblink')
    const href = el?.getAttribute('data-href')
    if (!href) return false
    // A right press — Ctrl+press on a Mac is one — must not select a word of the
    // link: the browser does that before the menu event, and the colour bar would
    // come up over it. The list a right-click opens is pasteLink.ts's.
    if (event.button === 2 || (IS_MAC && event.ctrlKey && event.button === 0)) {
      event.preventDefault()
      return true
    }
    if (event.button !== 0) return false
    // Opens on a click; a drag starting here selects the text instead.
    const file = docLinkTarget(href, view.state.field(linkEnv, false)?.path ?? '')
    if (file) {
      clickOrDrag(event, view, () => {
        const name = file.slice(file.lastIndexOf('/') + 1)
        void window.api
          .openVaultFile(file)
          .then((ok) => {
            if (!ok) notifyUser(view.state, `Couldn't open ${name}. It may have been moved or deleted.`)
          })
          .catch(() => notifyUser(view.state, `Couldn't open ${name}.`))
      })
    } else {
      clickOrDrag(event, view, () => void window.api.openExternal(href))
    }
    return true
  }
})
