import { Icon } from '../icons'
import { ToggleRow } from './primitives'
import { Disclosure, DisclosureGroup, SpaceAppearance, SpaceArranging, SpaceShortcuts } from './Spaces'
import { SpaceColour } from './SpaceColour'
import { SpacePage, type CollectedLooks } from './SpacePage'
import { SpaceFonts } from './SpaceFonts'
import { LINKS_POSITIONS } from './model'
import { RAW_MARK_STYLES, type RawMarkStyleId, type Space } from '../../../shared/settings'
import { COLOR_NAMES, colorToken, LAYERS, splitToken, type Layer } from '../../../shared/palette'
import type { FontLibrary } from './useInstalledFonts'

// Every setting that belongs to a space, in one form, rendered in two places:
//
//   Customisation           → writes to EVERY space at once
//   Spaces → this space     → writes to that one
//
// One component, so the two can never offer different options or lay them out
// differently — which is the whole point of "the same page, scoped".

/** What a note shows about itself, besides its links — its own "Links" disclosure
 *  below, since links has a position control too and doesn't fit a plain toggle
 *  list. Grouped here as "Note extras" — an honestly-named catch-all, not a
 *  false theme: the path breadcrumb, the edit-time stamp, and the raw/formatted
 *  view toggle don't have much in common besides "not links". Called "Note
 *  chrome" until Reuben flagged it 2026-08-29 as jargon nobody would recognise;
 *  before that, lived inside "Linking content" — a name that only ever
 *  described the first of the four settings that Disclosure held. */
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

/** Built FROM `RAW_MARK_STYLES` rather than listing the ids again: a `Record`
 *  keyed by the union means a new style is a type error here until it has a
 *  label, instead of silently missing from the row. */
const RAW_MARK_LABELS: Record<RawMarkStyleId, { label: string; hint: string }> = {
  faded: { label: 'Faded', hint: 'Greyed, so you read past them' },
  colour: { label: 'Coloured', hint: 'Monospaced, in a colour you pick' }
}
const LAYER_LABELS: Record<Layer, string> = { hl: 'Highlight', tc: 'Text colour' }
const RAW_MARK_STYLE_OPTIONS = RAW_MARK_STYLES.map((id) => ({ id, ...RAW_MARK_LABELS[id] }))

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
  /** the page looks and tints in Your collection — what the Page picker is
   *  allowed to offer. Threaded the same way `fontLibrary` is, and for the
   *  same reason: one source, so both scopes offer exactly the same list. */
  collection: CollectedLooks
  /** label of the fold to open on arrival — how a search result for a setting
   *  INSIDE one of these reaches it, rather than leaving the reader on a page
   *  of nine closed rows. Search only routes to Customisation, so this is
   *  unset in the per-space scope. */
  openDisclosure?: { fold: string; n: number } | null
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

export function SpaceForm({
  space,
  onChange,
  differs,
  onColorExisting,
  fontLibrary,
  collection,
  openDisclosure
}: Props): React.JSX.Element {
  const opens = (label: string): number | undefined =>
    openDisclosure?.fold === label ? openDisclosure.n : undefined
  return (
    <DisclosureGroup>
      <Disclosure
        label="Appearance"
        openSignal={opens('Appearance')}
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
        openSignal={opens('Fonts')}
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
        label="Page"
        openSignal={opens('Page')}
        hint="The paper itself — a pattern behind your writing, and a colour washed under it"
      >
        {differs && (['pageLook', 'tint'] as const).some(differs) && (
          <p className="mb-2 text-[11.5px] text-ink-400">
            Some of these differ between your spaces <Differs />
          </p>
        )}
        <SpacePage space={space} onChange={onChange} collection={collection} />
      </Disclosure>

      <Disclosure
        label="Colour"
        openSignal={opens('Colour')}
        hint="Colouring notes and folders in the sidebar — how it shows, your palette, and colouring new folders automatically"
      >
        {differs && (['colorStyle', 'colorAuto', 'colorInherit', 'colorPalette'] as const).some(differs) && (
          <p className="mb-2 text-[11.5px] text-ink-400">
            Some of these differ between your spaces <Differs />
          </p>
        )}
        <SpaceColour space={space} onChange={onChange} onColorExisting={onColorExisting} />
      </Disclosure>

      <Disclosure label="Arranging" hint="How the sidebar orders and labels things" openSignal={opens('Arranging')}>
        <SpaceArranging space={space} onChange={onChange} />
      </Disclosure>

      <Disclosure label="Links" hint="Whether a note’s links strip shows, and where it sits" openSignal={opens('Links')}>
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
        </div>
        <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-ink-400">
          When you type <code className="font-mono text-ink-500">[[</code>, the list shows the space
          you&rsquo;re writing in; type another space&rsquo;s name to reach it.{' '}
          <span className="font-medium text-ink-500">Tutorials → Linking your notes</span> walks
          through every form a link can take.
        </p>
      </Disclosure>

      <Disclosure
        label="Note extras"
        openSignal={opens('Note extras')}
        hint="The file path above a note, its edit time, and the raw-Markdown toggle"
      >
        <div className="flex flex-col gap-2">
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

          {/* Directly under Markdown pro, and inert without it: this decides how
              the marks READ once that switch has revealed them, so on its own it
              has nothing to colour. */}
          <div className={!space.markdownPro ? 'pointer-events-none opacity-40' : ''}>
            <p className="px-3 text-[12.5px] font-medium text-ink-700">
              How the marks look in Markdown pro
            </p>
            <p className="mb-1.5 px-3 text-[11.5px] leading-relaxed text-ink-500">
              Faded lets your eye run past them to the words. Highlighted makes the markup stand
              out, for when you want to read the code itself.
            </p>
            <div className="mode-row">
              {RAW_MARK_STYLE_OPTIONS.map((o) => {
                const on = space.rawMarkStyle === o.id
                return (
                  <button
                    key={o.id}
                    className={'mode-btn' + (on ? ' on' : '')}
                    aria-pressed={on}
                    onClick={() => onChange({ rawMarkStyle: o.id })}
                  >
                    <span className="t">{o.label}</span>
                    <span className="s">{o.hint}</span>
                  </button>
                )
              })}
            </div>
            {differs?.('rawMarkStyle') && (
              <p className="mt-1">
                <Differs />
              </p>
            )}

            {/* The same eight colours, in the same two layers, as colouring a
                phrase in a note — deliberately, so there is one palette in the
                app and not a second one only the marks use. Shown only once
                'Coloured' is chosen; there is nothing to pick for 'Faded'. */}
            {space.rawMarkStyle === 'colour' && (
              <div className="fade-in mt-3 px-3">
                <div className="flex items-center gap-1.5">
                  {LAYERS.map((l) => {
                    const on = splitToken(space.rawMarkTint).layer === l
                    return (
                      <button
                        key={l}
                        className={'mini' + (on ? ' on' : '')}
                        aria-pressed={on}
                        onClick={() =>
                          onChange({
                            rawMarkTint: colorToken(l, splitToken(space.rawMarkTint).name)
                          })
                        }
                      >
                        {LAYER_LABELS[l]}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {COLOR_NAMES.map((name) => {
                    const { layer } = splitToken(space.rawMarkTint)
                    const token = colorToken(layer, name)
                    const on = space.rawMarkTint === token
                    return (
                      <button
                        key={name}
                        data-tip={name[0].toUpperCase() + name.slice(1)}
                        aria-label={name}
                        aria-pressed={on}
                        onClick={() => onChange({ rawMarkTint: token })}
                        className={
                          'h-6 w-6 rounded-md border-none outline-none transition duration-150 ' +
                          (on ? 'ring-2 ring-brand-400' : 'ring-1 ring-ink-300/25 hover:ring-ink-300/60')
                        }
                        // The swatch shows the real token, so it previews the
                        // value this theme will actually paint.
                        style={{ background: `var(--${token})` }}
                      />
                    )
                  })}
                </div>
                {differs?.('rawMarkTint') && (
                  <p className="mt-1.5">
                    <Differs />
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </Disclosure>

      <Disclosure
        label="While scrolling"
        openSignal={opens('While scrolling')}
        hint="Whether the tab strip, path bar, heading row and links strip stay put, or get out of the way"
      >
        {/* The on/off mechanic is identical for all four and was previously
            repeated verbatim in every row's hint — stated once here instead,
            so each row below only has to say which bar it is. */}
        <p className="mb-2 px-1 text-[11.5px] leading-relaxed text-ink-400">
          Off, a bar steps aside the moment you scroll and returns once you&rsquo;re back at the
          very top — never mid-note, so nothing flickers as you read back and forth.
        </p>
        <div className="flex flex-col gap-2">
          <div>
            <ToggleRow
              on={space.pinTabs}
              onClick={() => onChange({ pinTabs: !space.pinTabs })}
              label="Keep the tab strip on screen"
              hint="The strip listing every note you have open."
            />
            {differs?.('pinTabs') && (
              <p className="mt-1 px-3">
                <Differs />
              </p>
            )}
          </div>

          {/* Only means something when the file path bar is shown at all —
              nothing to keep on screen if it's off entirely. */}
          <div className={!space.showPath ? 'pointer-events-none opacity-40' : ''}>
            <ToggleRow
              on={space.pinPath}
              onClick={() => onChange({ pinPath: !space.pinPath })}
              label="Keep the file path bar on screen"
              hint="The Space › Folder › Note bar underneath it."
            />
            {differs?.('pinPath') && (
              <p className="mt-1 px-3">
                <Differs />
              </p>
            )}
          </div>

          <div>
            <ToggleRow
              on={space.pinNoteHeader}
              onClick={() => onChange({ pinNoteHeader: !space.pinNoteHeader })}
              label="Keep the note’s heading row on screen"
              hint="Bold, italic, the custom buttons, the title, its stats and the split-view toggle."
            />
            {differs?.('pinNoteHeader') && (
              <p className="mt-1 px-3">
                <Differs />
              </p>
            )}
          </div>

          {/* Only means something when the links strip exists at the top of the
              note — a bottom strip is already fixed in place (nothing to toggle),
              and there's nothing to keep on screen if the strip is off entirely.
              Hidden-and-inert rather than removed from the DOM, so the page
              doesn't reflow as the two controls above it change. */}
          <div
            className={
              !space.showLinks || space.linksPosition === 'bottom' ? 'pointer-events-none opacity-40' : ''
            }
          >
            <ToggleRow
              on={space.pinLinks}
              onClick={() => onChange({ pinLinks: !space.pinLinks })}
              label="Keep the links strip on screen"
              hint="What this note points at, and what points back."
            />
            {differs?.('pinLinks') && (
              <p className="mt-1 px-3">
                <Differs />
              </p>
            )}
          </div>
        </div>
      </Disclosure>

      <Disclosure label="Shortcuts" hint="The four custom format-bar buttons" openSignal={opens('Shortcuts')}>
        <SpaceShortcuts space={space} onChange={onChange} />
      </Disclosure>
    </DisclosureGroup>
  )
}
