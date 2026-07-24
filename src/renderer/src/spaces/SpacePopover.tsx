import { useEffect, useRef, useState } from 'react'
import { NAMED_COLORS, isValidHexInput, type Space } from './model'

interface Props {
  space: Space
  x: number
  y: number
  onClose: () => void
  onRecolor: (hex: string) => void
  onSetIcon: (icon: string) => void
  onRename: () => void
  onDelete: () => void
}

// A small curated icon set (Arc-style). The blank choice clears back to a
// monogram of the space name.
const ICON_CHOICES = ['📝', '💼', '🏠', '⭐', '📚', '💡', '🎯', '🔧', '🎨', '🌱', '✅', '📌']

/** Right-click-a-space popover: leads with the colour picker (named palette +
 *  custom hex), then icon choices, then rename/delete. Every colour change calls
 *  back immediately — persistence is debounced in main, so the UI updates with no
 *  reload. Not shown for the synthetic Home space (it has no folder to edit). */
export function SpacePopover({
  space,
  x,
  y,
  onClose,
  onRecolor,
  onSetIcon,
  onRename,
  onDelete
}: Props): React.JSX.Element {
  const [hex, setHex] = useState(space.color ?? '')
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Clamp into the viewport once measured, so a right-click near an edge doesn't
  // push the popover off-screen.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(x, window.innerWidth - r.width - 8)
    const ny = Math.min(y, window.innerHeight - r.height - 8)
    setPos({ x: Math.max(8, nx), y: Math.max(8, ny) })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const commitHex = (v: string): void => {
    setHex(v)
    if (isValidHexInput(v)) onRecolor(v.startsWith('#') ? v : `#${v}`)
  }

  return (
    <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div
        ref={ref}
        className="space-pop"
        role="dialog"
        aria-label={`Customise ${space.label}`}
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="space-pop-title">{space.label}</div>

        <div className="space-pop-swatches">
          {NAMED_COLORS.map((c) => (
            <button
              key={c.id}
              className={'space-swatch' + (space.color?.toLowerCase() === c.hex ? ' on' : '')}
              title={c.label}
              aria-label={c.label}
              style={{ background: c.hex }}
              onClick={() => {
                setHex(c.hex)
                onRecolor(c.hex)
              }}
            />
          ))}
        </div>

        <div className="space-pop-hex">
          <span className="space-hex-preview" style={{ background: isValidHexInput(hex) ? (hex.startsWith('#') ? hex : `#${hex}`) : 'transparent' }} />
          <input
            value={hex}
            spellCheck={false}
            placeholder="#4f8cff"
            aria-label="Custom hex colour"
            onChange={(e) => commitHex(e.target.value)}
          />
        </div>

        <div className="space-pop-icons">
          <button
            className={'space-icon-choice' + (space.icon === '' ? ' on' : '')}
            title="Monogram"
            aria-label="Use a monogram"
            onClick={() => onSetIcon('')}
          >
            Aa
          </button>
          {ICON_CHOICES.map((emoji) => (
            <button
              key={emoji}
              className={'space-icon-choice' + (space.icon === emoji ? ' on' : '')}
              aria-label={`Icon ${emoji}`}
              onClick={() => onSetIcon(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="space-pop-actions">
          <button onClick={onRename}>Rename…</button>
          <button className="danger" onClick={onDelete}>
            Delete space
          </button>
        </div>
      </div>
    </div>
  )
}
