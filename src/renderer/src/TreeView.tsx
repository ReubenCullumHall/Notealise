import { useState } from 'react'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import { Icon } from './icons'
import { labelOf, metaOf, onDate, sortSiblings } from './organise/model'

// The sidebar tree. Ported from the legacy prototype's row renderers
// (legacy/src/App.jsx:521-722) so the two apps render the same sidebar: two-line
// note rows, folder rows with a chevron and child count, a grip handle that
// doubles as the multi-select toggle, drag-to-reorder with insertion lines, and
// hover actions. Row metrics live in app.css (.tree-row & co) so they own the
// density variables outright — see CLAUDE.md rule 8.

/** Which list a row belongs to; the shelf views are read-only. */
export type RowMode = 'tree' | 'pinned' | 'archive' | 'search'

/** Where a drop would land relative to the hovered row. */
type Hint =
  | { kind: 'into'; path: string }
  | { kind: 'sibling'; path: string; after: boolean }
  | null

export interface Selection {
  paths: Set<string>
}

export interface TreeActions {
  onOpen: (path: string) => void
  onContext: (e: React.MouseEvent, node: TreeNode | null) => void
  /** Move entries into `toDir`, optionally positioned around `anchor`. */
  onMove: (paths: string[], toDir: string, anchor: string | null, after: boolean) => void
  onTogglePin: (paths: string[], pinned: boolean) => void
  onTrash: (paths: string[]) => void
  onRestore: (paths: string[]) => void
  onNewNoteIn: (dir: string) => void
  onNewFolderIn: (dir: string) => void
  onRename: (node: TreeNode) => void
}

interface Props extends TreeActions {
  nodes: TreeNode[]
  workspace: Workspace
  openPath: string | null
  freeArrange: boolean
  organize: boolean
  mode: RowMode
  selection: Selection
  onSelectionChange: (next: Selection) => void
  /** lifted so the whole sidebar knows a drag is in progress (drop zones appear) */
  dragging: string[] | null
  onDragging: (paths: string[] | null) => void
  /** '' = vault root — the drop target for empty background. */
  rootDir?: string
}

const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

/** Indentation is expressed in the density variables, so changing the density
 *  re-indents the tree without React re-measuring anything. */
const padFor = (depth: number): string =>
  `calc(var(--row-pad0) + ${depth} * var(--row-indent))`

/** A quiet hover action on a row. `always` keeps it visible (a set pin). */
function RowBtn({
  onClick,
  title,
  tone = 'ink',
  always = false,
  children
}: {
  onClick: (e: React.MouseEvent) => void
  title: string
  tone?: 'ink' | 'brand'
  always?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={
        'shrink-0 rounded border-none bg-transparent p-0.5 outline-none transition-colors hover:bg-transparent ' +
        (always ? 'opacity-100 ' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ') +
        (tone === 'brand' ? 'text-brand-500 hover:text-brand-600' : 'text-ink-300 hover:text-brand-600')
      }
    >
      {children}
    </button>
  )
}

export function TreeView({
  nodes,
  workspace,
  openPath,
  freeArrange,
  organize,
  mode,
  selection,
  onSelectionChange,
  dragging,
  onDragging,
  rootDir = '',
  onOpen,
  onContext,
  onMove,
  onTogglePin,
  onTrash,
  onRestore,
  onNewNoteIn,
  onNewFolderIn,
  onRename
}: Props): React.JSX.Element {
  const [hint, setHint] = useState<Hint>(null)
  const shelved = mode === 'archive'
  const reorders = mode === 'tree'

  // Folder collapse lives in workspace.json, but is read here rather than
  // written on every toggle — a local override keeps expanding snappy and is
  // persisted by the caller through onCollapse if it ever needs to survive.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const isOpen = (p: string): boolean => expanded.has(p) !== (metaOf(workspace, p).collapsed === true)
  const toggle = (p: string): void =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  // ----- selection (ctrl/cmd-click adds to the set, like a file explorer) -----
  const picked = (p: string): boolean => selection.paths.has(p)
  const toggleSel = (p: string): void => {
    const next = new Set(selection.paths)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    onSelectionChange({ paths: next })
  }
  const clearSel = (): void => onSelectionChange({ paths: new Set() })

  // ----- drag & drop (always on — no need to enter Organize) -----
  const startDrag = (e: React.DragEvent, path: string): void => {
    // Dragging a row that's part of the selection carries the whole selection.
    const carry = picked(path) ? [...selection.paths] : [path]
    onDragging(carry)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', carry.join('\n'))
  }
  const endDrag = (): void => {
    onDragging(null)
    setHint(null)
  }

  /** Can the current drag legally land in `dir`? Never into itself or its own
   *  descendant, and never a no-op back into the same parent. */
  const dropOk = (dir: string): boolean => {
    if (!dragging) return false
    return !dragging.some((p) => dir === p || dir.startsWith(p + '/'))
  }

  const overRow = (e: React.DragEvent, node: TreeNode): void => {
    if (!dragging) return
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const rel = (e.clientY - box.top) / box.height
    // A folder takes items *into* itself in the middle band; the outer thirds
    // reorder around it. A note only ever reorders.
    let next: Hint = null
    if (node.type === 'dir' && rel > 0.25 && rel < 0.75 && dropOk(node.path)) {
      next = { kind: 'into', path: node.path }
    } else if (reorders && dropOk(parentOf(node.path))) {
      next = { kind: 'sibling', path: node.path, after: rel >= 0.5 }
    } else if (node.type === 'dir' && dropOk(node.path)) {
      next = { kind: 'into', path: node.path }
    }
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setHint(next)
  }

  const drop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const carry = dragging
    const h = hint
    endDrag()
    clearSel()
    if (!carry || !h) return
    if (h.kind === 'into') onMove(carry, h.path, null, false)
    else onMove(carry, parentOf(h.path), h.path, h.after)
  }

  const dropHintClass = (path: string): string => {
    if (!hint) return ''
    if (hint.kind === 'into' && hint.path === path) return ' drop-into'
    if (hint.kind === 'sibling' && hint.path === path)
      return hint.after ? ' drop-after' : ' drop-before'
    return ''
  }

  // ----- row renderers -----
  const rowClass = (node: TreeNode): string => {
    const isPicked = picked(node.path)
    const open = openPath === node.path
    // Selection wins over "open" so a ctrl-click always shows visibly, including
    // on the note you're reading; is-open keeps an outline so it stays findable.
    const tone = isPicked
      ? `row-picked${open ? ' is-open' : ''}`
      : open
        ? 'bg-brand-500/12 ring-1 ring-brand-300/50'
        : 'hover:bg-surface/70'
    return (
      'tree-row group flex cursor-pointer items-center pr-1.5 text-left ' +
      tone +
      (dragging?.includes(node.path) ? ' dragging' : '') +
      dropHintClass(node.path)
    )
  }

  const grip = (path: string): React.JSX.Element => (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        toggleSel(path)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          toggleSel(path)
        }
      }}
      className={
        'grip shrink-0 cursor-grab text-ink-300 outline-none active:cursor-grabbing' +
        (picked(path) ? ' is-on' : '')
      }
      title={picked(path) ? 'Click to deselect · drag to move' : 'Click to select · drag to move'}
    >
      <Icon name="grip" />
    </span>
  )

  const noteRow = (node: TreeNode, depth: number): React.JSX.Element => {
    const open = openPath === node.path
    const stamp = shelved ? onDate(metaOf(workspace, node.path).archivedAt) : null
    const isPinned = metaOf(workspace, node.path).pinned === true
    return (
      <div
        key={node.path}
        role="button"
        tabIndex={0}
        className={rowClass(node)}
        style={{ paddingLeft: padFor(depth) }}
        draggable={!shelved}
        onDragStart={shelved ? undefined : (e) => startDrag(e, node.path)}
        onDragEnd={endDrag}
        onDragOver={(e) => overRow(e, node)}
        onDrop={drop}
        onContextMenu={(e) => onContext(e, node)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            toggleSel(node.path)
            return
          }
          // Clicking a row you've already selected lets go of it — no hunting
          // for empty sidebar space to get out of a selection.
          if (picked(node.path)) {
            toggleSel(node.path)
            return
          }
          clearSel()
          onOpen(node.path)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen(node.path)
        }}
      >
        {!shelved && grip(node.path)}
        <span className={'shrink-0 ' + (open || picked(node.path) ? 'text-brand-600' : 'text-ink-300')}>
          <Icon name="doc" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="tree-title truncate font-medium text-ink-900">{labelOf(node)}</span>
          {/* hidden entirely at ultra density — see --row-sub-display */}
          <span className="tree-sub truncate text-ink-500">
            {stamp ? `Archived ${stamp}` : node.preview || 'Empty note'}
          </span>
        </span>

        {shelved ? (
          <RowBtn
            title="Restore to notes"
            always
            onClick={(e) => {
              e.stopPropagation()
              onRestore([node.path])
            }}
          >
            <Icon name="restore" />
          </RowBtn>
        ) : (
          <>
            <RowBtn
              title={isPinned ? 'Unpin' : 'Pin to favourites'}
              tone={isPinned ? 'brand' : 'ink'}
              always={isPinned}
              onClick={(e) => {
                e.stopPropagation()
                onTogglePin([node.path], !isPinned)
              }}
            >
              <Icon name={isPinned ? 'starFilled' : 'star'} />
            </RowBtn>
            <RowBtn
              title="Move to bin"
              onClick={(e) => {
                e.stopPropagation()
                onTrash([node.path])
              }}
            >
              <Icon name="trash" />
            </RowBtn>
          </>
        )}
      </div>
    )
  }

  const folderRow = (node: TreeNode, depth: number): React.JSX.Element => {
    const kids = sortSiblings(node.children ?? [], workspace, freeArrange)
    const count = kids.length
    const expandedNow = isOpen(node.path)
    const isPinned = metaOf(workspace, node.path).pinned === true
    return (
      <div key={node.path}>
        <div
          className={rowClass(node)}
          style={{ paddingLeft: padFor(depth) }}
          draggable={!shelved}
          onDragStart={shelved ? undefined : (e) => startDrag(e, node.path)}
          onDragEnd={endDrag}
          onDragOver={(e) => overRow(e, node)}
          onDrop={drop}
          onContextMenu={(e) => onContext(e, node)}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault()
              toggleSel(node.path)
              return
            }
            toggle(node.path)
          }}
        >
          {!shelved && grip(node.path)}
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.path)
            }}
            title={expandedNow ? 'Collapse' : 'Expand'}
            className="shrink-0 rounded border-none bg-transparent p-0.5 text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
          >
            <span className={'chev inline-flex' + (expandedNow ? ' open' : '')}>
              <Icon name="chevron" />
            </span>
          </button>
          <span className={'shrink-0 ' + (picked(node.path) ? 'text-brand-600' : 'text-brand-500/80')}>
            <Icon name="folder" />
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggle(node.path)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onRename(node)
            }}
            className="tree-title min-w-0 flex-1 truncate border-none bg-transparent p-0 text-left font-semibold text-ink-800 outline-none hover:bg-transparent"
          >
            {node.name}
          </button>
          {count > 0 && <span className="shrink-0 px-0.5 text-xs text-ink-300">{count}</span>}

          {shelved ? (
            <RowBtn
              title="Restore folder and its contents"
              always
              onClick={(e) => {
                e.stopPropagation()
                onRestore([node.path])
              }}
            >
              <Icon name="restore" />
            </RowBtn>
          ) : (
            <>
              <RowBtn
                title="New note in folder"
                onClick={(e) => {
                  e.stopPropagation()
                  onNewNoteIn(node.path)
                }}
              >
                <Icon name="filePlus" />
              </RowBtn>
              <RowBtn
                title="New subfolder"
                onClick={(e) => {
                  e.stopPropagation()
                  onNewFolderIn(node.path)
                }}
              >
                <Icon name="folderPlus" />
              </RowBtn>
              <RowBtn
                title={isPinned ? 'Unpin folder' : 'Pin folder'}
                tone={isPinned ? 'brand' : 'ink'}
                always={isPinned}
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin([node.path], !isPinned)
                }}
              >
                <Icon name={isPinned ? 'starFilled' : 'star'} />
              </RowBtn>
              {organize && (
                <>
                  <RowBtn
                    title="Rename folder"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRename(node)
                    }}
                  >
                    <Icon name="edit" />
                  </RowBtn>
                  <RowBtn
                    title="Move folder to bin"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTrash([node.path])
                    }}
                  >
                    <Icon name="trash" />
                  </RowBtn>
                </>
              )}
            </>
          )}
        </div>

        {expandedNow && (
          <div className="mt-0.5">
            {kids.map((k) => renderRow(k, depth + 1))}
            {count === 0 && (
              <p
                onDragOver={(e) => {
                  if (shelved || !dropOk(node.path)) return
                  e.preventDefault()
                  e.stopPropagation()
                  setHint({ kind: 'into', path: node.path })
                }}
                onDrop={drop}
                className={
                  'rounded-lg py-1.5 text-xs italic text-ink-300 ' +
                  (hint?.kind === 'into' && hint.path === node.path ? 'bg-brand-50' : '')
                }
                style={{ paddingLeft: padFor(depth + 1) }}
              >
                {shelved ? 'Empty' : 'Empty — drop items here'}
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderRow = (node: TreeNode, depth: number): React.JSX.Element =>
    node.type === 'dir' ? folderRow(node, depth) : noteRow(node, depth)

  const ordered = sortSiblings(nodes, workspace, freeArrange)

  return (
    <div
      onDragOver={(e) => {
        if (shelved || !dropOk(rootDir)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setHint({ kind: 'into', path: rootDir })
      }}
      onDrop={drop}
      onClick={(e) => {
        if (e.target === e.currentTarget) clearSel()
      }}
    >
      {ordered.map((n) => renderRow(n, 0))}
    </div>
  )
}
