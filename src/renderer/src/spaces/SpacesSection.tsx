import { useState } from 'react'
import { NAMED_COLORS, isValidHexInput, monogram, type Space } from './model'
import { Icon } from '../icons'

export interface SpacesAdmin {
  /** the full rail list (Home first, then the real spaces). */
  spaces: Space[]
  onAdd: () => void
  onRename: (space: Space) => void
  onRecolor: (name: string, hex: string) => void
  onReorder: (orderedNames: string[]) => void
  onDelete: (space: Space) => void
}

/** The Spaces manager shown in the Settings panel: add a space, and per space
 *  recolour (named palette + hex), rename, reorder, or delete. The rail is for
 *  quick switching; this is the place to curate them. */
export function SpacesSection({ spaces, onAdd, onRename, onRecolor, onReorder, onDelete }: SpacesAdmin): React.JSX.Element {
  const real = spaces.filter((s) => !s.isHome)
  const [editing, setEditing] = useState<string | null>(null) // space whose palette is open

  const move = (name: string, dir: -1 | 1): void => {
    const names = real.map((s) => s.name)
    const i = names.indexOf(name)
    const j = i + dir
    if (j < 0 || j >= names.length) return
    ;[names[i], names[j]] = [names[j], names[i]]
    onReorder(names)
  }

  return (
    <section className="settings-group">
      <h3>Spaces</h3>
      <p className="hint">
        Each top-level folder in your vault is a space. Add one here; recolour, rename, reorder or
        remove the rest. Colours live in <code>.mdnotes/spaces.json</code> — never in your notes.
      </p>

      <div className="spaces-admin">
        {real.length === 0 && (
          <p className="muted spaces-admin-empty">
            No spaces yet — just your Home notes. Add your first space below.
          </p>
        )}
        {real.map((s, i) => (
          <div className="space-admin-row" key={s.name}>
            <div className="space-admin-main">
              <button
                className="space-admin-dot"
                title="Recolour"
                aria-label={`Recolour ${s.name}`}
                style={{ background: s.color ?? undefined }}
                onClick={() => setEditing((e) => (e === s.name ? null : s.name))}
              >
                <span className="space-admin-glyph">{s.icon || monogram(s)}</span>
              </button>
              <span className="space-admin-name">{s.name}</span>
              <div className="space-admin-actions">
                <button className="mini" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(s.name, -1)}>
                  ↑
                </button>
                <button
                  className="mini"
                  title="Move down"
                  aria-label="Move down"
                  disabled={i === real.length - 1}
                  onClick={() => move(s.name, 1)}
                >
                  ↓
                </button>
                <button className="mini" title="Rename" aria-label="Rename" onClick={() => onRename(s)}>
                  Rename
                </button>
                <button className="mini danger" title="Delete space" aria-label="Delete space" onClick={() => onDelete(s)}>
                  <Icon name="trash" />
                </button>
              </div>
            </div>
            {editing === s.name && (
              <SpaceColorEditor color={s.color} onPick={(hex) => onRecolor(s.name, hex)} />
            )}
          </div>
        ))}
      </div>

      <button className="add-space-btn" onClick={onAdd}>
        <Icon name="plus" />
        <span>Add a space</span>
      </button>
    </section>
  )
}

function SpaceColorEditor({ color, onPick }: { color: string | null; onPick: (hex: string) => void }): React.JSX.Element {
  const [hex, setHex] = useState(color ?? '')
  return (
    <div className="space-admin-palette">
      <div className="space-pop-swatches">
        {NAMED_COLORS.map((c) => (
          <button
            key={c.id}
            className={'space-swatch' + (color?.toLowerCase() === c.hex ? ' on' : '')}
            title={c.label}
            aria-label={c.label}
            style={{ background: c.hex }}
            onClick={() => {
              setHex(c.hex)
              onPick(c.hex)
            }}
          />
        ))}
      </div>
      <div className="space-pop-hex">
        <span
          className="space-hex-preview"
          style={{ background: isValidHexInput(hex) ? (hex.startsWith('#') ? hex : `#${hex}`) : 'transparent' }}
        />
        <input
          value={hex}
          spellCheck={false}
          placeholder="#4f8cff"
          aria-label="Custom hex colour"
          onChange={(e) => {
            const v = e.target.value
            setHex(v)
            if (isValidHexInput(v)) onPick(v.startsWith('#') ? v : `#${v}`)
          }}
        />
      </div>
    </div>
  )
}
