import { Icon } from './icons'

export interface SearchHit {
  path: string
  title: string
  /** a short content snippet around the match, when searching contents. */
  snippet?: string
  /** true when the hit lives in the archive — a search covers everywhere, so the
   *  row says so rather than silently mixing shelved notes into the results. */
  archived?: boolean
  /** the top-level space folder this hit lives in ('' for loose notes) —
   *  carried on every hit so opening one can switch spaces first, whether or
   *  not the badge below is showing. */
  spaceFolder?: string
  /** emoji + name of that space, set only when it differs from the one you're
   *  currently in — an all-spaces search result needs to say where it lives. */
  spaceTag?: string
}

interface Props {
  query: string
  onQuery: (q: string) => void
  deep: boolean
  onToggleDeep: () => void
  allSpaces: boolean
  onToggleAllSpaces: () => void
}

/** One filter toggle inside the pill (legacy's `SearchToggle`). */
function SearchToggle({
  on,
  onClick,
  title,
  children
}: {
  on: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      data-tip={title}
      aria-pressed={on}
      aria-label={title}
      className={
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none p-0 outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        (on
          ? 'bg-accent-500/15 text-accent-600 hover:bg-accent-500/15'
          : 'bg-transparent text-accent-500 hover:bg-ink-300/15 hover:text-accent-600')
      }
    >
      {children}
    </button>
  )
}

/** The Spotlight-style search pill: one rounded pill with the query input and
 *  the filters on the right, so they're always in reach without opening
 *  anything (legacy/src/App.jsx:767-789).
 *
 *  Two filters, not three. The archive toggle was removed 2026-09-06 while
 *  Reuben reworks the archive area — searching archived notes belongs to
 *  whatever that becomes, and in the meantime the width is worth more to the
 *  query than to a filter nobody had asked for. Archived notes are simply out
 *  of the results (App.tsx's `n.archived` guard). */
export function SearchBar({
  query,
  onQuery,
  deep,
  onToggleDeep,
  allSpaces,
  onToggleAllSpaces
}: Props): React.JSX.Element {
  return (
    <div className="px-3 pb-2">
      <div className="btn-edge flex items-center gap-1.5 rounded-full border border-ink-300/30 bg-surface/70 py-1.5 pl-3 pr-1.5 focus-within:border-accent-300 focus-within:ring-4 focus-within:ring-accent-100">
        {/* Quieter than the ink ramp's own floor: at full --ink-300 the glyph
            and the divider read as controls you were meant to do something
            with. They are furniture, so they sit back into the pill and let
            the placeholder and the filters carry the row. The focus ring on
            the pill itself is untouched — that is the one signal here that
            IS meant to be seen (tester feedback, 2026-09-05).

            AND IT GETS OUT OF THE WAY ONCE YOU TYPE (Reuben, 2026-09-06): the
            glyph says "this is the search box", which is a thing you only need
            told while the box is empty — the moment there are words in it, the
            words say it better. So it collapses to nothing and slides left,
            handing the row back to the query. `w-0` with `overflow-hidden`
            rather than unmounting it, so the width animates instead of the
            input jumping; `opacity` alone would leave the gap behind. */}
        <span
          aria-hidden={query ? true : undefined}
          className={
            'shrink-0 overflow-hidden text-ink-300/55 transition-[width,opacity,margin] duration-200 ' +
            (query ? 'pointer-events-none -ml-1.5 w-0 opacity-0' : 'w-4 opacity-100')
          }
        >
          <Icon name="search" className="h-4 w-4" />
        </span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300"
          value={query}
          placeholder={(deep ? 'Search notes' : 'Search titles') + (allSpaces ? ', all spaces' : '')}
          onChange={(e) => onQuery(e.target.value)}
          spellCheck={false}
        />
        {/* No clear button. It only ever existed while there was a query — i.e.
            exactly when the row is at its tightest and every pixel is the thing
            you are typing into. Escape and a held Backspace both already clear
            it, and neither costs the row any width (Reuben, 2026-09-06). */}
        <span className="h-4 w-px shrink-0 bg-ink-300/15" />
        {/* The three filters are one group, so they sit tighter to each other
            than to the divider and the input: the row's own `gap-1.5` still
            separates the group from everything left of it, and `gap-0.5`
            closes the space INSIDE it. They were reading as three unrelated
            buttons spread along the pill. */}
        <div className="flex shrink-0 items-center gap-0.5">
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
    </div>
  )
}

interface ResultsProps {
  hits: SearchHit[]
  activePath: string | null
  /** `newTab` — Cmd/Ctrl+click, same gesture as the tree rows */
  onOpen: (hit: SearchHit, newTab?: boolean) => void
  deep: boolean
  archivedCount: number
  /** folder results are being biased toward (the open note's folder); null
   *  when nothing's open, so results sit in their plain default order. */
  contextLabel: string | null
}

/** The flat result list shown in place of the tree while a search is active. */
export function SearchResults({
  hits,
  activePath,
  onOpen,
  deep,
  archivedCount,
  contextLabel
}: ResultsProps): React.JSX.Element {
  if (hits.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-ink-300">
        No matches{deep ? '' : ' in note titles'}.
      </p>
    )
  }
  return (
    <div className="fade-in">
      <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        {hits.length} result{hits.length === 1 ? '' : 's'}
        {archivedCount > 0 && (
          <span className="normal-case tracking-normal"> · {archivedCount} archived</span>
        )}
        {contextLabel && (
          <span className="normal-case tracking-normal" data-tip="Closest matches to where you're working come first">
            {' '}
            · nearest to {contextLabel} first
          </span>
        )}
      </p>
      {hits.map((h) => (
        <div
          key={h.path}
          role="button"
          tabIndex={0}
          className={
            'tree-row group flex cursor-pointer items-center pr-1.5 text-left ' +
            (activePath === h.path
              ? 'bg-brand-500/15 ring-1 ring-brand-300/50'
              : 'hover:bg-surface/70')
          }
          style={{ paddingLeft: 'var(--row-pad0)' }}
          onClick={(e) => onOpen(h, e.metaKey || e.ctrlKey)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpen(h, e.metaKey || e.ctrlKey)
          }}
          data-tip={h.path}
        >
          <span className={'shrink-0 ' + (activePath === h.path ? 'text-brand-600' : 'text-ink-300')}>
            <Icon name="doc" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="tree-title truncate font-medium text-ink-900">{h.title}</span>
            <span className="tree-sub truncate text-ink-500">{h.snippet ?? h.path}</span>
          </span>
          {h.spaceTag && (
            <span
              className="tree-sub shrink-0 truncate rounded-full bg-ink-300/15 px-1.5 py-0.5 text-[11px] text-ink-500"
              data-tip={`Lives in ${h.spaceTag} — opening it switches you there`}
            >
              {h.spaceTag}
            </span>
          )}
          {h.archived && (
            <span className="shrink-0 text-ink-400" data-tip="In the archive">
              <Icon name="archive" />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
