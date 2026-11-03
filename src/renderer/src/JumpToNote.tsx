import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { Marked } from './ArchiveSearch'
import { SearchToggle } from './Search'
import { findNotes, indexNotes, type JumpNote } from './jumpMatch'

// Go to a note (Cmd/Ctrl+P): the sidebar Search, brought to the middle of the
// window with a key. Same pill, same two toggles (titles / contents, this space /
// every space — and they ARE the sidebar's toggles, so one answer holds for both),
// same result rows; plus the archive search's keyboard: ↑ ↓ to move, Enter to
// open. In the confirm window's frame (`.confirm-backdrop`, `.jump` in app.css).
//
// Focus stays in the box the whole time. The window is `aria-modal`, which is
// what keeps the tab keys, new-note and the other shortcuts from acting on the
// notes hidden behind it (App.tsx tests for that marker).

interface Props {
  /** the notes in reach — already narrowed by the "this space / every space" toggle */
  notes: JumpNote[]
  deep: boolean
  onToggleDeep: () => void
  allSpaces: boolean
  onToggleAllSpaces: () => void
  /** called when a contents search needs the notes' text read (once, lazily) */
  onWantText: () => void
  /** the note in the focused tab, so its row can say it is already open */
  activePath: string | null
  /** `newTab` — Cmd/Ctrl+Enter or Cmd/Ctrl+click, as everywhere else. `words` is
   *  what to take you to inside the note, when it matched on its text. */
  onOpen: (note: JumpNote, newTab: boolean, words: string) => void
  /** asks for it to close; it then plays its way out (`closing`) */
  onClose: () => void
  /** true while it plays its way out — it takes no more input then */
  closing: boolean
  /** the way-out has finished: unmount it */
  onClosed: () => void
}

export function JumpToNote({
  notes,
  deep,
  onToggleDeep,
  allSpaces,
  onToggleAllSpaces,
  onWantText,
  activePath,
  onOpen,
  onClose,
  closing,
  onClosed
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  // Folded once per opening, so a keystroke only searches.
  const index = useMemo(() => indexNotes(notes), [notes])
  const hits = useMemo(() => findNotes(index, query, deep), [index, query, deep])
  const typed = query.trim() !== ''
  // A contents search needs the notes read; the first word typed asks for it, and
  // so does widening to every space. Not keyed on `notes` itself: reading bumps
  // that, and a note that can't be read would ask again for ever.
  useEffect(() => {
    if (deep && typed) onWantText()
  }, [deep, typed, allSpaces, onWantText])

  // Put focus back where it was when you change your mind. Opening a note does
  // not use this: the note you picked takes over.
  const before = useRef<Element | null>(document.activeElement)
  const cancel = (): void => {
    const el = before.current
    onClose()
    if (el instanceof HTMLElement && el.isConnected) requestAnimationFrame(() => el.focus())
  }

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-jump-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // The results area eases to each new height rather than snapping to it
  // (`.jump-grow` in app.css transitions to --jump-h). Written straight onto the
  // element, not through state: a re-render per keystroke is enough.
  const grow = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = list.current
    const box = grow.current
    if (!el || !box) return
    const fit = (): void => box.style.setProperty('--jump-h', `${el.offsetHeight}px`)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The way out ends on the panel's own animationend; this is the safety net if
  // that never fires (an animation can be skipped), so it can't stay half-gone.
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(onClosed, 320)
    return () => window.clearTimeout(t)
  }, [closing, onClosed])

  const open = (i: number, newTab: boolean): void => {
    const hit = hits[i]
    if (!hit) return
    // On a match in the note's text, take you to the first of the words found there.
    const m = hit.snippet?.marks[0]
    onOpen(hit.note, newTab, hit.snippet && m ? hit.snippet.text.slice(m[0], m[1]) : '')
  }

  return (
    <div className={'confirm-backdrop jump-backdrop' + (closing ? ' closing' : '')} onClick={closing ? undefined : cancel}>
      <div
        className={'jump' + (closing ? ' closing' : '')}
        role="dialog"
        // Not modal any more while it plays its way out, so the note you picked
        // (and the shortcuts) answer straight away.
        aria-modal={closing ? undefined : 'true'}
        aria-label="Go to a note"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClosed()
        }}
        onKeyDown={(e) => {
          if (closing) {
            e.preventDefault()
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancel()
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const last = Math.max(0, hits.length - 1)
            setCursor((c) => Math.min(last, Math.max(0, c + (e.key === 'ArrowDown' ? 1 : -1))))
          } else if (e.key === 'Enter') {
            // Not while an input method is still composing the word.
            if (e.nativeEvent.isComposing) return
            e.preventDefault()
            open(cursor, e.metaKey || e.ctrlKey)
          } else if (e.key === 'Tab') {
            e.preventDefault() // the box is the only thing here to focus
          }
        }}
      >
        {/* The window IS the search field (Spotlight's shape): no box inside a box.
            On its own it is a capsule; the results grow out underneath it. */}
        <div className="flex items-center gap-2.5 py-3 pl-5 pr-3">
            <span className="shrink-0 text-ink-300" aria-hidden="true">
              <Icon name="search" className="h-5 w-5" />
            </span>
            <input
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-lg text-ink-900 outline-none placeholder:text-ink-300"
              value={query}
              placeholder={(deep ? 'Search notes' : 'Search titles') + (allSpaces ? ', all spaces' : '')}
              aria-label="Go to a note"
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls="jump-results"
              aria-activedescendant={hits[cursor] ? `jump-${cursor}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value)
                setCursor(0)
              }}
              spellCheck={false}
            />
            <span className="h-4 w-px shrink-0 bg-ink-300/15" />
            {/* The sidebar bar's own two toggles. Pressing one must not take focus
                from the box, or Enter would press the toggle instead of opening. */}
            <div className="flex shrink-0 items-center gap-0.5" onMouseDown={(e) => e.preventDefault()}>
              <SearchToggle
                on={deep}
                onClick={onToggleDeep}
                title={deep ? 'Searching titles and note contents' : 'Searching titles only'}
              >
                <Icon name="text" className="h-4 w-4" />
              </SearchToggle>
              <SearchToggle
                on={allSpaces}
                onClick={onToggleAllSpaces}
                title={allSpaces ? 'Searching every space' : 'Searching this space only'}
              >
                <Icon name="spaces" className="h-4 w-4" />
              </SearchToggle>
            </div>
        </div>
        <div ref={grow} className="jump-grow">
        <div
          ref={list}
          id="jump-results"
          role="listbox"
          aria-label="Notes"
          className={'jump-list' + (typed ? ' jump-list-on' : '')}
        >
          {/* Nothing under the field until you type — the placeholder says what to do. */}
          {!typed ? null : hits.length === 0 ? (
            <p className="px-4 pb-4 pt-1 text-sm text-ink-300">
              No matches{deep ? '' : ' in note titles'}.
            </p>
          ) : (
            <>
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                {hits.length} note{hits.length === 1 ? '' : 's'}
                <span className="normal-case tracking-normal" data-tip="Cmd/Ctrl+Enter opens it in a new tab">
                  {' '}
                  · ↑↓ Enter
                </span>
              </p>
              {hits.map((h, i) => {
                const n = h.note
                const on = i === cursor
                const isOpen = activePath === n.path
                return (
                  <div
                    key={n.path}
                    id={`jump-${i}`}
                    data-jump-i={i}
                    role="option"
                    aria-selected={on}
                    className={
                      'tree-row arch-row group flex cursor-pointer items-center pr-1.5 text-left ' +
                      (isOpen ? 'bg-brand-500/15 ring-1 ring-brand-300/50' : on ? 'arch-row-on' : 'hover:bg-surface/70')
                    }
                    style={{ paddingLeft: 'var(--row-pad0)' }}
                    onMouseMove={() => {
                      if (!on) setCursor(i)
                    }}
                    onClick={(e) => open(i, e.metaKey || e.ctrlKey)}
                    data-tip={n.path}
                  >
                    <span className={'shrink-0 ' + (isOpen ? 'text-brand-600' : 'text-ink-300')}>
                      <Icon name="doc" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="tree-title truncate font-medium text-ink-900">
                        <Marked text={n.title} marks={h.titleMarks} />
                      </span>
                      <span className="tree-sub truncate text-ink-500">
                        {h.snippet ? <Marked text={h.snippet.text} marks={h.snippet.marks} /> : n.where}
                      </span>
                    </span>
                    {n.spaceTag && (
                      <span
                        className="tree-sub shrink-0 truncate rounded-full bg-ink-300/15 px-1.5 py-0.5 text-[11px] text-ink-500"
                        data-tip={`Lives in ${n.spaceTag} — opening it switches you there`}
                      >
                        {n.spaceEmoji && (
                          <>
                            <span className="space-emoji">{n.spaceEmoji}</span>{' '}
                          </>
                        )}
                        {n.spaceTag}
                      </span>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
