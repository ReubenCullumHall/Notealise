import { useState } from 'react'
import { Icon } from '../icons'
import { BLANK, MAX_PANES } from './model'
import type { Drag } from './NotePane'

interface Props {
  /** open notes in strip order (vault-relative paths) */
  tabs: string[]
  /** the note each pane is showing — these read as "on screen" in the strip */
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

// Active/inactive follow the sidebar's space switcher rather than inventing a
// second "selected" idiom: accent border + wash for the one you're on, a plain
// hairline for the rest. `btn-edge` opts the inactive ones into the
// button-definition setting; the active tab keeps its accent border, which is
// how you can see which one you're in (CLAUDE.md, Tailwind-vs-app.css note).
const TAB_BASE =
  'press-row group relative flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg border py-1 pl-3 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
const TAB_ON = 'border-brand-400/60 bg-brand-500/12 text-brand-600 '
// A pane in a split that isn't the focused one: on screen, but not where the
// format bar and the keyboard are pointing. Quieter than active, louder than
// merely open.
const TAB_SHOWN = 'btn-edge border-brand-400/30 bg-surface/60 text-ink-700 hover:text-ink-900 '
const TAB_OFF =
  'btn-edge border-ink-300/25 bg-transparent text-ink-500 hover:bg-ink-300/15 hover:text-ink-900 '

/** The strip of open notes across the top of the editor area. Click to focus,
 *  × (or middle-click) to close, drag to reorder — or drag onto a pane's edge
 *  to split, which the panes themselves handle. */
export function TabStrip({
  tabs,
  panes,
  active,
  onSelect,
  onClose,
  onReorder,
  onSplitWith,
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
    if (dragging?.kind !== 'tab') return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (path === null) {
      setBefore(null)
      setSplitOn(null)
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
    if (dragging?.kind === 'tab') {
      if (splitOn !== null) onSplitWith(splitOn, dragging.path)
      else if (before !== undefined) onReorder(dragging.path, before)
    }
    clear()
  }

  const marker = (path: string | null): React.JSX.Element | null =>
    dragging?.kind === 'tab' && before === path ? (
      <span className="mx-px h-6 w-0.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
    ) : null

  return (
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
      {tabs.map((path) => {
        const on = path === active
        const shown = !on && panes.includes(path)
        // A blank tab ("+") has no file behind it, so it says what it wants.
        const title = path === '' ? 'Select a note' : stripMd(nameOf(path))
        return (
          <div key={path} className="flex shrink-0 items-center">
            {marker(path)}
            <div
              role="tab"
              tabIndex={0}
              aria-selected={on}
              data-tip={path || 'Waiting for a note'}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                // A private type: the sidebar tree gates its drops on its own
                // state, so a tab must never look like a note being moved.
                e.dataTransfer.setData('application/x-notes-tab', path)
                onDragTab(path)
              }}
              onDragEnd={() => {
                onDragTab(null)
                clear()
              }}
              onDragOver={(e) => over(e, path)}
              onDrop={drop}
              onClick={() => onSelect(path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(path)
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(path) // middle-click, as in a browser
              }}
              className={
                TAB_BASE +
                (on ? TAB_ON : shown ? TAB_SHOWN : TAB_OFF) +
                (dragging?.path === path ? 'opacity-40 ' : '')
              }
            >
              {/* What the drop would do, drawn in the tab itself: the note you
                  are pointing at keeps the left half and the dragged one
                  arrives in a column on the right. Same accent-edge idiom the
                  panes use for their own drop zones (NotePane's `zoneBox`) —
                  on the dark themes a wash alone is very nearly invisible, so
                  the border is what reads. */}
              {splitOn === path && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-1/2 rounded-r-lg border-l-2 border-brand-400 bg-brand-500/20"
                />
              )}
              <span className="max-w-[168px] truncate font-medium">{title}</span>
              <button
                type="button"
                aria-label={`Close ${title}`}
                data-tip="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(path)
                }}
                className={
                  'press flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent p-0 text-current outline-none transition duration-150 hover:bg-ink-300/20 focus-visible:opacity-100 group-hover:opacity-100 ' +
                  (on ? 'opacity-70 ' : 'opacity-0 ')
                }
              >
                <Icon name="x" className="h-3 w-3" />
              </button>
            </div>
          </div>
        )
      })}
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
  )
}
