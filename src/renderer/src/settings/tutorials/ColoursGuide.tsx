import { Icon } from '../../icons'
import { PALETTE, paletteEntry, type ColorName } from '../../editor/palette'
import { Card, Cards, Code, Heading, Sample, Text } from './parts'
import { practiceText } from './tryIt'

// Settings → Help → Tutorials → Colours.
//
// The words are the website's (site/tutorials/colours.html), card for card:
// change one, change the other. Every colour drawn here is the palette's own —
// the ten tokens a note's highlights and text colours use (shared/palette.ts) —
// so nothing on this page is a colour the app doesn't have.

/** A palette colour as a small square, for the picker's recent and starred rows. */
function Dot({ name }: { name: ColorName }): React.JSX.Element {
  return <span className="h-3.5 w-3.5 rounded-control" style={{ background: paletteEntry(name)?.hex }} />
}

const Empty = (): React.JSX.Element => (
  <span className="h-3.5 w-3.5 rounded-control border border-dashed border-ink-300/60" />
)

const Divider = (): React.JSX.Element => <span aria-hidden="true" className="h-3.5 w-px bg-ink-300/40" />

/** The bar that appears over a selection: highlight or text colour, the ten
 *  colours, then the way back. */
function BarSample(): React.JSX.Element {
  return (
    <Sample>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-control bg-ink-300/25 text-[10px]">
          ▉
        </span>
        <span className="px-1 text-[12px] text-ink-500">A</span>
        <Divider />
        {PALETTE.map((c) => (
          <span
            key={c.name}
            className="h-3.5 w-3.5 rounded-full ring-1 ring-ink-300/25"
            style={{ background: `var(--hl-${c.name})` }}
          />
        ))}
        <span className="px-1 text-ink-400">✕</span>
      </span>
    </Sample>
  )
}

export function ColoursGuide(): React.JSX.Element {
  const coral = paletteEntry('coral')?.hex ?? ''
  return (
    <>
      <Heading first>Colours</Heading>
      <Text>
        Select some words and a small bar of colours appears above them. The <span className="font-medium">A</span> on
        the format bar opens the same colours.
      </Text>

      <Heading>Colouring words</Heading>
      <Cards>
        <Card
          type="Select words"
          title="The bar over a selection"
          tryIt={practiceText(
            'The bar over a selection',
            'Select some of the words below. A bar of colours appears above them.',
            'Revise the key terms before Friday, and highlight the ones you keep forgetting.'
          )}
          shows={<BarSample />}
        >
          Press ▉ for a highlight or <span className="font-medium">A</span> for text colour, then pick one of the ten
          colours. The bar keeps to whichever of the two you used last.
        </Card>

        <Card
          type="Ctrl/Cmd + Shift + H"
          title="Highlight in one go"
          tryIt={practiceText(
            'Highlight in one go',
            'Select some words below and press Ctrl/Cmd + Shift + H.',
            'Revise the key terms before Friday, and highlight the ones you keep forgetting.'
          )}
          shows={
            <Sample>
              <span>
                Revise the <span className="hl-amber rounded-[3px] px-0.5">key terms</span> before Friday.
              </span>
            </Sample>
          }
        >
          Highlights the selected words in amber. For any other colour, use the bar.
        </Card>

        <Card
          type="+"
          title="Any colour"
          tryIt={practiceText(
            'Any colour',
            'Select some words below, press the + at the end of the bar, and pick a colour of your own.',
            'Revise the key terms before Friday, and highlight the ones you keep forgetting.'
          )}
          shows={
            <Sample>
              <span className="h-3.5 w-3.5 rounded-control" style={{ background: coral }} />
              <span className="font-mono">{coral}</span>
            </Sample>
          }
        >
          Press <span className="font-medium">+</span> at the end of the bar to open a colour square. Drag it, slide the
          strip under it, or type a hex such as <Code>#e07b5c</Code>, then press Apply.
        </Card>

        <Card
          type="★"
          title="Recent and starred colours"
          tryIt={practiceText(
            'Recent and starred colours',
            'Colour a few words in different colours, then star one with the star by the hex box.',
            'Revise the key terms before Friday, and highlight the ones you keep forgetting.'
          )}
          shows={
            <Sample>
              <Dot name="amber" />
              <Dot name="sky" />
              <Dot name="indigo" />
              <Divider />
              <Dot name="coral" />
              <Dot name="teal" />
              <Dot name="indigo" />
              <Empty />
              <Empty />
            </Sample>
          }
        >
          Under the square, your three most recent colours sit beside up to five starred ones. Press the star by the hex
          box to star a colour, and right-click a starred colour to unstar it. They are the same in every colour
          picker.
        </Card>

        <Card
          type="✕"
          title="Take it off"
          tryIt={practiceText(
            'Take it off',
            'Select the highlighted words below and press ✕ in the bar.',
            'Revise the <mark class="hl-amber">key terms</mark> before Friday.'
          )}
          shows={
            <Sample>
              <Icon name="x" className="h-3.5 w-3.5 text-ink-500" />
              Remove colour
            </Sample>
          }
        >
          Select the words and press ✕ in the bar, or Remove colour in the <span className="font-medium">A</span> menu
          on the format bar.
        </Card>
      </Cards>

      <Heading>A colour for a kind of text</Heading>
      <Cards>
        <Card
          type="Look → Colour"
          title="Headings, bold and links"
          shows={
            <Sample>
              <span className="font-semibold" style={{ color: 'var(--tc-coral)' }}>
                Waves
              </span>
              <span className="font-semibold" style={{ color: 'var(--tc-indigo)' }}>
                energy
              </span>
              <span style={{ color: 'var(--tc-teal)' }}>Waves</span>
            </Sample>
          }
        >
          In Settings, under <span className="font-medium">Text in your notes</span>, pick a row — Headings, Bold,
          Italic, Underline, Strikethrough, Note links or Web links — then Text or Highlight, then a colour. It changes
          how your notes look in Notealise; nothing is written into them.
        </Card>
      </Cards>

      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-400">
        The ten named colours adjust themselves for light and dark pages. A colour of your own stays exactly as you
        picked it on both, so check it on each.
      </p>
    </>
  )
}
