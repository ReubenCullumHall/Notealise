import { useEffect, useRef } from 'react'
import { EditorSelection, EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { linkEnv, setLinkEnv, type LinkEnv } from '../editor/linkEnv'
import { livePreview } from '../editor/livePreview'
import { toggleList } from '../editor/toggleList'
import { toggleMarkdown } from '../editor/toggleModel'
import { blockMath } from '../editor/blockMath'
import { blockTable } from '../editor/blockTable'
import { editorStyling } from '../editor/highlight'
import { hasWords, type Piece } from './model'

// An earlier version, shown the way the note looks — formatted, not as Markdown
// (Reuben, 2026-11-03: "earlier versions should always display as formatted
// text"). The editor's own drawing (live preview, toggles, maths, tables, the
// note's styling), read-only, so a copy looks exactly like the note it was —
// never a second renderer that could disagree with it. What has been removed
// from the note since is lit up, each piece under a "Removed since" bar with
// its Put back.

type Removed = Extract<Piece, { kind: 'removed' }>

class PutBackBar extends WidgetType {
  constructor(
    readonly piece: Removed,
    readonly busy: boolean,
    readonly onPutBack: (piece: Removed) => void
  ) {
    super()
  }
  eq(other: PutBackBar): boolean {
    return other.piece.key === this.piece.key && other.busy === this.busy
  }
  toDOM(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'history-gone-bar'
    const label = document.createElement('span')
    label.textContent = 'Removed since'
    const button = document.createElement('button')
    button.className = 'mini'
    button.textContent = 'Put back'
    button.disabled = this.busy
    button.addEventListener('mousedown', (e) => e.preventDefault())
    button.addEventListener('click', () => this.onPutBack(this.piece))
    bar.append(label, button)
    return bar
  }
  ignoreEvent(): boolean {
    return true // the button's own click, not the editor's
  }
}

const goneLine = Decoration.line({ class: 'history-gone-line' })

/** The removed pieces: a bar above each (a block widget, so it sits on its own
 *  row even when the piece starts with a table or a formula) and a wash on each
 *  of its lines. Block widgets have to come from a state field. */
function goneField(pieces: Piece[], busy: boolean, onPutBack: (p: Removed) => void): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      const b = new RangeSetBuilder<Decoration>()
      let at = 0
      for (const p of pieces) {
        const end = at + p.text.length
        if (p.kind === 'removed' && hasWords(p)) {
          b.add(at, at, Decoration.widget({ widget: new PutBackBar(p, busy, onPutBack), block: true, side: -1 }))
          for (let n = state.doc.lineAt(at).number; n <= state.doc.lineAt(end).number; n++) {
            const line = state.doc.line(n)
            b.add(line.from, line.from, goneLine)
          }
        }
        at = end + 1 // the line break between pieces
      }
      return b.finish()
    },
    update: (deco) => deco,
    provide: (f) => EditorView.decorations.from(f)
  })
}

interface Props {
  pieces: Piece[]
  env: LinkEnv
  busy: boolean
  onPutBack: (piece: Removed) => void
}

export function VersionView({ pieces, env, busy, onPutBack }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const putBack = useRef(onPutBack)
  putBack.current = onPutBack

  useEffect(() => {
    view.current = new EditorView({ parent: host.current as HTMLElement })
    return () => {
      view.current?.destroy()
      view.current = null
    }
  }, [])

  // A fresh state for each copy shown (and after each Put back): the text and
  // what is lit up both come from the comparison.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const doc = pieces.map((p) => p.text).join('\n')
    v.setState(
      EditorState.create({
        doc,
        // The cursor sits at the very end, so no heading's `#` shows at the top —
        // live preview shows a line's marks where the cursor is.
        selection: EditorSelection.cursor(doc.length),
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          linkEnv,
          markdown({ base: markdownLanguage, extensions: [toggleMarkdown] }),
          EditorView.lineWrapping,
          livePreview,
          toggleList,
          blockMath,
          blockTable,
          editorStyling,
          goneField(pieces, busy, (p) => putBack.current(p))
        ]
      })
    )
    v.dispatch({ effects: setLinkEnv.of(env) })
    v.scrollDOM.scrollTop = 0
  }, [pieces, busy, env])

  return <div className="history-view" ref={host} />
}
