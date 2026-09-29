import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

// The heading or block a link just landed on, lit up for a moment so you can
// see which one it is — Notion does the same. Colour only, fading out
// (CLAUDE.md: motion changes colour, never size or position); the fade itself
// is `.cm-link-landed` in app.css.

const setFlash = StateEffect.define<{ from: number; to: number } | null>()
const landed = Decoration.line({ class: 'cm-link-landed' })

export const blockFlash = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setFlash)) continue
      if (!e.value) return Decoration.none
      const doc = tr.state.doc
      const first = doc.lineAt(e.value.from).number
      const last = doc.lineAt(e.value.to).number
      const lines: Range<Decoration>[] = []
      for (let n = first; n <= last; n++) lines.push(landed.range(doc.line(n).from))
      return Decoration.set(lines)
    }
    return value.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** How long the light stays. The CSS fade is 1.6s, so this ends it while the
 *  wash is all but gone — past the fade, the wash would show again. */
const FLASH_MS = 1500

/** Which light is the latest in each editor. Following a second link before
 *  the first light has gone must not let the FIRST one's timer put the second
 *  out early (found by the stress test, 2026-09-29). */
const latest = new WeakMap<EditorView, number>()

/** Light up the lines from `from` to `to`, then put them back. */
export function flashLines(view: EditorView, from: number, to: number): void {
  const mine = (latest.get(view) ?? 0) + 1
  latest.set(view, mine)
  view.dispatch({ effects: setFlash.of({ from, to }) })
  setTimeout(() => {
    // the pane may have closed, or another link been followed, in the meantime
    if (view.dom.isConnected && latest.get(view) === mine) view.dispatch({ effects: setFlash.of(null) })
  }, FLASH_MS)
}
