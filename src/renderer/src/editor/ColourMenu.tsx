import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Icon } from '../icons'
import { PALETTE, type Layer } from './palette'
import { applyColor, clearColor } from './colorCommands'

// The "Text colour & highlight" dropdown in the format bar, ported from legacy's
// ColourMenu (legacy/src/App.jsx:1552-1610) — two rows of swatches (text, then
// highlight) over a "Remove colour" row.
//
// Legacy paints its swatches from literal hex values because its palette *is*
// hex. Ours is token-backed (`--tc-NAME` / `--hl-NAME` in theme.css, with
// separate light and dark values), so the swatches read the same variables the
// text will actually use — the preview is correct in both themes, and rule 5
// holds: no hex in component code.

interface Props {
  viewRef: React.RefObject<EditorView | null>
  /** shared button shell from FormatToolbar, minus the state classes */
  btnBase: string
  btnIdle: string
  btnActive: string
}

const HEAD = 'pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400'

// The four-stop bar under the "A" on the trigger. Deliberately a subset of the
// palette — it reads as "colour", not as a legend.
const TRIGGER_BAR =
  'linear-gradient(90deg,var(--tc-coral),var(--tc-amber),var(--tc-sage),var(--tc-sky))'

export function ColourMenu({ viewRef, btnBase, btnIdle, btnActive }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

  // Click-outside and Escape close it. Escape is captured so it closes the menu
  // rather than reaching the editor.
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

  // Every action needs the live view and an intact selection. The toolbar's
  // container already prevents default on mousedown, so the selection survives
  // the click; all that's left is to close the menu and hand focus back.
  const run = (fn: (v: EditorView) => void) => (): void => {
    const view = viewRef.current
    setOpen(false)
    if (view) fn(view)
  }

  const swatch = (layer: Layer, name: string, label: string): React.JSX.Element => (
    <button
      key={layer + name}
      title={label}
      aria-label={label}
      onClick={run((v) => applyColor(v, layer, name))}
      className="h-6 w-6 rounded-md border-none ring-1 ring-ink-300/25 outline-none transition duration-150 hover:scale-110 hover:ring-brand-300"
      style={{ background: `var(--${layer === 'hl' ? 'hl' : 'tc'}-${name})` }}
    />
  )

  return (
    <span ref={box} className="relative inline-flex">
      <button
        title="Text colour & highlight"
        aria-label="Text colour & highlight"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={btnBase + (open ? btnActive : btnIdle)}
      >
        <span className="flex flex-col items-center gap-[2px]">
          <span className="font-semibold leading-none">A</span>
          <span className="h-[3px] w-[13px] rounded-sm" style={{ background: TRIGGER_BAR }} />
        </span>
      </button>

      {open && (
        <div className="fade-in absolute left-0 top-9 z-40 w-max rounded-xl border border-ink-300/25 bg-surface p-2.5 shadow-float">
          <p className={HEAD}>Text</p>
          <div className="flex gap-1.5">
            {PALETTE.map((c) => swatch('tc', c.name, c.label))}
          </div>
          <p className={HEAD + ' pt-2.5'}>Highlight</p>
          <div className="flex gap-1.5">
            {PALETTE.map((c) => swatch('hl', c.name, `${c.label} highlight`))}
          </div>
          <button
            onClick={run(clearColor)}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-none bg-transparent py-1.5 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-brand-500/10 hover:text-brand-600"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
            <span>Remove colour</span>
          </button>
        </div>
      )}
    </span>
  )
}
