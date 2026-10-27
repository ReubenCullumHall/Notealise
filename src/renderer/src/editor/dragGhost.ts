import { StateEffect, StateField, type EditorState, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'

// Where a dragged block will land, shown AS the block (Reuben, 2026-10-16:
// "instead of having the line … make it have that text/media greyed out and
// like a ghost copy"). While a six-dot grip is carried (attachMove.ts), the note
// opens a gap at the drop point holding a greyed copy of what is being carried,
// and the block's own place closes up. So what is on screen while carrying is
// exactly the note after the drop: letting go swaps the copy for the real block
// in one step and nothing moves (Reuben, 2026-10-16: dimmed in place, its space
// closed on the drop and a voice note "doesn't always land where it shows").
//
// The gap is a real block in the note's layout — a CodeMirror block widget,
// added and moved by effects only. The document is never touched mid-drag, so
// the photos, videos and voice notes around it stay as they are drawn.
//
// The widget's height is FIXED and handed to CodeMirror up front
// (`estimatedHeight`): the block's own height where it came from, capped. That is
// what keeps the drag steady — attachMove knows exactly how far everything below
// the gap moved, and takes it back off when it measures where the pointer is, so
// the gap never chases the pointer up and down.

/** A tall block's copy is cut off here and fades out: it shows what is being
 *  carried, it does not have to hold all of it. */
export const GHOST_MAX_PX = 240

export interface Ghost {
  /** where the gap opens: a line start, or the end of the note */
  at: number
  /** its height in px — what CodeMirror is told, and what it is drawn at */
  height: number
  /** the copy of the carried block to show in it (cloned for each drawing) */
  body: HTMLElement
  /** a number per drag, so moving the gap never rebuilds a different copy */
  id: number
}

export const setGhost = StateEffect.define<Ghost | null>()
/** The carried block's own lines, closed up while it is away. */
export const setGhostSource = StateEffect.define<{ from: number; to: number } | null>()

/** What stands in for the carried block's lines: nothing, zero high — and
 *  CodeMirror is told so up front, as with the gap, so the drag can count on it. */
class GoneWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  get estimatedHeight(): number {
    return 0
  }

  toDOM(): HTMLElement {
    const d = document.createElement('div')
    d.className = 'cm-drag-gone'
    d.setAttribute('aria-hidden', 'true')
    return d
  }

  ignoreEvent(): boolean {
    return true
  }
}

class GhostWidget extends WidgetType {
  constructor(readonly ghost: Ghost) {
    super()
  }

  eq(other: GhostWidget): boolean {
    return other.ghost.id === this.ghost.id && other.ghost.height === this.ghost.height
  }

  get estimatedHeight(): number {
    return this.ghost.height
  }

  toDOM(): HTMLElement {
    const box = document.createElement('div')
    box.className = 'cm-drag-ghost'
    box.setAttribute('aria-hidden', 'true')
    box.style.height = `${this.ghost.height}px`
    const body = this.ghost.body.cloneNode(true) as HTMLElement
    box.appendChild(body)
    if (body.dataset.capped) box.classList.add('is-capped')
    return box
  }

  ignoreEvent(): boolean {
    return true
  }
}

interface GhostState {
  ghost: Ghost | null
  source: { from: number; to: number } | null
  decorations: DecorationSet
}

function build(state: EditorState, ghost: Ghost | null, source: { from: number; to: number } | null): DecorationSet {
  const ranges: Range<Decoration>[] = []
  if (source) {
    const doc = state.doc
    const from = doc.lineAt(Math.min(source.from, doc.length)).from
    const to = doc.lineAt(Math.min(source.to, doc.length)).to
    ranges.push(Decoration.replace({ widget: new GoneWidget(), block: true }).range(from, to))
  }
  if (ghost) {
    const doc = state.doc
    const at = Math.min(ghost.at, doc.length)
    // Before the line that starts here; at the very end of a note whose last
    // line has text, after it.
    const after = at === doc.length && doc.lineAt(at).from !== at
    ranges.push(Decoration.widget({ widget: new GhostWidget(ghost), block: true, side: after ? 1 : -1 }).range(at))
  }
  return Decoration.set(ranges, true)
}

export const dragGhost = StateField.define<GhostState>({
  create: () => ({ ghost: null, source: null, decorations: Decoration.none }),
  update(value, tr) {
    let { ghost, source } = value
    let changed = false
    for (const e of tr.effects) {
      if (e.is(setGhost)) {
        ghost = e.value
        changed = true
      } else if (e.is(setGhostSource)) {
        source = e.value
        changed = true
      }
    }
    // An edit mid-drag ends the drag (attachMove abandons it); drop what is shown
    // rather than map it onto text it no longer describes.
    if (tr.docChanged && (ghost || source)) return { ghost: null, source: null, decorations: Decoration.none }
    if (!changed) return value
    return { ghost, source, decorations: build(tr.state, ghost, source) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations)
})

/** Show (or move, or with null take away) the gap in `view`. Only when it
 *  changes: this runs on every pointer move. */
export function showGhost(view: EditorView, ghost: Ghost | null): void {
  const now = view.state.field(dragGhost, false)
  if (!now) return
  const same = now.ghost === ghost || (now.ghost && ghost && now.ghost.id === ghost.id && now.ghost.at === ghost.at)
  if (!same) view.dispatch({ effects: setGhost.of(ghost) })
}

/** Close up (or with null open again) the carried block's own place. */
export function hideSource(view: EditorView, source: { from: number; to: number } | null): void {
  const now = view.state.field(dragGhost, false)
  if (!now) return
  const same = now.source === source || (now.source && source && now.source.from === source.from && now.source.to === source.to)
  if (!same) view.dispatch({ effects: setGhostSource.of(source) })
}

/** A still copy of what is drawn for [from, to] in `view` — every line and block
 *  CodeMirror has on screen there, as it looks now. Nothing in it plays or loads:
 *  a video or an embedded player becomes a plain box its size. */
export function ghostBody(view: EditorView, from: number, to: number, capped: boolean): HTMLElement {
  const body = document.createElement('div')
  body.className = 'cm-drag-ghost-body'
  if (capped) body.dataset.capped = '1'
  for (const child of Array.from(view.contentDOM.children) as HTMLElement[]) {
    let pos: number
    try {
      pos = view.posAtDOM(child, 0)
    } catch {
      continue
    }
    if (pos < from || pos > to) continue
    const originals = Array.from(child.querySelectorAll('video, iframe, audio'))
    const copy = child.cloneNode(true) as HTMLElement
    Array.from(copy.querySelectorAll('video, iframe, audio')).forEach((el, i) => {
      el.removeAttribute('src')
      const r = originals[i]?.getBoundingClientRect()
      const box = document.createElement('div')
      box.className = 'cm-drag-ghost-media'
      if (r) {
        box.style.width = `${r.width}px`
        box.style.height = `${r.height}px`
      }
      el.replaceWith(box)
    })
    copy.querySelectorAll('button, input, a, [tabindex]').forEach((el) => el.setAttribute('tabindex', '-1'))
    body.appendChild(copy)
    if (body.childElementCount > 40) break
  }
  return body
}
