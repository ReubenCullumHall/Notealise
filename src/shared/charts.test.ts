import { describe, expect, it } from 'vitest'
import {
  chartEdit,
  chartNames,
  chartTabId,
  chartTabKey,
  chartTabNote,
  chartTitle,
  findCharts,
  insertChartEdit,
  isChartTab,
  isFlowChart,
  locateChart,
  withoutCharts
} from './charts'
import { countWords, notePreview, toPlainText } from './plainText'

const block = (body: string, fence = '```'): string => `${fence}mermaid\n${body}\n${fence}`
const apply = (text: string, e: { from: number; to: number; insert: string }): string =>
  text.slice(0, e.from) + e.insert + text.slice(e.to)

describe('findCharts', () => {
  it('finds a chart and exactly where its parts are', () => {
    const text = `Before\n\n${block('flowchart TD\n  A --> B')}\n\nAfter`
    const [c] = findCharts(text)
    expect(c.source).toBe('flowchart TD\n  A --> B')
    expect(text.slice(c.from, c.to)).toBe(block('flowchart TD\n  A --> B'))
    expect(text.slice(c.bodyFrom, c.closeFrom)).toBe('flowchart TD\n  A --> B\n')
  })

  it('finds several, in order, with tildes too', () => {
    const text = `${block('graph LR\n A')}\n\n${block('pie\n "a": 1', '~~~')}`
    expect(findCharts(text).map((c) => c.fence)).toEqual(['```', '~~~'])
  })

  it('reads a Windows file', () => {
    const text = '```mermaid\r\ngraph TD\r\n  A --> B\r\n```\r\nAfter'
    const [c] = findCharts(text)
    expect(c.source).toBe('graph TD\n  A --> B')
    expect(c.eol).toBe('\r\n')
    expect(text.slice(c.from, c.to)).toBe('```mermaid\r\ngraph TD\r\n  A --> B\r\n```')
  })

  it('finds an empty chart', () => {
    const [c] = findCharts('```mermaid\n```')
    expect(c.source).toBe('')
    expect(c.bodyFrom).toBe(c.closeFrom)
  })

  it.each([
    ['another language', '```js\nmermaid\n```'],
    ['words after the language', '```mermaid title\nA\n```'],
    ['a different case', '```Mermaid\nA\n```'],
    ['unclosed', '```mermaid\nA --> B\n\nThe rest of the note'],
    ['closed by the wrong character', '```mermaid\nA\n~~~'],
    ['closed by a shorter fence', '````mermaid\nA\n```'],
    ['a closing fence with words after it', '```mermaid\nA\n``` not yet'],
    ['inside a longer code block', '````md\n```mermaid\nA\n```\n````'],
    ['indented under a list item', '- item\n  ```mermaid\n  A\n  ```'],
    ['in a quote', '> ```mermaid\n> A\n> ```'],
    ['inside a maths block', '$$\n```mermaid\nA\n```\n$$'],
    ['inside frontmatter', '---\nx: |\n  ```mermaid\n```\n---\nBody'],
    ['the word on an ordinary line', 'I like mermaid charts']
  ])('is not a chart: %s', (_name, text) => {
    expect(findCharts(text)).toEqual([])
  })

  it('still finds a chart after frontmatter', () => {
    expect(findCharts(`---\ntitle: x\n---\n${block('graph TD')}`)).toHaveLength(1)
  })
})

describe('word count, sidebar line and search text', () => {
  const text = `Two words\n\n${block('flowchart TD\n  A[Photosynthesis here] --> B[More boxes]')}\n\nEnd`

  it('leaves charts out of the word count', () => {
    expect(countWords(text)).toBe(3)
  })

  it('still counts an ordinary code block', () => {
    expect(countWords('Hi\n\n```js\nconst x\n```')).toBe(3)
  })

  it('still counts an unclosed chart, which is on screen as code', () => {
    expect(countWords('Hi\n\n```mermaid\nsome words')).toBe(3)
  })

  it('keeps chart words in the text search reads', () => {
    expect(toPlainText(text)).toContain('Photosynthesis')
  })

  it('leaves a chart out of the sidebar line', () => {
    expect(notePreview(text)).toBe('Two words End')
  })

  it('leaves out a chart the sidebar line cut in half', () => {
    const long = `Opening words\n\n\`\`\`mermaid\nflowchart TD\n${'  A[Box] --> B[Box]\n'.repeat(40)}\`\`\`\n`
    expect(long.length).toBeGreaterThan(400)
    expect(notePreview(long)).toBe('Opening words')
    expect(withoutCharts(long.slice(0, 200), true).trim()).toBe('Opening words')
  })
})

describe('names', () => {
  it.each([
    ['---\ntitle: Revision flow\n---\nflowchart TD\n A', 'Revision flow'],
    ['---\ntitle: "Quoted name"\n---\ngraph TD\n A', 'Quoted name'],
    ['pie title Time spent\n "a": 1', 'Time spent'],
    ['gantt\n  title Exam plan\n  section A', 'Exam plan'],
    ['timeline\n  title Term', 'Term']
  ])('reads the title of %j', (source, want) => {
    expect(chartTitle(source)).toBe(want)
  })

  it('does not take a flow chart box called title for the name', () => {
    expect(chartTitle('flowchart TD\n title here --> B')).toBeNull()
  })

  it('numbers only the charts with no title', () => {
    const charts = [{ source: 'graph TD' }, { source: '---\ntitle: Own\n---\ngraph TD' }, { source: 'graph LR' }]
    expect(chartNames(charts, 'Biology')).toEqual(['Biology chart', 'Own', 'Biology chart 2'])
  })

  it.each([
    ['flowchart TD\n A', true],
    ['graph LR\n A', true],
    ['%% a comment\nflowchart TD', true],
    ['---\ntitle: x\n---\nflowchart TD', true],
    ['%%{init: {}}%%\ngraph TD', true],
    ['stateDiagram-v2\n A', false],
    ['pie\n "a": 1', false],
    ['', false]
  ])('knows whether %j can be walked', (source, want) => {
    expect(isFlowChart(source)).toBe(want)
  })
})

describe('writing a chart back', () => {
  const note = (body: string): string => `Before\n\n${block(body)}\n\nAfter`

  it('changes only the chart', () => {
    const text = note('graph TD\n  A')
    const [c] = findCharts(text)
    const e = chartEdit(c, 'graph LR\n  A --> B')
    expect(apply(text, e)).toBe(note('graph LR\n  A --> B'))
    expect(e.from).toBe(c.bodyFrom)
  })

  it('fills an empty chart', () => {
    const text = '```mermaid\n```'
    expect(apply(text, chartEdit(findCharts(text)[0], 'graph TD'))).toBe('```mermaid\ngraph TD\n```')
  })

  it('can empty a chart and stays a chart', () => {
    const text = note('graph TD')
    const out = apply(text, chartEdit(findCharts(text)[0], ''))
    expect(out).toBe('Before\n\n```mermaid\n```\n\nAfter')
    expect(findCharts(out)[0].source).toBe('')
  })

  it('keeps a Windows file Windows', () => {
    const text = '```mermaid\r\ngraph TD\r\n```\r\n'
    const out = apply(text, chartEdit(findCharts(text)[0], 'graph LR\nA --> B'))
    expect(out).toBe('```mermaid\r\ngraph LR\r\nA --> B\r\n```\r\n')
  })

  it('grows the fence when the text holds a line that would close it', () => {
    const text = note('graph TD')
    const out = apply(text, chartEdit(findCharts(text)[0], 'graph TD\n```\nA'))
    expect(findCharts(out)).toHaveLength(1)
    expect(findCharts(out)[0].source).toBe('graph TD\n```\nA')
    expect(out.endsWith('\n\nAfter')).toBe(true)
  })

  it('keeps what you typed through a round trip, whatever it is', () => {
    for (const s of ['A[`code`]', '~~~', '```mermaid', '````', 'a\n\n\nb', '  indented', '$$', '---']) {
      const text = note('graph TD')
      const out = apply(text, chartEdit(findCharts(text)[0], s))
      expect(findCharts(out).map((c) => c.source)).toEqual([s])
    }
  })
})

describe('finding the tab’s block again', () => {
  const c = (...sources: string[]) => findCharts(sources.map((s) => block(s)).join('\n\n'))

  it('follows a block that moved', () => {
    expect(locateChart(c('b', 'a'), { index: 0, source: 'a' }, 2)).toBe(1)
  })

  it('takes the nearest of two identical charts', () => {
    expect(locateChart(c('a', 'x', 'a'), { index: 2, source: 'a' }, 3)).toBe(2)
    expect(locateChart(c('a', 'x', 'a'), { index: 0, source: 'a' }, 3)).toBe(0)
  })

  it('follows a block edited in place', () => {
    expect(locateChart(c('x', 'changed'), { index: 1, source: 'old' }, 2)).toBe(1)
  })

  it('says it has gone when the block was deleted', () => {
    expect(locateChart(c('x'), { index: 1, source: 'gone' }, 2)).toBeNull()
    expect(locateChart(c('x', 'y'), { index: 0, source: 'gone' }, 3)).toBeNull()
    expect(locateChart([], { index: 0, source: 'gone' }, 1)).toBeNull()
  })
})

describe('putting a deleted chart back', () => {
  it('goes back between the paragraphs it came from', () => {
    const text = 'One\n\nTwo'
    const out = apply(text, insertChartEdit(text, 5, 'graph TD'))
    expect(out).toBe('One\n\n```mermaid\ngraph TD\n```\n\nTwo')
  })

  it('goes on the end of a note, with a gap', () => {
    const text = 'One'
    expect(apply(text, insertChartEdit(text, 99, 'graph TD'))).toBe('One\n\n```mermaid\ngraph TD\n```')
  })

  it('fills an empty note', () => {
    expect(apply('', insertChartEdit('', 0, 'graph TD'))).toBe('```mermaid\ngraph TD\n```')
  })

  it('never lands inside another code block', () => {
    const text = 'One\n\n```js\na\nb\n```\n\nTwo'
    const out = apply(text, insertChartEdit(text, text.indexOf('b'), 'graph TD'))
    expect(findCharts(out)).toHaveLength(1)
    expect(out).toContain('```js\na\nb\n```')
  })

  it('never lands inside a formula', () => {
    const text = '$$\nx\ny\n$$\n\nEnd'
    const out = apply(text, insertChartEdit(text, text.indexOf('y'), 'graph TD'))
    expect(out).toContain('$$\nx\ny\n$$')
    expect(findCharts(out)).toHaveLength(1)
  })

  it('goes after an unclosed code block rather than into it', () => {
    const text = 'One\n\n```js\nno end'
    const out = apply(text, insertChartEdit(text, text.indexOf('no'), 'graph TD'))
    expect(out.startsWith('One\n\n```mermaid')).toBe(true)
  })

  it('keeps its text whole if that text holds a fence', () => {
    const out = apply('A', insertChartEdit('A', 1, 'graph TD\n```\nB'))
    expect(findCharts(out)[0].source).toBe('graph TD\n```\nB')
  })
})

describe('a chart tab', () => {
  it('is written under its note, so renames and the bin carry it', () => {
    const id = chartTabId('Biology/Cells.md', 'k3')
    expect(id.startsWith('Biology/Cells.md/')).toBe(true)
    expect(isChartTab(id)).toBe(true)
    expect(chartTabNote(id)).toBe('Biology/Cells.md')
    expect(chartTabKey(id)).toBe('k3')
  })

  it('is never an ordinary note', () => {
    expect(isChartTab('Biology/Cells.md')).toBe(false)
    expect(chartTabNote('Biology/Cells.md')).toBe('Biology/Cells.md')
  })
})
