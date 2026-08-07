import { useEffect, useRef, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import type { Workspace } from '../../shared/workspace'
import type { ColorStyle } from '../../shared/settings'
import { inkOn, rgbChannels } from '../../shared/color'
import { Icon } from './icons'
import { colorOf, labelOf, metaOf, onDate, sortSiblings } from './organise/model'

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
  /** Open the colour picker for these rows, anchored to `at`. The popover
   *  itself lives in App, not here: there are four TreeViews on screen and a
   *  per-instance one could put two pickers up at once — the same reason
   *  HoverCard and ContextMenu are single and portalled. */
  onPickColor: (paths: string[], at: { left: number; top: number; bottom: number }) => void
}

interface Props extends TreeActions {
  nodes: TreeNode[]
  workspace: Workspace
  openPath: string | null
  freeArrange: boolean
  /** where an entry's colour is painted — the grip, or the whole row */
  colorStyle: ColorStyle
  /** whether an uncoloured row shows its nearest coloured ancestor's colour */
  colorInherit: boolean
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
  colorStyle,
  colorInherit,
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
  onRename,
  onPickColor
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

  // ----- selection -----
  //
  // Selecting is a MODE, entered by clicking a row's six-dot grip. The first
  // click is the only one that has to hit the dots: from then on a plain click
  // anywhere on any row adds it to the set or takes it out again, because once
  // you are picking things to bin or archive, "click the thing" is what the
  // hand wants to do — hunting for a 16px target on each subsequent row was the
  // friction that made multi-select not worth using.
  //
  // The mode ends only on Escape or the Clear button in the selection bar
  // (Sidebar.tsx), never by clicking away — an accidental click on the
  // background used to throw away a set you had spent a dozen clicks building.
  const picked = (p: string): boolean => selection.paths.has(p)
  /** True while a selection exists, i.e. while a plain click means "select". */
  const selecting = selection.paths.size > 0
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
    // A completed move ends the selection: the whole point of building the set
    // was to move it, and the items are now where you put them. Escape and
    // Clear are the only ways OUT of the mode; finishing the job is not the
    // same thing as backing out of it.
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

  // ----- colour -----
  // Resolved per row: its own colour, or the nearest coloured ancestor's when
  // the space inherits. The shelf views (archive, bin) don't paint it — they
  // are a different list about a different thing, and colour there would read
  // as a status rather than as which folder something came from.
  const rowColor = (path: string): ReturnType<typeof colorOf> =>
    shelved ? null : colorOf(workspace, path, colorInherit)

  /** The two custom properties app.css's `.tint-*` rules paint from. Inline
   *  because the value is the user's data, not a design token — the STYLING
   *  stays in the stylesheet (rule 5). */
  const colorVars = (c: ReturnType<typeof colorOf>): React.CSSProperties =>
    c
      ? ({
          '--row-rgb': rgbChannels(c.hex),
          '--row-ink': inkOn(c.hex) === 'dark' ? '0 0 0' : '255 255 255'
        } as React.CSSProperties)
      : {}

  /** Colouring acts on the whole selection when the row is part of it — the
   *  same rule dragging follows, so "select three, colour them" works. */
  const colorTargets = (path: string): string[] =>
    picked(path) ? [...selection.paths] : [path]

  const openColor = (e: React.MouseEvent, path: string): void => {
    e.stopPropagation()
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onPickColor(colorTargets(path), { left: box.left, top: box.top, bottom: box.bottom })
  }

  // ----- row renderers -----
  const rowClass = (node: TreeNode, c: ReturnType<typeof colorOf>): string => {
    const isPicked = picked(node.path)
    const open = openPath === node.path
    // 'row' and 'solid' both own the row's background; 'tag' only paints the grip.
    const painted = !!c && colorStyle !== 'tag'
    // Selection wins over "open" so a picked row always shows visibly, including
    // on the note you're reading; is-open keeps an outline so it stays findable.
    // A painted row keeps its colour under BOTH (app.css layers the selection
    // ring over it) — losing the colour on the row you just clicked is exactly
    // when you're trying to see which group it belongs to.
    const tone = isPicked
      ? `row-picked${open ? ' is-open' : ''}`
      : open && !painted
        ? 'bg-brand-500/12 ring-1 ring-brand-300/50'
        : ''
    // Tailwind's hover background is emitted only when nothing else owns the
    // row's background. A utility and an app.css rule at the same specificity
    // would be decided by source order, which is the drift CLAUDE.md warns
    // about — so the component opts out in JS instead.
    const hover = !painted && !isPicked && !open ? 'hover:bg-surface/70' : ''
    const paint = !c
      ? ''
      : colorStyle === 'tag'
        ? 'tint-tag '
        : `tint-${colorStyle}${open ? ' is-open' : ''} `
    return (
      'tree-row group flex cursor-pointer items-center pr-1.5 text-left ' +
      paint +
      tone +
      (tone && hover ? ' ' : '') +
      hover +
      (dragging?.includes(node.path) ? ' dragging' : '') +
      dropHintClass(node.path)
    )
  }

  /** The row's colour control: a swatch when it has one, an outline when it
   *  doesn't. In the hover-action group beside pin and bin, because that is
   *  where the app already puts "do something to this row". */
  const colorBtn = (path: string): React.JSX.Element => {
    const c = rowColor(path)
    return (
      <RowBtn
        title={c ? (c.own ? `Colour · ${c.hex}` : `Colour · inherited from ${c.from}`) : 'Set a colour'}
        onClick={(e) => openColor(e, path)}
      >
        <span
          aria-hidden="true"
          className={
            'block h-3.5 w-3.5 rounded-full ' +
            (c ? 'ring-1 ring-wash/25' : 'border border-dashed border-current')
          }
          style={c ? { background: `rgb(${rgbChannels(c.hex)})` } : undefined}
        />
      </RowBtn>
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
    const c = rowColor(node.path)
    return (
      <div
        key={node.path}
        role="button"
        tabIndex={0}
        className={rowClass(node, c)}
        style={{ paddingLeft: padFor(depth), ...colorVars(c) }}
        draggable={!shelved}
        onDragStart={shelved ? undefined : (e) => startDrag(e, node.path)}
        onDragEnd={endDrag}
        onDragOver={(e) => overRow(e, node)}
        onDrop={drop}
        onContextMenu={(e) => onContext(e, node)}
        onClick={(e) => {
          // Cmd/Ctrl+click opens the note in ANOTHER tab beside the current one.
          // It does NOT clear the selection: the mode is only ended by Escape or
          // Clear, so reaching for a note mid-selection can't cost you the set.
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            onOpen(node.path, true)
            return
          }
          // In selection mode a plain click is the select gesture — on this row
          // whether it is already in the set or not.
          if (selecting) {
            toggleSel(node.path)
            return
          }
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
              {colorBtn(node.path)}
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
    const c = rowColor(node.path)
    return (
      <div key={node.path}>
        <div
          // Scrolled to when the path bar reveals this folder. A ref on the row
          // rather than a querySelector from Sidebar: the row knows whether it
          // is the target, and a selector would have to guess which of the four
          // TreeViews rendered it.
          ref={node.path === revealTarget ? revealRef : undefined}
          className={rowClass(node, c)}
          style={{ paddingLeft: padFor(depth), ...colorVars(c) }}
          draggable={!shelved}
          onDragStart={shelved ? undefined : (e) => startDrag(e, node.path)}
          onDragEnd={endDrag}
          onDragOver={(e) => overRow(e, node)}
          onDrop={drop}
          onContextMenu={(e) => onContext(e, node)}
          onClick={() => {
            // In selection mode the row joins the set instead of expanding. The
            // chevron beside it still expands (it stops propagation), which is
            // the point: you often need to open a folder to reach the subnotes
            // you are trying to select.
            if (selecting) toggleSel(node.path)
            else toggle(node.path)
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
              // The name is part of the row, not part of the expander — so in
              // selection mode it selects, like the rest of the row.
              if (selecting) toggleSel(node.path)
              else toggle(node.path)
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
                {colorBtn(node.path)}
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
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) onContext(e, null)
      }}
    >
      {ordered.map((n) => renderRow(n, 0))}
    </div>
  )
}
