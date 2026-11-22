// Mermaid charts in a note: finding them, naming them, and writing one back.
//
// A chart is a standard fenced code block (```mermaid), so the file opens as a chart
// on GitHub, in Obsidian and in VS Code (CLAUDE.md rule 4). Nothing is added to the
// note to mark it, and this app never rewrites a chart it is only showing.
//
// Plain text only, with no imports: main reads this through plainText.ts, and
// blocks.ts imports plainText, so importing back would make a loop. The rules below
// follow CommonMark's: a fence closes on the same character, at least as long, with
// nothing after it. An unclosed fence is not a chart. It stays visible as code, so a
// half-typed block never hides the rest of the note.

export interface ChartBlock {
  /** Start of the opening fence's line. */
  from: number
  /** End of the closing fence's line (not including its line break). */
  to: number
  /** Start of the line after the opening fence. */
  bodyFrom: number
  /** Start of the closing fence's line. */
  closeFrom: number
  /** The chart's text, with `\n` line breaks and no line break at the end. */
  source: string
  /** The opening run of backticks or tildes. */
  fence: string
  /** The line break this block is written with. */
  eol: '\n' | '\r\n'
}

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const MATHS = /^\s*\$\$\s*$/

function frontmatterStop(text: string): number {
  const first = /^---[ \t]*\r?\n/.exec(text)
  if (!first) return 0
  const close = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m
  const rest = text.slice(first[0].length)
  const m = close.exec(rest)
  return m ? first[0].length + m.index + m[0].length : 0
}

interface Scan {
  charts: ChartBlock[]
  /** Where a chart that never closes begins, if the text ends inside one. */
  openChartAt: number | null
}

function scan(text: string): Scan {
  const charts: ChartBlock[] = []
  // Almost no note has a chart, and this runs as you type.
  if (text.indexOf('mermaid') === -1) return { charts, openChartAt: null }

  let open: { mark: string; from: number; bodyFrom: number; chart: boolean } | null = null
  let inMaths = false
  let pos = frontmatterStop(text)
  while (pos <= text.length) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl
    const end = lineEnd > pos && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd
    const line = text.slice(pos, end)
    const f = line.includes('```') || line.includes('~~~') ? FENCE.exec(line) : null

    if (open) {
      if (f && f[1][0] === open.mark[0] && f[1].length >= open.mark.length && !f[2].trim()) {
        if (open.chart) {
          const hasBody = pos > open.bodyFrom
          let bodyEnd = hasBody ? pos - 1 : pos
          if (hasBody && text[bodyEnd - 1] === '\r') bodyEnd--
          charts.push({
            from: open.from,
            to: end,
            bodyFrom: open.bodyFrom,
            closeFrom: pos,
            source: text.slice(open.bodyFrom, Math.max(open.bodyFrom, bodyEnd)).replace(/\r\n/g, '\n'),
            fence: open.mark,
            eol: text[open.bodyFrom - 2] === '\r' ? '\r\n' : '\n'
          })
        }
        open = null
      }
    } else if (inMaths) {
      if (MATHS.test(line)) inMaths = false
    } else if (MATHS.test(line)) {
      inMaths = true
    } else if (f && !(f[1][0] === '`' && f[2].includes('`'))) {
      open = {
        mark: f[1],
        from: pos,
        bodyFrom: lineEnd + 1,
        // At the line's start only: an indented block belongs to a list item and stays code.
        chart: line.startsWith(f[1]) && f[2].trim() === 'mermaid'
      }
    }
    if (nl === -1) break
    pos = nl + 1
  }
  return { charts, openChartAt: open?.chart ? open.from : null }
}

/** Every chart in a note, top to bottom. */
export function findCharts(text: string): ChartBlock[] {
  return scan(text).charts
}

/** The note's text with its charts taken out, for the word count and the sidebar's line.
 *  `cutOff`: the text is only the start of a file, so a chart still open at the end is a
 *  chart whose closing fence was cut off, and goes too. */
export function withoutCharts(text: string, cutOff = false): string {
  const { charts, openChartAt } = scan(text)
  if (!charts.length && openChartAt === null) return text
  let out = ''
  let at = 0
  for (const c of charts) {
    out += text.slice(at, c.from)
    at = c.to
  }
  const stop = cutOff && openChartAt !== null ? openChartAt : text.length
  return out + text.slice(at, stop)
}

/** The chart's text after its own settings block and comments, from its first real word. */
function firstWord(source: string): string {
  const body = source.replace(/^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '')
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    return line.split(/[\s:;{]/, 1)[0].toLowerCase()
  }
  return ''
}

/** Only flow charts can be walked through. Every other chart type is for looking at. */
export function isFlowChart(source: string): boolean {
  const word = firstWord(source)
  return word === 'flowchart' || word === 'graph' || word === 'flowchart-elk'
}

/** The chart's own title, if it has one. */
export function chartTitle(source: string): string | null {
  const clean = (t: string): string => t.trim().replace(/^(["'])(.*)\1$/, '$2').trim().slice(0, 80)
  const fm = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(source)
  if (fm) {
    const t = /^title:[ \t]*(.+)$/m.exec(fm[1])
    if (t && clean(t[1])) return clean(t[1])
  }
  // `title Plan` on its own line, or `pie title Plan`. A flow chart has no such line,
  // and a box could be called "title".
  if (isFlowChart(source)) return null
  const body = fm ? source.slice(fm[0].length) : source
  const line = /^[ \t]*(?:pie[ \t]+)?title[ \t]+(.+)$/m.exec(body)
  return line && clean(line[1]) ? clean(line[1]) : null
}

/** What each chart in a note is called: its own title, else "Biology chart", "Biology chart 2". */
export function chartNames(charts: readonly Pick<ChartBlock, 'source'>[], noteTitle: string): string[] {
  let untitled = 0
  return charts.map((c) => {
    const own = chartTitle(c.source)
    if (own) return own
    untitled++
    return untitled === 1 ? `${noteTitle} chart` : `${noteTitle} chart ${untitled}`
  })
}

export interface ChartEdit {
  from: number
  to: number
  insert: string
}

/** The smallest change that makes this block hold `nextSource`. The fence grows if the new
 *  text contains a line that would otherwise close it, so a chart can't break its note. */
export function chartEdit(block: ChartBlock, nextSource: string): ChartEdit {
  const next = nextSource.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const eol = block.eol
  const body = next ? next.split('\n').join(eol) + eol : ''
  const mark = block.fence[0]
  let longest = 0
  for (const line of next.split('\n')) {
    const f = FENCE.exec(line)
    if (f && f[1][0] === mark && !f[2].trim()) longest = Math.max(longest, f[1].length)
  }
  if (longest < block.fence.length) return { from: block.bodyFrom, to: block.closeFrom, insert: body }
  const fence = mark.repeat(longest + 1)
  return { from: block.from, to: block.to, insert: `${fence}mermaid${eol}${body}${fence}` }
}

/** The nearest line start at or before `at` that is outside every code block and formula. An
 *  unclosed block runs to the end of the note, so nothing from its first line on is safe. */
function safeLineStart(text: string, at: number): number {
  const start = frontmatterStop(text)
  let safe = start
  let open: { fence: string | null; at: number } | null = null
  let pos = start
  while (pos <= text.length) {
    if (!open && pos <= at) safe = pos
    const nl = text.indexOf('\n', pos)
    const line = text.slice(pos, nl === -1 ? text.length : nl).replace(/\r$/, '')
    const f = FENCE.exec(line)
    if (open) {
      const closes =
        open.fence === null
          ? MATHS.test(line)
          : !!f && f[1][0] === open.fence[0] && f[1].length >= open.fence.length && !f[2].trim()
      if (closes) open = null
    } else if (MATHS.test(line)) open = { fence: null, at: pos }
    else if (f) open = { fence: f[1], at: pos }
    if (nl === -1) break
    pos = nl + 1
  }
  if (open && at >= open.at) return open.at
  return at >= text.length && !open ? text.length : Math.max(start, safe)
}

/** Put a chart back into a note it was deleted from, as near to `at` as a block can go. */
export function insertChartEdit(text: string, at: number, source: string): ChartEdit {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const next = source.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  let longest = 2
  for (const line of next.split('\n')) {
    const f = FENCE.exec(line)
    if (f && f[1][0] === '`' && !f[2].trim()) longest = Math.max(longest, f[1].length)
  }
  const fence = '`'.repeat(longest + 1)
  const body = next ? next.split('\n').join(eol) + eol : ''
  const block = `${fence}mermaid${eol}${body}${fence}`
  const p = safeLineStart(text, Math.max(0, Math.min(at, text.length)))
  const before = text.slice(0, p)
  const after = text.slice(p)
  const lead = !before || /\r?\n\r?\n$/.test(before) ? '' : before.endsWith('\n') ? eol : eol + eol
  const trail = !after ? '' : /^\r?\n/.test(after) ? eol : eol + eol
  return { from: p, to: p, insert: lead + block + trail }
}

/** What a chart's tab remembers about the block it shows. */
export interface ChartAnchor {
  index: number
  source: string
}

/** Find the tab's block again after the note changed. Its exact text wins (the nearest copy,
 *  when a note holds two the same), so a block dragged elsewhere is followed. If that text has
 *  gone but the note has as many charts as before, the block at the same place was edited.
 *  Otherwise it was removed. */
export function locateChart(charts: readonly ChartBlock[], anchor: ChartAnchor, expectedCount?: number): number | null {
  let best: number | null = null
  charts.forEach((c, i) => {
    if (c.source !== anchor.source) return
    if (best === null || Math.abs(i - anchor.index) < Math.abs(best - anchor.index)) best = i
  })
  if (best !== null) return best
  if (expectedCount !== undefined && charts.length === expectedCount && anchor.index < charts.length) return anchor.index
  return null
}

// --- a chart's tab ------------------------------------------------------------------
//
// A tab is its path, and renames, moves, the bin and closing a folder all act on a path and
// everything under it. So a chart's tab is written as if it lived inside its note. `:` can't
// be in a saved file name here (shared/filenames.ts), so this never collides with a real file.

const CHART_TAB = '/::chart/'

export const chartTabId = (notePath: string, key: string): string => notePath + CHART_TAB + key
export const isChartTab = (path: string): boolean => path.includes(CHART_TAB)
export const chartTabNote = (path: string): string => {
  const at = path.indexOf(CHART_TAB)
  return at === -1 ? path : path.slice(0, at)
}
export const chartTabKey = (path: string): string => {
  const at = path.indexOf(CHART_TAB)
  return at === -1 ? '' : path.slice(at + CHART_TAB.length)
}
