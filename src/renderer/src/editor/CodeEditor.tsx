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

  // Position the selection toolbar over the current selection (or hide it).
  const refreshToolbar = useCallback((view: EditorView): void => {
    const sel = view.state.selection.main
    const box = container.current
    // A selected EMBED is not selected text: the grip selects a photo or video
    // as one object (attachSelect), and offering to bold or highlight it makes
    // no sense. Its own affordance is the ring plus Backspace.
    if (sel.empty || !box || selectionIsEmbed(view.state)) {
      setTb(null)
      return
    }
    const a = view.coordsAtPos(sel.from)
    const b = view.coordsAtPos(sel.to)
    if (!a || !b) {
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
    setTb({ left, top })
  }, [])

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
    setTb(null)
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
      if (e.key === 'Escape') setTb(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tb])

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
