import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view'
import { linkEnv } from './linkEnv'

// Every editor currently on screen, so a drag that starts in one pane can find
// the others.
//
// A drag is the one gesture in this app that legitimately spans two editors:
// picking a paragraph up in the left column and dropping it into the right one
// is two documents, two transactions and two note paths. Everything else in
// `editor/` is scoped to the single view it was handed, and should stay that
// way — this exists so exactly one feature can look sideways, rather than
// threading a list of panes down through every extension that might one day
// want one.
//
// A Set of live views rather than anything App-owned: the views register
// themselves as they are created and drop out as they are destroyed, so it
// cannot go stale against a pane that has closed. React never has to remember
// to tell it anything.

const views = new Set<EditorView>()

/** Put this in the extension list and the view is findable while it lives. */
export const registerView = ViewPlugin.fromClass(
  class implements PluginValue {
    constructor(private readonly view: EditorView) {
      views.add(view)
    }
    destroy(): void {
      views.delete(this.view)
    }
  }
)

/** The editor under a point on screen, or null.
 *
 *  Hit-tested against `scrollDOM` rather than `view.dom`: the outer element
 *  includes chrome the drop should not count as "inside the text", and the
 *  scroller is exactly the area a boundary can be measured in. */
export function viewAtPoint(x: number, y: number): EditorView | null {
  for (const view of views) {
    const r = view.scrollDOM.getBoundingClientRect()
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return view
  }
  return null
}

/** The vault-relative path of the note a view is editing, or '' when it has
 *  none — the blank column ("Select a note") is a real editor over an empty
 *  document, and nothing may be dropped into a note that does not exist. */
export function notePathOf(view: EditorView): string {
  return view.state.field(linkEnv, false)?.path ?? ''
}
