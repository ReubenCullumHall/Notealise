import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { claimEscape } from './settings/escapeClaims'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  /** a quieter word after the label — "where it came from" */
  hint?: string
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /** a caption above the items, for a menu that is a choice ("Put back in") */
  heading?: string
}

// A renderer-drawn menu (not Electron's native Menu) so prompt 5 can restyle it.
export function ContextMenu({ x, y, items, onClose, heading }: Props): React.JSX.Element {
  // Kept inside the window: opened low down (a row near the foot of the
  // sidebar), a menu used to run off the bottom with its last items unreachable.
  const ref = useRef<HTMLUListElement>(null)
  const [at, setAt] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const M = 8
    setAt({
      left: Math.max(M, Math.min(x, window.innerWidth - r.width - M)),
      top: Math.max(M, Math.min(y, window.innerHeight - r.height - M))
    })
  }, [x, y, items.length])
  // Escape closes it, like every other popover here. Claimed (see escapeClaims.ts)
  // so that, inside Settings, the same keypress closes this menu and not the whole
  // window behind it. `onClose` is kept in a ref so a re-render doesn't re-bind.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const release = claimEscape()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      release()
    }
  }, [])
  return (
    <div
      className="menu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <ul ref={ref} className="menu" style={at} onClick={(e) => e.stopPropagation()}>
        {heading && (
          <li className="menu-heading" aria-hidden="true">
            {heading}
          </li>
        )}
        {items.map((it) => (
          <li
            key={it.label}
            className={it.danger ? 'menu-item danger' : 'menu-item'}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            {it.label}
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
