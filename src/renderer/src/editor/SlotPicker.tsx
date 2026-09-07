import { Icon } from '../icons'
import { ACTION_GROUPS, findAction } from './commands'

// The list of commands a custom format-bar slot can be programmed with. Shared
// by the popover that opens off an empty slot in the bar and by Settings →
// Shortcuts, so both offer exactly the same choices in the same order.

const HEAD = 'col-span-full pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400'

export function ActionGrid({
  value,
  onPick,
  cols = 2
}: {
  /** id currently in the slot being edited ('' when empty) */
  value: string
  onPick: (id: string) => void
  cols?: 2 | 3
}): React.JSX.Element {
  return (
    <div className={'grid gap-1 ' + (cols === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {ACTION_GROUPS.map(({ group, actions }) => (
        <div key={group} className="contents">
          <p className={HEAD}>{group}</p>
          {actions.map((a) => {
            const on = a.id === value
            return (
              <button
                key={a.id}
                data-tip={a.hint}
                aria-pressed={on}
                onClick={() => onPick(a.id)}
                className={
                  'flex items-center gap-2 rounded-lg border-none px-2 py-1.5 text-left outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                  (on ? 'bg-brand-500/15 text-brand-600' : 'bg-transparent text-ink-700 hover:bg-ink-300/15 hover:text-ink-900')
                }
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">{a.glyph}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{a.label}</span>
              </button>
            )
          })}
        </div>
      ))}
      <button
        onClick={() => onPick('')}
        className={
          'col-span-full mt-1.5 flex items-center justify-center gap-1.5 rounded-lg border-none bg-transparent py-1.5 text-[12px] outline-none transition duration-150 hover:bg-ink-300/15 hover:text-ink-900 ' +
          (value ? 'text-ink-500' : 'text-ink-400')
        }
      >
        <Icon name="x" className="h-3.5 w-3.5" />
        <span>{value ? 'Clear this button' : 'Leave empty'}</span>
      </button>
    </div>
  )
}

/** The face a slot shows: its action's glyph, or — when the slot is empty — a
 *  dashed outline standing in for the button that isn't there yet.
 *
 *  It was a literal "?" until 2026-09-04. Two things were wrong with that: a
 *  question mark means "help" everywhere else in software, and four of them
 *  spread across the format bar read as four icons that had failed to load —
 *  which is exactly how it was first reported. A dashed box says "space for
 *  something" rather than "something is missing".
 *
 *  The affordance lives HERE, not in the two call sites, so the format bar and
 *  Settings → Shortcuts show the same thing without either having to restyle
 *  itself. (It also retired the last 13px type in the chrome: the "?" was the
 *  only glyph in the bar that wasn't 14px.) */
export function SlotFace({ id }: { id: string }): React.JSX.Element {
  const action = findAction(id)
  if (action) return <>{action.glyph}</>
  return (
    <span
      aria-hidden
      className="h-4 w-4 rounded-control border border-dashed border-current opacity-60"
    />
  )
}
