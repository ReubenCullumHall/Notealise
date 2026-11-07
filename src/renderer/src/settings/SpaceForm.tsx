import { Differs, Tick, TickGroup, ToggleRow } from './primitives'
import {
  AccentReachSection,
  AccentSection,
  ButtonEdgesSection,
  CornersSection,
  DensitySection,
  Disclosure,
  DisclosureGroup,
  EditorWidthSection,
  SpaceArranging,
  SpaceShortcuts,
  TextToneSection,
  ThemeCards
} from './Spaces'
import { SpaceColour } from './SpaceColour'
import { SpacePage, type CollectedLooks } from './SpacePage'
import { SpaceFonts } from './SpaceFonts'
import { LINKS_POSITIONS } from './model'
import type { Space } from '../../../shared/settings'
import type { FontLibrary } from './useInstalledFonts'

// Every setting that belongs to a space, in one form, rendered in two places:
//
//   Look → Every space      → writes to EVERY space at once
//   Spaces → this space     → writes to that one
//
// One component, so the two can never offer different options or lay them out
// differently — which is the whole point of "the same page, scoped".
//
// Laid out basics-first (Reuben, 2026-09-29: "easier for people who just want
// the basics"). Theme, corners, accent colour and fonts — what most people open
// Settings to change — sit open at the top (corners joined them 2026-10-26). Everything else is in six folds
// below them, and the settings only a few people want are in the last one,
// Advanced. It was nine folds, with the theme inside the first.

/** What a note shows about itself, besides its links — the Note extras fold,
 *  which also holds the links strip and what stays on screen while you
 *  scroll (each its own fold until 2026-09-29). Called "Note chrome" until
 *  Reuben flagged it 2026-08-29 as jargon nobody would recognise. */
const CHROME: { key: keyof Space & string; label: string; hint: string }[] = [
  {
    key: 'showPath',
    label: 'Show the file path',
    hint: 'A bar between the tabs and the format bar reading Space › Folder › Note. Clicking a folder in it opens that folder in the sidebar and closes the rest, so you can see what else is in there.'
  },
  {
    key: 'showIsland',
    label: 'Show the bookmark',
    hint: 'The bookmark at the start of the tab strip, where you keep the notes you come back to most. Turn it off and it goes from this space; the notes in it are remembered for when you turn it back on.'
  },
  {
    key: 'showNoteInfo',
    label: 'Show when it was last edited',
    hint: 'Puts the time beside the word count, on your machine’s clock. Hover it for the full dates, including when the note was created.'
  }
  // Markdown pro was here until 2026-11-07; it is one switch for the whole app now,
  // in Settings → Extra features (ExtraFeatures.tsx), with how its marks look.
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
   *  to — one space here, every space on Look */
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
   *  of closed rows. Search only routes to Look, so this is unset in the
   *  per-space scope. */
  openDisclosure?: { fold: string; n: number } | null
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
  /** Whole-app scope: do the spaces disagree about any of these? */
  const anyDiffer = (keys: readonly (keyof Space)[]): boolean => !!differs && keys.some(differs)
  /** The line at the top of a fold whose controls the spaces disagree about. */
  const foldDiffers = (keys: readonly (keyof Space)[]): React.JSX.Element | null =>
    anyDiffer(keys) ? (
      <p className="text-[11.5px] text-ink-400">
        Some of these differ between your spaces <Differs />
      </p>
    ) : null

  return (
    <div className="flex flex-col gap-6">
      {/* The basics, open. */}
      <ThemeCards space={space} onChange={onChange} differs={anyDiffer(['theme'])} />
      {/* Up with the basics, under the theme it most resembles — Reuben's call
          (2026-10-26), the one setting beside theme, accent and fonts here. */}
      <CornersSection space={space} onChange={onChange} differs={anyDiffer(['corners'])} />
      <AccentSection space={space} onChange={onChange} differs={anyDiffer(['accent'])} />
      <SpaceFonts space={space} onChange={onChange} fontLibrary={fontLibrary} differs={differs} />

      <DisclosureGroup>
        <Disclosure
          label="Page"
          openSignal={opens('Page')}
          hint="The paper itself — a pattern behind your writing, a colour washed under it, and how wide it runs"
        >
          {foldDiffers(['pageLook', 'tint', 'pageLookIntensity', 'pageLookAccent', 'editorWidth'])}
          <SpacePage space={space} onChange={onChange} collection={collection} />
          <EditorWidthSection space={space} onChange={onChange} />
        </Disclosure>

        <Disclosure
          label="Sidebar"
          openSignal={opens('Sidebar')}
          hint="How tightly it packs, how it orders notes and folders, and its Note / Folder buttons"
        >
          {foldDiffers(['density', 'freeArrange', 'compactNav'])}
          <DensitySection space={space} onChange={onChange} />
          <SpaceArranging space={space} onChange={onChange} />
        </Disclosure>

        <Disclosure
          label="Colour"
          openSignal={opens('Colour')}
          hint="Headings, bold and links in your notes, and colouring notes and folders in the sidebar"
        >
          {foldDiffers(['formatColors', 'colorStyle', 'colorAuto', 'colorInherit', 'colorFadeNested', 'colorPalette'])}
          <SpaceColour space={space} onChange={onChange} onColorExisting={onColorExisting} />
        </Disclosure>

        <Disclosure
          label="Note extras"
          openSignal={opens('Note extras')}
          hint="Links, the file path, the bookmark, edit time, Markdown pro, and what stays on screen as you scroll"
        >
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
            <p className="px-1 pb-2 text-[11.5px] leading-relaxed text-ink-400">
              When you type <code className="font-mono text-ink-500">[[</code>, the list shows the
              space you&rsquo;re writing in; type another space&rsquo;s name to reach it.{' '}
              <span className="font-medium text-ink-500">Help → Tutorials → Linking your notes</span>{' '}
              walks through every form a link can take.
            </p>

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

            {/* Was its own fold of four switches, each repeating the same
                sentence about what "off" means. One question — which bars stay
                put — so one frame, the mechanic said once, and a tick per bar.
                A bar that isn't showing at all can't be kept on screen, so its
                tick greys out and says what would bring it back. */}
            <TickGroup
              label="Keep on screen while you scroll"
              hint="Unticked, a bar steps aside the moment you scroll and comes back once you’re at the very top — never mid-note, so nothing flickers as you read."
              aside={anyDiffer(['pinTabs', 'pinPath', 'pinNoteHeader', 'pinLinks']) ? <Differs /> : null}
            >
              <Tick
                on={space.pinTabs}
                onClick={() => onChange({ pinTabs: !space.pinTabs })}
                label="Tab strip"
                tip="The strip listing every note you have open."
              />
              <Tick
                on={space.pinPath}
                onClick={() => onChange({ pinPath: !space.pinPath })}
                label="File path bar"
                disabled={!space.showPath}
                tip={
                  space.showPath
                    ? 'The Space › Folder › Note bar under the tabs.'
                    : 'Turn on Show the file path above first.'
                }
              />
              <Tick
                on={space.pinNoteHeader}
                onClick={() => onChange({ pinNoteHeader: !space.pinNoteHeader })}
                label="Heading row"
                tip="Bold, italic, the custom buttons, the title, its stats and the split-view toggle."
              />
              <Tick
                on={space.pinLinks}
                onClick={() => onChange({ pinLinks: !space.pinLinks })}
                label="Links strip"
                // A bottom strip is already fixed in place, and a hidden one
                // has nothing to keep.
                disabled={!space.showLinks || space.linksPosition === 'bottom'}
                tip={
                  !space.showLinks
                    ? 'Turn on Show a note’s links above first.'
                    : space.linksPosition === 'bottom'
                      ? 'A strip at the bottom already stays put.'
                      : 'What this note points at, and what points back.'
                }
              />
            </TickGroup>
          </div>
        </Disclosure>

        <Disclosure label="Shortcuts" hint="The four custom format-bar buttons" openSignal={opens('Shortcuts')}>
          {foldDiffers(['toolbarSlots'])}
          <SpaceShortcuts space={space} onChange={onChange} />
        </Disclosure>

        <Disclosure
          label="Advanced"
          openSignal={opens('Advanced')}
          hint="Text colour on dark themes, how far the accent reaches, and stronger button edges"
        >
          {foldDiffers(['textTone', 'accentMode', 'accentUiText', 'buttonDefinition'])}
          <TextToneSection space={space} onChange={onChange} />
          <AccentReachSection space={space} onChange={onChange} />
          <ButtonEdgesSection space={space} onChange={onChange} />
        </Disclosure>
      </DisclosureGroup>
    </div>
  )
}
