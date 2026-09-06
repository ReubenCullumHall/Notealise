import { lineOfEmbed } from '../../../shared/attachments'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { baseExtensions } from './extensions'
import { applyColor, clearColor } from './colorCommands'
import { SelectionToolbar } from './SelectionToolbar'
import { setLinkEnv, type LinkEnv, type LinkHandlers } from './linkEnv'
import { selectionIsEmbed } from './attachSelect'
import { rawViewOf } from './rawView'
import { mediaSourceOf } from './mediaSource'
import type { Layer } from './palette'

interface Props {
  /** vault-relative path of the open note (identity for cursor/scroll memory) */
  path: string
  /** the note's content; only read when `version` changes (open / external reload) */
  doc: string
  /** bump to push a new `doc` into the view (open a note, external change) */
  version: number
  onDocChange: (text: string) => void
  /** set to the live EditorView so the top toolbar can act on it */
  editorRef?: React.MutableRefObject<EditorView | null>
  /** what the editor knows about the vault, for resolving `[[links]]` */
  env: LinkEnv
  /** what a clicked or dragged link does. Captured once; kept fresh through a ref. */
  linkHandlers: LinkHandlers
  /** scroll to this heading once the document has landed, then forget it —
   *  what `[[Note#Heading]]` does after the note opens */
  revealHeading?: string | null
  /** vault path of a photo/video: scroll to the line embedding it. The
   *  delete dialog's "go and look at that note" jump. */
  revealEmbed?: string | null
  /** the eye button: print each photo/video's own source under it, leaving the
   *  rest of the note formatted. Independent of `raw` — see mediaSource.ts. */
  mediaSource?: boolean
  /** Markdown pro: show this note as raw Markdown — every syntax mark visible,
   *  tables and maths as their source. Styling is untouched either way. */
  raw?: boolean
}

interface Saved {
  anchor: number
  head: number
  scrollTop: number
}
// Per-path cursor + scroll memory, so returning to a note lands where you left off.
const perPath = new Map<string, Saved>()

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))
const snapshot = (view: EditorView): Saved => {
  const s = view.state.selection.main
  return { anchor: s.anchor, head: s.head, scrollTop: view.scrollDOM.scrollTop }
}

interface TbState {
  left: number
  top: number
}

/** How long the selection has to sit still before the colour bar appears.
 *
 *  It used to appear on the very first selected character, which meant it
 *  followed the pointer across a drag-select and flashed on every Shift+Arrow —
 *  a panel jumping about over the words you are trying to look at. Reuben,
 *  2026-09-05: "add a slight natural delay ... like when your cursor stops
 *  moving or when you let go of the selection click".
 *
 *  So there are two triggers, and they are different lengths on purpose:
 *  releasing the mouse is a deliberate "I have finished choosing" and gets the
 *  short one, while a selection still being extended (keyboard, or the pointer
 *  mid-drag) has to go quiet for the long one. Both are debounced — each
 *  further change restarts the clock, which is what makes it read as "when you
 *  stop" rather than "220ms after you start". */
const SETTLE_MS = 220
const RELEASE_MS = 60

// The single most common CM6-in-React bug is recreating the EditorView when the
// content changes, which jumps the cursor. So: create the view ONCE (empty deps),
// and switch notes by dispatching a full-document replace — never a remount.
export function CodeEditor({
  path,
  doc,
  version,
  onDocChange,
  editorRef,
  env,
  linkHandlers,
  revealHeading,
  revealEmbed,
  raw,
  mediaSource
}: Props): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onDocChange)
  onChangeRef.current = onDocChange
  const docRef = useRef(doc)
  docRef.current = doc
  // Read once, at construction. The effect below owns every change after that.
  const rawRef = useRef(raw)
  rawRef.current = raw
  const mediaSourceRef = useRef(mediaSource)
  mediaSourceRef.current = mediaSource
  // Same reason as onChangeRef above: the view is built once, so the handlers it
  // captures must be a stable box whose contents we keep current, not the
  // functions themselves (which are new on every App render).
  const linksRef = useRef<LinkHandlers | null>(linkHandlers)
  linksRef.current = linkHandlers
  const envRef = useRef(env)
  envRef.current = env
  const prevPath = useRef<string | null>(null)
  const programmatic = useRef(false) // true while we replace the doc ourselves

  const [tb, setTb] = useState<TbState | null>(null)
  // `refreshToolbar` is built once (empty deps) and called from the update
  // listener inside a view that is also built once, so anything it needs to
  // read has to be a ref — a captured `tb` would be the value from first paint
  // forever.
  const tbRef = useRef<TbState | null>(null)
  tbRef.current = tb
  /** true between pointerdown and pointerup anywhere — i.e. a drag-select is
   *  still in progress and the selection is not finished being made. */
  const dragSelecting = useRef(false)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable, because `refreshToolbar` below is built once and calls it.
  const cancelSettle = useCallback((): void => {
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
  }, [])
  /** Take the panel down and abandon any pending appearance. */
  const hideToolbar = useCallback((): void => {
    cancelSettle()
    setTb(null)
  }, [cancelSettle])

  // Position the selection toolbar over the current selection (or hide it).
  const refreshToolbar = useCallback((view: EditorView, now = false): void => {
    const sel = view.state.selection.main
    const box = container.current
    // A selected EMBED is not selected text: the grip selects a photo or video
    // as one object (attachSelect), and offering to bold or highlight it makes
    // no sense. Its own affordance is the ring plus Backspace.
    if (sel.empty || !box || selectionIsEmbed(view.state)) {
      cancelSettle()
      setTb(null)
      return
    }
    const a = view.coordsAtPos(sel.from)
    const b = view.coordsAtPos(sel.to)
    if (!a || !b) {
      cancelSettle()
      setTb(null)
      return
    }
    const rect = box.getBoundingClientRect()
    const width = 260
    const height = 40
    const centerX = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2
    const left = Math.max(6, Math.min(centerX - rect.left - width / 2, rect.width - width - 6))
    const above = a.top - rect.top - height - 8
    const top = above < 4 ? b.bottom - rect.top + 8 : above // flip below if no room
    const at = { left, top }

    // Mid-drag: stay away entirely. The panel would otherwise be chasing the
    // pointer across the very text being selected.
    if (dragSelecting.current) {
      cancelSettle()
      setTb(null)
      return
    }
    // Already up: follow the selection with no delay. The wait is about not
    // INTERRUPTING; once the panel is on screen, lagging behind the text it is
    // pointing at is just wrong.
    if (tbRef.current) {
      cancelSettle()
      setTb(at)
      return
    }
    cancelSettle()
    // `now` is the release path: the wait it already served was RELEASE_MS, and
    // stacking SETTLE_MS on top of that is what made "let go and it appears"
    // feel like "let go, wait, and it appears".
    if (now) {
      setTb(at)
      return
    }
    settle.current = setTimeout(() => {
      settle.current = null
      setTb(at)
    }, SETTLE_MS)
  }, [cancelSettle])

  // Pointer state is tracked on the window, not the editor: a drag-select
  // very often ends with the pointer outside the pane it started in (past the
  // last line, or over the sidebar), and a `mouseup` bound to the editor never
  // hears about that — leaving `dragSelecting` stuck true and the toolbar
  // permanently suppressed.
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (e.button !== 0) return
      // `view.dom`, NOT the `.cm-host` container — the toolbar is a child of
      // the container, so testing against that would treat a click on a swatch
      // as the start of a new drag-select and unmount the panel from under the
      // pointer before the click could land on it.
      const view = viewRef.current
      if (!view || !view.dom.contains(e.target as Node)) return
      dragSelecting.current = true
      cancelSettle()
      setTb(null)
    }
    const up = (): void => {
      if (!dragSelecting.current) return
      dragSelecting.current = false
      const view = viewRef.current
      if (!view) return
      // Let CodeMirror commit the selection this release finishes before
      // measuring it — on mouseup the state has not been updated yet.
      cancelSettle()
      settle.current = setTimeout(() => {
        settle.current = null
        refreshToolbar(view, true)
      }, RELEASE_MS)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      cancelSettle()
    }
  }, [refreshToolbar, cancelSettle])

  // Markdown pro lives in a Compartment because the view is created ONCE (the
  // effect below has empty deps, so the editor is never torn down and rebuilt
  // when a prop changes). A compartment is CodeMirror's way to swap one
  // extension in an existing state, and reconfiguring produces a transaction the
  // decoration builders can see — which is how they know to redraw.
  const rawBox = useRef(new Compartment())
  const mediaSourceBox = useRef(new Compartment())

  useEffect(() => {
    const view = new EditorView({
      parent: host.current as HTMLElement,
      state: EditorState.create({
        doc: docRef.current,
        extensions: [
          ...baseExtensions(linksRef),
          rawBox.current.of(rawViewOf(!!rawRef.current)),
          mediaSourceBox.current.of(mediaSourceOf(!!mediaSourceRef.current)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !programmatic.current) onChangeRef.current(u.state.doc.toString())
            if (u.selectionSet || u.docChanged || u.geometryChanged) refreshToolbar(u.view)
          })
        ]
      })
    })
    viewRef.current = view
    if (editorRef) editorRef.current = view
    view.dispatch({ effects: setLinkEnv.of(envRef.current) })
    prevPath.current = path
    const saved = perPath.get(path)
    if (saved) {
      const len = view.state.doc.length
      view.dispatch({ selection: { anchor: clamp(saved.anchor, len), head: clamp(saved.head, len) } })
      view.scrollDOM.scrollTop = saved.scrollTop
    }
    view.focus()
    return () => {
      if (prevPath.current) perPath.set(prevPath.current, snapshot(view))
      view.destroy()
      viewRef.current = null
      if (editorRef) editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Toggling raw view. Reconfiguring rather than recreating keeps the cursor,
  // the scroll position, the undo history and the open document exactly as they
  // were — flipping the switch is meant to be a way of LOOKING at the note, not
  // a way of reopening it.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: rawBox.current.reconfigure(rawViewOf(!!raw)) })
  }, [raw])

  // Same again for the eye. Two compartments rather than one holding both, so
  // flipping either can't force the other's decorations to rebuild.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: mediaSourceBox.current.reconfigure(mediaSourceOf(!!mediaSource))
    })
  }, [mediaSource])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const next = docRef.current
    if (prevPath.current === path && view.state.doc.toString() === next) return

    const switching = prevPath.current !== null && prevPath.current !== path
    if (switching) perPath.set(prevPath.current as string, snapshot(view))
    const saved = switching ? perPath.get(path) : null

    programmatic.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: saved
        ? { anchor: clamp(saved.anchor, next.length), head: clamp(saved.head, next.length) }
        : { anchor: 0 }
    })
    programmatic.current = false
    view.scrollDOM.scrollTop = saved ? saved.scrollTop : 0
    prevPath.current = path
    hideToolbar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version])

  // Push the vault's shape into the editor whenever it changes. This is what
  // makes a `[[link]]` stop looking unwritten the moment its note exists — the
  // decorations only recompute on a transaction, so without this the link would
  // stay dashed until the user happened to type (CLAUDE.md's bug-class 1).
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setLinkEnv.of(env) })
  }, [env])

  // `[[Note#Heading]]`: the note opens first and the heading is found second.
  // Keyed on `version` as well as the heading, because the document arrives in a
  // separate effect and searching it before it lands finds nothing.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !revealHeading) return
    const want = revealHeading.trim().toLowerCase()
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const line = view.state.doc.line(n)
      const m = /^#{1,6}\s+(.*)$/.exec(line.text)
      if (!m || m[1].trim().toLowerCase() !== want) continue
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 })
      })
      view.focus()
      return
    }
    // No such heading: the note is open and the cursor is at the top, which is
    // where it would have been anyway. Silently landing at the start beats an
    // error about a heading the user can simply see isn't there.
  }, [revealHeading, path, version])

  // "Show me where this picture is." Same shape as the heading jump above,
  // including the `version` key: the document lands in its own effect, and
  // searching before it arrives finds nothing.
  useEffect(() => {
    const view = viewRef.current
    if (!view || !revealEmbed) return
    const n = lineOfEmbed(view.state.doc.toString(), path, revealEmbed)
    if (!n) return // not in this note (any more) — leave the cursor where it is
    const line = view.state.doc.line(n)
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 })
    })
    view.focus()
  }, [revealEmbed, path, version])

  // Escape dismisses the toolbar (selection stays; reselecting shows it again).
  useEffect(() => {
    if (!tb) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hideToolbar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tb, hideToolbar])

  const pick = (layer: Layer, name: string): void => {
    if (viewRef.current) applyColor(viewRef.current, layer, name)
  }
  const clear = (): void => {
    if (viewRef.current) clearColor(viewRef.current)
  }

  return (
    <div className="cm-host" ref={container}>
      <div className="cm-mount" ref={host} />
      {tb && <SelectionToolbar left={tb.left} top={tb.top} onPick={pick} onClear={clear} />}
    </div>
  )
}
