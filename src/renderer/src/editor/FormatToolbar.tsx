import { useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { bold, italic, strike, underline } from './formatCommands'
import { AnchoredPopover } from './AnchoredPopover'
import { ColourMenu } from './ColourMenu'
import { ActionGrid, SlotFace } from './SlotPicker'
import { findAction } from './commands'

interface Props {
  viewRef: React.RefObject<EditorView | null>
  /** the four custom buttons, in bar order — see AppSettings.toolbarSlots */
  slots: string[]
  onSetSlot: (index: number, id: string) => void
  /** a bar in one column of a split: same buttons, less air around them */
  compact?: boolean
}

// Shared button shell, ported from legacy's FmtBtn (legacy/src/App.jsx:1538).
// `onMouseDown` is prevented so clicking a button never blurs the editor or
// drops the selection the command needs to act on.
// Split into base + state because the colour menu's trigger stays lit while its
// dropdown is open; the plain buttons are base + idle, which is the same string
// they had before.
// `shrink-0` is load-bearing in a split column: the bar's container scrolls, and
// without it flex would squeeze the buttons themselves instead, so B/I/U/S run
// into each other at a third of the window's width.
const BTN_BASE =
  'press flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-none bg-transparent p-0 text-[14px] leading-none outline-none transition duration-150 '
const BTN_IDLE = 'text-ink-500 hover:bg-ink-300/15 hover:text-ink-900 '
const BTN_ACTIVE = 'bg-brand-500/15 text-brand-600 '
// An empty slot is quieter than a real button — it's an invitation, not a
// command, and shouldn't compete with B / I / U / S for attention.
const BTN_EMPTY = 'text-ink-300 hover:bg-ink-300/15 hover:text-ink-900 '
const FMT_BTN = BTN_BASE + BTN_IDLE

// The top format bar. The controls sit centred over the text column, with two
// user-programmable slots on each side of the built-in group.
export function FormatToolbar({ viewRef, slots, onSetSlot, compact }: Props): React.JSX.Element {
  const run = (fn: (v: EditorView) => void) => () => {
    if (viewRef.current) fn(viewRef.current)
  }
  // In a split column the row is ~180px wide: an EMPTY slot is an invitation to
  // program a button, and an invitation is not worth pushing Bold and Italic off
  // the edge for. Assigned slots keep their place — they're real commands — and
  // an empty one is still fillable from Settings → Spaces → Shortcuts, which is
  // where changing them lives anyway.
  const slot = (i: number): React.JSX.Element | null => {
    const id = slots[i] ?? ''
    if (compact && !findAction(id)) return null
    return (
      <SlotButton key={i} id={id} onPick={(next) => onSetSlot(i, next)} onRun={(fn) => run(fn)()} />
    )
  }
  // The bar trades its internal air before it trades a button.
  const divider = (
    <span className={(compact ? 'mx-0.5' : 'mx-1.5') + ' h-4 w-px shrink-0 bg-ink-300/25'} />
  )
  return (
    <div
      className={
        // No border, no padding of its own: the bar is a group of buttons INSIDE
        // the pane's command row, which owns the row's chrome. A third of the
        // window is narrower than the group's natural width, so a split column
        // scrolls it rather than shrinking the buttons.
        'relative flex items-center gap-0.5 ' +
        // `justify-center` is unusable once the bar scrolls: flexbox centres the
        // overflow on BOTH sides and the part that spills off the left can never
        // be scrolled back into view. A narrow column starts at the first button
        // instead and scrolls right.
        (compact ? 'toolbar-scroll min-w-0 flex-1 justify-start overflow-x-auto' : 'shrink-0 justify-center')
      }
      onMouseDown={(e) => e.preventDefault()}
    >
      {slot(0)}
      {slot(1)}
      {divider}
      <button className={FMT_BTN + 'font-bold'} data-tip="Bold  (Ctrl/Cmd+B)" onClick={run(bold)}>
        B
      </button>
      <button className={FMT_BTN + 'font-display italic'} data-tip="Italic  (Ctrl/Cmd+I)" onClick={run(italic)}>
        I
      </button>
      <button
        className={FMT_BTN + 'underline underline-offset-2'}
        data-tip="Underline  (Ctrl/Cmd+U)"
        onClick={run(underline)}
      >
        U
      </button>
      <button
        className={FMT_BTN + 'line-through'}
        data-tip="Strikethrough  (Ctrl/Cmd+Shift+X)"
        onClick={run(strike)}
      >
        S
      </button>
      {divider}
      <ColourMenu viewRef={viewRef} btnBase={BTN_BASE} btnIdle={BTN_IDLE} btnActive={BTN_ACTIVE} />
      {divider}
      {slot(2)}
      {slot(3)}
    </div>
  )
}

/** One programmable button, with exactly two modes and no overlap between them:
 *  EMPTY it shows a dashed outline and clicking opens the picker; PROGRAMMED
 *  it is an ordinary format button — clicking runs the command, full stop.
 *
 *  Re-assigning from the bar (previously a right-click) is deliberately gone:
 *  it made a live command button double as its own settings control, on a
 *  gesture nothing else in the app uses and nothing advertised. Changing an
 *  assigned slot is Settings → Spaces → Shortcuts, which shows all four at once
 *  against a preview of the bar.
 *
 *  The picker is an `AnchoredPopover` — portalled to `document.body` — and NOT
 *  an absolutely-positioned child, which is what it was until 2026-08-29. In
 *  place it rendered underneath the editor and every click on it went to
 *  CodeMirror instead; see AnchoredPopover.tsx for the measurement and the
 *  paint-order reason. */
function SlotButton({
  id,
  onPick,
  onRun
}: {
  id: string
  onPick: (id: string) => void
  onRun: (fn: (v: EditorView) => void) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const action = findAction(id)

  const title = action
    ? `${action.label}  —  ${action.hint}\nChange this button in Settings → Spaces → Shortcuts`
    : 'Empty button — click to choose a command for it'

  return (
    <span className="inline-flex shrink-0">
      <button
        ref={btn}
        data-tip={title}
        aria-label={action ? action.label : 'Choose a command for this button'}
        aria-expanded={action ? undefined : open}
        onClick={() => {
          if (action) onRun(action.run)
          else setOpen((o) => !o)
        }}
        className={BTN_BASE + (open ? BTN_ACTIVE : action ? BTN_IDLE : BTN_EMPTY)}
      >
        <SlotFace id={id} />
      </button>

      {open && (
        <AnchoredPopover
          anchor={btn}
          width={268}
          label="Choose a command for this button"
          onClose={() => setOpen(false)}
        >
          <p className="pb-0.5 text-[12px] text-ink-500">
            Put a command on this button. Once it has one, clicking runs it — change or clear it in
            Settings → Spaces → Shortcuts.
          </p>
          <ActionGrid
            value={id}
            onPick={(next) => {
              onPick(next)
              setOpen(false)
            }}
          />
        </AnchoredPopover>
      )}
    </span>
  )
}
