import { useState } from 'react'
import { ColorField } from '../color/Picker'
import { Icon } from '../icons'
import { getLastLayer, PALETTE, setLastLayer, type Layer } from './palette'

interface Props {
  left: number
  top: number
  onPick: (layer: Layer, name: string) => void
  onClear: () => void
}

// A small floating popover shown over a non-empty selection. Positioning + show/
// hide is owned by CodeEditor; this is just the controls. `onMouseDown` is
// prevented across the whole bar so clicking a swatch never blurs the editor or
// collapses the selection the command needs to act on.
export function SelectionToolbar({ left, top, onPick, onClear }: Props): React.JSX.Element {
  // Seeded from the last layer used anywhere, not from a fixed default — see
  // `lastLayer` in palette.ts for why this component cannot hold it itself.
  const [layer, setLayerState] = useState<Layer>(getLastLayer())
  const setLayer = (l: Layer): void => {
    setLayerState(l)
    setLastLayer(l)
  }
  const swatchPrefix = layer === 'hl' ? 'hl-' : 'tc-'
  // The custom colour is per-toolbar state and deliberately not remembered
  // across selections: unlike the LAYER (see palette.ts's `lastLayer`), a
  // one-off colour is a decision about this phrase, and a bar that reopened
  // holding the last arbitrary colour someone tried would be offering it as a
  // default it never earned.
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState('#e07b5c')
  return (
    <div className="sel-toolbar" style={{ left, top }} onMouseDown={(e) => e.preventDefault()}>
      {/* The controls are their own ROW element rather than loose children of a
          wrapping flex bar. A wrap put the custom panel on a second line, but a
          shrink-to-fit flex container still sizes itself as if every child sat
          on ONE line — so the bar came out as wide as the swatch row AND the
          panel side by side, with the difference showing as dead space to the
          right of the picker (Reuben, 2026-09-06, screenshot). Stacked, the bar
          is as wide as its widest row, which is this one. */}
      <div className="sel-row">
        <div className="sel-mode">
          <button
            className={layer === 'hl' ? 'on' : ''}
            data-tip="Highlight"
            onClick={() => setLayer('hl')}
          >
            ▉
          </button>
          <button
            className={layer === 'tc' ? 'on' : ''}
            data-tip="Text colour"
            onClick={() => setLayer('tc')}
          >
            A
          </button>
        </div>
        {/* The same hairline the search pill uses between its input and its
            filters. Reuben, 2026-09-06: the two mode buttons and the ten swatches
            were one undifferentiated run, and ▉/A read as two more colours rather
            than as the switch that decides what the ten DO. */}
        <span className="sel-divider" aria-hidden="true" />
        <div className="sel-swatches">
          {PALETTE.map((c) => (
            <button
              key={c.name}
              className="swatch"
              style={{ background: `var(--${swatchPrefix}${c.name})` }}
              data-tip={c.label}
              onClick={() => onPick(layer, c.name)}
            />
          ))}
          {/* "Any colour", the same custom path the sidebar's picker and the
              accent and tint pickers offer (Reuben, 2026-09-05 — the pickers were
              to be universal). It stays COLLAPSED by default: the ten presets are
              the fast path over a selection, and a saturation square unfurling
              over the words you have just selected would be in the way of the one
              thing you can see. The trigger wears the current custom colour, so
              reaching for the same one twice is one click the second time. */}
          <button
            className={'swatch swatch-custom' + (open ? ' is-on' : '')}
            style={{ background: hex }}
            aria-expanded={open}
            data-tip="Any colour"
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="plus" className="h-3 w-3" />
          </button>
        </div>
        <button className="sel-clear" data-tip="Remove colour" onClick={onClear}>
          ✕
        </button>
      </div>

      {open && (
        <div className="sel-custom">
          <ColorField value={hex} onChange={setHex} />
          <button className="mini mt-2 w-full" onClick={() => onPick(layer, hex)}>
            Apply to {layer === 'hl' ? 'highlight' : 'text'}
          </button>
        </div>
      )}
    </div>
  )
}
