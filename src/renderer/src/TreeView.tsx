import { useEffect, useRef, useState } from 'react'
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
  /** `newTab` — Cmd/Ctrl+click: open beside what's already open instead of
   *  replacing it. A plain click behaves as it always has. */
  onOpen: (path: string, newTab?: boolean) => void
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
  mode: RowMode
  selection: Selection
  onSelectionChange: (next: Selection) => void
  /** lifted so the whole sidebar knows a drag is in progress (drop zones appear) */
  dragging: string[] | null
  onDragging: (paths: string[] | null) => void
  /** '' = vault root — the drop target for empty background. */
  rootDir?: string
  /** Which folders are open, owned by Sidebar and shared by all four TreeViews.
   *
   *  This used to be per-instance state XOR'd against `workspace`'s `collapsed`
   *  flag — so membership in the set did not mean "expanded", and the same folder
   *  toggled independently in the pinned tree and the main one. Neither survives
   *  "open this folder and close every other one", which needs one answer for
   *  the whole sidebar. */
  expanded: Set<string>
  onToggleExpand: (path: string) => void
  /** scroll this row into view once, after a reveal from the path bar */
  revealTarget?: string | null
}

const parentOf = (p: string): string => {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

/** Indentation is expressed in the density variables, so changing the density
 *  re-indents the tree without React re-measuring anything. */
const padFor = (depth: number): string =>
  `calc(var(--row-pad0) + ${depth} * var(--row-indent))`

/** Hover-only actions (new note, new folder, trash, unset pin/star…) float over
 *  the row instead of reserving flow width — `opacity-0` alone still occupies
 *  layout space, which is what was starving the name column and shoving the
 *  visible content to the left of the row even at rest. `always` actions (a
 *  set pin, restore in a shelf view) stay in flow beside them since they're
 *  meant to be visible without hovering. */
const ROW_ACTIONS_CLASS =
  'absolute right-1.5 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md ' +
  'bg-surface/95 px-1 py-0.5 opacity-0 shadow-card backdrop-blur-sm pointer-events-none ' +
  'transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto ' +
  'focus-within:opacity-100 focus-within:pointer-events-auto'

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
      data-tip={title}
      aria-label={title}
      className={
        'inline-flex shrink-0 items-center justify-center rounded border-none bg-transparent p-0.5 outline-none transition-colors hover:bg-transparent ' +
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
  mode,
  selection,
  onSelectionChange,
  dragging,
  onDragging,
  rootDir = '',
  expanded,
  onToggleExpand,
  revealTarget,
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

  const isOpen = (p: string): boolean => expanded.has(p)
  const toggle = onToggleExpand

  // Bring a revealed folder into view. `block: 'nearest'` so a folder already on
  // screen doesn't jump — the reveal is about what is open, not about scrolling
  // for its own sake.
  const revealRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (revealTarget && revealRef.current) {
      revealRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [revealTarget])

  // ----- selection (ctrl/cmd-click adds to the set, like a file explorer) -----
  const picked = (p: string): boolean => selection.paths.has(p)
  const toggleSel = (p: string): void => {
    const next = new Set(selection.paths)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    onSelectionChange({ paths: next })
  }
  const clearSel = (): void => onSelectionChange({ paths: new Set() })

  // ----- drag & drop (always on) -----
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
      data-tip={picked(path) ? 'Click to deselect · drag to move' : 'Click to select · drag to move'}
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
          // Cmd/Ctrl+click opens the note in ANOTHER tab beside the current one.
          // It used to add the row to the selection; selecting is now the grip's
          // job (the six dots), which is a target you can hit on purpose rather
          // than a modifier that competes with opening.
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            clearSel()
            onOpen(node.path, true)
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
            {isPinned && (
              <RowBtn
                title="Unpin"
                tone="brand"
                always
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin([node.path], !isPinned)
                }}
              >
                <Icon name="starFilled" />
              </RowBtn>
            )}
            <div className={ROW_ACTIONS_CLASS}>
              {!isPinned && (
                <RowBtn
                  title="Pin to favourites"
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePin([node.path], !isPinned)
                  }}
                >
                  <Icon name="star" />
                </RowBtn>
              )}
              <RowBtn
                title="Move to bin"
                onClick={(e) => {
                  e.stopPropagation()
                  onTrash([node.path])
                }}
              >
                <Icon name="trash" />
              </RowBtn>
            </div>
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
          // Scrolled to when the path bar reveals this folder. A ref on the row
          // rather than a querySelector from Sidebar: the row knows whether it
          // is the target, and a selector would have to guess which of the four
          // TreeViews rendered it.
          ref={node.path === revealTarget ? revealRef : undefined}
          className={rowClass(node)}
          style={{ paddingLeft: padFor(depth) }}
          draggable={!shelved}
          onDragStart={shelved ? undefined : (e) => startDrag(e, node.path)}
          onDragEnd={endDrag}
          onDragOver={(e) => overRow(e, node)}
          onDrop={drop}
          onContextMenu={(e) => onContext(e, node)}
          onClick={() => {
            // No modifier branch: a folder has nothing to open in a tab, and if
            // Cmd/Ctrl still meant "select" here, the six dots would be the way
            // to select a note while a modifier selected a folder.
            toggle(node.path)
          }}
        >
          {!shelved && grip(node.path)}
          {/* Chevron + folder icon share a tight inner gap, distinct from the
              row's wider --row-gap between other elements — both already
              toggle the same collapse, so the space between them is just
              dead air, not a meaningful separation. */}
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.path)
              }}
              data-tip={expandedNow ? 'Collapse' : 'Expand'}
              className="inline-flex shrink-0 items-center justify-center rounded border-none bg-transparent p-0.5 text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
            >
              <span className={'chev inline-flex' + (expandedNow ? ' open' : '')}>
                <Icon name="chevron" />
              </span>
            </button>
            <span className={picked(node.path) ? 'text-brand-600' : 'text-brand-500/80'}>
              <Icon name="folder" />
            </span>
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
              {isPinned && (
                <RowBtn
                  title="Unpin folder"
                  tone="brand"
                  always
                  onClick={(e) => {
                    e.stopPropagation()
                    onTogglePin([node.path], !isPinned)
                  }}
                >
                  <Icon name="starFilled" />
                </RowBtn>
              )}
              <div className={ROW_ACTIONS_CLASS}>
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
                {!isPinned && (
                  <RowBtn
                    title="Pin folder"
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin([node.path], !isPinned)
                    }}
                  >
                    <Icon name="star" />
                  </RowBtn>
                )}
              </div>
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
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) onContext(e, null)
      }}
    >
      {ordered.map((n) => renderRow(n, 0))}
    </div>
  )
}
