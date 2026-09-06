import { useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { ColorField } from '../color/Picker'
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
  const [custom, setCustom] = useState(false)
  const [hex, setHex] = useState('#e07b5c')
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
      className="h-6 w-6 rounded-md border-none ring-1 ring-ink-300/25 outline-none transition duration-150 hover:ring-ink-300/60"
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
        // panel needs a number to clamp against the window edge. 256 was what
        // `w-max` MEASURED at (eight 24px swatches, their gaps and the padding)
        // — taken from the live panel's own rect, not estimated; at 236 the last
        // swatch in each row was cut off behind a scrollbar.
        //
        // 236 since 2026-09-05. The palette went to ten and the panel gained a
        // colour field, and 236 is what the FIELD needs — the swatches became a
        // 5x2 grid to fit that rather than the panel widening to fit them,
        // because a row of ten 24px swatches wants 294 and would have made this
        // the widest popover in the app for the sake of one line.
        <AnchoredPopover
          anchor={btn}
          width={236}
          // 520, not the 420 default. With "Any colour" open the panel is
          // ~470px — measured, not estimated: at 420 it scrolled internally and
          // the two Text/Highlight apply buttons were the 35px below the fold,
          // which is the whole point of the disclosure being there. The
          // component still clamps to the space actually available, so this is
          // a ceiling rather than a promise.
          maxHeight={520}
          label="Text colour & highlight"
          onClose={() => setOpen(false)}
        >
          {/* A 5x2 GRID, not a wrapping row. Ten 24px swatches with their gaps
              need 294px, which is wider than this panel wants to be next to a
              236px colour field — and left to wrap they broke 8 + 2, which
              reads as a mistake rather than as a block. Five and five is the
              same ten colours looking deliberate, and it leaves the panel the
              width the field below it already needed. */}
          <p className={HEAD}>Text</p>
          <div className="grid grid-cols-5 gap-1.5">
            {PALETTE.map((c) => swatch('tc', c.name, c.label))}
          </div>
          <p className={HEAD + ' pt-2.5'}>Highlight</p>
          <div className="grid grid-cols-5 gap-1.5">
            {PALETTE.map((c) => swatch('hl', c.name, `${c.label} highlight`))}
          </div>

          {/* Above the disclosure, not below it. The panel is capped in height
              and scrolls; with the colour field open, a footer button was off
              the bottom — so the one control that UNDOES a colour was the one
              you had to scroll to find. It belongs with the swatches anyway:
              both act on the selection in one click. */}
          <button
            onClick={run(clearColor)}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border-none bg-transparent py-1.5 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-ink-300/15 hover:text-ink-900"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
            <span>Remove colour</span>
          </button>

          {/* "Any colour" — the same custom path every other picker in the app
              now has (Reuben, 2026-09-05). ONE field for both layers rather
              than one per row: a saturation square is the tallest control in
              the app and two of them would make this panel taller than the
              note. Which layer it lands on is therefore an explicit choice —
              two buttons, not a mode the panel remembers, because the two rows
              above have already taught you that this menu is "pick a row, then
              a colour" and a hidden layer would break that. */}
          <button
            type="button"
            aria-expanded={custom}
            onClick={() => setCustom((c) => !c)}
            className={
              'mt-2.5 flex w-full items-center gap-1.5 rounded-lg border-none bg-transparent px-0 py-1 text-left outline-none transition-colors hover:bg-transparent focus-visible:ring-2 focus-visible:ring-brand-300 ' +
              (custom ? 'text-brand-600' : 'text-ink-400 hover:text-ink-900')
            }
          >
            <span
              className={'inline-flex transition-transform duration-150 ' + (custom ? 'rotate-90' : '')}
            >
              <Icon name="chevron" className="h-3 w-3" />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">Any colour</span>
            <span
              aria-hidden="true"
              className="ml-auto h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-ink-300/40"
              style={{ background: hex }}
            />
          </button>
          {custom && (
            <div className="pt-1">
              <ColorField value={hex} onChange={setHex} />
              <div className="mt-2 flex gap-1.5">
                <button className="mini flex-1" onClick={run((v) => applyColor(v, 'tc', hex))}>
                  Text
                </button>
                <button className="mini flex-1" onClick={run((v) => applyColor(v, 'hl', hex))}>
                  Highlight
                </button>
              </div>
            </div>
          )}

        </AnchoredPopover>
      )}
    </span>
  )
}
