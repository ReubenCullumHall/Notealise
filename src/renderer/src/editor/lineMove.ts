import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view'
import { attachDragHandle, type DragSource } from './attachMove'
import { blockRange, canMoveBlock } from './blockMove'

// The six-dot grip beside the line you are on, for moving a paragraph up or
// down the note — the same handle a photo already has, and the same one the
// sidebar puts on a note or a folder row, so "grab it by the dots" means one
// thing everywhere in this app.
//
// ONE element, not a decoration per line. A `Decoration.line` on the active
// line would rebuild decorations on every cursor move and put a button inside
// CodeMirror's own content DOM; this keeps a single button parked over the
// editor and moves it, which costs nothing to reposition and cannot interfere
// with the passes in livePreview.ts.
//
// It lives in the 28px gutter `.cm-line` carries (highlight.ts), so it never
// shifts a character of text — CLAUDE.md's rule that nothing in the editor
// chrome may change layout by appearing.

const LINE_SOURCE: DragSource = {
  // The grip is always on the active line, so the live selection IS the answer
  // — `blockRange` reads it directly and `pos` is not needed. That also means a
  // selection made after the grip appeared is honoured, rather than whatever
  // was true when it was placed.
  rangeAt: (view) => (canMoveBlock(view.state) ? blockRange(view.state) : null),
  // A press with no drag selects the block. It is the cheapest way to find out
  // what the grip thinks it is holding before committing to a drag, and it
  // matches the embed grip, where a click also selects what would move.
  onClick: (view, _pos, range) => {
    view.dispatch({ selection: { anchor: range.from, head: range.to } })
    view.focus()
  },
  className: 'cm-line-grip',
  label: 'Drag to move this block up or down in the note'
}

/** How far into the gutter the grip sits. The gutter is 28px and the grip 20px,
 *  so 4px each side is all there is — enough to keep it off the text without
 *  pushing it out into the page margin, where it would be a long way from the
 *  line it acts on in a wide window. */
const GUTTER_INSET = 4

class LineGrip implements PluginValue {
  private readonly btn: HTMLElement
  private readonly onScroll: () => void

  constructor(private view: EditorView) {
    this.btn = attachDragHandle(view, LINE_SOURCE)
    this.btn.style.display = 'none'
    // On `.cm-editor` (which CodeMirror already makes a positioned element)
    // rather than inside `.cm-content`, whose children CodeMirror owns and
    // rebuilds. The cost is that it does not scroll on its own, which is what
    // the listener below is for.
    view.dom.appendChild(this.btn)
    this.onScroll = () => this.place()
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    this.place()
  }

  update(u: ViewUpdate): void {
    // `focusChanged` matters as much as the rest: the grip marks the line you
    // are working on, and with the editor unfocused there is no such line.
    if (u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged || u.focusChanged) {
      this.place()
    }
  }

  private place(): void {
    const view = this.view
    // Hidden while unfocused, and in a note too short to have anywhere to move
    // a block TO — a control that cannot do anything should not be offered.
    if (!view.hasFocus || !canMoveBlock(view.state)) {
      this.btn.style.display = 'none'
      return
    }
    const range = blockRange(view.state)
    const block = view.lineBlockAt(range.from)
    const top = block.top + view.documentTop
    const editor = view.dom.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()

    // Off the top or bottom of what is on screen — scrolled away rather than
    // absent, so it is hidden rather than pinned to an edge, where it would
    // point at a line that is not there.
    if (top < editor.top || top > editor.bottom) {
      this.btn.style.display = 'none'
      return
    }
    this.btn.style.display = ''
    this.btn.style.left = `${content.left - editor.left + GUTTER_INSET}px`
    // Centred on the FIRST line of the block, not on the block as a whole: a
    // four-line paragraph's midpoint is nowhere near the line the cursor is on,
    // and the grip is meant to read as belonging to where you are.
    const lineHeight = view.defaultLineHeight
    const gripHeight = this.btn.offsetHeight || 14
    this.btn.style.top = `${top - editor.top + (lineHeight - gripHeight) / 2}px`
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.btn.remove()
  }
}

export const lineMove = ViewPlugin.fromClass(LineGrip)
