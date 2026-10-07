import { Card, Cards, Chip, Heading, Text } from './parts'
import { practiceText } from './tryIt'

// Settings → Tutorials → Linking your notes.
//
// Pure explanation; the switches live on the Links page. `[[Note]]` is
// guessable, `[[Note|what it says]]` is not, and neither is the rule about which
// space the picker offers you. None of it is discoverable from the editor, and a
// feature nobody can find the shape of may as well not be there.

export function LinkingGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Linking notes</Heading>
      <Text>
        Type <code className="font-mono text-ink-700">[[</code> anywhere in a note to connect it to
        another one, and pick from the list.
      </Text>

      <Heading>The six forms</Heading>
      <Cards>
        <Card
          type="[[Waves]]"
          title="By name"
          tryIt={practiceText(
            'By name',
            'Type `[[` on the empty line below and pick a note from the list.'
          )}
          shows={<Chip>Waves</Chip>}
        >
          Pick a note from the list. This is the everyday one.
        </Card>

        <Card type="[[Term 3/Waves]]" title="By path" shows={<Chip>Waves</Chip>}>
          The list writes this for you when two notes share a name, or the note is in another space.
          Only the name shows.
        </Card>

        <Card
          type="[[Waves|the waves chapter]]"
          title="In your own words"
          tryIt={practiceText(
            'In your own words',
            'Type `[[`, pick a note, then type `|` and your own words just before the `]]`.'
          )}
          shows={<Chip>the waves chapter</Chip>}
        >
          Pick the note, then type <code className="font-mono">|</code> and your words just before
          the <code className="font-mono">]]</code>. Your words show; the link still opens Waves.
        </Card>

        <Card
          type="[[Waves#Interference]]"
          title="Straight to a heading"
          tryIt={practiceText(
            'Straight to a heading',
            'Type `[[#` on the empty line below: the list shows this note\'s headings.',
            '## First heading\n\nSome words.\n\n## Second heading\n\nSome more words.\n'
          )}
          shows={
            <Chip>
              Waves <span className="px-0.5 text-ink-300">›</span>{' '}
              <span className="text-ink-500">Interference</span>
            </Chip>
          }
        >
          In the list, press <span className="font-medium">→</span> on a note (or click its arrow),
          then pick a heading. Type <code className="font-mono">[[#</code> for the headings in this
          note.
        </Card>

        <Card
          type="[[Waves#^k3x9]]"
          title="Straight to a paragraph"
          tryIt={practiceText(
            'Straight to a paragraph',
            'Right-click the six dots beside the paragraph below, choose Copy link to block, then paste it on the empty line under it.',
            'A wave carries energy from place to place.\n'
          )}
          shows={
            <Chip>
              Waves <span className="px-0.5 text-ink-300">›</span>{' '}
              <span className="text-ink-500">A wave carries energy…</span>
            </Chip>
          }
        >
          Right-click the six dots beside a line, choose{' '}
          <span className="font-medium">Copy link to block</span>, then paste it into any note. The
          link shows the paragraph&rsquo;s first words.
        </Card>

        <Card
          type="[[Term 3]]"
          title="A folder"
          tryIt={practiceText(
            'A folder',
            'Type `[[` on the empty line below and pick a folder from the list.'
          )}
          shows={<Chip icon="folder">Term 3</Chip>}
        >
          Pick a folder from the list. Clicking the link opens that folder in the sidebar.
        </Card>
      </Cards>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
        To change where a link goes, right-click it and pick again. Your own words stay.
      </p>

      <h3 className="mt-7 accent-heading font-display text-[15px] font-semibold">
        Links and your spaces
      </h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        The <code className="font-mono text-ink-700">[[</code> list shows the space you&rsquo;re
        writing in. To link something in another space, start by typing that space&rsquo;s name and
        the list follows you there:
      </p>
      <div className="mt-2 rounded-xl px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-600 ring-1 ring-ink-300/20">
        <div>
          [[Wav<span className="ml-3 font-sans text-ink-400">— notes in this space</span>
        </div>
        <div className="mt-1">
          [[Physics<span className="ml-3 font-sans text-ink-400">— everything in Physics</span>
        </div>
        <div className="mt-1">
          [[Physics/Wav<span className="ml-3 font-sans text-ink-400">— narrowed inside Physics</span>
        </div>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
        Or step through it. Folders and notes in the list have an arrow at the end: press{' '}
        <span className="font-medium">→</span> or click the arrow to go inside. Inside a note the
        list is its headings, so you can link straight to one.{' '}
        <span className="font-medium">←</span> or the name at the top goes back.
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
        A link that already crosses spaces keeps working wherever you are — this only decides what
        the picker offers. Those links are drawn with a dotted leading edge, and hovering one names
        the space it lands in.
      </p>

      <h3 className="mt-7 accent-heading font-display text-[15px] font-semibold">Opening a link</h3>
      <div className="mt-2 flex flex-col gap-1 text-[12px] text-ink-600">
        {[
          ['Click', 'Opens in a new tab — the note you were reading stays open'],
          ['Cmd + click (Ctrl on Windows)', 'Opens it in a tab behind this one — you stay where you are'],
          ['Alt + click', 'Opens it beside this one, in a new column'],
          ['Drag it', 'Drop it into any column'],
          [
            'Right-click it',
            'Point it somewhere else. The list opens on that note’s headings, or on its folder if you right-click the note’s name. Esc leaves it as it was'
          ],
          ['A note that isn’t written yet', 'Shown dashed. Clicking makes it, next to this note']
        ].map(([k, v]) => (
          <div key={k} className="flex gap-3 rounded-lg px-2 py-1.5 ring-1 ring-ink-300/15">
            <span className="w-[10.5rem] shrink-0 font-medium text-ink-700">{k}</span>
            <span className="min-w-0 flex-1 text-ink-500">{v}</span>
          </div>
        ))}
      </div>

      <h3 className="mt-7 accent-heading font-display text-[15px] font-semibold">The links strip</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Every note carries a strip of its connections at the top: what it links to, then what links
        back to it. Hover one to see which of the two it is, which space it&rsquo;s in, and the line
        the link sits in.
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
        Whether it shows at all, whether it stays put as you scroll, and whether the folder trail
        shows above it are all in{' '}
        <span className="font-medium text-ink-500">Settings → Look → Note extras</span> — each
        space can answer them differently.
      </p>

      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-400">
        Renaming a note updates the links that pointed at it. Moving one between folders doesn&rsquo;t
        need to — links find a note by its name, so they keep working wherever it ends up.
      </p>
    </>
  )
}
