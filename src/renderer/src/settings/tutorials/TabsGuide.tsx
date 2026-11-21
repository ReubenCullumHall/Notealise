import { Card, Cards, Code, Face, Heading, Text, Tips } from './parts'

// Settings → Help → Tutorials → Tabs and columns.
//
// The words are the website's (site/tutorials/tabs.html), card for card:
// change one, change the other. Tried in a real build on 2026-11-20: Ctrl/Cmd-click
// for a new tab, dropping a tab on a tab, Go to a note, the tab right-click menu.
// Described from the code or changelog, NOT tried: Ctrl/Cmd+\, the column arrow,
// dragging a column, dragging a name out of a split, resizing columns, space
// swipe, Shift+scroll, the space and tab shortcuts.
// Each new guide has only been opened in the :5173 preview, not a real window.
// No real iPhone. Not tried on Windows.
// No card here has a Try it: each is done in the window — the sidebar, the tab strip,
// a column's edge — not in a note (docs/tutorials.md). Opening a link in a
// tab or a column is the Linking guide's, so it isn't repeated here.

export function TabsGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Tabs and columns</Heading>
      <Text>A click in the sidebar opens a note in the tab you&rsquo;re on. These keep more than one open.</Text>

      <Heading>Tabs</Heading>
      <Cards>
        <Card
          type="Ctrl/Cmd + click a note"
          title="Another tab"
          shows={<Face icon="doc">Lecture notes · Enzymes · Exam dates</Face>}
        >
          Click a note in the sidebar with <Code>Ctrl</Code> held (<Code>Cmd</Code> on a Mac) and it opens in a new tab.
          The strip of tabs shows once there are two.
        </Card>

        <Card type="Ctrl/Cmd + P" title="Go to a note" shows={<Face icon="search">cel → Cell structure</Face>}>
          Type part of a note&rsquo;s name, move with the arrow keys and press <Code>Enter</Code>.{' '}
          <Code>Ctrl/Cmd + Enter</Code> opens it in a new tab.
        </Card>
      </Cards>

      <Heading>Side by side</Heading>
      <Cards>
        <Card
          type="Drop a tab on another tab"
          title="Two notes at once"
          shows={<Face icon="splitView">Lecture notes | Enzymes</Face>}
        >
          Drag a tab onto the middle of another and the two open side by side, joined as one tab. Up to three fit.{' '}
          <Code>Ctrl/Cmd + \</Code> opens an empty column beside the note you&rsquo;re in.
        </Card>

        <Card type="The arrow on a column's top edge" title="Move a column" shows={<Face icon="moveRight">Move this column to the right</Face>}>
          Point at a column&rsquo;s top bar and an arrow shows on its top edge — click it to swap places with the next
          column. Or drag the column by its top edge.
        </Card>

        <Card
          type="Right-click its name in the joined tab"
          title="Take one out"
          shows={<Face>Take Enzymes out of the split</Face>}
        >
          Or choose Split them all apart. Dragging its name onto an empty part of the tab strip takes it out too.
        </Card>
      </Cards>

      <Heading>Spaces</Heading>
      <Cards>
        <Card type="Swipe sideways with two fingers" title="Change space" shows={<Face icon="spaces">Biology · Physics · Maths</Face>}>
          Or <Code>Shift</Code> + scroll, <Code>Ctrl/Cmd + Alt + Shift + ←</Code> or <Code>→</Code>, or click a space
          button at the bottom of the sidebar.
        </Card>
      </Cards>

      <Tips lead="Also:">
        <p>Drag the line between two columns to change their width.</p>
        <p>
          <Code className="text-ink-500">Ctrl/Cmd + Alt + ←</Code> or <Code className="text-ink-500">→</Code> moves
          between tabs.
        </p>
      </Tips>
    </>
  )
}
