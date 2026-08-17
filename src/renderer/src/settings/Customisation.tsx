import { Icon } from '../icons'
import { SpaceForm } from './SpaceForm'
import { activeSpace, type AppSettings, type Space } from '../../../shared/settings'
import type { FontLibrary } from './useInstalledFonts'

// Settings → Customisation. How the app LOOKS and what it shows, set for every
// space at once.
//
// **Every customisation setting belongs to a space** — appearance, colour,
// arranging, a note's own chrome, the format-bar buttons. That is the rule, not
// an implementation detail: a revision space and a journal are different kinds
// of thing to look at, and the app is built so each can answer differently. This
// page is the "…and apply it to all of them" half of that rule, which every such
// setting is required to have.
//
// It is deliberately NOT a global layer that spaces then override. A value that
// wins over a space's own would be a precedence chain, and a control that
// silently does nothing because something further down beat it is the worst bug
// this settings window can have (CLAUDE.md has the theme layer's version of that
// story). So: one answer per space, and this page writes to all of them.
//
// What is NOT here: startup, dates, numbers, the clock. One app launch, one
// locale — those are app-general and live under **General**.

interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
  /** colour the folders that already exist, in EVERY space — this page's scope */
  onColorExisting: () => void
  /** send the reader to the per-space version of this page */
  onGoToSpaces: () => void
  fontLibrary: FontLibrary
}

export function Customisation({
  settings,
  onChange,
  onColorExisting,
  onGoToSpaces,
  fontLibrary
}: Props): React.JSX.Element {
  const spaces = settings.spaces
  // Shown as the starting point. The active space rather than the first, so the
  // controls open on what you were just looking at.
  const shown = activeSpace(settings)

  /** Do the spaces disagree about this one? Whole-app scope shows a marker where
   *  they do — presenting one space's answer as everyone's would be a lie. */
  const differs = (key: keyof Space): boolean =>
    spaces.some((s) => JSON.stringify(s[key]) !== JSON.stringify(spaces[0][key]))

  return (
    <>
      <div className="rounded-xl bg-brand-500/8 px-3 py-2.5 ring-1 ring-brand-300/40">
        <p className="flex items-center gap-2 text-[13px] font-medium text-brand-600">
          <Icon name="spaces" className="h-3.5 w-3.5" />
          Everything here applies to all {spaces.length} {spaces.length === 1 ? 'space' : 'spaces'}
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
          Every one of these settings really belongs to a <em>space</em> — how a set of notes looks
          is a property of that set, so a revision space can be dark and dense while a journal is
          light and roomy. This page is the shortcut for when you want one answer everywhere: change
          a control and all {spaces.length} take it.
        </p>
        <button
          onClick={onGoToSpaces}
          className="mini mt-2"
          data-tip="The same controls, scoped to one space"
        >
          Set just one space instead →
        </button>
      </div>

      <div>
        <h3 className="font-display text-[15px] font-semibold text-ink-900">Every space</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
          How notes look and what they show. Where your spaces currently disagree about something
          it&rsquo;s marked — changing it here settles it for all of them.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <SpaceForm
            space={shown}
            onChange={(patch) => onChange({ spaces: spaces.map((s) => ({ ...s, ...patch })) })}
            differs={spaces.length > 1 ? differs : undefined}
            onColorExisting={onColorExisting}
            fontLibrary={fontLibrary}
          />
        </div>
      </div>
    </>
  )
}
