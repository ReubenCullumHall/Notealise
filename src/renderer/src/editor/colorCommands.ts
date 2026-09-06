import {
  type ChangeSpec,
  EditorState,
  type Extension,
  Prec,
  type TransactionSpec
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { colorPairs, pairAtEdge, SCAN } from './colorTags'
import { isRaw } from './rawView'
import { type Layer, setLastLayer, tagFor } from './palette'
import { recolor } from './colorModel'
import { normalizeHex } from '../../../shared/color'

// Thin CodeMirror wrappers over the pure model in colorModel.ts, plus the two
// keyboard/cleanup behaviours the tags need now that they are NEVER shown
// (livePreview's colorPass). Both exist for the same reason: invisible markup
// must not be able to leave the document in a state you can neither see nor
// fix. Reuben's calls, 2026-08-29.

/** Apply/replace/toggle a colour on the current selection. `name === null` clears.
 *
 *  `name` is a palette name (`sage`) or a custom `#rrggbb`. THE HEX IS
 *  NORMALISED HERE AND NOWHERE ELSE: `recolor` writes whatever it is given
 *  straight into a `style` attribute in the user's file, so this is the gate.
 *  `normalizeHex` returns the long lowercase form or null, and a null is
 *  dropped rather than passed on — a colour that cannot be parsed is not a
 *  colour, and the alternative is arbitrary text inside `style="…"`. */
export function applyColor(view: EditorView, layer: Layer, name: string | null): void {
  const sel = view.state.selection.main
  if (sel.empty) return
  if (name !== null && name.startsWith('#')) {
    const hex = normalizeHex(name)
    if (!hex) return
    name = hex
  }
  // Remember which of the two was used, wherever it was used from — the format
  // bar's colour menu as well as the selection toolbar, so the next selection
  // opens on the one you actually last reached for. `name === null` is a clear,
  // not a choice of layer, so it does not count.
  if (name !== null) setLastLayer(layer)
  const r = recolor(view.state.doc.toString(), sel.from, sel.to, tagFor(layer), name)
  if (view.state.doc.sliceString(r.from, r.to) === r.insert) {
    view.focus() // nothing to change (e.g. clearing a layer that isn't there)
    return
  }
  view.dispatch({
    changes: { from: r.from, to: r.to, insert: r.insert },
    selection: { anchor: r.selFrom, head: r.selTo }
  })
  view.focus()
}

/** Remove both highlight and text colour from the selection. */
export function clearColor(view: EditorView): void {
  applyColor(view, 'hl', null)
  applyColor(view, 'tc', null)
}

/** Backspace/Delete at the edge of a colour span takes the colour OFF, rather
 *  than eating one of its two tags.
 *
 *  Without this the tags are merely `atomic`, so one Backspace at the start of
 *  highlighted text swallows the whole opening tag — leaving an orphan
 *  `</mark>` and a phrase that silently lost its colour, with nothing on screen
 *  to say what happened because the tags are never drawn. Removing BOTH tags
 *  gets the same visible result as one deliberate operation, undoable in one
 *  step, and never leaves a half-pair in the file.
 *
 *  Only fires on a collapsed cursor sitting exactly at a tag boundary. Anywhere
 *  else it returns false and the default deletion runs untouched. */
const removeColorAtEdge =
  (dir: -1 | 1) =>
  (view: EditorView): boolean => {
    // Markdown pro shows the real source, and the whole point of it is editing
    // that source by hand. Swallowing both tags on one Backspace there would be
    // the editor overruling what you can plainly see.
    if (isRaw(view.state)) return false
    const sel = view.state.selection.main
    if (!sel.empty) return false
    const pair = pairAtEdge(view.state, sel.head, dir)
    if (!pair) return false
    // Delete the CLOSE tag first: removing the open one would shift every
    // position after it, and the close tag is always the later of the two.
    view.dispatch({
      changes: [
        { from: pair.closeFrom, to: pair.closeTo },
        { from: pair.openFrom, to: pair.openTo }
      ],
      // Land where the text now starts, so the cursor doesn't jump.
      selection: { anchor: pair.openFrom }
    })
    return true
  }

/** Keep every colour tag pair whole across an edit.
 *
 *  The tags are never drawn (livePreview's colorPass), and an UNMATCHED tag
 *  cannot be paired, so it is never concealed either — it just appears as raw
 *  `<mark class="hl-rose">` in the middle of the note. A selection that swallows
 *  one tag but not the other is what creates one, and it is easy to do by
 *  accident: Reuben, 2026-08-29, selecting a highlighted word *plus the space
 *  after it* and pressing Backspace. Including the space in FRONT was fine —
 *  that selection covers both tags — which is exactly the asymmetry a half-eaten
 *  pair produces.
 *
 *  So, for every pair that existed BEFORE this transaction and was broken by it:
 *
 *    both tags alive, content gone   → drop both (an empty pair is invisible junk)
 *    one tag alive, content survives → put the missing tag back
 *    one tag alive, content gone     → drop the survivor
 *
 *  Re-inserting rather than unwrapping is Reuben's call: you deleted part of a
 *  highlight, so the part you did not delete stays highlighted, the way any word
 *  processor behaves.
 *
 *  **Only pairs that were whole in `startState` are touched.** A stray tag the
 *  file already contained — imported from the old app, or edited elsewhere — is
 *  left visible on purpose (also Reuben's call): it is genuinely broken markup,
 *  and showing it is the only way anyone would know to fix it. That also means
 *  hand-typing a `<mark …>` never has it deleted out from under you mid-word.
 *
 *  A `transactionFilter`, so the mend joins the transaction that broke it and one
 *  undo restores the text AND its colour. It terminates because the appended
 *  changes leave no broken pair behind. */
const mendColorPairs = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr
  // Same reason as the keymap above: in Markdown pro the tags are visible and
  // yours to edit. Putting a `</mark>` back that you just deliberately deleted,
  // while you are looking straight at it, is the worst version of this feature.
  if (isRaw(tr.startState)) return tr
  const old = tr.startState
  const newDoc = tr.newDoc
  const changes: ChangeSpec[] = []
  const done = new Set<number>()
  // Only near what actually changed — a whole-document scan on every keystroke is
  // the cost `colorPass` avoids with `visibleRanges`, and this runs even more often.
  tr.changes.iterChangedRanges((fromA, toA) => {
    const from = Math.max(0, fromA - SCAN)
    const to = Math.min(old.doc.length, toA + SCAN)
    for (const p of colorPairs(old, from, to)) {
      if (done.has(p.openFrom)) continue
      done.add(p.openFrom)
      const openText = old.doc.sliceString(p.openFrom, p.openTo)
      const closeText = old.doc.sliceString(p.closeFrom, p.closeTo)
      const openFrom = tr.changes.mapPos(p.openFrom, -1)
      const openTo = tr.changes.mapPos(p.openTo, 1)
      const closeFrom = tr.changes.mapPos(p.closeFrom, -1)
      const closeTo = tr.changes.mapPos(p.closeTo, 1)
      // A tag "survived" only if its exact text is still there — mapping a
      // position through a deletion lands you at the deletion point, where the
      // slice is empty or something else entirely.
      const openAlive = newDoc.sliceString(openFrom, openTo) === openText
      const closeAlive = newDoc.sliceString(closeFrom, closeTo) === closeText
      const contentSurvives = closeFrom > openTo
      if (openAlive && closeAlive) {
        // Mapped, not the original offsets: both tags are untouched here, but a
        // change elsewhere in the same transaction can still have moved them.
        if (!contentSurvives) changes.push({ from: openFrom, to: closeTo })
      } else if (openAlive) {
        changes.push(
          contentSurvives
            ? { from: closeFrom, insert: closeText }
            : { from: openFrom, to: openTo }
        )
      } else if (closeAlive) {
        changes.push(
          contentSurvives
            ? { from: openTo, insert: openText }
            : { from: closeFrom, to: closeTo }
        )
      }
    }
  })
  if (!changes.length) return tr
  return [tr, { changes, sequential: true } satisfies TransactionSpec]
})

/** Everything above that has to be installed in the editor. */
export const colorEditing: Extension = [
  mendColorPairs,
  // Ahead of the default keymap, which would otherwise delete the atomic tag
  // before this ever sees the key.
  Prec.high(
    keymap.of([
      { key: 'Backspace', run: removeColorAtEdge(-1) },
      { key: 'Delete', run: removeColorAtEdge(1) }
    ])
  )
]
