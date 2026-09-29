import { Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { titleOf } from '../../../shared/links'
import { uniqueName } from '../links/model'
import { anchorOf, linkTargets, tagFor, targetAtLine } from './blockIds'
import { flashLines } from './blockFlash'
import { linkEnv, linkHandlersFacet, notifyUser } from './linkEnv'

// "Copy link to block" — right-click the six-dot grip beside the line you're on
// (Reuben, 2026-09-29: "like Notion"). The link goes on the clipboard as the
// same `[[Note#^k3x9]]` the `[[` picker writes, so pasting it into any note
// gives the link and nothing more has to be built for pasting.

/** Offer the menu for the line the cursor is on. Nothing is offered on a line
 *  there is nothing to link to (a blank line, or a table until stage 3). */
export function openBlockLinkMenu(view: EditorView, x: number, y: number): void {
  const handlers = view.state.facet(linkHandlersFacet)?.current
  const env = view.state.field(linkEnv, false)
  if (!handlers || !env?.path) return
  const n = view.state.doc.lineAt(view.state.selection.main.head).number
  const t = targetAtLine(view.state, n)
  if (!t) return
  handlers.menu(x, y, [
    {
      label: t.kind === 'heading' ? 'Copy link to heading' : 'Copy link to block',
      run: () => copyBlockLink(view, n)
    }
  ])
}

/** Put a link to the heading or block on line `n` on the clipboard, giving the
 *  block its tag first if it has none. The block lights up as it is copied, so
 *  you can see which one the link will land on — a list item, not the list. */
function copyBlockLink(view: EditorView, n: number): void {
  const env = view.state.field(linkEnv, false)
  if (!env?.path) return
  // Asked again rather than trusted from when the menu opened: the note may
  // have been edited while it was up.
  const t = targetAtLine(view.state, n)
  if (!t) return
  let id: string | null = null
  if (t.kind === 'block') {
    const tag = tagFor(view.state, t)
    // Not an undo step: the tag is invisible, so a Cmd+Z that took it away
    // would look like it did nothing — and it would break the link just copied.
    if (tag.changes) view.dispatch({ changes: tag.changes, annotations: Transaction.addToHistory.of(false) })
    id = tag.id
  }
  const name = uniqueName(env.notes, { path: env.path, title: titleOf(env.path), kind: 'note' })
  const link = '[[' + name + '#' + anchorOf(linkTargets(view.state), t, id) + ']]'
  const doc = view.state.doc
  flashLines(view, doc.line(t.line).from, doc.line(t.endLine).from)
  void copyText(link).then((ok) => {
    // back to the note: the menu, and the fallback's hidden box, both took focus
    view.focus()
    notifyUser(view.state, ok ? 'Link copied — paste it into any note' : "Couldn't copy the link")
  })
}

/** Put `text` on the clipboard.
 *
 *  `navigator.clipboard` is missing in the app itself — a packaged build loads
 *  from `file://`, which Chromium doesn't count as a secure context — so it
 *  works every time in the live server and never for a user (CLAUDE.md). The
 *  fallback, `execCommand('copy')`, copies whatever is SELECTED on the page, so
 *  it is given a hidden box holding just the link to select; copying the
 *  editor's own selection would put the wrong text on the clipboard. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // denied or unavailable — fall through to the selection-based copy
  }
  const box = document.createElement('textarea')
  box.value = text
  box.setAttribute('readonly', '')
  box.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(box)
  box.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  box.remove()
  return ok
}
