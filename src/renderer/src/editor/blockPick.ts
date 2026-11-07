import { EditorSelection, EditorState, Prec, StateField, type ChangeSet, type Extension, type SelectionRange, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { blockRange, type BlockRange } from './blockMove'
import { attachmentFileOf } from './attachSelect'
import { linkEnv, linkHandlersFacet } from './linkEnv'
import { ANCHOR, type MediaOrigin } from '../../../shared/workspace'

// Picking several blocks at once, the way the sidebar picks several notes (Reuben, 2026-11-07:
// "command/control + click should allow you to select multiple blocks not just one, like the
// sidebar with notes and folders"). Cmd+click (Ctrl+click on Windows and Linux) on a block's six
// dots — or on the block itself — adds it to what is picked, or takes it back out; Shift+click
// picks everything from the first picked block down to this one. A plain click still picks just
// the one.
//
// What is picked is the ordinary document selection, one range per block (attachSelect.ts's
// reasoning: CodeMirror already draws it, keeps it and clears it on a click elsewhere). Copy, cut
// and Backspace/Delete then work on all of them: copied with a blank line between each, so a
// voice note pasted elsewhere stays a voice note (a line straight after one would join it), and
// cut or deleted whole, lines and all, so nothing is left behind but the gap closing.

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent)

/** The key that adds to a pick: Cmd on a Mac (Ctrl+click there is a right-click), Ctrl elsewhere. */
export function addsToPick(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey
}

/** The block at `pos`, as a range — the same block its six dots would move, worked out as
 *  if nothing were selected (a selection would otherwise stand in for the block). */
export function blockAt(state: EditorState, pos: number): BlockRange {
  const at = Math.min(Math.max(pos, 0), state.doc.length)
  return blockRange(state.update({ selection: EditorSelection.cursor(at) }).state, at)
}

/** Cmd/Ctrl+click: `block` joins what is picked, or leaves it if it was already picked.
 *  Returns the new selection (pure, for the tests and for `pick`). */
export function togglePicked(state: EditorState, block: BlockRange): EditorSelection {
  const picked = state.selection.ranges.filter((r) => !r.empty)
  // The same block whichever handle picked it: a voice note's own dots pick its tag, the line's
  // dots pick its whole line — the same thing when the tag is alone on the line.
  const trimmed = (from: number, to: number): string => {
    const text = state.doc.sliceString(from, to)
    const lead = text.length - text.trimStart().length
    return `${from + lead}:${from + text.trimEnd().length}`
  }
  const key = trimmed(block.from, block.to)
  const same = (r: SelectionRange): boolean => trimmed(r.from, r.to) === key
  if (picked.some(same)) {
    const rest = picked.filter((r) => !same(r))
    return rest.length ? EditorSelection.create(rest, rest.length - 1) : EditorSelection.single(block.from)
  }
  if (block.from === block.to) return state.selection
  // A picked range this block overlaps gives way to the block (a text selection half into it).
  const rest = picked.filter((r) => r.to < block.from || r.from > block.to)
  const next = [...rest, EditorSelection.range(block.from, block.to)]
  return EditorSelection.create(next, next.length - 1)
}

/** Shift+click: one run of whole lines from the first picked block (or the cursor's line)
 *  to this one, whichever way round. */
export function extendPicked(state: EditorState, block: BlockRange): EditorSelection {
  const doc = state.doc
  const ranges = state.selection.ranges
  const from = Math.min(block.from, doc.lineAt(Math.min(...ranges.map((r) => r.from))).from)
  const to = Math.max(block.to, doc.lineAt(Math.max(...ranges.map((r) => r.to))).to)
  return EditorSelection.single(from, to)
}

/** Act on a click that carries a pick key. False when it carries none — the click is then
 *  the caller's as usual. */
export function pickFromClick(view: EditorView, e: MouseEvent, block: BlockRange): boolean {
  if (e.button !== 0 || e.altKey) return false
  let selection: EditorSelection
  if (e.shiftKey && !addsToPick(e)) selection = extendPicked(view.state, block)
  else if (addsToPick(e) && !e.shiftKey) selection = togglePicked(view.state, block)
  else return false
  view.dispatch({ selection, scrollIntoView: false, userEvent: 'select.pick' })
  view.focus()
  return true
}

/** Cmd/Ctrl+click (or Shift+click) anywhere on a drawn block the editor never hears clicks on
 *  — a video, a video card — adds it to the picked blocks, as its six dots do (Reuben,
 *  2026-11-07). The click that follows is swallowed, so a video doesn't also start playing.
 *  `skip` names the parts that keep their own click (its buttons). */
export function pickOnModifierClick(view: EditorView, root: HTMLElement, skip = 'button, input, a'): void {
  let picked = false
  root.addEventListener(
    'mousedown',
    (e) => {
      picked = false
      if (!(addsToPick(e) || e.shiftKey)) return
      if ((e.target as HTMLElement).closest(skip)) return
      let pos: number
      try {
        pos = view.posAtDOM(root)
      } catch {
        return
      }
      const block = blockAt(view.state, pos)
      if (block.from !== block.to && pickFromClick(view, e, block)) {
        picked = true
        e.preventDefault()
        e.stopPropagation()
      }
    },
    true
  )
  root.addEventListener(
    'click',
    (e) => {
      if (!picked) return
      picked = false
      e.preventDefault()
      e.stopPropagation()
    },
    true
  )
}

// --- what the picked blocks do --------------------------------------------------------

/** More than one range, each a whole block: a multi-block pick, as opposed to a text
 *  selection, which keeps CodeMirror's own copy and delete. */
export function isMultiPick(state: EditorState): boolean {
  return state.selection.ranges.length > 1 && isBlockPick(state)
}

/** Every range is a whole block — starts at a line's start and ends at a line's end (or is
 *  an embed alone on its line) — one or more of them. */
export function isBlockPick(state: EditorState): boolean {
  const ranges = state.selection.ranges
  const doc = state.doc
  return ranges.every((r) => {
    if (r.empty) return false
    const first = doc.lineAt(r.from)
    const last = doc.lineAt(r.to)
    const head = doc.sliceString(first.from, r.from)
    const tail = doc.sliceString(r.to, last.to)
    return head.trim() === '' && tail.trim() === ''
  })
}

/** The whole lines each picked block stands on, in order, overlaps merged. */
function pickedLines(state: EditorState): { from: number; to: number }[] {
  const doc = state.doc
  const spans = state.selection.ranges
    .map((r) => ({ from: doc.lineAt(r.from).from, to: doc.lineAt(r.to).to }))
    .sort((a, b) => a.from - b.from)
  const out: { from: number; to: number }[] = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

/** What a copy of the picked blocks holds: each block's lines, a blank line between them. */
export function pickedText(state: EditorState): string {
  return pickedLines(state)
    .map((s) => state.doc.sliceString(s.from, s.to))
    .join('\n\n')
}

/** What taking the picked blocks out removes, in order, against the document as it stands —
 *  shared by delete/cut and by dragging them somewhere else (attachMove.ts). */
export function pickedCuts(state: EditorState): { from: number; to: number }[] {
  return cutsFor(state, pickedLines(state))
}

/** What taking these blocks (whole lines, in order) out removes: each with its line break, and —
 *  when a blank line keeps it apart from what is above — the blank lines below it too, so it
 *  leaves one gap, not two. A block tight against the lines around it (a list item) takes only
 *  its own lines. */
export function cutsFor(state: EditorState, spans: { from: number; to: number }[]): { from: number; to: number }[] {
  const doc = state.doc
  const blank = (n: number): boolean => doc.line(n).text.trim() === ''
  const specs = spans.map((s) => {
    const first = doc.lineAt(s.from)
    const last = doc.lineAt(s.to)
    if (last.number === doc.lines) {
      // The note's last block: the blank lines above it go too, or the note ends in a gap.
      let above = first.number - 1
      while (above >= 1 && blank(above)) above--
      return { from: above >= 1 ? doc.line(above).to : 0, to: s.to }
    }
    let after = last.number + 1
    if (first.number === 1 || blank(first.number - 1)) {
      while (after < doc.lines && blank(after)) after++
    }
    return { from: s.from, to: doc.line(after).from }
  })
  // Two picked blocks with only blank lines between can reach into each other's gap: one cut.
  const cuts: { from: number; to: number }[] = []
  for (const c of specs.sort((a, b) => a.from - b.from)) {
    const prev = cuts[cuts.length - 1]
    if (prev && c.from <= prev.to) prev.to = Math.max(prev.to, c.to)
    else cuts.push({ ...c })
  }
  // A cut that runs to the end of the note takes the blank lines above it too.
  const end = cuts[cuts.length - 1]
  if (end.to === doc.length && end.from === doc.lineAt(end.from).from) {
    let above = doc.lineAt(end.from).number - 1
    while (above >= 1 && blank(above)) above--
    // A note that ended with a line break still does.
    const endsInBreak = doc.lines > 1 && doc.line(doc.lines).length === 0
    end.from = above >= 1 ? doc.line(above).to + (endsInBreak ? 1 : 0) : 0
  }
  return cuts
}

/** Take the picked blocks out, each with the line break after it (the one before it, for a
 *  block on the last line), as one change — and the blank line that kept it apart from the
 *  next thing, when there is one above it too, so three picked voice notes don't leave three
 *  gaps behind. The cursor goes to the end of the line above the first, like deleting one
 *  picked voice note (attachSelect.ts `cutRange`). */
export function removePicked(view: EditorView): ChangeSet {
  const state = view.state
  const doc = state.doc
  const cuts = pickedCuts(state)
  const changes = state.changes(cuts)
  const firstLine = doc.lineAt(cuts[0].from)
  const caret =
    firstLine.number > 1 && cuts[0].from === firstLine.from ? doc.line(firstLine.number - 1).to : cuts[0].from
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(changes.mapPos(caret, -1)),
    userEvent: 'delete.pick',
    scrollIntoView: true
  })
  return changes
}

const EMBED_IN = /!\[[^\]\n]*\]\([^)\n]*\)|<video\b[^>\n]*>\s*<\/video>|<audio\b[^>\n]*>\s*<\/audio>/gi

/** The files behind the voice notes, pictures and videos in the picked blocks, with where each
 *  sat (for the bin's Restore). A remote picture, or a target that isn't a picture, video or
 *  recording, has no file here (attachmentFileOf). */
export function pickedMedia(state: EditorState): { file: string; origin: MediaOrigin }[] {
  const note = state.field(linkEnv, false)?.path ?? ''
  if (!note) return []
  const doc = state.doc
  const out: { file: string; origin: MediaOrigin }[] = []
  for (const r of state.selection.ranges) {
    const text = doc.sliceString(r.from, r.to)
    EMBED_IN.lastIndex = 0
    for (let m = EMBED_IN.exec(text); m; m = EMBED_IN.exec(text)) {
      const file = attachmentFileOf(m[0], note)
      if (!file) continue
      const from = r.from + m.index
      const to = from + m[0].length
      const line = doc.lineAt(from)
      out.push({
        file,
        origin: {
          note,
          text: m[0],
          line: line.number,
          col: from - line.from,
          before: doc.sliceString(Math.max(0, from - ANCHOR), from),
          after: doc.sliceString(to, Math.min(doc.length, to + ANCHOR))
        }
      })
    }
  }
  return out
}

function onCopy(e: ClipboardEvent, view: EditorView, cut: boolean): boolean {
  if (!isMultiPick(view.state) || !e.clipboardData) return false
  e.preventDefault()
  e.clipboardData.clearData()
  e.clipboardData.setData('text/plain', pickedText(view.state).split('\n').join(view.state.lineBreak))
  if (cut && !view.state.readOnly) removePicked(view)
  return true
}

const deletePicked = (view: EditorView): boolean => {
  if (!isMultiPick(view.state) || view.state.readOnly) return false
  // Deleting (not cutting: a cut is on its way somewhere else) takes the files of any voice
  // notes, pictures and videos with it, to the bin (Reuben, 2026-11-07: "it should also be
  // binned and not be still hidden in the … folder").
  const media = pickedMedia(view.state)
  const note = view.state.field(linkEnv, false)?.path ?? ''
  const before = view.state.doc
  const changes = removePicked(view)
  const after = view.state.doc
  const handlers = view.state.facet(linkHandlersFacet)?.current
  if (media.length && note && handlers?.binPickedMedia) {
    handlers.binPickedMedia({
      note,
      items: media,
      restore: () => {
        // Only onto the note as the delete left it: the editor swaps notes in place.
        if ((view.state.field(linkEnv, false)?.path ?? '') !== note || !view.state.doc.eq(after)) return false
        view.dispatch({ changes: changes.invert(before), userEvent: 'input.restore' })
        return true
      }
    })
  }
  return true
}

/** Cmd/Ctrl/Shift+click on a block's words picks the whole block. A link keeps its own
 *  Cmd+click (open in the background — linkGestures.ts), so anything clickable is left alone. */
function onMouseDown(e: MouseEvent, view: EditorView): boolean {
  if (e.button !== 0 || e.altKey || !(addsToPick(e) || e.shiftKey)) return false
  // Shift+click in text is CodeMirror's own "select to here"; only a Shift+click that
  // follows a pick (more than one block, or a whole block) carries on picking.
  if (e.shiftKey && !addsToPick(e) && !isBlockPick(view.state)) return false
  const target = e.target as HTMLElement | null
  if (target?.closest('a, button, input, [role="button"], .cm-wikilink, .cm-weblink, .cm-link, .cm-url')) return false
  // A block drawn in place of its lines (a maths block) is asked where it starts; a click's
  // coordinates on one can answer the line after it.
  // A picture is asked the same way: a click's coordinates on a tall one can land elsewhere.
  const drawn = target?.closest('.cm-content > :not(.cm-line), .cm-image')
  let pos: number | null
  try {
    pos = drawn ? view.posAtDOM(drawn) : view.posAtCoords({ x: e.clientX, y: e.clientY })
  } catch {
    pos = null
  }
  if (pos === null) return false
  const block = blockAt(view.state, pos)
  if (block.from === block.to) return false // a blank line is nothing to pick
  return pickFromClick(view, e, block) ? (e.preventDefault(), true) : false
}

/** Whether the selection standing now was made by picking blocks — their six dots, a
 *  Cmd/Ctrl-click, a move — rather than by selecting words. The floating bold/italic bar stays
 *  away from a pick (CodeEditor.tsx): it popped up over the block above and covered that block's
 *  six dots (Reuben, 2026-11-07: "yes, do that"). Selecting words shows it as ever. */
const pickedByDots = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    if (tr.isUserEvent('select.pick') || tr.isUserEvent('move.pick') || tr.isUserEvent('move.drop')) return true
    if (tr.selection || tr.docChanged) return false
    return value
  }
})

export const isDotPick = (state: EditorState): boolean => state.field(pickedByDots, false) ?? false

export const blockPick: Extension = [
  pickedByDots,
  // More than one range at a time — but only ever made by picking: a Cmd+click in text does
  // not add a second cursor (the editor has never had those, and typing in two places at
  // once is not what anyone here asked for).
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of(() => false),
  // Highest: markdown() binds Backspace at high precedence and would answer first.
  Prec.highest(
    keymap.of([
      { key: 'Backspace', run: deletePicked },
      { key: 'Delete', run: deletePicked }
    ])
  ),
  EditorView.domEventHandlers({
    copy: (e, view) => onCopy(e, view, false),
    cut: (e, view) => onCopy(e, view, true),
    mousedown: onMouseDown
  })
]

// --- dragging them together ----------------------------------------------------------

export interface PickedGroup {
  /** each picked block's lines, in order */
  spans: { from: number; to: number }[]
  /** what moving them takes out (cutsFor) */
  cuts: { from: number; to: number }[]
  /** what lands where they are dropped */
  text: string
  /** set apart by blank lines (a paragraph, a voice note, a table) rather than tight against
   *  its neighbours (a list item): kept that way where it lands */
  spaced: boolean
  /** what goes between the blocks in `text` */
  joiner: string
}

/** A block the app draws as one thing, which Markdown only reads as that thing with a blank line
 *  either side: a voice note, picture or video line, a table, a `$$` block, any HTML. */
const BLOCK_LINE = /^\s*(<|\||\$\$|!\[[^\]\n]*\]\([^)\n]*\)\s*$)/

/** Is this block set apart by blank lines where it is (or a kind that always must be)? */
function isSpaced(doc: Text, span: { from: number; to: number }): boolean {
  const first = doc.lineAt(span.from)
  const last = doc.lineAt(span.to)
  if (BLOCK_LINE.test(first.text)) return true
  const blankAbove = first.number === 1 || doc.line(first.number - 1).text.trim() === ''
  const blankBelow = last.number === doc.lines || doc.line(last.number + 1).text.trim() === ''
  // A blank line (or the note's edge) on both sides: a paragraph. Words against it on either
  // side: a list item or a line of a run, which lands tight.
  return blankAbove && blankBelow
}

/** These blocks (whole lines, in order), ready to be moved together. */
export function blockGroup(state: EditorState, spans: { from: number; to: number }[]): PickedGroup {
  const doc = state.doc
  const spaced = spans.some((s) => isSpaced(doc, s))
  const joiner = spaced ? '\n\n' : '\n'
  return {
    spans,
    cuts: cutsFor(state, spans),
    text: spans.map((s) => doc.sliceString(s.from, s.to)).join(joiner),
    spaced,
    joiner
  }
}

/** The picked blocks, when the block whose dots were grabbed is one of several picked —
 *  they then move together (Reuben, 2026-11-07: dragging two picked voice notes must move
 *  both, "like normal text blocks"). Null otherwise: the grabbed block moves alone. */
export function pickedGroup(state: EditorState, grabbed: { from: number; to: number }): PickedGroup | null {
  if (!isMultiPick(state)) return null
  const spans = pickedLines(state)
  if (spans.length < 2) return null
  if (!spans.some((s) => s.from <= grabbed.to && s.to >= grabbed.from)) return null
  return blockGroup(state, spans)
}

/** Dropping the group at `at` (a line start, or the note's end) in the same note: one
 *  change — the blocks out of their places, all of them in at the drop point, a blank line
 *  between each — and the moved blocks still picked, so they can be carried on. Null when
 *  `at` is on one of the blocks' own places (not a move). */
export function moveGroupSpec(
  state: EditorState,
  group: PickedGroup,
  at: number,
  /** Arriving from another note (a split view): nothing here to cut, and the blocks' own places
   *  are in that note, so they mean nothing here. They land spaced the same way (2026-11-07). */
  foreign = false
): { changes: ChangeSet; selection: EditorSelection } | null {
  const doc = state.doc
  if (foreign) group = { ...group, cuts: [] }
  else if (group.spans.some((s) => at >= s.from && at <= (doc.lineAt(s.to).number < doc.lines ? doc.line(doc.lineAt(s.to).number + 1).from : doc.length)))
    return null
  // Inside one of the gaps a cut closes up: land where that cut starts.
  const inCut = group.cuts.find((c) => at > c.from && at < c.to)
  if (inCut) at = inCut.from
  // Dropped on the edge of a cut: that cut and the drop are one change.
  const merged = group.cuts.find((c) => at === c.from || at === c.to)
  // What will sit either side of the dropped blocks once the cuts are made.
  const belowAt = merged ? merged.to : at
  const aboveAt = merged ? merged.from : at
  // A blank line either side when the neighbour there is words: a line straight after a voice
  // note would be read as part of it (an HTML block runs until a blank line). Dropped at a line's
  // end (the note's last line), a line break first.
  const below = doc.lineAt(belowAt)
  const textBelow = belowAt === below.from && below.text.trim() !== ''
  const midLine = aboveAt > 0 && aboveAt !== doc.lineAt(aboveAt).from
  const above = aboveAt > 0 ? doc.lineAt(midLine ? aboveAt : aboveAt - 1) : null
  const textAbove = !!above && above.text.trim() !== ''
  // A list item (tight) lands tight; anything set apart stays set apart.
  const lead = (midLine ? '\n' : '') + (group.spaced && textAbove ? '\n' : '')
  const insert = lead + group.text + '\n' + (group.spaced && textBelow ? '\n' : '')
  const specs = group.cuts.map((c) => (c === merged ? { from: c.from, to: c.to, insert } : { from: c.from, to: c.to, insert: '' }))
  if (!merged) specs.push({ from: at, to: at, insert })
  const changes = state.changes(specs)
  // Back where they already were (just after the last of them, say): not a move.
  if (changes.apply(doc).eq(doc)) return null
  // Where the dropped text starts in the new note, then each block within it.
  let start = changes.mapPos(merged ? merged.from : at, -1) + lead.length
  // From another note the text may have been re-pointed (a picture's path), so the blocks'
  // lengths there are not theirs here: the whole arrival is picked as one.
  if (foreign) return { changes, selection: EditorSelection.single(start, start + group.text.length) }
  const ranges = group.spans.map((sp) => {
    const len = sp.to - sp.from
    const r = EditorSelection.range(start, start + len)
    start += len + group.joiner.length
    return r
  })
  return { changes, selection: EditorSelection.create(ranges, ranges.length - 1) }
}
