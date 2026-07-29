import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { bold, italic, strike, underline } from './formatCommands'
import { ColourMenu } from './ColourMenu'
import { ActionGrid, SlotFace } from './SlotPicker'
import { findAction } from './toolbarActions'

interface Props {
  viewRef: React.RefObject<EditorView | null>
  /** the four custom buttons, in bar order — see AppSettings.toolbarSlots */
  slots: string[]
  onSetSlot: (index: number, id: string) => void
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
// An empty slot is quieter than a real button — it's an invitation, not a
// command, and shouldn't compete with B / I / U / S for attention.
const BTN_EMPTY = 'text-ink-300 hover:bg-brand-500/10 hover:text-brand-600 '
const FMT_BTN = BTN_BASE + BTN_IDLE

// The top format bar. The controls sit centred over the text column, with two
// user-programmable slots on each side of the built-in group.
export function FormatToolbar({ viewRef, slots, onSetSlot }: Props): React.JSX.Element {
  const run = (fn: (v: EditorView) => void) => () => {
    if (viewRef.current) fn(viewRef.current)
  }
  const slot = (i: number, align: 'left' | 'right'): React.JSX.Element => (
    <SlotButton
      key={i}
      id={slots[i] ?? ''}
      align={align}
      onPick={(id) => onSetSlot(i, id)}
      onRun={(fn) => run(fn)()}
    />
  )
  return (
    <div
      className="relative flex shrink-0 items-center justify-center gap-0.5 border-b border-ink-300/20 px-4 py-1.5"
      onMouseDown={(e) => e.preventDefault()}
    >
      {slot(0, 'left')}
      {slot(1, 'left')}
      <span className="mx-1.5 h-4 w-px bg-ink-300/25" />
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
      <ColourMenu viewRef={viewRef} btnBase={BTN_BASE} btnIdle={BTN_IDLE} btnActive={BTN_ACTIVE} />
      <span className="mx-1.5 h-4 w-px bg-ink-300/25" />
      {slot(2, 'right')}
      {slot(3, 'right')}
    </div>
  )
}

/** One programmable button, with exactly two modes and no overlap between them:
 *  EMPTY it shows "?" and clicking opens the picker; PROGRAMMED it is an
 *  ordinary format button — clicking runs the command, full stop.
 *
 *  Re-assigning from the bar (previously a right-click) is deliberately gone:
 *  it made a live command button double as its own settings control, on a
 *  gesture nothing else in the app uses and nothing advertised. Changing an
 *  assigned slot is Settings → Spaces → Shortcuts, which shows all four at once
 *  against a preview of the bar. */
function SlotButton({
  id,
  align,
  onPick,
  onRun
}: {
  id: string
  align: 'left' | 'right'
  onPick: (id: string) => void
  onRun: (fn: (v: EditorView) => void) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const action = findAction(id)

  // Same close rules as ColourMenu: click-outside, and Escape captured so it
  // closes this rather than reaching the editor.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const title = action
    ? `${action.label}  —  ${action.hint}\nChange this button in Settings → Spaces → Shortcuts`
    : 'Empty button — click to choose a command for it'

  return (
    <span ref={box} className="relative inline-flex">
      <button
        title={title}
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
        <div
          className={
            'fade-in absolute top-9 z-40 max-h-[min(420px,60vh)] w-[268px] overflow-y-auto rounded-xl border border-ink-300/25 bg-surface p-2.5 shadow-float ' +
            (align === 'right' ? 'right-0' : 'left-0')
          }
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
        </div>
      )}
    </span>
  )
}
