import { Icon } from '../icons'
import { SpaceForm } from './SpaceForm'
import { activeSpace, type AppSettings, type Space } from '../../../shared/settings'

// Settings → Master settings. Everything, set for the whole app at once.
//
// Two kinds of thing live here and the page is honest about which is which:
//
//   • App-general — startup, dates, numbers, the clock. One app, one answer.
//   • Per-space — appearance, arranging, a note's own chrome, the format-bar
//     buttons. Each space really does hold its own answer; setting it HERE sets
//     every one of them.
//
// This is deliberately not a global layer that spaces then override. A value
// that wins over a space's own would be a precedence chain, and a control that
// silently does nothing because something further down beat it is the worst bug
// this settings window can have (CLAUDE.md has the theme layer's version of that
// story). So: one answer per space, and this page writes to all of them.

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  /** the app-general sections, which Settings.tsx already owns */
  general: React.ReactNode
  formatting: React.ReactNode
}

export function MasterSettings({ settings, onChange, general, formatting }: Props): React.JSX.Element {
  const spaces = settings.spaces
  // Shown as the starting point. The active space rather than the first, so the
  // controls open on what you were just looking at.
  const shown = activeSpace(settings)

  /** Do the spaces disagree about this one? Master scope shows a marker where
   *  they do — presenting one space's answer as everyone's would be a lie. */
  const differs = (key: keyof Space): boolean =>
    spaces.some((s) => JSON.stringify(s[key]) !== JSON.stringify(spaces[0][key]))

  /** Every space takes the change. */
  const applyToAll = (patch: Partial<Space>): void =>
    onChange({ spaces: spaces.map((s) => ({ ...s, ...patch })) })

  return (
    <>
      <div className="rounded-xl bg-brand-500/8 px-3 py-2.5 ring-1 ring-brand-300/40">
        <p className="flex items-center gap-2 text-[13px] font-medium text-brand-600">
          <Icon name="spaces" className="h-3.5 w-3.5" />
          Everything here applies to all {spaces.length} {spaces.length === 1 ? 'space' : 'spaces'}
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
          To change one space on its own, go to <span className="font-medium text-ink-600">Spaces</span>{' '}
          and open its own settings. The page there looks exactly like this one.
        </p>
      </div>

      {general}
      {formatting}

      <div>
        <h3 className="font-display text-[15px] font-semibold text-ink-900">Every space</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
          How notes look and what they show. Each space can answer these differently — setting one
          here answers it for all of them at once.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <SpaceForm space={shown} onChange={applyToAll} differs={spaces.length > 1 ? differs : undefined} />
        </div>
      </div>
    </>
  )
}
