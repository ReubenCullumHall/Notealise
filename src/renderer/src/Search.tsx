import { Icon } from './icons'

export interface SearchHit {
  path: string
  title: string
  /** a short content snippet around the match, when searching contents. */
  snippet?: string
  /** true when the hit lives in the archive — a search covers everywhere, so the
   *  row says so rather than silently mixing shelved notes into the results. */
  archived?: boolean
}

interface Props {
  query: string
  onQuery: (q: string) => void
  deep: boolean
  onToggleDeep: () => void
  withArchived: boolean
  onToggleWithArchived: () => void
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
      title={title}
      aria-pressed={on}
      aria-label={title}
      className={
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none p-0 outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        (on
          ? 'bg-brand-500/15 text-brand-600 hover:bg-brand-500/15'
          : 'bg-transparent text-ink-400 hover:bg-brand-500/10 hover:text-brand-600')
      }
    >
      {children}
    </button>
  )
}

/** The Spotlight-style search pill: one rounded pill with the query input, a
 *  clear button, and the filters on the right so they're always in reach without
 *  opening anything (legacy/src/App.jsx:767-789). */
export function SearchBar({
  query,
  onQuery,
  deep,
  onToggleDeep,
  withArchived,
  onToggleWithArchived
}: Props): React.JSX.Element {
  return (
    <div className="px-3 pb-2">
      <div className="flex items-center gap-1.5 rounded-full border border-ink-300/30 bg-surface/70 py-1.5 pl-3 pr-1.5 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
        <span className="shrink-0 text-ink-300">
          <Icon name="search" className="h-4 w-4" />
        </span>
        <input
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300"
          value={query}
          placeholder={deep ? 'Search notes' : 'Search titles'}
          onChange={(e) => onQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button
            className="shrink-0 rounded-full border-none bg-transparent p-1 text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
            title="Clear"
            aria-label="Clear search"
            onClick={() => onQuery('')}
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        )}
        <span className="h-4 w-px shrink-0 bg-ink-300/25" />
        <SearchToggle
          on={deep}
          onClick={onToggleDeep}
          title={deep ? 'Searching titles and note contents' : 'Searching titles only'}
        >
          <Icon name="text" className="h-4 w-4" />
        </SearchToggle>
        <SearchToggle
          on={withArchived}
          onClick={onToggleWithArchived}
          title={withArchived ? 'Including archived notes' : 'Archived notes hidden'}
        >
          <Icon name="archive" className="h-4 w-4" />
        </SearchToggle>
      </div>
    </div>
  )
}

interface ResultsProps {
  hits: SearchHit[]
  activePath: string | null
  onOpen: (hit: SearchHit) => void
  deep: boolean
  archivedCount: number
}

/** The flat result list shown in place of the tree while a search is active. */
export function SearchResults({
  hits,
  activePath,
  onOpen,
  deep,
  archivedCount
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
      </p>
      {hits.map((h) => (
        <div
          key={h.path}
          role="button"
          tabIndex={0}
          className={
            'tree-row group flex cursor-pointer items-center pr-1.5 text-left ' +
            (activePath === h.path
              ? 'bg-brand-500/12 ring-1 ring-brand-300/50'
              : 'hover:bg-surface/70')
          }
          style={{ paddingLeft: 'var(--row-pad0)' }}
          onClick={() => onOpen(h)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpen(h)
          }}
          title={h.path}
        >
          <span className={'shrink-0 ' + (activePath === h.path ? 'text-brand-600' : 'text-ink-300')}>
            <Icon name="doc" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="tree-title truncate font-medium text-ink-900">{h.title}</span>
            <span className="tree-sub truncate text-ink-500">{h.snippet ?? h.path}</span>
          </span>
          {h.archived && (
            <span className="shrink-0 text-ink-400" title="In the archive">
              <Icon name="archive" />
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
