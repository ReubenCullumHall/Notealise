import { Icon } from '../icons'
import { ToggleRow } from './primitives'
import { Disclosure, SpaceAppearance, SpaceArranging, SpaceShortcuts } from './Spaces'
import type { Space } from '../../../shared/settings'

// Every setting that belongs to a space, in one form, rendered in two places:
//
//   Master settings         → writes to EVERY space at once
//   Spaces → this space     → writes to that one
//
// One component, so the two can never offer different options or lay them out
// differently — which is the whole point of "the same page, scoped".

/** What a note shows about itself. The other three sections are the long-standing
 *  Appearance / Arranging / Shortcuts, which live in Spaces.tsx. */
const CHROME: { key: keyof Space & string; label: string; hint: string; needs?: 'showLinks' }[] = [
  {
    key: 'showLinks',
    label: 'Show a note’s links',
    hint: 'A strip under the format bar listing what this note points at and what points back at it. Hover one to see which of the two it is, which space it’s in, and the line it sits in.'
  },
  {
    key: 'pinLinks',
    label: 'Keep them on screen',
    hint: 'The strip stays put however far you scroll, instead of scrolling away with the text. Handy while you’re joining notes up; costs a little height in a three-way split.',
    needs: 'showLinks'
  },
  {
    key: 'showPath',
    label: 'Show the file path',
    hint: 'A bar between the tabs and the format bar reading Space › Folder › Note. Clicking a folder in it opens that folder in the sidebar and closes the rest, so you can see what else is in there.'
  },
  {
    key: 'showNoteInfo',
    label: 'Show when it was last edited',
    hint: 'Puts the time beside the word count, on your machine’s clock. Hover it for the full dates, including when the note was created.'
  }
]

interface Props {
  /** the space being edited — or, in master scope, the one whose values are
   *  shown as the starting point */
  space: Space
  onChange: (patch: Partial<Space>) => void
  /** true for a setting the spaces currently disagree about. Master scope only:
   *  showing one value as though it were everyone's would be a lie, so the
   *  control says so and changing it settles the disagreement. */
  differs?: (key: keyof Space) => boolean
}

/** "Spaces differ" next to a control, in master scope only. */
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

export function SpaceForm({ space, onChange, differs }: Props): React.JSX.Element {
  return (
    <>
      <Disclosure label="Appearance" hint="Theme, accent colour, button edges and sidebar density">
        {differs && (['theme', 'textTone', 'buttonDefinition', 'density', 'accent', 'accentMode'] as const).some(differs) && (
          <p className="mb-2 text-[11.5px] text-ink-400">
            Some of these differ between your spaces <Differs />
          </p>
        )}
        <SpaceAppearance space={space} onChange={onChange} />
      </Disclosure>

      <Disclosure label="Arranging" hint="How the sidebar orders and labels things">
        <SpaceArranging space={space} onChange={onChange} />
      </Disclosure>

      <Disclosure label="Linking content" hint="What a note shows about itself, above the text">
        <div className="flex flex-col gap-2">
          {CHROME.map((c) => {
            const off = c.needs ? !space[c.needs] : false
            return (
              <div key={c.key} className={off ? 'pointer-events-none opacity-40' : ''}>
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
            )
          })}
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
