import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { isRaw } from './rawView'
import {
  MIN_COLS,
  moveColumn,
  padRows,
  parseAlign,
  readCell,
  removeColumn,
  removeRow,
  resizeColumns,
  resizeRows,
  serializeTable,
  setAlign,
  setCell,
  splitRow,
  type Align,
  type TableModel
} from './tableModel'

// GFM tables, drawn as real tables — ALWAYS, including while the cursor is in
// them — and edited a cell at a time.
//
// A StateField and NOT a pass in livePreview.ts's PASSES, for exactly the reason
// blockMath.ts spells out: a table spans line breaks, replacing those needs
// `block: true`, and CM6 does not allow a ViewPlugin to provide block
// decorations. The other half of that contract matters just as much: a block
// replacement's range must cover WHOLE lines — from a line start to the start of
// the line after — so it ends at `doc.line(last + 1).from`, not at the table
// node's own `to`.
//
// WHY THE PIPES NEVER SHOW ANY MORE. This used to bail out whenever the
// selection touched the table (`touchesSelection`), handing you the raw
// `| --- |` source the moment you tried to change anything — which is the thing
// the whole feature was asked to fix. Now the widget is always drawn and a cell
// becomes an `<input>` on click. Nothing in the editor ever shows a pipe.
//
// **Cells come from slicing the line, NOT from `TableCell` nodes.** Verified
// against the real @lezer/markdown tree, and this is the trap: an EMPTY cell
// produces no `TableCell` node at all, only the `TableDelimiter` pipes either
// side of it. Collecting `TableCell` children — what this file did while the
// table was read-only — reads `| a |  | c |` back as two cells, so `c` moves
// into column 2. Drawing that wrong was cosmetic; WRITING it back deletes a
// column out of the user's file. `splitRow` splits on unescaped pipes instead,
// which is the same reason the tree was used in the first place (`\|` is a
// literal pipe, not a boundary).
//
// A LINE DIRECTLY UNDER A TABLE IS PART OF IT. Not a quirk of this app — GFM
// continues a table until a blank line, so `after` written straight beneath one
// is parsed as a one-cell row and GitHub renders it as a row too. The widget
// therefore draws it as a row, and writing the block back turns it into an
// explicit `| after |  |`. That is the same table either way, but it IS a
// visible change to a line the user didn't touch, so: `/table` inserts a blank
// line after itself precisely to keep the next thing you type out of the table.
//
// Node shape, verified rather than assumed:
//   Table > TableHeader                  <- the header LINE
//         > TableDelimiter               <- the |:---|---:| line; alignment lives here
//         > TableRow*                    <- each body LINE
// (`TableDelimiter` also names the single `|` characters inside a header/row, so
// only a DIRECT child of `Table` is the alignment line.)

/** Which cell, in which table, is currently open for editing. `row === -1` is
 *  the header. `table` is the document position the table starts at, which is
 *  what survives a rewrite: committing a cell replaces the block from exactly
 *  that offset, so it never moves. */
interface EditTarget {
  table: number
  row: number
  col: number
}

const setEditCell = StateEffect.define<EditTarget | null>()

/** Cross-transaction, because Tab has to open the *next* cell after the edit it
 *  just committed has been written — by which point the widget has been rebuilt
 *  and the old `<input>` is gone. Local DOM state cannot survive that; a
 *  StateField can. */
const editCell = StateField.define<EditTarget | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEditCell)) return e.value
    if (!value) return null
    // A change elsewhere in the note must not leave this pointing into the
    // middle of what is now a different table.
    if (tr.docChanged) return { ...value, table: tr.changes.mapPos(value.table, -1) }
    return value
  }
})

interface FoundTable {
  /** start of the first line */
  from: number
  /** end of the LAST line, with no trailing newline — the range a rewrite
   *  replaces. Distinct from `blockTo` on purpose: replacing the newline too
   *  would weld the table to the paragraph beneath it. */
  to: number
  /** start of the following line — what a block decoration must end at */
  blockTo: number
  model: TableModel
}

function findTables(state: EditorState): FoundTable[] {
  const doc = state.doc
  const out: FoundTable[] = []

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const firstLine = doc.lineAt(node.from).number
      const lastLine = doc.lineAt(node.to).number

      let header: string[] = []
      let align: ReturnType<typeof parseAlign> = []
      const rows: string[][] = []

      for (let c = node.node.firstChild; c; c = c.nextSibling) {
        const text = doc.sliceString(c.from, c.to)
        if (c.name === 'TableHeader') header = splitRow(text).map(readCell)
        else if (c.name === 'TableDelimiter') align = parseAlign(text)
        else if (c.name === 'TableRow') rows.push(splitRow(text).map(readCell))
      }
      if (!header.length) return // not a table this app can draw or write back

      out.push({
        from: doc.line(firstLine).from,
        to: doc.line(lastLine).to,
        blockTo: lastLine < doc.lines ? doc.line(lastLine + 1).from : doc.line(lastLine).to,
        model: padRows({ header, align, rows })
      })
    }
  })
  return out
}

class TableWidget extends WidgetType {
  /** Set inside `toDOM`; disconnects the `ResizeObserver` that keeps the
   *  column-handle/alignment overlays lined up with their header cells. */
  private cleanup: (() => void) | null = null

  constructor(
    readonly model: TableModel,
    readonly from: number,
    readonly to: number,
    /** the cell open for editing in THIS table, if any */
    readonly edit: { row: number; col: number } | null
  ) {
    super()
  }

  eq(other: TableWidget): boolean {
    return this.key() === other.key()
  }

  private key(): string {
    // `from`/`to` are in here so a table that merely moved is rebuilt: its
    // handlers close over those offsets to write back to the right place.
    return JSON.stringify([this.model, this.from, this.to, this.edit])
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table'
    const table = document.createElement('table')

    /** The open input, if this render has one. Held so that clicking straight
     *  from one cell to another commits the first — mousedown is prevented (to
     *  stop CodeMirror placing a cursor), and a prevented mousedown means no
     *  focus change and therefore no `blur` to commit on. */
    let open: { input: HTMLTextAreaElement; row: number; col: number } | null = null
    let done = false

    /** Write `text` into (row, col) and optionally open another cell, in ONE
     *  transaction. One, because two would put a frame on screen with the table
     *  rewritten and no cell open — a visible flicker on every Tab. */
    const commit = (row: number, col: number, text: string, then: EditTarget | null): void => {
      if (done) return
      done = true
      const next = setCell(this.model, row, col, text)
      const serialized = serializeTable(next, view.state.lineBreak)
      const unchanged = serialized === view.state.sliceDoc(this.from, this.to)
      view.dispatch({
        ...(unchanged ? {} : { changes: { from: this.from, to: this.to, insert: serialized } }),
        effects: setEditCell.of(then),
        // The document owns the text; the cursor has no business inside a block
        // that renders as a widget, so park it at the table's start.
        selection: { anchor: this.from }
      })
      if (!then) view.focus()
    }

    /** Move `by` cells, wrapping at the ends of rows. Returns null past either
     *  end, which simply closes the editor — growing the table on Tab is the
     *  next stage's job, not something to guess at here. */
    const step = (row: number, col: number, by: 1 | -1): EditTarget | null => {
      let r = row
      let c = col + by
      if (c >= this.model.header.length) {
        c = 0
        r += 1
      } else if (c < 0) {
        c = this.model.header.length - 1
        r -= 1
      }
      if (r < -1 || r >= this.model.rows.length) return null
      return { table: this.from, row: r, col: c }
    }

    const openCell = (row: number, col: number): void => {
      // Commit whatever is already being edited first, and let ITS transaction
      // carry the request to open this one.
      if (open) commit(open.row, open.col, open.input.value, { table: this.from, row, col })
      else view.dispatch({ effects: setEditCell.of({ table: this.from, row, col }) })
    }

    const buildCell = (row: number, col: number, value: string): HTMLTableCellElement => {
      const cell = document.createElement(row === -1 ? 'th' : 'td')
      const a = this.model.align[col]
      if (a) cell.style.textAlign = a
      const editing = this.edit && this.edit.row === row && this.edit.col === col

      if (editing) {
        // A TEXTAREA, not an input. A table cell wraps, and a single-line input
        // can only ever grow sideways — which is what made one long sentence
        // stretch its column across the whole note. This grows downwards, and
        // the row grows with it, the way it does in Notion.
        const input = document.createElement('textarea')
        input.className = 'cm-table-editor'
        input.rows = 1
        input.value = value
        if (a) input.style.textAlign = a
        open = { input, row, col }

        /** Height follows the content, recomputed from scratch each time —
         *  measuring `scrollHeight` against a height that is already big enough
         *  never shrinks back when you delete a line. */
        const grow = (): void => {
          input.style.height = 'auto'
          input.style.height = `${input.scrollHeight}px`
        }

        input.addEventListener('input', grow)
        input.addEventListener('keydown', (e) => {
          // Enter commits rather than inserting a line break: a GFM cell cannot
          // contain one at all, so there is nothing for a newline to mean here.
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(row, col, input.value, null)
          } else if (e.key === 'Tab') {
            e.preventDefault()
            commit(row, col, input.value, step(row, col, e.shiftKey ? -1 : 1))
          } else if (e.key === 'Escape') {
            e.preventDefault()
            done = true // discard: close without writing
            view.dispatch({ effects: setEditCell.of(null) })
            view.focus()
          } else if (
            e.key === 'Backspace' &&
            row >= 0 && // never the header — Markdown has no table without one
            input.value === '' &&
            input.selectionStart === 0 &&
            input.selectionEnd === 0 &&
            (this.model.rows[row] ?? []).every((c) => c.trim() === '')
          ) {
            // There is deliberately no separate "remove row" control any more —
            // this IS the control. Backspacing on an already-empty row removes
            // it, the same two-step "clear it, then backspace" gesture Notion
            // uses for a block. Requiring every cell in the row to be empty (not
            // just this one) means an accidental empty cell beside real data can
            // never delete that data.
            e.preventDefault()
            apply(removeRow(this.model, row), { table: this.from, row: row - 1, col })
          }
        })
        // Clicking anywhere else — another cell, the text, another pane —
        // commits, which is what "click away to keep it" means.
        input.addEventListener('blur', () => commit(row, col, input.value, null))
        cell.appendChild(input)
        // Not in the document yet when toDOM runs: focus() on a detached node
        // does nothing, and scrollHeight is 0 until it has been laid out.
        requestAnimationFrame(() => {
          grow()
          input.focus()
          input.select()
        })
      } else {
        cell.textContent = value
        cell.addEventListener('mousedown', (e) => {
          e.preventDefault() // stop CodeMirror putting a cursor inside the widget
          openCell(row, col)
        })
      }
      // NOTE: no chrome appended here any more — see the block below the table
      // is fully built, and the big comment on `positionChrome` for why.
      return cell
    }

    /**
     * One column's alignment, as a button that CYCLES: unset → left → centre →
     * right → unset.
     *
     * A cycle rather than a menu, deliberately. `.cm-table` scrolls sideways
     * (a wide table must not widen the note), so a popover opened inside it
     * would be clipped by its own container — and portalling one out to
     * `document.body` for a four-state choice is more machinery than the choice
     * is worth. Alignment has four states and a tooltip that names the next one,
     * which is the case where cycling is honest rather than annoying.
     *
     * Unset shows nothing but a faint dot: most tables never set alignment, and
     * a letter over every column would be permanent noise for a property almost
     * nobody uses.
     */
    const alignControl = (col: number): HTMLElement => {
      const order: Align[] = [null, 'left', 'center', 'right']
      const current = this.model.align[col] ?? null
      const next = order[(order.indexOf(current) + 1) % order.length]
      const label: Record<string, string> = {
        null: 'not set',
        left: 'left',
        center: 'centred',
        right: 'right'
      }
      const btn = document.createElement('button')
      btn.className = 'cm-table-align' + (current ? ' on' : '')
      btn.type = 'button'
      btn.textContent = current ? current[0].toUpperCase() : '·'
      btn.setAttribute('aria-label', `Column alignment: ${label[String(current)]}`)
      btn.dataset.tip = `Alignment: ${label[String(current)]} — click for ${label[String(next)]}`
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation() // don't let the click fall through to the cell under it
        apply(setAlign(this.model, col, next))
      })
      return btn
    }

    /** Rewrite the block from `next`. The one path every control ends in, so
     *  growing, shrinking and re-aligning all get the same single transaction,
     *  the same "did anything actually change" check, and the same closing of
     *  any open cell that write-back already had.
     *
     *  `liveTo` is the important part. A `+` DRAG calls this many times, and each
     *  call rewrites the block — so after the first one `this.to` is the end of a
     *  table that no longer exists, and replacing `[from, this.to]` again would
     *  write over whatever now follows it. The start never moves (the rewrite
     *  begins exactly at `from`), so tracking the end is enough. */
    let liveTo = this.to
    const apply = (next: TableModel, then: EditTarget | null = null): void => {
      const serialized = serializeTable(next, view.state.lineBreak)
      if (serialized === view.state.sliceDoc(this.from, liveTo)) return
      done = true // a structural change invalidates any input still open
      view.dispatch({
        changes: { from: this.from, to: liveTo, insert: serialized },
        effects: setEditCell.of(then),
        selection: { anchor: this.from }
      })
      liveTo = this.from + serialized.length
      if (!then) view.focus()
    }

    /**
     * A `+` you can also drag. Click adds one; dragging past `stepPx` adds
     * another, and dragging back removes them again.
     *
     * The drag reports an absolute count — `resizeColumns`/`resizeRows` take a
     * size, not a delta — because a pointermove fires many times a second and
     * replaying it as increments would add a column per frame the pointer sat
     * still. It also means letting go is never a separate commit: what you see
     * mid-drag is already what the file says.
     */
    const grower = (
      axis: 'col' | 'row',
      startCount: number,
      resize: (m: TableModel, n: number) => TableModel
    ): HTMLElement => {
      const btn = document.createElement('button')
      // Down the RIGHT edge for columns, along the BOTTOM for rows — the edge
      // you reach for when you want another one, and big enough to hit. The
      // first version hid these at the far end of the top and left strips, where
      // they were both hard to find and (being outside the scrolling box)
      // clipped away entirely.
      btn.className = 'cm-table-add cm-table-add-' + axis
      btn.type = 'button'
      btn.textContent = '+'
      btn.setAttribute('aria-label', axis === 'col' ? 'Add a column' : 'Add a row')
      btn.dataset.tip = axis === 'col' ? 'Add a column — drag for several' : 'Add a row — drag for several'

      const stepPx = 46
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const origin = axis === 'col' ? e.clientX : e.clientY
        // The model as it was when the drag began. Every move is measured from
        // here, so dragging back past the start really does undo the drag rather
        // than shrinking whatever the last frame produced.
        const base = this.model
        let last = startCount
        let moved = false

        const onMove = (m: MouseEvent): void => {
          const delta = (axis === 'col' ? m.clientX : m.clientY) - origin
          const want = startCount + Math.round(delta / stepPx)
          if (want === last) return
          last = want
          moved = true
          apply(resize(base, want))
        }
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          // A click is a drag that never moved. Handled here rather than in a
          // click listener so the two can't both fire and add two.
          if (!moved) apply(resize(base, startCount + 1))
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      })
      return btn
    }

    /**
     * The column handle: a six-dot pill centred above the header cell, the same
     * grip glyph the sidebar's own draggable rows use (`icons.tsx`'s `grip`),
     * rebuilt here in raw DOM because this widget is outside React. It does two
     * things, told apart by whether the pointer MOVED:
     *
     *   - Click (no movement) SELECTS the column — a blue outline, same
     *     language `.row-picked`/selection use elsewhere in the app — and while
     *     selected, Backspace or Delete removes it. This replaced a permanent
     *     little grab bar that was there only to be clicked once; selecting
     *     first means nothing is one accidental click from disappearing, and it
     *     is the same "clear or select, then act" shape the row deletion above
     *     just adopted.
     *   - Drag reorders the column, dropping it at the boundary nearest the
     *     pointer. Column rects are captured ONCE at mousedown rather than
     *     re-measured on every move: `apply()` is never called mid-drag (unlike
     *     the resize grower below), so the table never moves under the drag and
     *     there is nothing to re-measure.
     */
    let selectedCol: number | null = null
    let cleanupSelect: (() => void) | null = null
    const selectColumn = (i: number | null): void => {
      cleanupSelect?.()
      cleanupSelect = null
      selectedCol = i
      // `grid`, not `table`: the handle/align overlays this ALSO has to clear
      // now live as siblings of `table`, not inside it (see the big comment
      // above `positionChrome`), so a query scoped to `table` alone would miss
      // them and leave a stale lit handle behind after deselecting.
      grid.querySelectorAll('.cm-table-col-on').forEach((el) => el.classList.remove('cm-table-col-on'))
      if (i === null) return
      for (const tr of Array.from(table.rows)) tr.cells[i]?.classList.add('cm-table-col-on')
      // The handle stays lit without hovering — otherwise moving the mouse
      // down to press Backspace would hide the very thing showing it's armed.
      overlayPairs[i]?.handle.classList.add('cm-table-col-on')
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          if (this.model.header.length > MIN_COLS) apply(removeColumn(this.model, i))
          selectColumn(null)
        } else if (e.key === 'Escape') {
          // Claim it, matching the convention every other transient overlay in
          // this app follows (Settings' own Escape, EmojiPicker) — a selected
          // column is exactly that kind of transient state.
          e.stopPropagation()
          selectColumn(null)
        }
      }
      // Anything outside the handles deselects — including clicking into a
      // cell to edit it, which must not leave a stale blue column behind.
      const onDown = (e: MouseEvent): void => {
        if (!(e.target as HTMLElement).closest('.cm-table-col-handle')) selectColumn(null)
      }
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('mousedown', onDown, true)
      cleanupSelect = () => {
        window.removeEventListener('keydown', onKey, true)
        window.removeEventListener('mousedown', onDown, true)
      }
    }

    const gripIcon = (): SVGSVGElement => {
      const NS = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(NS, 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '11')
      svg.setAttribute('height', '11')
      const g = document.createElementNS(NS, 'g')
      g.setAttribute('fill', 'currentColor')
      for (const [cx, cy] of [
        [9, 6], [9, 12], [9, 18],
        [15, 6], [15, 12], [15, 18]
      ] as const) {
        const c = document.createElementNS(NS, 'circle')
        c.setAttribute('cx', String(cx))
        c.setAttribute('cy', String(cy))
        c.setAttribute('r', '1.6')
        g.appendChild(c)
      }
      svg.appendChild(g)
      return svg
    }

    const columnHandle = (i: number): HTMLElement => {
      const btn = document.createElement('button')
      btn.className = 'cm-table-col-handle'
      btn.type = 'button'
      btn.appendChild(gripIcon())
      btn.setAttribute('aria-label', `Column ${i + 1} — drag to reorder, click to select`)
      btn.dataset.tip =
        this.model.header.length > MIN_COLS
          ? 'Drag to reorder — click, then Backspace to remove'
          : 'Drag to reorder'

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const headerCells = Array.from(table.querySelectorAll('thead th')) as HTMLElement[]
        const gridRect = grid.getBoundingClientRect()
        // One boundary before the first column and one after every column —
        // length + 1 of them, each a valid drop point.
        const boundaries = [
          headerCells[0].getBoundingClientRect().left - gridRect.left,
          ...headerCells.map((el) => el.getBoundingClientRect().right - gridRect.left)
        ]
        let moved = false
        let target = i
        let marker: HTMLElement | null = null

        const onMove = (m: MouseEvent): void => {
          if (!moved && Math.abs(m.clientX - startX) < 4) return
          if (!moved) {
            moved = true
            selectColumn(null) // a drag is not a selection
            marker = document.createElement('div')
            marker.className = 'cm-table-col-drop'
            grid.appendChild(marker)
          }
          const x = m.clientX - gridRect.left
          target = boundaries.reduce(
            (best, b, bi) => (Math.abs(b - x) < Math.abs(boundaries[best] - x) ? bi : best),
            0
          )
          if (marker) marker.style.left = `${boundaries[target]}px`
        }
        const onUp = (): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          if (moved) {
            marker?.remove()
            apply(moveColumn(this.model, i, target))
          } else {
            selectColumn(selectedCol === i ? null : i)
          }
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      })
      return btn
    }

    const thead = document.createElement('thead')
    const htr = document.createElement('tr')
    // Kept for `positionChrome` and the hover wiring below — both need to map
    // a column index straight to its `<th>` without re-querying the DOM.
    const headerCells: HTMLTableCellElement[] = []
    this.model.header.forEach((c, i) => {
      const cell = buildCell(-1, i, c)
      headerCells.push(cell)
      htr.appendChild(cell)
    })
    thead.appendChild(htr)
    table.appendChild(thead)

    // Rows have no grip control of their own — see the Backspace handler above
    // (buildCell's `editing` branch), which is the only way to remove one now.
    const tbody = document.createElement('tbody')
    this.model.rows.forEach((row, r) => {
      const tr = document.createElement('tr')
      for (let i = 0; i < this.model.header.length; i++) tr.appendChild(buildCell(r, i, row[i] ?? ''))
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)

    const grid = document.createElement('div')
    grid.className = 'cm-table-grid'
    grid.appendChild(table)
    grid.appendChild(grower('col', this.model.header.length, resizeColumns))
    grid.appendChild(grower('row', this.model.rows.length, resizeRows))

    /**
     * The column handle and the alignment mark are appended HERE — as overlays
     * on `grid`, positioned in JS from each header cell's measured rect —
     * rather than as children of the `<th>` they visually belong to. That used
     * to be simpler and it was wrong: confirmed with an isolated headless
     * repro (three buttons, zero buttons, one, two — content- and
     * offset-independent), a `<th>` with TWO `position: absolute` children
     * reproducibly and roughly DOUBLES its own rendered height in this
     * Chromium build — with only one it's fine, with zero it's fine, the
     * moment there are two direct positioned children it inflates, and it
     * partially inflates even nested one level through a single wrapper. This
     * is a table-cell-specific browser quirk, not anything in this file's own
     * CSS or markup — overlaying from OUTSIDE the table sidesteps it rather
     * than depending on however that turns out to be fixed or not fixed.
     *
     * The one thing this costs: pixel positions computed once can go stale if
     * the column widths change later without the widget being rebuilt — a
     * pane resize is the only way that happens (anything that changes the
     * MODEL, e.g. a resize-drag or an edit, produces a whole new widget
     * instance already). `ResizeObserver` below covers that.
     */
    const overlayPairs: { align: HTMLElement; handle: HTMLElement }[] = []
    this.model.header.forEach((_, i) => {
      const align = alignControl(i)
      const handle = columnHandle(i)
      align.classList.add('cm-table-chrome-overlay')
      handle.classList.add('cm-table-chrome-overlay')
      // A header cell being EDITED right now used to reveal its chrome via
      // `:focus-within` on the th — that stopped working the moment the chrome
      // stopped being a descendant of it. Replicated here for the same reason:
      // a keyboard user tabbed into the header cell has no hover to rely on.
      if (this.edit && this.edit.row === -1 && this.edit.col === i) {
        align.classList.add('cm-table-chrome-show')
        handle.classList.add('cm-table-chrome-show')
      }
      overlayPairs.push({ align, handle })
      grid.appendChild(align)
      grid.appendChild(handle)
    })

    // Hovering a header cell reveals ITS OWN column's chrome — the same
    // "only the area it's over" scoping the rest of the chrome already has.
    // Has to be JS now: with the overlay living outside the `<th>`, there is
    // no DOM relationship left for a CSS descendant selector to hover through.
    headerCells.forEach((th, i) => {
      const { align, handle } = overlayPairs[i]
      th.addEventListener('mouseenter', () => {
        align.classList.add('cm-table-chrome-show')
        handle.classList.add('cm-table-chrome-show')
      })
      th.addEventListener('mouseleave', () => {
        align.classList.remove('cm-table-chrome-show')
        handle.classList.remove('cm-table-chrome-show')
      })
    })

    const positionChrome = (): void => {
      const gridRect = grid.getBoundingClientRect()
      headerCells.forEach((th, i) => {
        const r = th.getBoundingClientRect()
        const { align, handle } = overlayPairs[i]
        // Relative to `grid`'s own box, which is what these are `position:
        // absolute` against — NOT relative to the viewport, and NOT affected
        // by `.cm-table`'s horizontal scroll: scrolling moves `grid` (and
        // everything positioned against it) as one rigid unit, so a position
        // measured once stays correct at any scroll offset.
        align.style.left = `${r.right - gridRect.left - 14}px`
        align.style.top = `${r.top - gridRect.top + 1}px`
        handle.style.left = `${r.left - gridRect.left + r.width / 2}px`
        handle.style.top = `${r.top - gridRect.top - 18}px`
      })
    }
    // Not mounted yet when toDOM runs (no parent, so every rect above would
    // measure zero) — same reason the cell editor defers its own focus/grow.
    requestAnimationFrame(positionChrome)
    const resize = new ResizeObserver(positionChrome)
    resize.observe(grid)
    this.cleanup = () => resize.disconnect()

    wrap.appendChild(grid)
    return wrap
  }

  /** Only job: stop the `ResizeObserver` from `positionChrome` outliving the
   *  widget it was watching for. CodeMirror creates a fresh `TableWidget` on
   *  every relevant edit (see `eq()`), so this fires often and matters. */
  destroy(dom: HTMLElement): void {
    this.cleanup?.()
    void dom
  }

  /** True for everything: the widget owns its own clicks and keys now, and
   *  CodeMirror trying to place a cursor inside it is exactly what put the raw
   *  source back on screen. */
  ignoreEvent(): boolean {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  // Markdown pro: the source of a table is the one people most often want to
  // see, so raw view has to reach this StateField and not just the passes.
  if (isRaw(state)) return Decoration.none
  const target = state.field(editCell, false) ?? null
  return Decoration.set(
    findTables(state).map((t) =>
      Decoration.replace({
        widget: new TableWidget(
          t.model,
          t.from,
          t.to,
          target && target.table === t.from ? { row: target.row, col: target.col } : null
        ),
        block: true
      }).range(t.from, t.blockTo)
    ),
    true
  )
}

const blockTableField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    // No longer rebuilt on every selection change: the table is drawn the same
    // way wherever the cursor is, so only the text and which cell is open can
    // change it.
    if (tr.docChanged || tr.effects.some((e) => e.is(setEditCell))) return build(tr.state)
    // Toggling raw view reconfigures the editor, which is a transaction with no
    // doc change and no effect of ours — without this the table would keep its
    // widget until the next keystroke.
    if (tr.reconfigured) return build(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f)
})

// `editCell` first: `blockTableField` reads it, and StateFields resolve in the
// order they are added.
export const blockTable: Extension = [editCell, blockTableField]
