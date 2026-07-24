export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

// A renderer-drawn menu (not Electron's native Menu) so prompt 5 can restyle it.
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  return (
    <div
      className="menu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <ul className="menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
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
          </li>
        ))}
      </ul>
    </div>
  )
}
