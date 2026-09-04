import { useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { Icon } from '../icons'
import { AnchoredPopover } from './AnchoredPopover'
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
  const btn = useRef<HTMLButtonElement>(null)

  // Every action needs the live view and an intact selection. `AnchoredPopover`
  // prevents default on mousedown across the whole panel, so the selection
  // survives the click; all that's left is to close the menu and hand focus
  // back. (That used to come from the toolbar's own container — the panel is
  // portalled out of it now, so it carries the guard itself.)
  const run = (fn: (v: EditorView) => void) => (): void => {
    const view = viewRef.current
    setOpen(false)
    if (view) fn(view)
  }

  const swatch = (layer: Layer, name: string, label: string): React.JSX.Element => (
    <button
      key={layer + name}
      data-tip={label}
      aria-label={label}
      onClick={run((v) => applyColor(v, layer, name))}
      className="h-6 w-6 rounded-md border-none ring-1 ring-ink-300/25 outline-none transition duration-150 hover:ring-brand-300"
      style={{ background: `var(--${layer === 'hl' ? 'hl' : 'tc'}-${name})` }}
    />
  )

  return (
    <span className="inline-flex shrink-0">
      <button
        ref={btn}
        data-tip="Text colour & highlight"
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
        // Portalled, like the slot picker beside it — rendered in place this
        // panel sat underneath the editor and every swatch click went to
        // CodeMirror. See AnchoredPopover.tsx. `w-max` is gone with it: a fixed
        // panel needs a number to clamp against the window edge. 256 is what
        // `w-max` MEASURED at (eight 24px swatches, their gaps and the padding)
        // — taken from the live panel's own rect, not estimated; at 236 the last
        // swatch in each row was cut off behind a scrollbar.
        <AnchoredPopover
          anchor={btn}
          width={256}
          label="Text colour & highlight"
          onClose={() => setOpen(false)}
        >
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
        </AnchoredPopover>
      )}
    </span>
  )
}
