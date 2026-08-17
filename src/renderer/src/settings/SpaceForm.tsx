import { Icon } from '../icons'
import { ToggleRow } from './primitives'
import { Disclosure, SpaceAppearance, SpaceArranging, SpaceShortcuts } from './Spaces'
import { SpaceColour } from './SpaceColour'
import { SpaceFonts } from './SpaceFonts'
import { LINKS_POSITIONS } from './model'
import type { Space } from '../../../shared/settings'
import type { FontLibrary } from './useInstalledFonts'

// Every setting that belongs to a space, in one form, rendered in two places:
//
//   Customisation           → writes to EVERY space at once
//   Spaces → this space     → writes to that one
//
// One component, so the two can never offer different options or lay them out
// differently — which is the whole point of "the same page, scoped".

/** What a note shows about itself, besides its links (handled separately below,
 *  since position and pinning aren't plain toggles). The other three sections are
 *  the long-standing Appearance / Arranging / Shortcuts, which live in Spaces.tsx. */
const CHROME: { key: keyof Space & string; label: string; hint: string }[] = [
  {
    key: 'showPath',
    label: 'Show the file path',
    hint: 'A bar between the tabs and the format bar reading Space › Folder › Note. Clicking a folder in it opens that folder in the sidebar and closes the rest, so you can see what else is in there.'
  },
  {
    key: 'showNoteInfo',
    label: 'Show when it was last edited',
    hint: 'Puts the time beside the word count, on your machine’s clock. Hover it for the full dates, including when the note was created.'
  },
  {
    key: 'markdownPro',
    label: 'Markdown pro',
    hint: 'Puts a button in the bottom-right corner of every note that switches between the formatted view and the raw Markdown — every asterisk, hash and table pipe visible, exactly as the file has them. Bold still looks bold and headings stay large; only the marks stop being hidden. Each note remembers which way you last looked at it.'
  }
]

interface Props {
  /** the space being edited — or, in whole-app scope, the one whose values are
   *  shown as the starting point */
  space: Space
  onChange: (patch: Partial<Space>) => void
  /** true for a setting the spaces currently disagree about. Whole-app scope
   *  only: showing one value as though it were everyone's would be a lie, so the
   *  control says so and changing it settles the disagreement. */
  differs?: (key: keyof Space) => boolean
  /** colour the folders that already exist, across whatever this form is scoped
   *  to — one space here, every space in the Customisation page */
  onColorExisting: () => void
  /** what's installed to pick from, and the download/import actions — one
   *  instance, created in Settings.tsx, so a download made from either scope
   *  (or from Your collection) shows up in both immediately */
  fontLibrary: FontLibrary
}

/** "Spaces differ" next to a control, in whole-app scope only. */
function Differs(): React.JSX.Element {
  return (
    <span
      data-tip="Your spaces don’t agree on this. Changing it here settles it for all of them."
      className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md bg-wash/[0.07] px-1.5 py-0.5 align-middle text-[10px] font-medium text-ink-400"
    >
      <Icon name="spaces" className="h-2.5 w-2.5" />
      spaces differ
    </span>
  )
}

export function SpaceForm({ space, onChange, differs, onColorExisting, fontLibrary }: Props): React.JSX.Element {
  return (
    <>
      <Disclosure
        label="Appearance"
        hint="Theme, accent colour, button edges, sidebar density and editor width"
      >
        {differs &&
          (['theme', 'textTone', 'buttonDefinition', 'density', 'editorWidth', 'accent', 'accentMode'] as const).some(
            differs
          ) && (
            <p className="mb-2 text-[11.5px] text-ink-400">
              Some of these differ between your spaces <Differs />
            </p>
          )}
        <SpaceAppearance space={space} onChange={onChange} />
      </Disclosure>

      <Disclosure
        label="Fonts"
        hint="Separate skins for the app's interface and for your notes, plus a dyslexia-friendly override for a note's body text"
      >
        {differs && (['font', 'uiFont', 'dyslexiaFont'] as const).some(differs) && (
          <p className="mb-2 text-[11.5px] text-ink-400">
            Some of these differ between your spaces <Differs />
          </p>
        )}
        <SpaceFonts space={space} onChange={onChange} fontLibrary={fontLibrary} />
      </Disclosure>

      <Disclosure
        label="Colour"
        hint="Colouring notes and folders in the sidebar — how it shows, your palette, and colouring new folders automatically"
      >
        {differs && (['colorStyle', 'colorAuto', 'colorInherit', 'colorPalette'] as const).some(differs) && (
          <p className="mb-2 text-[11.5px] text-ink-400">
            Some of these differ between your spaces <Differs />
          </p>
        )}
        <SpaceColour space={space} onChange={onChange} onColorExisting={onColorExisting} />
      </Disclosure>

      <Disclosure label="Arranging" hint="How the sidebar orders and labels things">
        <SpaceArranging space={space} onChange={onChange} />
      </Disclosure>

      <Disclosure label="Linking content" hint="What a note shows about itself, and where">
        <div className="flex flex-col gap-2">
          <div>
            <ToggleRow
              on={space.showLinks}
              onClick={() => onChange({ showLinks: !space.showLinks })}
              label="Show a note’s links"
              hint="A strip listing what this note points at and what points back at it. Hover one to see which of the two it is, which space it’s in, and the line it sits in."
            />
            {differs?.('showLinks') && (
              <p className="mt-1 px-3">
                <Differs />
              </p>
            )}
          </div>

          <div className={!space.showLinks ? 'pointer-events-none opacity-40' : ''}>
            <div className="mode-row">
              {LINKS_POSITIONS.map((p) => {
                const on = space.linksPosition === p.id
                return (
                  <button
                    key={p.id}
                    className={'mode-btn' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ linksPosition: p.id })}
                  >
                    <span className="t">{p.label}</span>
                    <span className="s">{p.hint}</span>
                  </button>
                )
              })}
            </div>
            {differs?.('linksPosition') && (
              <p className="mt-1">
                <Differs />
              </p>
            )}
          </div>

          {/* Pinning only means something at the top — a bottom strip is
              already fixed, so pinning it would be a toggle with nothing to
              toggle. Hidden-and-inert rather than removed from the DOM, so its
              position in the list doesn't jump when the other control changes. */}
          <div
            className={
              !space.showLinks || space.linksPosition === 'bottom' ? 'pointer-events-none opacity-40' : ''
            }
          >
            <ToggleRow
              on={space.pinLinks}
              onClick={() => onChange({ pinLinks: !space.pinLinks })}
              label="Keep them on screen"
              hint="The strip stays put however far you scroll, instead of scrolling away with the text. Handy while you’re joining notes up; costs a little height in a three-way split."
            />
            {differs?.('pinLinks') && (
              <p className="mt-1 px-3">
                <Differs />
              </p>
            )}
          </div>

          {CHROME.map((c) => (
            <div key={c.key}>
              <ToggleRow
                on={space[c.key] as boolean}
                onClick={() => onChange({ [c.key]: !space[c.key] } as Partial<Space>)}
                label={c.label}
                hint={c.hint}
              />
              {differs?.(c.key) && (
                <p className="mt-1 px-3">
                  <Differs />
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-ink-400">
          When you type <code className="font-mono text-ink-500">[[</code>, the list shows the space
          you&rsquo;re writing in; type another space&rsquo;s name to reach it.{' '}
          <span className="font-medium text-ink-500">Tutorials → Linking your notes</span> walks
          through every form a link can take.
        </p>
      </Disclosure>

      <Disclosure label="Shortcuts" hint="The four custom format-bar buttons">
        <SpaceShortcuts space={space} onChange={onChange} />
      </Disclosure>
    </>
  )
}
