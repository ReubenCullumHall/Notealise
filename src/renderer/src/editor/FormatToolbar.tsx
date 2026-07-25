import type { EditorView } from '@codemirror/view'
import { bold, insertMath, italic, strike, underline } from './formatCommands'
import { ColourMenu } from './ColourMenu'

interface Props {
  viewRef: React.RefObject<EditorView | null>
}

// Shared button shell, ported from legacy's FmtBtn (legacy/src/App.jsx:1538).
// `onMouseDown` is prevented so clicking a button never blurs the editor or
// drops the selection the command needs to act on.
// Split into base + state because the colour menu's trigger stays lit while its
// dropdown is open; the plain buttons are base + idle, which is the same string
// they had before.
const BTN_BASE =
  'flex h-7 w-7 items-center justify-center rounded-md border-none bg-transparent p-0 text-[14px] leading-none outline-none transition duration-150 '
const BTN_IDLE = 'text-ink-500 hover:bg-brand-500/10 hover:text-brand-600 '
const BTN_ACTIVE = 'bg-brand-500/15 text-brand-600 '
const FMT_BTN = BTN_BASE + BTN_IDLE

// The top format bar. The controls sit centred over the text column.
export function FormatToolbar({ viewRef }: Props): React.JSX.Element {
  const run = (fn: (v: EditorView) => void) => () => {
    if (viewRef.current) fn(viewRef.current)
  }
  return (
    <div
      className="relative flex shrink-0 items-center justify-center gap-0.5 border-b border-ink-300/20 px-4 py-1.5"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className={FMT_BTN + 'font-bold'} title="Bold  (Ctrl/Cmd+B)" onClick={run(bold)}>
        B
      </button>
      <button className={FMT_BTN + 'font-display italic'} title="Italic  (Ctrl/Cmd+I)" onClick={run(italic)}>
        I
      </button>
      <button
        className={FMT_BTN + 'underline underline-offset-2'}
        title="Underline  (Ctrl/Cmd+U)"
        onClick={run(underline)}
      >
        U
      </button>
      <button
        className={FMT_BTN + 'line-through'}
        title="Strikethrough  (Ctrl/Cmd+Shift+X)"
        onClick={run(strike)}
      >
        S
      </button>
      <span className="mx-1.5 h-4 w-px bg-ink-300/25" />
      <button
        className={FMT_BTN + 'font-display italic'}
        title="LaTeX block  (Ctrl/Cmd+Shift+L)"
        onClick={run(insertMath)}
      >
        ƒx
      </button>
      <span className="mx-1.5 h-4 w-px bg-ink-300/25" />
      <ColourMenu viewRef={viewRef} btnBase={BTN_BASE} btnIdle={BTN_IDLE} btnActive={BTN_ACTIVE} />
    </div>
  )
}
