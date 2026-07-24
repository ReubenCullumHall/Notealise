import { useState } from 'react'
import type { TreeNode } from '../../shared/types'
import { Icon } from './icons'

interface Props {
  nodes: TreeNode[]
  openPath: string | null
  onOpen: (path: string) => void
  onContext: (e: React.MouseEvent, node: TreeNode) => void
  /** Move `fromPath` into folder `toDir` ("" = vault root). */
  onMove: (fromPath: string, toDir: string) => void
  /** Folder these nodes live in — the drop target for the empty background.
   *  "" is the vault root (the Home space); a space renders its own folder. */
  rootDir?: string
}

const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}
const stripExt = (name: string): string =>
  name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name

export function TreeView({
  nodes,
  openPath,
  onOpen,
  onContext,
  onMove,
  rootDir = ''
}: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragPath, setDragPath] = useState<string | null>(null)
  // The folder path currently targeted by a drag ("" = root, null = none).
  const [dropDir, setDropDir] = useState<string | null>(null)

  const toggle = (p: string): void =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  // Can the dragged entry legally drop into `dir`? No-op if it's already there;
  // forbidden if `dir` is the dragged folder itself or one of its descendants.
  const canDrop = (dir: string): boolean => {
    if (dragPath == null) return false
    if (parentOf(dragPath) === dir) return false
    if (dir === dragPath || dir.startsWith(dragPath + '/')) return false
    return true
  }

  const commitDrop = (dir: string): void => {
    const from = dragPath
    setDragPath(null)
    setDropDir(null)
    if (from != null && canDrop(dir)) onMove(from, dir)
  }

  // A row's drop target: a folder takes items into itself; a note takes them
  // into the folder it lives in (drop "next to" it).
  const targetDir = (node: TreeNode): string =>
    node.type === 'dir' ? node.path : parentOf(node.path)

  const render = (list: TreeNode[], depth: number): React.JSX.Element[] =>
    list.map((node) => {
      const isDir = node.type === 'dir'
      const isOpen = expanded.has(node.path)
      const dir = targetDir(node)
      const isInto = isDir && dropDir === node.path && canDrop(node.path)
      const cls =
        'row' +
        (openPath === node.path ? ' active' : '') +
        (dragPath === node.path ? ' dragging' : '') +
        (isInto ? ' drop-into' : '')
      return (
        <li key={node.path}>
          <div
            className={cls}
            style={{ paddingLeft: `calc(var(--row-pad0) + ${depth} * var(--row-indent))` }}
            draggable
            onDragStart={(e) => {
              e.stopPropagation()
              setDragPath(node.path)
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', node.path)
            }}
            onDragEnd={() => {
              setDragPath(null)
              setDropDir(null)
            }}
            onDragOver={(e) => {
              if (!canDrop(dir)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              setDropDir(dir)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              commitDrop(dir)
            }}
            onClick={() => (isDir ? toggle(node.path) : onOpen(node.path))}
            onContextMenu={(e) => onContext(e, node)}
          >
            <span className="grip" title="Drag to move">
              <Icon name="grip" />
            </span>
            <span
              className="twisty"
              onClick={
                isDir
                  ? (e) => {
                      e.stopPropagation()
                      toggle(node.path)
                    }
                  : undefined
              }
            >
              {isDir ? <Icon name="chevron" className={'chev' + (isOpen ? ' open' : '')} /> : null}
            </span>
            <span className="row-icon">
              <Icon name={isDir ? 'folder' : 'doc'} />
            </span>
            <span className="label">{isDir ? node.name : stripExt(node.name)}</span>
          </div>
          {isDir && isOpen && node.children && node.children.length > 0 && (
            <ul className="tree">{render(node.children, depth + 1)}</ul>
          )}
        </li>
      )
    })

  return (
    <ul
      className={'tree tree-root' + (dropDir === rootDir ? ' drop-root' : '')}
      onDragOver={(e) => {
        if (!canDrop(rootDir)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropDir(rootDir)
      }}
      onDrop={(e) => {
        e.preventDefault()
        commitDrop(rootDir)
      }}
    >
      {render(nodes, 0)}
    </ul>
  )
}
