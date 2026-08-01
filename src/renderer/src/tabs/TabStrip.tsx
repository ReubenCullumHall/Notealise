import { useState } from 'react'
import { Icon } from '../icons'
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
  /** a tab drag started/ended — the panes show their drop zones while it runs */
  onDragTab: (path: string | null) => void
  /** open an empty tab ("+"), which asks you to pick a note */
  onNewTab: () => void
  dragging: Drag | null
}

const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const stripMd = (s: string): string => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s)

// Active/inactive follow the sidebar's space switcher rather than inventing a
// second "selected" idiom: accent border + wash for the one you're on, a plain
// hairline for the rest. `btn-edge` opts the inactive ones into the
// button-definition setting; the active tab keeps its accent border, which is
// how you can see which one you're in (CLAUDE.md, Tailwind-vs-app.css note).
const TAB_BASE =
  'group flex shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg border py-1 pl-3 pr-1 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 '
const TAB_ON = 'border-brand-400/60 bg-brand-500/15 text-brand-600 '
// A pane in a split that isn't the focused one: on screen, but not where the
// format bar and the keyboard are pointing. Quieter than active, louder than
// merely open.
const TAB_SHOWN = 'btn-edge border-brand-400/30 bg-surface/60 text-ink-700 hover:text-brand-600 '
const TAB_OFF =
  'btn-edge border-ink-300/25 bg-transparent text-ink-500 hover:bg-brand-500/10 hover:text-brand-600 '

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
  onDragTab,
  onNewTab,
  dragging
}: Props): React.JSX.Element {
  // The gap the dragged tab would land in: the path it goes before, or null for
  // "the end". `undefined` means no indicator at all (not over the strip).
  const [before, setBefore] = useState<string | null | undefined>(undefined)

  const over = (e: React.DragEvent, path: string | null): void => {
    // A column being dragged is rearranging the SPLIT, not the strip; the panes
    // handle that drop, and the strip stays out of it.
    if (dragging?.kind !== 'tab') return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (path === null) {
      setBefore(null)
      return
    }
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const rightHalf = e.clientX - box.left > box.width / 2
    const at = tabs.indexOf(path)
    setBefore(rightHalf ? (tabs[at + 1] ?? null) : path)
  }

  const drop = (e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (dragging?.kind === 'tab' && before !== undefined) onReorder(dragging.path, before)
    setBefore(undefined)
  }

  const marker = (path: string | null): React.JSX.Element | null =>
    dragging?.kind === 'tab' && before === path ? (
      <span className="mx-px h-6 w-0.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
    ) : null

  return (
    <div
      className="tab-strip flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink-300/25 bg-surface/40 px-2 py-1.5 backdrop-blur"
      role="tablist"
      aria-label="Open notes"
      onDragOver={(e) => over(e, null)}
      onDrop={drop}
      onDragLeave={() => setBefore(undefined)}
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
              title={path || 'Waiting for a note'}
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
                setBefore(undefined)
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
              <span className="max-w-[168px] truncate font-medium">{title}</span>
              <button
                type="button"
                aria-label={`Close ${title}`}
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(path)
                }}
                className={
                  'flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent p-0 text-current outline-none transition duration-150 hover:bg-ink-300/20 focus-visible:opacity-100 group-hover:opacity-100 ' +
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
        title="New tab"
        aria-label="New tab"
        onClick={onNewTab}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-none bg-transparent p-0 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
  )
}
