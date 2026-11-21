import { Card, Cards, Code, Face, Heading, Text, Tips } from './parts'
import { practiceText } from './tryIt'

// Settings → Help → Tutorials → Moving things around.
//
// The words are the website's (site/tutorials/moving.html), card for card:
// change one, change the other. Tried in a real build on 2026-11-20: the six-dot
// drag preview, picking several lines, Alt-drag a link, holding over a folder +
// drop + Undo, dropping on Pinned. Described from the code or changelog, NOT
// tried: dropping a block on a sidebar note, unpinning by drag, every Finder or
// Explorer drop, every Try it.
// Each new guide has only been opened in the :5173 preview, not a real window.
// No real iPhone. Not tried on Windows.
// The sidebar cards have no Try it: they are done
// in the sidebar, not in a note (docs/tutorials.md). "Into another note" has none
// either — practising it would drop a line into one of your own notes.

const TWO_LINES = 'Osmosis moves water across a membrane.\n\nDiffusion needs no energy.\n\nActive transport needs energy.\n'

export function MovingGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Moving things around</Heading>
      <Text>
        Anything with six dots beside it can be picked up. A line or a highlight shows where it will land, and it lands
        exactly there.
      </Text>

      <Heading>In a note</Heading>
      <Cards>
        <Card
          type="Drag the six dots"
          title="Move a line or block"
          tryIt={practiceText(
            'Move a line or block',
            'Point at a line below, then drag the six dots on its left above another line.',
            TWO_LINES
          )}
          shows={<Face icon="grip">A greyed copy where it will go</Face>}
        >
          Point at a line and its six dots show on the left. Drag them and a greyed copy opens up where it will land.
          Pictures, voice notes, tables and formulas move the same way.
        </Card>

        <Card
          type="Ctrl/Cmd + click the six dots"
          title="Several at once"
          tryIt={practiceText(
            'Several at once',
            'Hold Ctrl/Cmd and click the six dots of two lines below, then drag one of them.',
            TWO_LINES
          )}
          shows={<Face icon="grip">Two lines picked</Face>}
        >
          Each one you click joins the pick (<Code>Shift</Code> + click picks a run). Then drag, copy, cut or delete them
          together.
        </Card>

        <Card
          type="Drop the six dots on a note in the sidebar"
          title="Into another note"
          shows={<Face icon="doc">Enzymes</Face>}
        >
          The block goes to the end of that note, and Undo brings it back.
        </Card>

        <Card
          type="Alt + drag a note into a note"
          title="A link instead of a move"
          tryIt={practiceText(
            'A link instead of a move',
            'Hold Alt (Option on a Mac) and drag a note from the sidebar onto the empty line below.'
          )}
          shows={<Face icon="noteLink">Exam dates</Face>}
        >
          Hold <Code>Alt</Code> (<Code>Option</Code> on a Mac) as you drag a note from the sidebar into a note, and a
          link to it goes in on its own line.
        </Card>
      </Cards>

      <Heading>In the sidebar</Heading>
      <Cards>
        <Card type="Hold a note over a closed folder" title="Into a folder" shows={<Face icon="folder">Cells</Face>}>
          It opens, so you can drop the note deeper inside.
        </Card>

        <Card type="Undo" title="Change your mind" shows={<Face>Moved “Practical” to Cells. Undo</Face>}>
          Moving notes into another folder says where they went. Undo puts them back where they were.
        </Card>

        <Card type="Drop a note on Pinned" title="Pin it" shows={<Face icon="starFilled">Pinned</Face>}>
          Once something is pinned, drop a note anywhere on the Pinned list to pin it. Drag it back into your notes to
          unpin it.
        </Card>
      </Cards>

      <Tips lead="From Finder or Explorer:">
        <p>Drop files on a folder in the sidebar to copy them in — a Markdown file becomes a note.</p>
        <p>Drop a picture, recording or file into a note and it goes on a new line under the block you let go on.</p>
        <p>Hold a file over a tab and that note comes to the front.</p>
      </Tips>
    </>
  )
}
