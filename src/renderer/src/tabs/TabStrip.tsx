import { useState } from 'react'
import { Icon } from '../icons'
import { BLANK, MAX_PANES, stripGroups } from './model'
import type { Drag } from './NotePane'

interface Props {
  /** open notes in strip order (vault-relative paths) */
  tabs: string[]
  /** the note each pane is showing, left to right. Two or more of these and the
   *  strip draws them as ONE grouped tab — see `stripGroups`. */
  panes: string[]
  /** the focused pane's note */
  active: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  /** strip reorder: put `path` before `before` (null = last) */
  onReorder: (path: string, before: string | null) => void
  /** split two open notes: `target` (the tab dropped ONTO) takes the left
   *  column, `dragged` arrives on its right */
  onSplitWith: (target: string, dragged: string) => void
  /** move the whole group to sit before `before` (null = last) */
  onMoveGroup: (before: string | null) => void
  /** take one note out of the split — its column closes, the tab stays open */
  onTakeOutOfSplit: (path: string) => void
  /** end the split: one column, everything else still open behind it */
  onUngroup: () => void
  /** a tab drag started/ended — the panes show their drop zones while it runs */
  onDragTab: (path: string | null) => void
  /** open an empty tab ("+"), which asks you to pick a note */
  onNewTab: () => void
  dragging: Drag | null
  /** fade this out of the way (Settings → While scrolling → "Keep the tab
   *  strip on screen", off). Its layout space stays reserved — nothing below
   *  it reflows — same as the links block and the note's own heading row. */
  hidden: boolean
}

const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const stripMd = (s: string): string => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s)
const titleOf = (p: string): string => (p === BLANK ? 'Select a note' : stripMd(nameOf(p)))

// Active/inactive follow the sidebar's space switcher rather than inventing a
// second "selected" idiom: accent border + wash for the one you're on, a plain
// hairline for the rest. `btn-edge` opts the inactive ones into the
// button-definition setting; the active tab keeps its accent border, which is
// how you can see which one you're in (CLAUDE.md, Tailwind-vs-app.css note).
const TAB_BASE =
  'press-row group relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg border py-1 pl-3 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
const TAB_ON = 'border-brand-400/60 bg-brand-500/15 text-brand-600 '
const TAB_OFF =
  'btn-edge border-ink-300/25 bg-transparent text-ink-500 hover:bg-ink-300/15 hover:text-ink-900 '

// A SEGMENT of a grouped tab. The group draws the one border round the lot, so
// a segment has none of its own — what separates two of them is the divider
// below, and what marks the focused one is the accent wash it shares with a
// lone active tab. TAB_SHOWN (a second, quieter "this is on screen" border)
// used to say what the grouping now says outright, and went with this change.
const SEG_BASE =
  'press-row group/seg relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-md py-0.5 pl-2.5 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
const SEG_ON = 'bg-brand-500/15 text-brand-600 '
const SEG_OFF = 'text-ink-600 hover:bg-ink-300/15 hover:text-ink-900 '

/** The strip of open notes across the top of the editor area. Click to focus,
 *  × (or middle-click) to close, drag to reorder — or drag onto a pane's edge
 *  to split, which the panes themselves handle.
 *
 *  **Notes sharing the screen share a tab.** Two or three columns render as one
 *  wide pill with a divider between each name, in the order they sit on screen,
 *  so the strip shows the split before you have looked at it (Reuben,
 *  2026-09-06). The pill's grip drags the whole group along the strip; a name
 *  inside it drags out of the split; right-clicking one offers both in words. */
export function TabStrip({
  tabs,
  panes,
  active,
  onSelect,
  onClose,
  onReorder,
  onSplitWith,
  onMoveGroup,
  onTakeOutOfSplit,
  onUngroup,
  onDragTab,
  onNewTab,
  dragging,
  hidden
}: Props): React.JSX.Element {
  // The gap the dragged tab would land in: the path it goes before, or null for
  // "the end". `undefined` means no indicator at all (not over the strip).
  const [before, setBefore] = useState<string | null | undefined>(undefined)
  // The tab a drop would SPLIT against, rather than reorder past. Never set at
  // the same time as `before` — a drop is one gesture or the other, decided by
  // where in the target tab the pointer is.
  const [splitOn, setSplitOn] = useState<string | null>(null)
  // A group being dragged along the strip. Local, not App's `drag`: a group has
  // no meaning to a pane, and leaving App's state null is what keeps the panes'
  // drop zones from lighting up for a gesture they cannot answer.
  const [groupDrag, setGroupDrag] = useState(false)
  // Which segment's right-click menu is open, and where.
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)

  const items = stripGroups({ tabs, panes, focus: 0 })
  const grouped = panes.length > 1

  /** Whether dropping on `target`'s middle can actually produce a split, which
   *  is what decides whether the middle third is offered at all. An indicator
   *  for a drop the model would refuse (`splitWith` returns the layout it was
   *  given) is worse than no indicator: it promises a column that never comes.
   *
   *  A note already in a pane needs no new column — it just moves — so the cap
   *  only applies to one arriving from the strip. The blank tab is excluded as
   *  a TARGET: "waiting for a note" has nothing to sit beside, and reordering
   *  is the only thing a drop on it can sensibly mean. It is fine as the thing
   *  DRAGGED, where it is exactly the Cmd/Ctrl+\ gesture done by hand. */
  const canSplitOnto = (target: string): boolean =>
    dragging?.kind === 'tab' &&
    dragging.path !== target &&
    target !== BLANK &&
    (panes.includes(dragging.path) || panes.length < MAX_PANES)

  const clear = (): void => {
    setBefore(undefined)
    setSplitOn(null)
  }

  const over = (e: React.DragEvent, path: string | null): void => {
    // A column being dragged is rearranging the SPLIT, not the strip; the panes
    // handle that drop, and the strip stays out of it.
    if (dragging?.kind !== 'tab' && !groupDrag) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (path === null) {
      setBefore(null)
      setSplitOn(null)
      return
    }
    // A group travels whole, so there is no half of it to split against and no
    // sense in dropping it inside itself — only the caret is offered.
    if (groupDrag) {
      if (panes.includes(path)) {
        clear()
        return
      }
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const at = tabs.indexOf(path)
      setSplitOn(null)
      setBefore((e.clientX - box.left) / box.width > 0.5 ? (tabs[at + 1] ?? null) : path)
      return
    }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    // Three zones, matching the pane's own `zoneAt`: the outer thirds keep the
    // reorder this strip has always done, the middle splits. Read off the event
    // rather than off state for the same reason NotePane does it — the drop
    // must land where the pointer is, not where the last dragover put it.
    if (x > 0.3 && x < 0.7 && canSplitOnto(path)) {
      setSplitOn(path)
      setBefore(undefined)
      return
    }
    const at = tabs.indexOf(path)
    setSplitOn(null)
    setBefore(x > 0.5 ? (tabs[at + 1] ?? null) : path)
  }

  const drop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (groupDrag) {
      if (before !== undefined) onMoveGroup(before)
    } else if (dragging?.kind === 'tab') {
      if (splitOn !== null) onSplitWith(splitOn, dragging.path)
      else if (before !== undefined) {
        // Dragged OUT of the group and dropped on the strip: leaving the split
        // is the gesture, and the strip position is where it lands. Two steps
        // because they are two different questions — App runs them in order.
        if (grouped && panes.includes(dragging.path)) onTakeOutOfSplit(dragging.path)
        onReorder(dragging.path, before)
      }
    }
    clear()
    setGroupDrag(false)
  }

  const marker = (path: string | null): React.JSX.Element | null =>
    (dragging?.kind === 'tab' || groupDrag) && before === path ? (
      <span className="mx-px h-6 w-0.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
    ) : null

  /** The shared bits of a clickable name — a lone tab and a group segment do
   *  the same four things, and only their skin differs. */
  const nameProps = (path: string): React.HTMLAttributes<HTMLDivElement> => ({
    onClick: () => onSelect(path),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(path)
      }
    },
    onAuxClick: (e) => {
      if (e.button === 1) onClose(path) // middle-click, as in a browser
    }
  })

  const closeButton = (path: string, on: boolean, inGroup: boolean): React.JSX.Element => (
    <button
      type="button"
      aria-label={`Close ${titleOf(path)}`}
      data-tip="Close tab"
      onClick={(e) => {
        e.stopPropagation()
        onClose(path)
      }}
      className={
        'press flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent p-0 text-current outline-none transition duration-150 hover:bg-ink-300/20 focus-visible:opacity-100 ' +
        (inGroup ? 'group-hover/seg:opacity-100 ' : 'group-hover:opacity-100 ') +
        (on ? 'opacity-70 ' : 'opacity-0 ')
      }
    >
      <Icon name="x" className="h-3 w-3" />
    </button>
  )

  const tabDragProps = (path: string): React.HTMLAttributes<HTMLDivElement> => ({
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = 'move'
      // A private type: the sidebar tree gates its drops on its own state, so a
      // tab must never look like a note being moved.
      e.dataTransfer.setData('application/x-notes-tab', path)
      onDragTab(path)
    },
    onDragEnd: () => {
      onDragTab(null)
      clear()
    },
    onDragOver: (e) => over(e, path),
    onDrop: drop
  })

  return (
    <>
    <div
      className={
        'tab-strip flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-300/25 bg-surface/40 px-2 py-1.5 backdrop-blur transition-[opacity,transform] duration-150 ' +
        (hidden ? 'pointer-events-none -translate-y-1 opacity-0' : 'translate-y-0 opacity-100')
      }
      role="tablist"
      aria-label="Open notes"
      onDragOver={(e) => over(e, null)}
      onDrop={drop}
      onDragLeave={clear}
    >
      {/* An empty strip has to be exactly as tall as a full one, or opening the
          first note shifts the page down — the thing reserving the space was
          meant to prevent. Held open by a real tab that happens to be invisible,
          so it can't drift out of step with the tab styling above it. */}
      {tabs.length === 0 && (
        <div className={TAB_BASE + TAB_OFF + 'invisible'} aria-hidden="true">
          <span className="font-medium">Untitled</span>
        </div>
      )}

      {items.map((item) =>
        item.length > 1 ? (
          // --- the grouped tab: every note currently on screen, in screen order
          <div key={'group:' + item.join('|')} className="flex shrink-0 items-center">
            {marker(item[0])}
            <div
              className={
                TAB_BASE.replace('pl-3 pr-1', 'gap-0.5 px-1') +
                'border-brand-400/50 bg-surface/60 ' +
                (groupDrag ? 'opacity-40 ' : '')
              }
              data-tip="These notes are sharing the screen"
              onDragOver={(e) => over(e, item[0])}
              onDrop={drop}
            >
              {/* The group's own drag handle. It has to be a distinct target:
                  the names inside are draggable too (dragging one takes it OUT
                  of the split), and two gestures that start in the same pixels
                  would be a coin toss. */}
              <span
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('application/x-notes-tabgroup', '1')
                  setGroupDrag(true)
                }}
                onDragEnd={() => {
                  setGroupDrag(false)
                  clear()
                }}
                data-tip="Drag to move these together"
                className="flex h-6 w-3.5 shrink-0 cursor-grab items-center justify-center text-ink-300 transition-colors duration-150 hover:text-ink-500 active:cursor-grabbing"
              >
                <Icon name="grip" className="h-3 w-3" />
              </span>
              {item.map((path, i) => (
                <div key={path || 'blank'} className="flex shrink-0 items-center">
                  {/* The divider IS the split: one per seam, never leading or
                      trailing, so the number of dividers reads as the number of
                      columns minus one. */}
                  {i > 0 && (
                    <span className="mx-0.5 h-4 w-px shrink-0 bg-ink-300/40" aria-hidden="true" />
                  )}
                  <div
                    role="tab"
                    tabIndex={0}
                    aria-selected={path === active}
                    data-tip={path || 'Waiting for a note'}
                    draggable
                    {...nameProps(path)}
                    {...tabDragProps(path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setMenu({ x: e.clientX, y: e.clientY, path })
                    }}
                    className={
                      SEG_BASE +
                      (path === active ? SEG_ON : SEG_OFF) +
                      (dragging?.path === path ? 'opacity-40 ' : '')
                    }
                  >
                    <span className="max-w-[168px] truncate font-medium">{titleOf(path)}</span>
                    {closeButton(path, path === active, true)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // --- an ordinary tab: open, but not on screen
          <div key={item[0] || 'blank'} className="flex shrink-0 items-center">
            {marker(item[0])}
            <div
              role="tab"
              tabIndex={0}
              aria-selected={item[0] === active}
              data-tip={item[0] || 'Waiting for a note'}
              draggable
              {...nameProps(item[0])}
              {...tabDragProps(item[0])}
              className={
                TAB_BASE +
                (item[0] === active ? TAB_ON : TAB_OFF) +
                (dragging?.path === item[0] ? 'opacity-40 ' : '')
              }
            >
              {/* What the drop would do, drawn in the tab itself: the note you
                  are pointing at keeps the left half and the dragged one
                  arrives in a column on the right. Same accent-edge idiom the
                  panes use for their own drop zones (NotePane's `zoneBox`) —
                  on the dark themes a wash alone is very nearly invisible, so
                  the border is what reads. */}
              {splitOn === item[0] && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-1/2 rounded-r-lg border-l-2 border-brand-400 bg-brand-500/20"
                />
              )}
              <span className="max-w-[168px] truncate font-medium">{titleOf(item[0])}</span>
              {closeButton(item[0], item[0] === active, false)}
            </div>
          </div>
        )
      )}
      {marker(null)}
      <button
        type="button"
        data-tip="New tab"
        aria-label="New tab"
        onClick={onNewTab}
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-none bg-transparent p-0 text-ink-400 outline-none transition duration-200 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
    {menu && (
      <TabGroupMenu
        x={menu.x}
        y={menu.y}
        path={menu.path}
        canTakeOut={panes.length > 1}
        onTakeOut={() => onTakeOutOfSplit(menu.path)}
        onUngroup={onUngroup}
        onClose={() => onClose(menu.path)}
        onDismiss={() => setMenu(null)}
      />
    )}
    </>
  )
}

/** The grouped tab's right-click menu. Every item names the note you clicked,
 *  because a group is several notes and "Close" alone would be a guess. */
function TabGroupMenu({
  x,
  y,
  path,
  canTakeOut,
  onTakeOut,
  onUngroup,
  onClose,
  onDismiss
}: {
  x: number
  y: number
  path: string
  canTakeOut: boolean
  onTakeOut: () => void
  onUngroup: () => void
  onClose: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const name = titleOf(path)
  const items = [
    ...(canTakeOut ? [{ label: `Take ${name} out of the split`, onClick: onTakeOut }] : []),
    { label: 'Split them all apart', onClick: onUngroup },
    { label: `Close ${name}`, onClick: onClose, danger: true }
  ]
  return (
    <div
      className="menu-backdrop"
      onClick={onDismiss}
      onContextMenu={(e) => {
        e.preventDefault()
        onDismiss()
      }}
    >
      <ul className="menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
        {items.map((it) => (
          <li
            key={it.label}
            className={it.danger ? 'menu-item danger' : 'menu-item'}
            onClick={() => {
              it.onClick()
              onDismiss()
            }}
          >
            {it.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
