import { Card, Cards, Code, Face, Heading, Text, Tips } from './parts'

// Settings → Help → Tutorials → Archive and earlier versions.
//
// The words are the website's (site/tutorials/archive.html), card for card:
// change one, change the other. Tried in a real build on 2026-11-20: the "?"
// archive question, Move to Archive, the archive view, the Put back list, binning
// and restoring a note, opening Earlier versions. Described from the code or
// changelog, NOT tried: choosing a Put back destination, Archive this space,
// Recovery, Put back and Restore whole note inside Earlier versions.
// Each new guide has only been opened in the :5173 preview, not a real window.
// No real iPhone. Not tried on Windows.
// No card has a Try it: each is done in the sidebar, a tab or Settings, and practising
// would archive or bin the practice note (docs/tutorials.md).

export function KeepingGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Archive and earlier versions</Heading>
      <Text>
        Nothing you put away is lost: archived notes wait in the archive, deleted ones in the Bin, and every note keeps
        earlier copies of itself.
      </Text>

      <Heading>The archive</Heading>
      <Cards>
        <Card type="Ctrl/Cmd + Shift + A" title="Archive a note" shows={<Face icon="archive">Archived “Mitochondria”. Undo</Face>}>
          Archives the note you&rsquo;re in. Or right-click its tab and choose Move to archive. Undo puts it straight
          back.
        </Card>

        <Card type="?" title="Old notes ask" shows={<Face icon="question">Want to archive?</Face>}>
          A note you haven&rsquo;t edited in over 3 months shows a <Code>?</Code> where its six dots go. Click it and
          choose Yes, or Never ask me this again.
        </Card>

        <Card type="The archive button" title="Go into the archive" shows={<Face icon="archive">Search the archive</Face>}>
          It&rsquo;s at the bottom of the sidebar, beside the Bin. Click it to go in — the archive has its own search —
          and again to come back.
        </Card>

        <Card type="Right-click → Put back…" title="Put back" shows={<Face icon="restore">Put back in · where it came from</Face>}>
          Right-click a note in the archive and choose where it came from, or any of your spaces.
        </Card>
      </Cards>

      <Heading>The Bin</Heading>
      <Cards>
        <Card type="The Bin button" title="Get a deleted note back" shows={<Face icon="restore">Put back</Face>}>
          Deleted notes wait in the Bin, at the bottom of the sidebar. Point at one and press the curved arrow to put it
          back where it was. After you empty the Bin, Settings → Data → Recovery keeps them for 7 more days.
        </Card>
      </Cards>

      <Heading>Earlier versions</Heading>
      <Cards>
        <Card type="Right-click → Earlier versions…" title="See what a note used to say" shows={<Face>Removed since · Put back</Face>}>
          Right-click a note&rsquo;s tab or its name in the sidebar. Pick a time on the left: anything removed since has
          a Put back, and Restore whole note takes the whole note back.
        </Card>

        <Card type="Settings → Data → Earlier versions" title="How often a copy is kept" shows={<Face>When you close the note</Face>}>
          Or when you close the app, or every 1, 5 or 15 minutes while you write. A copy is also kept before you delete a
          sentence or more. Copies last 30 days.
        </Card>
      </Cards>

      <Tips lead="Also:">
        <p>Right-click a space and choose Archive this space to put the whole space away.</p>
      </Tips>
    </>
  )
}
