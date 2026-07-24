import { useState } from 'react'
import { PALETTE, type Layer } from './palette'

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
  const [layer, setLayer] = useState<Layer>('hl')
  const swatchPrefix = layer === 'hl' ? 'hl-' : 'tc-'
  return (
    <div className="sel-toolbar" style={{ left, top }} onMouseDown={(e) => e.preventDefault()}>
      <div className="sel-mode">
        <button
          className={layer === 'hl' ? 'on' : ''}
          title="Highlight"
          onClick={() => setLayer('hl')}
        >
          ▉
        </button>
        <button
          className={layer === 'tc' ? 'on' : ''}
          title="Text colour"
          onClick={() => setLayer('tc')}
        >
          A
        </button>
      </div>
      <div className="sel-swatches">
        {PALETTE.map((c) => (
          <button
            key={c.name}
            className="swatch"
            style={{ background: `var(--${swatchPrefix}${c.name})` }}
            title={c.label}
            onClick={() => onPick(layer, c.name)}
          />
        ))}
      </div>
      <button className="sel-clear" title="Remove colour" onClick={onClear}>
        ✕
      </button>
    </div>
  )
}
