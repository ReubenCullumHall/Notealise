import { Icon } from './icons'

export interface SearchHit {
  path: string
  title: string
  /** top-level folder the note lives in ('' = the Home space). */
  space: string
  /** label to show for the space badge ('Home' for root notes). */
  spaceLabel: string
  /** a short content snippet around the match, when searching contents. */
  snippet?: string
}

interface Props {
  query: string
  onQuery: (q: string) => void
  deep: boolean
  onToggleDeep: () => void
}

/** The Spotlight-style search pill (ported from the original browser app): one
 *  rounded pill with the query input, a clear button, and a filter toggle for
 *  searching note contents as well as titles. Results are rendered by the parent. */
export function SearchBar({ query, onQuery, deep, onToggleDeep }: Props): React.JSX.Element {
  return (
    <div className="search-wrap">
      <div className="search-pill">
        <span className="search-ico">
          <Icon name="search" />
        </span>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <input
          className="search-input"
          value={query}
          placeholder={deep ? 'Search notes' : 'Search titles'}
          onChange={(e) => onQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button className="search-clear" title="Clear" aria-label="Clear search" onClick={() => onQuery('')}>
            <Icon name="x" />
          </button>
        )}
        <span className="search-sep" />
        <button
          className={'search-toggle' + (deep ? ' on' : '')}
          title={deep ? 'Searching titles and note contents' : 'Searching titles only'}
          aria-pressed={deep}
          aria-label="Search inside note contents"
          onClick={onToggleDeep}
        >
          <Icon name="doc" />
        </button>
      </div>
    </div>
  )
}

interface ResultsProps {
  hits: SearchHit[]
  activePath: string | null
  onOpen: (hit: SearchHit) => void
  deep: boolean
}

/** The flat result list shown in place of the tree while a search is active. */
export function SearchResults({ hits, activePath, onOpen, deep }: ResultsProps): React.JSX.Element {
  if (hits.length === 0) {
    return <p className="search-empty muted">No matches{deep ? '' : ' in titles'}.</p>
  }
  return (
    <div className="search-results">
      <p className="search-count">
        {hits.length} result{hits.length === 1 ? '' : 's'}
      </p>
      <ul className="tree">
        {hits.map((h) => (
          <li key={h.path}>
            <div
              className={'row search-row' + (activePath === h.path ? ' active' : '')}
              onClick={() => onOpen(h)}
              title={h.path}
            >
              <span className="row-icon">
                <Icon name="doc" />
              </span>
              <span className="search-row-main">
                <span className="label">{h.title}</span>
                {h.snippet && <span className="search-snippet">{h.snippet}</span>}
              </span>
              <span className="search-badge">{h.spaceLabel}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
