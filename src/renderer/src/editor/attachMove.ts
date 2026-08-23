import { EditorView } from '@codemirror/view'
import { gripIcon } from './blockTable'
import { embedSpanAt, selectEmbed } from './attachSelect'

// Dragging an image/video embed to a different line in the note — the same
// grip-and-drag interaction blockTable.ts's column handle already uses
// (mousedown, track on `window` so the gesture survives leaving the element,
// a 4px threshold before it counts as a drag, a marker at the nearest
// boundary, one transaction on drop), applied to a whole LINE instead of a
// table column. Shared by imagePass and videoPass so this logic — and its
// drop-indicator — exist in exactly one place.
//
// The document is never touched mid-drag: only `mousemove`/`mouseup` run, and
// neither dispatches anything until drop. That's what keeps the widget
// rendered as a picture/player throughout the whole gesture instead of
// flipping into raw markdown — decorations only rebuild on
// `docChanged || selectionSet || viewportChanged`, and this drag causes none
// of those until the very last `dispatch`.

/** Builds the small grip button an image/video widget shows on hover. It takes
 *  no position: the line it acts on is resolved from the button's own DOM node
 *  at mousedown, which is both always current AND what frees ImageWidget /
 *  VideoWidget from rebuilding every time their line shifts. */
export function attachDragHandle(view: EditorView): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'cm-attach-grip'
  btn.setAttribute('aria-label', 'Drag to move up or down in the note')
  btn.dataset.tip = 'Drag to move'
  btn.appendChild(gripIcon())

  btn.addEventListener('mousedown', (start) => {
    if (start.button !== 0) return
    start.preventDefault()
    start.stopPropagation() // don't let imageClick/CM6 place a cursor here

    // Asked of the DOM at the moment of the gesture, rather than captured when
    // the widget was built. That swap is what lets ImageWidget/VideoWidget drop
    // their positions out of `eq()`: they used to carry from/to purely so a
    // widget whose line had shifted would be REBUILT and this closure re-made —
    // which meant typing anything above an embed tore down and recreated it, and
    // for a <video> that is a fresh element, a re-decode and a lost playback
    // position on every keystroke. `imageClick` already reads position this way.
    const doc = view.state.doc
    const startPos = Math.min(view.posAtDOM(btn), doc.length)
    // Captured here rather than at mouseup: a click selects THIS embed, and by
    // mouseup the button may no longer be the thing under the pointer.
    const span = embedSpanAt(view.state, startPos)
    const line = doc.lineAt(startPos)
    const isLast = line.number === doc.lines

    // The embed's own line, for the "dropped back where it started" check.
    const ownFrom = line.from
    const ownTo = isLast ? line.to : doc.line(line.number + 1).from

    // What actually gets cut. Normally the line plus the newline that follows
    // it. On the LAST line there is no trailing newline to take, so the one
    // that separated it from the line above is taken instead — cutting just
    // `line.from`–`line.to` left that newline dangling, so every move off the
    // last line added an empty line to the end of the note.
    const removeFrom = isLast && line.number > 1 ? doc.line(line.number - 1).to : ownFrom
    const removeTo = ownTo

    // One boundary at the top of every VISIBLE rendered block (dropping there
    // means "become the line right before this one") plus one past the last
    // block's bottom (means "become the new last line"). Only the viewport is
    // covered, same reasoning `imagePass` itself only decorates
    // `view.visibleRanges` — a drag is a viewport-scale gesture, not a
    // whole-document one.
    //
    // Rendered BLOCKS, not source lines, and that distinction is load-bearing:
    // a table is one block widget standing in for several source lines, whose
    // interiors have no height of their own. Walking source lines produced
    // boundaries inside a table's raw markdown — exactly the position
    // blockTable.ts warns about — which corrupts the table on the next parse.
    // `viewportLineBlocks` only ever names positions between blocks.
    let boundaries: { y: number; pos: number }[] = []
    // Measured lazily and re-measured whenever the view has scrolled: a wheel
    // scroll or an edge-autoscroll mid-drag moves the lines under the cursor,
    // and boundaries captured once at mousedown would silently desync from
    // what's on screen.
    let measuredScroll = Number.NaN
    let measuredViewport = -1
    const measure = (): void => {
      if (view.state.doc !== doc) return // see the abort in onUp
      const scroll = view.scrollDOM.scrollTop
      if (boundaries.length && scroll === measuredScroll && view.viewport.from === measuredViewport) return
      measuredScroll = scroll
      measuredViewport = view.viewport.from
      const docTop = view.documentTop
      const blocks = view.viewportLineBlocks
      boundaries = blocks.map((b) => ({ y: b.top + docTop, pos: b.from }))
      const last = blocks[blocks.length - 1]
      if (last) {
        const lastLine = doc.lineAt(Math.min(last.to, doc.length))
        boundaries.push({
          y: last.bottom + docTop,
          pos: lastLine.number < doc.lines ? doc.line(lastLine.number + 1).from : doc.length
        })
      }
    }
    measure()
    if (!boundaries.length) return // nothing measured (shouldn't happen — bail quietly)

    let moved = false
    let target = ownFrom
    let marker: HTMLElement | null = null
    let finished = false

    // ONE teardown, called from every way this gesture can end. It used to live
    // only inside the mouseup handler, so a button released outside the window
    // (an alt-tab, a modal stealing focus) left both listeners attached for
    // good — and the next drag then ran two of them at once, each dispatching
    // its own transaction against the same document.
    const cleanup = (): void => {
      if (finished) return
      finished = true
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', cleanup)
      window.removeEventListener('keydown', onKey)
      marker?.remove()
      marker = null
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cleanup() // abandon the drag, change nothing
    }

    const onMove = (m: MouseEvent): void => {
      if (!moved && Math.abs(m.clientY - start.clientY) < 4) return
      if (!moved) {
        moved = true
        marker = document.createElement('div')
        marker.className = 'cm-attach-drop-marker'
        document.body.appendChild(marker)
      }
      measure()
      if (!boundaries.length) return
      let best = boundaries[0]
      for (const b of boundaries) if (Math.abs(b.y - m.clientY) < Math.abs(best.y - m.clientY)) best = b
      target = best.pos
      if (marker) {
        const rect = view.dom.getBoundingClientRect()
        marker.style.top = `${best.y}px`
        marker.style.left = `${rect.left}px`
        marker.style.width = `${rect.width}px`
      }
    }

    const onUp = (): void => {
      const wasMoved = moved
      const dropAt = target
      cleanup()
      // A press with no drag is a CLICK, and a click selects the embed as one
      // object — which is what lets Backspace remove the whole thing rather
      // than one character of its source (see attachSelect).
      if (!wasMoved) {
        if (span) selectEmbed(view, span)
        return
      }
      // Dropping on either edge of the embed's own current line is not a
      // move — the boundary list always includes both, same as the table
      // always including a column's own two edges.
      if (dropAt === ownFrom || dropAt === ownTo) return
      // Every position here was recorded against the document as it stood at
      // mousedown. If the note has been reloaded since — a vault synced by
      // OneDrive with another device writing the same file is the realistic
      // case — they mean nothing against the new text, and dispatching them
      // anyway either scrambles the note or throws a RangeError nothing
      // catches. Abandoning the move is the only honest answer.
      if (view.state.doc !== doc) return

      // A drop landing strictly inside the span being cut isn't a position in
      // the resulting document at all. The two no-op checks above catch every
      // real case; this is the belt-and-braces one.
      if (dropAt > removeFrom && dropAt < removeTo) return

      const content = doc.sliceString(line.from, line.to)
      const atEnd = dropAt === doc.length && removeTo !== doc.length
      const insert = atEnd ? '\n' + content : content + '\n'
      // Two changes, both expressed against the ORIGINAL document — CM6
      // composes a non-overlapping multi-range ChangeSpec correctly on its
      // own, the same way a table rewrite is one transaction rather than a
      // remove-then-insert pair that could flash a half-moved state. They are
      // handed over in document order, and collapsed into ONE change when the
      // insert point is exactly where the cut begins (which happens when the
      // embed is on the last line and the line above it is empty) rather than
      // relying on how CM6 resolves two changes touching at a single point.
      view.dispatch({
        changes:
          dropAt === removeFrom
            ? { from: removeFrom, to: removeTo, insert }
            : dropAt < removeFrom
              ? [
                  { from: dropAt, to: dropAt, insert },
                  { from: removeFrom, to: removeTo, insert: '' }
                ]
              : [
                  { from: removeFrom, to: removeTo, insert: '' },
                  { from: dropAt, to: dropAt, insert }
                ]
      })
      view.focus()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', cleanup)
    window.addEventListener('keydown', onKey)
  })

  return btn
}
