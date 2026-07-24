import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { baseExtensions } from './extensions'
import { applyColor, clearColor } from './colorCommands'
import { SelectionToolbar } from './SelectionToolbar'
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
export function CodeEditor({ path, doc, version, onDocChange, editorRef }: Props): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onDocChange)
  onChangeRef.current = onDocChange
  const docRef = useRef(doc)
  docRef.current = doc
  const prevPath = useRef<string | null>(null)
  const programmatic = useRef(false) // true while we replace the doc ourselves

  const [tb, setTb] = useState<TbState | null>(null)

  // Position the selection toolbar over the current selection (or hide it).
  const refreshToolbar = useCallback((view: EditorView): void => {
    const sel = view.state.selection.main
    const box = container.current
    if (sel.empty || !box) {
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

  useEffect(() => {
    const view = new EditorView({
      parent: host.current as HTMLElement,
      state: EditorState.create({
        doc: docRef.current,
        extensions: [
          ...baseExtensions(),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !programmatic.current) onChangeRef.current(u.state.doc.toString())
            if (u.selectionSet || u.docChanged || u.geometryChanged) refreshToolbar(u.view)
          })
        ]
      })
    })
    viewRef.current = view
    if (editorRef) editorRef.current = view
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
