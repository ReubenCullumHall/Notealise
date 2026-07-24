import type { EditorView } from '@codemirror/view'
import { bold, insertMath, italic, strike, underline } from './formatCommands'

interface Props {
  viewRef: React.RefObject<EditorView | null>
}

// The top format bar. `onMouseDown` is prevented so clicking a button never blurs
// the editor or drops the selection the command needs to act on.
export function FormatToolbar({ viewRef }: Props): React.JSX.Element {
  const run = (fn: (v: EditorView) => void) => () => {
    if (viewRef.current) fn(viewRef.current)
  }
  return (
    <div className="fmt-toolbar" onMouseDown={(e) => e.preventDefault()}>
      <button className="fmt-btn bold" title="Bold  (Ctrl/Cmd+B)" onClick={run(bold)}>
        B
      </button>
      <button className="fmt-btn italic" title="Italic  (Ctrl/Cmd+I)" onClick={run(italic)}>
        I
      </button>
      <button className="fmt-btn underline" title="Underline  (Ctrl/Cmd+U)" onClick={run(underline)}>
        U
      </button>
      <button className="fmt-btn strike" title="Strikethrough  (Ctrl/Cmd+Shift+X)" onClick={run(strike)}>
        S
      </button>
      <span className="fmt-sep" />
      <button className="fmt-btn latex" title="LaTeX block  (Ctrl/Cmd+Shift+L)" onClick={run(insertMath)}>
        ƒx
      </button>
    </div>
  )
}
