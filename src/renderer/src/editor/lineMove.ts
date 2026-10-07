import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view'
import { attachDragHandle, type DragSource } from './attachMove'
import { blockRange, canMoveBlock } from './blockMove'
import { openBlockLinkMenu } from './copyBlockLink'

// The six-dot grip beside the line you are on — or, since 2026-10-06, the line
// the POINTER is over (Reuben: "make sure there's a selector for every line") —
// for moving a paragraph up or down the note — the same handle a photo already has, and the same one the
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

/** The line each editor's grip is on RIGHT NOW when it is following the pointer;
 *  null when it is on the cursor's line. Read at the moment of a press, which is
 *  why it is kept here rather than captured when the grip was placed. */
const targets = new WeakMap<EditorView, number | null>()

const LINE_SOURCE: DragSource = {
  // The line the grip is on, asked of `blockRange` at the moment of the press: the
  // pointer's line while it is hovering one, else the cursor's — where the live
  // selection is the answer, so a selection made after the grip appeared is
  // honoured rather than whatever was true when it was placed.
  rangeAt: (view) =>
    canMoveBlock(view.state) ? blockRange(view.state, targets.get(view) ?? undefined) : null,
  // A press with no drag selects the block. It is the cheapest way to find out
  // what the grip thinks it is holding before committing to a drag, and it
  // matches the embed grip, where a click also selects what would move.
  onClick: (view, _pos, range) => {
    view.dispatch({ selection: { anchor: range.from, head: range.to } })
    view.focus()
  },
  className: 'cm-line-grip',
  label: 'Drag to move this block up or down in the note. Right-click to copy a link to it'
}

/** How far into the gutter the grip sits. The gutter is 28px and the grip 20px,
 *  so 4px each side is all there is — enough to keep it off the text without
 *  pushing it out into the page margin, where it would be a long way from the
 *  line it acts on in a wide window. */
const GUTTER_INSET = 4

/** What the grip should look like, worked out from the layout (read phase) and
 *  applied afterwards (write phase). */
type Placement = { show: false } | { show: true; left: number; top: number; hover: boolean }

class LineGrip implements PluginValue {
  private readonly btn: HTMLElement
  private readonly onScroll: () => void
  private readonly onMove: (e: MouseEvent) => void
  private readonly onLeave: () => void
  /** where the pointer last was over the editor, or null when it is not over it */
  private pointer: { x: number; y: number } | null = null
  /** One object, so a burst of requests is one measurement. */
  private readonly measurer = {
    read: (): Placement => this.read(),
    write: (p: Placement): void => this.write(p)
  }

  constructor(private view: EditorView) {
    this.btn = attachDragHandle(view, LINE_SOURCE)
    this.btn.style.display = 'none'
    // On `.cm-editor` (which CodeMirror already makes a positioned element)
    // rather than inside `.cm-content`, whose children CodeMirror owns and
    // rebuilds. The cost is that it does not scroll on its own, which is what
    // the listener below is for.
    view.dom.appendChild(this.btn)
    // Right-click: "Copy link to block" (copyBlockLink.ts). The press itself is
    // kept from taking focus, or the editor would blur, the grip would hide
    // under the pointer and the menu would open beside nothing.
    this.btn.addEventListener('mousedown', (e) => {
      if (e.button === 2) e.preventDefault()
    })
    this.btn.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      openBlockLinkMenu(view, e.clientX, e.clientY, targets.get(view) ?? undefined)
    })
    this.onScroll = () => this.place()
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    // Follow the pointer onto any line. A press moves nothing: while a button is
    // down the pointer is selecting text or dragging this very grip, and a grip
    // that jumped about under that would be wrong in both.
    this.onMove = (e) => {
      if (e.buttons) return
      this.pointer = { x: e.clientX, y: e.clientY }
      this.place()
    }
    this.onLeave = () => {
      this.pointer = null
      this.place()
    }
    view.dom.addEventListener('mousemove', this.onMove)
    view.dom.addEventListener('mouseleave', this.onLeave)
    this.place()
  }

  update(u: ViewUpdate): void {
    // `focusChanged` matters as much as the rest: the grip marks the line you
    // are working on, and with the editor unfocused there is no such line.
    if (u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged || u.focusChanged) {
      this.place()
    }
  }

  /** Ask for the grip to be put where it belongs, once the layout is settled.
   *
   *  Never measured on the spot: CodeMirror refuses layout reads while it is
   *  UPDATING ("Reading the editor layout isn't allowed during an update" — which
   *  `update()` above is), and a plugin that throws is switched off for good. The
   *  first version of the follow-the-pointer grip read the line under the pointer
   *  right there, so typing with the pointer over the note killed the grip for the
   *  rest of the session (found 2026-10-06). `requestMeasure` runs `read` after the
   *  update and `write` after that, and batches however many requests came in. */
  private place(): void {
    this.view.requestMeasure(this.measurer)
  }

  /** The start of the line under the pointer, or null when it is not over the
   *  text. The gutter the grip sits in is INSIDE the content box, so crossing
   *  from the words to the grip never leaves it. */
  private hoverPos(): number | null {
    const p = this.pointer
    if (!p) return null
    const content = this.view.contentDOM.getBoundingClientRect()
    if (p.x < content.left - 8 || p.x > content.right) return null
    const y = p.y - this.view.documentTop
    if (y < 0 || y > this.view.contentHeight) return null
    return this.view.lineBlockAtHeight(y).from
  }

  private read(): Placement {
    const view = this.view
    const hover = this.hoverPos()
    targets.set(view, hover)
    // On the cursor's line only while the editor has focus; on the pointer's line
    // always. Hidden in a note too short to have anywhere to move a block TO — a
    // control that cannot do anything should not be offered.
    if ((hover === null && !view.hasFocus) || !canMoveBlock(view.state)) return { show: false }
    const range = blockRange(view.state, hover ?? undefined)
    const block = view.lineBlockAt(range.from)
    const top = block.top + view.documentTop
    const editor = view.dom.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()

    // Off the top or bottom of what is on screen — scrolled away rather than
    // absent, so it is hidden rather than pinned to an edge, where it would
    // point at a line that is not there.
    if (top < editor.top || top > editor.bottom) return { show: false }
    // Centred on the FIRST line of the block, not on the block as a whole: a
    // four-line paragraph's midpoint is nowhere near the line the cursor is on,
    // and the grip is meant to read as belonging to where you are.
    const lineHeight = view.defaultLineHeight
    const gripHeight = this.btn.offsetHeight || 14
    return {
      show: true,
      left: content.left - editor.left + GUTTER_INSET,
      top: top - editor.top + (lineHeight - gripHeight) / 2,
      hover: hover !== null
    }
  }

  private write(p: Placement): void {
    if (!p.show) {
      this.btn.style.display = 'none'
      return
    }
    this.btn.style.display = ''
    this.btn.classList.toggle('is-hover', p.hover)
    this.btn.style.left = `${p.left}px`
    this.btn.style.top = `${p.top}px`
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    this.view.dom.removeEventListener('mousemove', this.onMove)
    this.view.dom.removeEventListener('mouseleave', this.onLeave)
    targets.delete(this.view)
    this.btn.remove()
  }
}

export const lineMove = ViewPlugin.fromClass(LineGrip)
