import { Icon } from '../icons'
import { HelpTip } from '../Tooltip'
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
  /** fold to open on arrival, with the counter that makes repeat asks
   *  distinct — set when a search result routed here */
  openDisclosure?: { fold: string; n: number } | null
}

export function Customisation({
  settings,
  onChange,
  onColorExisting,
  onGoToSpaces,
  fontLibrary,
  openDisclosure
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
      <div className="rounded-xl bg-ink-300/10 px-3 py-2.5 ring-1 ring-ink-300/25">
        <p className="flex items-center gap-2 text-[13px] font-medium text-brand-600">
          <Icon name="spaces" className="h-3.5 w-3.5" />
          Everything here applies to all {spaces.length} {spaces.length === 1 ? 'space' : 'spaces'}
        </p>
        <p className="mt-1 flex items-start gap-1 text-[11.5px] leading-relaxed text-ink-500">
          <span>Change a control here and all {spaces.length} take it.</span>
          <HelpTip
            text={`Every one of these settings really belongs to a space — how a set of notes looks is a property of that set, so a revision space can be dark and dense while a journal stays light and roomy. This page is just the shortcut for setting them all at once.`}
          />
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
        <h3 className="accent-heading font-display text-[15px] font-semibold">Every space</h3>
        {spaces.length > 1 && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
            Where your spaces disagree about something, it&rsquo;s marked — change it here to settle
            it for everyone.
          </p>
        )}
        {/* No `gap` and no wrapper styling: SpaceForm brings its own
            DisclosureGroup, which is the single bordered container the whole
            run of rows now lives in. */}
        <div className="mt-3">
          <SpaceForm
            space={shown}
            onChange={(patch) => onChange({ spaces: spaces.map((s) => ({ ...s, ...patch })) })}
            differs={spaces.length > 1 ? differs : undefined}
            onColorExisting={onColorExisting}
            fontLibrary={fontLibrary}
            collection={{ pageLooks: settings.pageLookLibrary, tints: settings.tintLibrary }}
            openDisclosure={openDisclosure}
          />
        </div>
      </div>
    </>
  )
}
