import { useEffect, useRef } from 'react'
import katex from 'katex'
import { Icon } from '../../icons'
import { Card, Cards, Code, Heading, Sample, Text } from './parts'
import { practiceText } from './tryIt'

// Settings → Help → Tutorials → Maths, tables and toggles.
//
// The words are the website's (site/tutorials/blocks.html), card for card:
// change one, change the other. Formulas are drawn by KaTeX, the same library
// the editor uses, so they look the way they do in a note.

/** A formula, drawn into its own element (KaTeX writes the DOM itself — no HTML
 *  string is ever built here). */
function Formula({ tex }: { tex: string }): React.JSX.Element {
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (box.current) katex.render(tex, box.current, { throwOnError: false })
  }, [tex])
  return <span ref={box} />
}

/** The table `/table` makes, once it has some words in it. `plus` shows the bar
 *  that adds a column; `grip` the six dots above a column. */
function TableSample({ plus = false, grip = false }: { plus?: boolean; grip?: boolean }): React.JSX.Element {
  const cell = 'border border-ink-300/40 px-2 py-0.5 text-left'
  return (
    <span className={'relative inline-block ' + (grip ? 'pt-3.5 ' : '') + (plus ? 'pr-3.5' : '')}>
      {grip && (
        <span className="absolute left-5 top-0 inline-flex h-3 w-5 items-center justify-center rounded-full bg-ink-300/25 text-ink-500">
          <Icon name="grip" className="h-2.5 w-2.5" />
        </span>
      )}
      <table className="border-collapse text-[11.5px] text-ink-700">
        <thead>
          <tr>
            <th className={cell + ' bg-wash/[0.08] font-semibold'}>Wave</th>
            <th className={cell + ' bg-wash/[0.08] font-semibold'}>Speed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}>Sound</td>
            <td className={cell}>343 m/s</td>
          </tr>
        </tbody>
      </table>
      {plus && (
        <span className="absolute bottom-0 right-0 top-0 flex w-3 items-center justify-center rounded-control bg-wash/[0.08] text-[10px] text-ink-400">
          +
        </span>
      )}
    </span>
  )
}

/** A toggle: the arrow, its title, and what is inside while it is open. */
function ToggleSample({ open }: { open: boolean }): React.JSX.Element {
  return (
    <Sample>
      <span className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1">
          <span className={'inline-flex text-ink-400 transition-transform duration-150 ' + (open ? 'rotate-90' : '')}>
            <Icon name="chevron" className="h-3 w-3" />
          </span>
          Key formulas
        </span>
        {open && (
          <>
            <span className="pl-4">Speed = distance / time</span>
            <span className="pl-4">Frequency = 1 / period</span>
          </>
        )}
      </span>
    </Sample>
  )
}

export function BlocksGuide(): React.JSX.Element {
  return (
    <>
      <Heading first>Maths, tables and toggles</Heading>
      <Text>
        Formulas, tables and toggle lists each start from the <Code className="text-ink-700">/</Code> menu.
      </Text>

      <Heading>Formulas</Heading>
      <Cards>
        <Card
          type="/inline"
          title="Inside a sentence"
          tryIt={practiceText(
            'Inside a sentence',
            'Type `/inline` at the end of the line below, press Enter, then type `x^2`.',
            'The area of the square is ',
            true
          )}
          shows={
            <Sample>
              <span>
                The area is <Formula tex="x^2" /> square metres.
              </span>
            </Sample>
          }
        >
          Press <Code>Enter</Code>, then type the formula in the box that opens under the line — <Code>x^2</Code>, say.
          It draws as you type. Press <Code>Enter</Code> again when you are done.
        </Card>

        <Card
          type="Ctrl/Cmd + Shift + L"
          title="On its own line"
          tryIt={practiceText(
            'On its own line',
            'Press Ctrl/Cmd + Shift + L on the empty line below.'
          )}
          shows={
            <Sample>
              <Formula tex={'\\int_0^1 x\\,dx = \\tfrac{1}{2}'} />
            </Sample>
          }
        >
          Press it on an empty line, or pick LaTeX formula from the <Code>/</Code> menu. <Code>Shift + Enter</Code> adds
          a line to the formula.
        </Card>
      </Cards>

      <Heading>Tables</Heading>
      <Cards>
        <Card
          type="/table"
          title="A table"
          tryIt={practiceText(
            'A table',
            'Type `/table` on the empty line below, then click a cell and type.'
          )}
          shows={<TableSample />}
        >
          Click a cell and type. <Code>Enter</Code> keeps what you typed, <Code>Tab</Code> moves to the next cell, and{' '}
          <Code>Shift + Enter</Code> starts a new line inside a cell.
        </Card>

        <Card
          type="+"
          title="More rows and columns"
          tryIt={practiceText(
            'More rows and columns',
            'Point at the right edge of the table below until a + bar shows, then click it.',
            '| Wave | Speed |\n| --- | --- |\n| Sound | 343 m/s |\n'
          )}
          shows={<TableSample plus />}
        >
          Point at the right edge or the bottom edge of the table and a + bar shows. Click it for one more, or drag it
          for several.
        </Card>

        <Card
          type="Six dots above a column"
          title="Move, remove or resize a column"
          tryIt={practiceText(
            'Move, remove or resize a column',
            'Point at a column heading below and drag the six dots, or drag the line between two columns.',
            '| Wave | Speed | Note |\n| --- | --- | --- |\n| Sound | 343 m/s | In air |\n'
          )}
          shows={<TableSample grip />}
        >
          Drag the six dots to move the column. Click them, then press <Code>Backspace</Code> to remove it. Drag the
          line between two columns to change their width.
        </Card>
      </Cards>

      <Heading>Toggle lists</Heading>
      <Cards>
        <Card
          type="> then a space"
          title="A toggle"
          tryIt={practiceText(
            'A toggle',
            'Type `>` and a space on the empty line below, then a title, press Enter and write something inside.'
          )}
          shows={<ToggleSample open />}
        >
          Type the title, press <Code>Enter</Code>, and write what goes inside. <Code>/toggle</Code> does the same.
        </Card>

        <Card
          type="Ctrl/Cmd + Enter"
          title="Open and shut"
          tryIt={practiceText(
            'Open and shut',
            'Click the arrow beside the toggle below, or put the cursor on its title and press Ctrl/Cmd + Enter.',
            '<details open><summary>Key formulas</summary>\n\nSpeed = distance / time\nFrequency = 1 / period\n\n</details>\n'
          )}
          shows={<ToggleSample open={false} />}
        >
          With the cursor on the title — or click the arrow. Everything inside hides and comes back, headings, tables
          and formulas included. <Code>Enter</Code> on an empty line inside steps you out below the toggle.
        </Card>
      </Cards>

      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-400">
        To change one later: click a formula to open its box again, click a table cell to edit it, or press{' '}
        <Code className="text-ink-500">Backspace</Code> at the start of a toggle title to turn it back into ordinary
        lines. <Code className="text-ink-500">Backspace</Code> in an empty table row removes the row.
      </p>
    </>
  )
}
