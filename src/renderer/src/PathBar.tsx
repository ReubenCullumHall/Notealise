import { Icon } from './icons'
import { crumbsFor, type SpaceMark } from './links/model'

// Where the note you're in actually lives: `📝 Physics › Term 3 › Waves`.
//
// One bar for the whole editor area, above the tab strip, following whichever
// column has the keyboard. Not one per column: in a three-way split, three path
// bars is three rows of chrome saying something you can already see in the three
// titles, and the question "where am I?" is about where you are — singular.
//
// **It is navigation, not a label.** Clicking a folder reaches back into the
// sidebar, opens that folder and closes every other one, and scrolls it into
// view. Chrome that steers the tree rather than describing it.

interface Props {
  /** the focused column's note, or "" when nothing is open */
  path: string
  spaces: SpaceMark[]
  /** open this folder in the sidebar and collapse everything else */
  onReveal: (folder: string) => void
}

const SEP = 'shrink-0 px-1 text-ink-300'

export function PathBar({ path, spaces, onReveal }: Props): React.JSX.Element {
  const crumbs = crumbsFor(path, spaces)
  return (
    <div
      className="path-bar flex h-[26px] shrink-0 items-center overflow-x-auto border-b border-ink-300/20 bg-surface/25 px-3 text-[11.5px] backdrop-blur"
      aria-label="File path"
    >
      {/* Nothing open still draws the bar. It is a preference, so it may change
          the chrome's height when it is switched — but never per note, or the
          text would shift under you every time you opened one. */}
      {crumbs.length === 0 ? (
        <span className="truncate text-ink-300">No note open</span>
      ) : (
        crumbs.map((c, i) => (
          <span key={c.path ?? '#note'} className="flex min-w-0 shrink-0 items-center">
            {i > 0 && (
              <span aria-hidden="true" className={SEP}>
                ›
              </span>
            )}
            {c.path === null ? (
              // The note itself. Not a button: there is nothing to reveal about
              // where you already are.
              <span className="truncate font-medium text-ink-700">{c.label}</span>
            ) : (
              <button
                type="button"
                data-tip={`Show ${c.label} in the sidebar`}
                onClick={() => onReveal(c.path as string)}
                className="flex shrink-0 items-center gap-1 rounded border-none bg-transparent px-1 py-0.5 text-ink-500 outline-none transition duration-150 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {c.emoji && (
                  <span aria-hidden="true" className="text-[10px] leading-none">
                    {c.emoji}
                  </span>
                )}
                {i === 0 && !c.emoji && <Icon name="folder" className="h-3 w-3 shrink-0" />}
                <span className="truncate">{c.label}</span>
              </button>
            )}
          </span>
        ))
      )}
    </div>
  )
}
