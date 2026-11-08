import { EditorSelection, RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view'
import { isEmbedLine } from './blockMove'
import { embedSpanAt } from './attachSelect'
import { addsToPick, pickFromClick } from './blockPick'
import { isRaw } from './rawView'

// Blocks keep their distance (Reuben, 2026-11-08: "don't make any blocks overlap" — two voice notes
// recorded one under the other drew their picked outlines across each other on a Lined page).
// The spacing itself is CSS (app.css, `--block-clear`); this file adds what CSS can't do on its own:
// marking which pictures and videos are blocks, ringing a picked table or formula, and making a
// press in the gap round a block pick it. The rules: docs/feature-done-checklist.md "Blocks — spacing and page looks".

/** A picture or video alone on its line is a BLOCK; one inside a sentence is not. CSS can't tell
 *  them apart (a line's words are bare text, which `:has()` cannot see), so lines that hold
 *  nothing but a picture or video are marked here and app.css spaces only those. */
const blockLine = Decoration.line({ class: 'cm-block-line' })

function markBlockLines(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos)
      // Voice notes are found by their own class (app.css); the mark is for pictures and videos.
      if (isEmbedLine(line.text) && !/^\s*<audio\b/i.test(line.text)) b.add(line.from, line.from, blockLine)
      pos = line.to + 1
    }
  }
  return b.finish()
}

const blockLineMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = markBlockLines(view)
    }
    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged) this.decorations = markBlockLines(u.view)
    }
  },
  { decorations: (p) => p.decorations }
)

/** A picked table or formula wears the same outline as a picked voice note, picture or video
 *  (rule 9). Those three draw it themselves; a table and a formula are drawn by their own passes,
 *  which don't know about picking, so the class is put on here once the editor has redrawn. */
const RINGED = ':scope > .cm-table table, :scope > .cm-math-display'

const pickRing = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule()
    }
    update(u: ViewUpdate): void {
      if (u.selectionSet || u.docChanged || u.viewportChanged) this.schedule()
    }
    private schedule(): void {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const ranges = view.state.selection.ranges.filter((r) => !r.empty)
          const out: { el: Element; on: boolean }[] = []
          for (const frame of view.contentDOM.querySelectorAll(':scope > .cm-block-frame')) {
            const el = frame.querySelector(RINGED)
            if (!el) continue
            let on = false
            if (ranges.length) {
              let pos: number
              try {
                pos = view.posAtDOM(frame)
              } catch {
                continue
              }
              const block = view.lineBlockAt(pos)
              on = ranges.some((r) => r.from <= block.from && r.to >= block.to)
            }
            out.push({ el, on })
          }
          return out
        },
        write: (out) => {
          for (const { el, on } of out) el.classList.toggle('cm-attach-selected', on)
        }
      })
    }
  }
)

/** The gap round a block is the block's (rule 3, Reuben 2026-11-08: "its hitbox is slightly bigger
 *  than what you see"): a press in the band just above or below a voice note, picture, video,
 *  table or formula picks it, as its six dots do — Cmd/Ctrl adds it to the pick, Shift picks a
 *  run. Only that band: a press ON the block is the block's own (play, cells, the maths box).
 *  A native listener, not `domEventHandlers`: a table's or formula's band is inside its widget,
 *  whose events CodeMirror never hands to the editor's own handlers. */
const MEDIA = ':scope > .cm-voice, :scope > .cm-image, :scope > .cm-video, :scope > .cm-video-card'

function blockAtGap(view: EditorView, target: HTMLElement, y: number): { from: number; to: number } | null {
  if (target.classList.contains('cm-line')) {
    const block = target.querySelector<HTMLElement>(MEDIA)
    if (!block) return null
    // Only a block ALONE on its line: a picture in a sentence is text, and on an old
    // `test<audio …>` line the space above the player is the words' (guard.py 1).
    if (!isEmbedLine(view.state.doc.lineAt(view.posAtDOM(target)).text)) return null
    const r = block.getBoundingClientRect()
    if (y >= r.top && y <= r.bottom) return null
    return embedSpanAt(view.state, view.posAtDOM(block))
  }
  const frame = target.classList.contains('cm-block-frame')
    ? target
    : target.classList.contains('cm-table')
      ? target.closest<HTMLElement>('.cm-block-frame')
      : null
  if (!frame) return null
  const inner = frame.querySelector<HTMLElement>(':scope > .cm-table table, :scope > .cm-math-display')
  if (!inner) return null
  const r = inner.getBoundingClientRect()
  if (y >= r.top && y <= r.bottom) return null
  const block = view.lineBlockAt(view.posAtDOM(frame))
  return { from: block.from, to: block.to }
}

const gapClick = ViewPlugin.fromClass(
  class {
    private readonly onDown: (e: MouseEvent) => void
    constructor(readonly view: EditorView) {
      this.onDown = (e) => {
        if (e.button !== 0 || e.altKey || isRaw(view.state)) return
        const span = blockAtGap(view, e.target as HTMLElement, e.clientY)
        if (!span || span.from === span.to) return
        e.preventDefault()
        e.stopPropagation()
        if (addsToPick(e) || e.shiftKey) {
          pickFromClick(view, e, span)
          return
        }
        view.dispatch({ selection: EditorSelection.single(span.from, span.to), userEvent: 'select.pick' })
        view.focus()
      }
      view.contentDOM.addEventListener('mousedown', this.onDown, true)
    }
    destroy(): void {
      this.view.contentDOM.removeEventListener('mousedown', this.onDown, true)
    }
  }
)

export const blockLines: Extension = [blockLineMarks, pickRing, gapClick]
