import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { dirName, titleOf } from '../../../shared/links'
import { linkEnv, type LinkHandlersRef, type OpenHow } from './linkEnv'
import { linksAt, type ResolvedLink } from './wikiPass'
import { clickOrDrag } from './clickOrDrag'
import { finish, relinkOpen, startRelink } from './relink'

/** A Mac's Ctrl+click is its right-click, not the "open it here" of Windows. */
const IS_MAC = /Mac/.test(navigator.userAgent)

// Clicking and dragging a `[[link]]`. The editor had no DOM event handlers at all
// before this — everything else it does is a decoration.
//
// The gestures are the ones the tab strip and the sidebar already use, because a
// link is just another way of opening a note and should not need learning twice:
//
//   click            open it in a NEW TAB — the note you were reading stays open
//   Cmd/Ctrl+click   open it here instead, replacing this column's note
//   Alt+click        open it beside this one, in a new column
//   drag             drop it into any column (same protocol as dragging a tab)
//
// Plain click adds a tab rather than replacing, which is the opposite of the
// sidebar. Following a link is reading ONWARD from what you have — losing the
// note that sent you there is exactly the wrong thing — whereas clicking in the
// sidebar is choosing what to work on. Cmd/Ctrl is the escape hatch for when you
// really do mean "go there instead", inverted from the browser convention for
// the same reason.
//
// A folder link has no document to open, so it is SHOWN: the sidebar opens it
// and closes everything else, exactly as clicking it in the path bar does.

/** The link under a document position, if any. `pos` comes from
 *  `posAtDOM`/`posAtCoords`, so it is an offset into the real document — the
 *  marks the pass draws are styling, not a separate coordinate system. */
function linkAtPos(view: EditorView, pos: number): ResolvedLink | null {
  const env = view.state.field(linkEnv, false)
  if (!env) return null
  // Scanning the clicked line rather than the document: a link never spans a
  // line break, and a long note shouldn't be re-parsed on every click.
  const line = view.state.doc.lineAt(pos)
  for (const r of linksAt(env, line.text)) {
    if (line.from + r.link.from <= pos && pos <= line.from + r.link.to) return r
  }
  return null
}

const howFrom = (e: MouseEvent): OpenHow =>
  e.metaKey || e.ctrlKey ? 'replace' : e.altKey ? 'split' : 'tab'

/** Follow a link — the one place that decides what "open this" means, shared by
 *  the editor and (through App) the links block. */
export function followLink(r: ResolvedLink, how: OpenHow, handlers: LinkHandlersRef): void {
  const h = handlers.current
  if (!h) return
  if (r.self) {
    if (r.heading) h.jump(r.heading)
    return
  }
  if (r.isDir && r.path) {
    h.reveal(r.path)
    return
  }
  if (r.path) h.open(r.path, how, r.heading)
  else h.create(dirName(r.suggestedPath), titleOf(r.suggestedPath), how)
}

export function linkGestures(handlers: LinkHandlersRef): Extension {
  return [
    EditorView.domEventHandlers({
      // mousedown, not click: CodeMirror places the cursor on mousedown, and a
      // cursor landing inside the link would reveal its raw `[[…]]` at the same
      // moment we open the note — the text would flicker as the column changed
      // under it. Returning true tells CM we've handled it; clickOrDrag then
      // decides on mouseup whether it was a click or a drag.
      mousedown(e, view) {
        const el = (e.target as HTMLElement | null)?.closest?.('.cm-wikilink')
        if (!el) return false
        // A right press on a link — Ctrl+press on a Mac is one — must not select
        // a word of it: the browser does that before the menu event, and the
        // colour bar would come up over a link (see `contextmenu` below).
        if (e.button === 2 || (IS_MAC && e.ctrlKey && e.button === 0)) {
          e.preventDefault()
          return true
        }
        if (e.button !== 0) return false
        const pos = view.posAtDOM(el)
        const r = linkAtPos(view, pos)
        if (!r) return false
        // Opens on a click; a drag starting here selects the text instead.
        // (Dragging a link onto the tab strip to open it went, 2026-09-25 —
        // Reuben's call: selecting text is what a drag across words means.)
        const how = howFrom(e)
        clickOrDrag(e, view, () => followLink(r, how, handlers))
        return true
      },
      // Right-click: point the link somewhere else (relink.ts). No menu — that
      // is what right-clicking a link is for. The heading half opens the
      // picker on that note's headings; the note's name, on its folder.
      contextmenu(e, view) {
        const el = (e.target as HTMLElement | null)?.closest?.('.cm-wikilink')
        if (!el) return false
        const part = el.classList.contains('cm-wikilink-heading') ? 'heading' : 'target'
        // Another link is already being re-pointed: put that one back first.
        // That can move this link along the line — and under the pointer the
        // other link, grown back to full width, may now be what's there — so
        // this link's place is carried through the change, not re-read from
        // the screen.
        const before = view.posAtDOM(el)
        const moved = relinkOpen(view.state) ? finish(view) : null
        const pos = moved ? moved.mapPos(before, 1) : before
        const r = linkAtPos(view, pos)
        if (!r) return false
        e.preventDefault()
        handlers.current?.inspect(null)
        const line = view.state.doc.lineAt(pos)
        const link = { ...r.link, from: line.from + r.link.from, to: line.from + r.link.to }
        startRelink(view, link, part)
        return true
      },
      // Hovering a link in the text raises the same card the links strip does.
      // Not the browser's own `title` tooltip: that appears wherever the cursor
      // is after a delay the OS picks, which is neither "right under the thing"
      // nor consistent with the strip.
      mouseover(e, view) {
        const el = (e.target as HTMLElement | null)?.closest?.('.cm-wikilink')
        if (!el) return false
        const r = linkAtPos(view, view.posAtDOM(el))
        if (!r) return false
        const box = el.getBoundingClientRect()
        handlers.current?.inspect({
          kind: !r.path ? 'missing' : r.isDir ? 'folder' : 'out',
          title: r.link.text,
          path: r.path,
          suggestedPath: r.suggestedPath,
          space: r.space,
          emoji: r.emoji,
          cross: r.cross,
          ambiguous: r.ambiguous,
          // The line it sits in, same as a backlink chip shows.
          context: view.state.doc.lineAt(view.posAtDOM(el)).text.trim(),
          rect: { left: box.left, top: box.top, bottom: box.bottom }
        })
        return false
      },
      mouseout(e) {
        // `relatedTarget` inside the same link is the cursor moving between the
        // marks of one split link (target › heading), not leaving it.
        const to = e.relatedTarget as HTMLElement | null
        const from = (e.target as HTMLElement | null)?.closest?.('.cm-wikilink')
        if (from && to?.closest?.('.cm-wikilink') === from) return false
        handlers.current?.inspect(null)
        return false
      }
    })
  ]
}
