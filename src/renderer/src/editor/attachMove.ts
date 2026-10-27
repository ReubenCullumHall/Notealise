import { EditorView } from '@codemirror/view'
import { gripIcon } from './blockTable'
import { embedSpanAt, selectEmbed } from './attachSelect'
import { createEdgeScroller } from '../edgeScroll'
import type { BlockRange } from './blockMove'
import { notePathOf, viewAtPoint } from './viewRegistry'
import { retargetEmbeds } from '../../../shared/attachments'
import { GHOST_MAX_PX, ghostBody, hideSource, showGhost, type Ghost } from './dragGhost'

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

/** What a grip picks up, and what a press with no drag means.
 *
 *  The gesture below — threshold, boundary marker, edge-scroll, one transaction
 *  on drop — is identical whether the thing being moved is a photo's line or a
 *  four-line paragraph. Only these two answers differ, so they are the only
 *  thing a caller supplies. */
export interface DragSource {
  /** the lines to move, resolved at mousedown from the grip's own position.
   *  Null abandons the gesture before it starts. */
  rangeAt: (view: EditorView, pos: number) => BlockRange | null
  /** a press that never became a drag */
  onClick?: (view: EditorView, pos: number, range: BlockRange) => void
  /** class on the button, so the two grips can be positioned differently */
  className: string
  /** for screen readers — the only thing that says what the six dots do */
  label: string
}

/** The media grip: one line, and a click selects the embed on it as one object.
 *  Exactly the behaviour this file had before it took a `DragSource` at all. */
export const EMBED_SOURCE: DragSource = {
  rangeAt: (view, pos) => {
    const line = view.state.doc.lineAt(pos)
    return { from: line.from, to: line.to }
  },
  onClick: (view, pos) => {
    const span = embedSpanAt(view.state, pos)
    if (span) selectEmbed(view, span)
  },
  className: 'cm-attach-grip',
  label: 'Drag to move up or down in the note'
}

/** Builds the small grip button an image/video widget shows on hover. It takes
 *  no position: the line it acts on is resolved from the button's own DOM node
 *  at mousedown, which is both always current AND what frees ImageWidget /
 *  VideoWidget from rebuilding every time their line shifts. */
/** Each drag's ghost is its own (dragGhost.ts `Ghost.id`). */
let ghostIds = 0

export function attachDragHandle(view: EditorView, source: DragSource = EMBED_SOURCE): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = source.className
  // aria-label but deliberately NO `data-tip`. Six dots in a grid is already
  // the universal "pick this up" handle, and the tooltip is bare text with no
  // panel behind it (Tooltip.tsx) — so floating over a note it inherited the
  // NOTE's typeface rather than the interface's, and read as stray serif text
  // sitting on the picture. The label stays for screen readers, which have no
  // other way to know what the button does.
  btn.setAttribute('aria-label', source.label)
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
    // Captured here rather than at mouseup: by then the button may no longer be
    // the thing under the pointer, and for the line grip the SELECTION this is
    // derived from may have moved on.
    const range = source.rangeAt(view, startPos)
    if (!range) return
    const firstLine = doc.lineAt(range.from)
    const lastLine = doc.lineAt(range.to)
    const isLast = lastLine.number === doc.lines

    // The block's own extent, for the "dropped back where it started" check.
    const ownFrom = firstLine.from
    const ownTo = isLast ? lastLine.to : doc.line(lastLine.number + 1).from

    // What actually gets cut. Normally the lines plus the newline that follows
    // them. On the LAST line there is no trailing newline to take, so the one
    // that separated it from the line above is taken instead — cutting just
    // `from`–`to` left that newline dangling, so every move off the last line
    // added an empty line to the end of the note.
    const removeFrom = isLast && firstLine.number > 1 ? doc.line(firstLine.number - 1).to : ownFrom
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
    // WHICH editor the pointer is over. Starts as the one the drag began in and
    // follows the pointer into another pane, which is what makes this a
    // transfer between notes rather than only a reorder inside one.
    let dropView = view
    // What the drop point shows instead of a line: the carried block, greyed, in
    // a gap at the drop point (dragGhost.ts). Made at the first move; `shown` is
    // where its gap is open right now, if anywhere. Up here because `measure`
    // reads it, and runs once straight away.
    let ghost: (Omit<Ghost, 'at'> & { fullHeight: number }) | null = null
    let shown: { view: EditorView; at: number; height: number } | null = null
    // The carried block's own place, closed up while its gap is open elsewhere:
    // where it starts and how tall it is, in the note's own coordinates as they
    // were before anything closed or opened.
    let gone: { top: number; h: number } | null = null

    // Every y here is measured from the top of the note (not the window), and as
    // the note stands with NO gap open and nothing closed up — so a boundary
    // keeps its number however the gap moves, and scrolling only changes what
    // the pointer's y converts to (`freeY`).
    let boundaries: { y: number; pos: number }[] = []
    // Measured lazily and re-measured whenever the view has scrolled: a wheel
    // scroll or an edge-autoscroll mid-drag moves the lines under the cursor,
    // and boundaries captured once at mousedown would silently desync from
    // what's on screen. `measuredView` joins them for the same reason — cross
    // into another pane and every boundary belongs to a different document.
    let measuredScroll = Number.NaN
    let measuredViewport = -1
    let measuredView: EditorView | null = null
    const measure = (): void => {
      const v = dropView
      // The source doc changing under us aborts the whole gesture (see onUp).
      // A DIFFERENT view's document is not ours to police.
      if (v === view && view.state.doc !== doc) return
      const scroll = v.scrollDOM.scrollTop
      if (
        boundaries.length &&
        v === measuredView &&
        scroll === measuredScroll &&
        v.viewport.from === measuredViewport
      ) {
        return
      }
      measuredView = v
      measuredScroll = scroll
      measuredViewport = v.viewport.from
      const vDoc = v.state.doc
      const blocks = v.viewportLineBlocks
      // Measured while the gap is open and the block's own place closed, every
      // line after the closed place sits `gone.h` higher and every line after the
      // gap `height` lower than in the note as it stands. Put both back, so a
      // boundary is where its line really is and the gap never moves the target
      // it is showing (dragGhost.ts).
      const gap = shown && shown.view === v ? shown : null
      const shut = gone && v === view ? gone : null
      const free = (pos: number, y: number, afterGap: boolean): number =>
        y + (shut && pos > firstLine.from ? shut.h : 0) - (gap && afterGap ? gap.height : 0)
      boundaries = blocks.map((b) => ({ y: free(b.from, b.top, !!gap && b.from > gap.at), pos: b.from }))
      const last = blocks[blocks.length - 1]
      if (last) {
        const lastLine = vDoc.lineAt(Math.min(last.to, vDoc.length))
        const pos = lastLine.number < vDoc.lines ? vDoc.line(lastLine.number + 1).from : vDoc.length
        const gapInside = !!gap && (gap.at <= last.from || (gap.at === pos && pos === vDoc.length && vDoc.lineAt(pos).from !== pos))
        boundaries.push({ y: free(pos, last.bottom, gapInside), pos })
      }
    }

    /** The pointer's y on screen → where it is in the note as it stands (the
     *  boundaries' coordinates), undoing the open gap and the closed-up place.
     *  Over the gap it is the gap's own boundary: the pointer is on the place it
     *  already shows. */
    const freeY = (clientY: number): number => {
      const y = clientY - dropView.documentTop
      const gap = shown && shown.view === dropView ? shown : null
      const gTop = gap ? boundaries.find((b) => b.pos === gap.at)?.y : undefined
      if (!gap || gTop === undefined) return y
      const H = gap.height
      const shut = gone && dropView === view ? gone : null
      if (!shut) return y >= gTop + H ? y - H : y >= gTop ? gTop : y
      const { top: S, h } = shut
      if (gTop >= S + h) {
        // the gap is below the closed place, which pulled it up by h
        const g = gTop - h
        return y < S ? y : y < g ? y + h : y <= g + H ? gTop : y + h - H
      }
      // the gap is above the closed place
      return y < gTop ? y : y <= gTop + H ? gTop : y < S + H ? y - H : y - H + h
    }
    measure()
    if (!boundaries.length) return // nothing measured (shouldn't happen — bail quietly)

    let moved = false
    let target = ownFrom
    let finished = false
    /** Alt held on the last move: a copy into another pane leaves the block where it is. */
    let copyHeld = false
    /** where the carried block starts, from the top of the note (see `gone`) */
    let srcTop = 0
    const showAt = (v: EditorView, at: number | null): void => {
      if (!ghost) return
      if (shown && (shown.view !== v || at === null) && shown.view.dom.isConnected) showGhost(shown.view, null)
      if (at === null) {
        shown = null
        return
      }
      showGhost(v, { id: ghost.id, height: ghost.height, body: ghost.body, at })
      shown = { view: v, at, height: ghost.height }
    }

    // Holding near the top or bottom of the editor scrolls it — the only way to
    // move a picture further than one screenful on a trackpad, where the
    // fingers that would scroll are the ones holding the drag. Declared above
    // `cleanup` because `cleanup` stops it, and a const referenced before its
    // own initialiser is a temporal-dead-zone throw waiting for the one path
    // that tears the drag down early.
    let lastY = start.clientY
    const scroller = createEdgeScroller(view.scrollDOM, () => place(lastY))

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
      window.removeEventListener('blur', abandon)
      window.removeEventListener('keydown', onKey)
      scroller.stop()
    }

    /** Close the gap and open the block's place again. Not part of `cleanup`: a
     *  drop does both in the same step as the move — the edit itself clears them
     *  (dragGhost.ts) — so the copy becomes the block without anything on screen
     *  moving. Every other ending calls this. */
    const clearShown = (): void => {
      showAt(dropView, null)
      if (view.dom.isConnected) hideSource(view, null)
      gone = null
    }

    const abandon = (): void => {
      cleanup()
      clearShown()
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') abandon() // abandon the drag, change nothing
    }

    /** Open the ghost's gap on the boundary nearest `y`. Split out of `onMove`
     *  because the edge-scroller has to call it too: while the pointer is held
     *  still in the scroll zone the document keeps moving under it, and nothing
     *  else would re-run this — the gap would sit on a line that had scrolled
     *  away. */
    const place = (y: number): void => {
      measure()
      if (!boundaries.length) return
      const at = freeY(y)
      let best = boundaries[0]
      for (const b of boundaries) if (Math.abs(b.y - at) < Math.abs(best.y - at)) best = b
      target = best.pos
      if (!moved || !ghost) return
      // On its own edges (or inside itself) it is not moving anywhere: no gap,
      // and the block back in its place.
      const home = dropView === view && target >= ownFrom && target <= ownTo
      // Its place closes up while it is carried — unless Alt is copying it into
      // another pane, when it stays.
      const closes = !home && !(copyHeld && dropView !== view)
      gone = closes ? { top: srcTop, h: ghost.fullHeight } : null
      hideSource(view, closes ? { from: firstLine.from, to: lastLine.to } : null)
      showAt(dropView, home ? null : target)
    }

    const onMove = (m: MouseEvent): void => {
      if (!moved && Math.abs(m.clientY - start.clientY) < 4) return
      copyHeld = m.altKey
      if (!moved) {
        moved = true
        // The block's own place and height where it is now, so the gap is its
        // size and its place can close up by exactly that much.
        srcTop = view.lineBlockAt(firstLine.from).top
        const full = Math.max(1, view.lineBlockAt(lastLine.to).bottom - srcTop)
        const height = Math.min(Math.round(full), GHOST_MAX_PX)
        ghost = { height, fullHeight: full, body: ghostBody(view, firstLine.from, lastLine.to, full > GHOST_MAX_PX), id: ++ghostIds }
      }
      // A pane with no note in it (the blank column) is not a place text can go,
      // so the pointer being over one leaves the target where it was rather than
      // offering a drop that would have nowhere to land.
      const over = viewAtPoint(m.clientX, m.clientY)
      if (over && over !== dropView && (over === view || notePathOf(over))) dropView = over
      lastY = m.clientY
      // Edge-scrolling always belongs to the pane being pointed at.
      scroller.retarget(dropView.scrollDOM)
      scroller.track(m.clientY)
      place(m.clientY)
    }

    // Whatever the drop does — a move, a copy, nothing at all — the gap and the
    // closed-up place go afterwards (a move has already taken them with it).
    const onUp = (up: MouseEvent): void => {
      try {
        drop(up)
      } finally {
        clearShown()
      }
    }

    const drop = (up: MouseEvent): void => {
      const wasMoved = moved
      const dropAt = target
      const into = dropView
      // Read at DROP, not at mousedown: you decide whether this is a move or a
      // copy while you are carrying it and can see where it would land.
      const copying = up.altKey
      cleanup()
      // A press with no drag is a CLICK, and what that means belongs to the
      // caller: for an embed it selects the picture as one object (which is
      // what lets Backspace remove the whole thing rather than one character of
      // its source — see attachSelect); for a line it selects the block.
      if (!wasMoved) {
        source.onClick?.(view, startPos, range)
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

      // --- into ANOTHER pane: two documents, one gesture ---------------------
      if (into !== view) {
        const to = notePathOf(into)
        const from = notePathOf(view)
        if (!to) return // the blank column has no note to write into
        const raw = doc.sliceString(firstLine.from, lastLine.to)
        // A picture's target is written relative to the note holding it, so text
        // arriving from another folder has to be re-pointed or the picture
        // silently stops loading. Same file on disk, new way of naming it —
        // which is the whole reason this is a re-point and not a copy.
        const text = retargetEmbeds(raw, from, to)
        const intoDoc = into.state.doc
        const at = Math.min(dropAt, intoDoc.length)
        const atEnd = at === intoDoc.length && at > 0
        into.dispatch({
          changes: { from: at, to: at, insert: atEnd ? '\n' + text : text + '\n' },
          // Land the cursor on what just arrived: the pane you dropped into is
          // where your attention is, and it is the only feedback that says the
          // transfer went where you meant.
          selection: { anchor: atEnd ? at + 1 : at },
          scrollIntoView: true
        })
        // Alt keeps the original. Otherwise this is a transfer, and the source
        // gives it up — one dispatch per document, because they are separate
        // documents with separate undo histories.
        if (!copying) view.dispatch({ changes: { from: removeFrom, to: removeTo, insert: '' } })
        into.focus()
        return
      }

      // Alt inside ONE pane would be a duplicate a few lines from its original,
      // which is not something anybody drags to achieve. Left as a plain move.

      // A drop landing strictly inside the span being cut isn't a position in
      // the resulting document at all. The two no-op checks above catch every
      // real case; this is the belt-and-braces one.
      if (dropAt > removeFrom && dropAt < removeTo) return

      const content = doc.sliceString(firstLine.from, lastLine.to)
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
    window.addEventListener('blur', abandon)
    window.addEventListener('keydown', onKey)
  })

  return btn
}
