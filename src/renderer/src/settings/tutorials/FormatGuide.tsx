import { findAction } from '../../editor/commands'
import { SlotFace } from '../../editor/SlotPicker'
import { Icon } from '../../icons'
import { Card, Cards, Code, Heading, Sample, Text } from './parts'
import { practiceText } from './tryIt'

// Settings → Help → Tutorials → Format bar and / commands.
//
// The words are the website's (site/tutorials/format.html), card for card:
// change one, change the other. What each card says was checked against the
// running app — the keys, the / list and its short words, the four buttons.
//
// What a card "shows" is drawn from the app's own pieces: the bar's empty places
// are the bar's own `SlotFace` (editor/SlotPicker.tsx), and the / list reads its
// rows' words from the command registry (editor/commands.tsx), so the page can't
// drift from the app.

/** One hairline between groups of buttons, as on the bar itself. */
const Divider = (): React.JSX.Element => <span aria-hidden="true" className="h-3.5 w-px bg-ink-300/40" />

/** The bar as a new user first sees it: the four places for your own buttons are
 *  still empty, drawn the way the bar draws them (`SlotFace` — a dashed outline,
 *  quieter than a real button; Reuben, 2026-10-07: show it before). */
function BarSample(): React.JSX.Element {
  // `inline-flex` so the dashed square takes its size — the bar's own buttons are
  // flex boxes, and a bare inline span ignores its width and height.
  const empty = (
    <span className="inline-flex text-ink-300">
      <SlotFace id="" />
    </span>
  )
  return (
    <Sample>
      <span className="inline-flex items-center gap-2 text-ink-500">
        {empty}
        {empty}
        <Divider />
        <span className="font-bold">B</span>
        <span className="font-display italic">I</span>
        <span className="underline underline-offset-2">U</span>
        <span className="line-through">S</span>
        <Divider />
        <span className="flex flex-col items-center gap-[2px]">
          <span className="font-semibold leading-none">A</span>
          <span
            className="h-[3px] w-[13px] rounded-sm"
            style={{
              background: 'linear-gradient(90deg,var(--tc-coral),var(--tc-amber),var(--tc-sage),var(--tc-sky))'
            }}
          />
        </span>
        <Divider />
        {empty}
        {empty}
      </span>
    </Sample>
  )
}

/** The first rows of the / list, in the words the list itself uses. */
function MenuSample(): React.JSX.Element {
  return (
    <Sample>
      <span className="flex flex-col gap-0.5">
        {['h1', 'h2', 'bullet'].map((id) => {
          const c = findAction(id)
          return c ? (
            <span key={id}>
              <span className="font-medium">{c.label}</span> <span className="text-ink-400">{c.hint}</span>
            </span>
          ) : null
        })}
      </span>
    </Sample>
  )
}

/** A tick box, drawn the way the checklist draws one. */
function Box({ done = false }: { done?: boolean }): React.JSX.Element {
  return done ? (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-control bg-ink-500 text-surface">
      <Icon name="check" className="h-2.5 w-2.5" />
    </span>
  ) : (
    <span className="h-3.5 w-3.5 rounded-control border border-ink-300/60" />
  )
}

export function FormatGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Format bar and / commands</Heading>
      <Text>
        The bar above a note styles the words you have selected. Type <Code className="text-ink-700">/</Code> on any
        line for a list of everything else you can add.
      </Text>

      <Heading>On the bar</Heading>
      <Cards>
        <Card
          type="B I U S"
          title="Style words"
          tryIt={practiceText(
            'Style words',
            'Select a word and press a button on the bar above, or use the keys.',
            'The quick brown fox jumps over the lazy dog.'
          )}
          shows={
            <Sample>
              <span>
                Plain, <span className="font-semibold">bold</span>, <span className="italic">italic</span>,{' '}
                <span className="underline underline-offset-2">underlined</span> and{' '}
                <span className="line-through">struck</span>.
              </span>
            </Sample>
          }
        >
          Select the words and press a button, or use the keys: <Code>Ctrl/Cmd + B</Code>,{' '}
          <Code>Ctrl/Cmd + I</Code>, <Code>Ctrl/Cmd + U</Code> and <Code>Ctrl/Cmd + Shift + X</Code> for
          strikethrough. Press again to take the style off.
        </Card>

        <Card
          type="Click a dashed button"
          title="Your four buttons"
          tryIt={practiceText(
            'Your four buttons',
            'Click a dashed button on the bar above and pick a command for it, then press it with the cursor on the line below.',
            'A line to turn into a heading.'
          )}
          shows={<BarSample />}
        >
          Pick a command for it. From then on the button runs that command. Change or clear the four in{' '}
          <span className="font-medium">Settings → Look → Shortcuts</span>.
        </Card>
      </Cards>

      <Heading>The / menu</Heading>
      <Cards>
        <Card
          type="/"
          title="Open the list"
          tryIt={practiceText(
            'Open the list',
            'Type `/` on the empty line below, then keep typing to narrow the list.'
          )}
          shows={<MenuSample />}
        >
          Type it at the start of a line or after a space, keep typing to narrow the list, then press{' '}
          <Code>Enter</Code>. Most commands also answer to a short word, such as <Code>/ul</Code>, <Code>/todo</Code> or{' '}
          <Code>/h1</Code>.
        </Card>

        <Card
          type="/h1"
          title="Headings"
          tryIt={practiceText(
            'Headings',
            'Type `/h1` on the empty line below, press Enter, then type a title.'
          )}
          shows={
            <Sample>
              <span className="flex flex-col">
                <span className="text-[17px] font-semibold leading-tight">Waves</span>
                <span className="text-[14px] font-semibold leading-tight">Interference</span>
                <span className="text-[12.5px] font-semibold leading-tight">Standing waves</span>
              </span>
            </Sample>
          }
        >
          <Code>/h1</Code>, <Code>/h2</Code> or <Code>/h3</Code> — or type <Code>#</Code> and a space at the start of a
          line, with <Code>##</Code> and <Code>###</Code> for the smaller sizes.
        </Card>

        <Card
          type="/todo"
          title="Lists"
          tryIt={practiceText(
            'Lists',
            'Type `/todo` on the empty line below, press Enter, then write two things to do.'
          )}
          shows={
            <Sample>
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-1.5">
                  <Box />
                  Read chapter 3
                </span>
                <span className="flex items-center gap-1.5">
                  <Box done />
                  Hand in the notes
                </span>
              </span>
            </Sample>
          }
        >
          <Code>/bullet</Code>, <Code>/numbered</Code> or <Code>/todo</Code> — or type <Code>-</Code> then a space,{' '}
          <Code>1.</Code> then a space, or <Code>- [ ]</Code> then a space at the start of a line.
        </Card>
      </Cards>
    </>
  )
}
