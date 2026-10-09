import { useEffect, useRef } from 'react'
import { ArchiveIcon, Icon } from './icons'
import { DRAG_SEARCH } from './tabs/island'
import { onDate } from './organise/model'
import { archRowId, type ArchiveHit, type Mark } from './organise/archiveSearch'

// The archive's own search bar and its results (Reuben, 2026-10-08: the archive
// "has its own search bar"). It stands where the sidebar's search pill stands,
// in the same pill, so the two read as one family — but it is a different
// search: always the whole archive, always names, folders AND what the notes
// say, with no filters to set (organise/archiveSearch.ts). The archive box in
// place of the magnifier is what says which search you are typing into.
//
// The keyboard is the point of a search you use to FIND something: ↓ and ↑
// move through the results from the box, Enter opens, Cmd/Ctrl+Enter opens in
// a tab beside, Escape clears. Focus stays in the box the whole time.

interface BarProps {
  query: string
  onQuery: (q: string) => void
  /** ↓ / ↑ from the box; Enter opens the row the arrows are on (or the first) */
  onStep: (by: 1 | -1) => void
  onEnter: (newTab: boolean) => void
  /** id of the result the arrows are on, for screen readers */
  activeId?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}

export function ArchiveSearchBar({ query, onQuery, onStep, onEnter, activeId, inputRef }: BarProps): React.JSX.Element {
  return (
    <div className="px-3 pb-2">
      <div className="search-pill arch-pill btn-edge flex items-center gap-1.5 rounded-full border border-ink-300/30 bg-surface/70 py-1.5 pl-3 pr-1.5">
        {/* The archive box rather than a magnifier, and it stays while you type
            — unlike the sidebar search's glyph, it says WHICH search this is,
            which matters more once there are words in the box, not less. */}
        <span className="shrink-0 text-accent-500" aria-hidden="true">
          <ArchiveIcon className="h-4 w-4" />
        </span>
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300"
          value={query}
          placeholder="Search the archive"
          aria-label="Search the archive"
          role="combobox"
          aria-expanded={!!query}
          aria-controls="arch-results"
          aria-activedescendant={activeId}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              onStep(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              onEnter(e.metaKey || e.ctrlKey)
            } else if (e.key === 'Escape' && query) {
              // Clear first; a second Escape is left to whatever else listens.
              e.stopPropagation()
              onQuery('')
            }
          }}
          spellCheck={false}
        />
        {query && (
          <button
            onClick={() => onQuery('')}
            data-tip="Clear the search"
            aria-label="Clear the search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none bg-transparent p-0 text-accent-500 outline-none transition duration-200 hover:bg-ink-300/15 hover:text-accent-600 focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

/** `text` with the stretches in `marks` highlighted. */
function Marked({ text, marks }: { text: string; marks: Mark[] }): React.JSX.Element {
  if (!marks.length) return <>{text}</>
  const out: React.ReactNode[] = []
  let at = 0
  marks.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a))
    out.push(
      <mark key={i} className="arch-hit">
        {text.slice(a, b)}
      </mark>
    )
    at = b
  })
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

interface ResultsProps {
  hits: ArchiveHit[]
  /** the row the arrow keys are on, -1 for none */
  cursor: number
  activePath: string | null
  onOpen: (path: string, newTab: boolean) => void
  /** a folder result: show it in the archive's tree */
  onReveal: (path: string) => void
  /** the pointer moved onto a row — the arrows carry on from there */
  onPoint: (i: number) => void
}

export function ArchiveResults({ hits, cursor, activePath, onOpen, onReveal, onPoint }: ResultsProps): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  // Keep the row the arrows are on in sight.
  useEffect(() => {
    if (cursor < 0) return
    list.current?.querySelector<HTMLElement>(`[data-arch-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (hits.length === 0) {
    return (
      <div className="fade-in px-4 py-8 text-center">
        <p className="text-sm text-ink-500">Nothing in the archive matches.</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-300">
          It looks through names, folders and what the notes say. Fewer words find more.
        </p>
      </div>
    )
  }
  return (
    <div ref={list} id="arch-results" role="listbox" aria-label="Archive results" className="fade-in">
      <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        {hits.length} in the archive
        <span className="normal-case tracking-normal" data-tip="Move with the arrow keys, open with Enter">
          {' '}
          · ↑↓ Enter
        </span>
      </p>
      {hits.map((h, i) => {
        const d = h.doc
        const dir = d.type === 'dir'
        const on = i === cursor
        const open = activePath === d.path
        const where = [d.where && `in ${d.where}`, d.from && `from ${d.from}`].filter(Boolean).join(' · ')
        const stamp = onDate(d.archivedAt)
        return (
          <div
            key={d.path}
            id={archRowId(d.path)}
            data-arch-i={i}
            role="option"
            aria-selected={on}
            tabIndex={-1}
            className={
              'tree-row arch-row group flex cursor-pointer items-center pr-1.5 text-left ' +
              (open ? 'bg-brand-500/15 ring-1 ring-brand-300/50' : on ? 'arch-row-on' : 'hover:bg-surface/70')
            }
            style={{ paddingLeft: 'var(--row-pad0)' }}
            draggable={!dir}
            onDragStart={(e) => {
              // Into the tab island, like a sidebar search result.
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(DRAG_SEARCH, d.path)
            }}
            onMouseMove={() => {
              if (!on) onPoint(i)
            }}
            onClick={(e) => (dir ? onReveal(d.path) : onOpen(d.path, e.metaKey || e.ctrlKey))}
            data-tip={dir ? 'Show this folder in the archive' : stamp ? `Archived ${stamp}` : undefined}
          >
            <span className={'shrink-0 ' + (open ? 'text-brand-600' : dir ? 'text-brand-500/80' : 'text-ink-300')}>
              <Icon name={dir ? 'folder' : 'doc'} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="tree-title truncate font-medium text-ink-900">
                <Marked text={d.title} marks={h.titleMarks} />
              </span>
              <span className="tree-sub truncate text-ink-500">
                {h.snippet ? <Marked text={h.snippet.text} marks={h.snippet.marks} /> : where || (dir ? 'Folder' : 'In the archive')}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
