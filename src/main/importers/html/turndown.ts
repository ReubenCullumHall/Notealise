import TurndownService from 'turndown'

// turndown's core doesn't include GFM tables/strikethrough (that's a separate
// `turndown-plugin-gfm` package) — small custom rules here instead of adding
// a second dependency for two rules' worth of behaviour.
export function createConverter(opts: { dropHeaderChrome?: boolean } = {}): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

  // turndown does NOT strip <head>/<style>/<script> by default — fed a full
  // HTML document (as opposed to a fragment), the print stylesheet Notion's
  // export embeds leaks straight into the markdown as literal text. Confirmed
  // against a real export (2026-08-04): a page's raw .html carried ~700
  // characters of CSS ahead of any real content.
  td.remove(['script', 'style', 'head', 'title'])
  // Notion's own page chrome (<header><h1 class="page-title">…) restates the
  // title we already take from the filename — dropped so it isn't duplicated
  // as the note's first line. Not wanted for arbitrary HTML files, where a
  // <header> may be real content, so it's opt-in.
  if (opts.dropHeaderChrome) td.remove('header')

  // Markdown has no syntax for these, and this app's own convention is inline
  // HTML (rule 4) — `<u>` is exactly what its underline command writes. Without
  // `keep`, turndown unwraps them and the formatting is silently lost.
  // `<mark>` is how a Word highlight arrives; `<sup>`/`<sub>` matter for the
  // "1 m²"/"H₂O" that a science document is full of.
  td.keep(['u', 'mark', 'sup', 'sub'])

  td.addRule('strikethrough', {
    filter: (node) => ['del', 's', 'strike'].includes(node.nodeName.toLowerCase()),
    replacement: (content) => `~~${content}~~`
  })

  // Loosely typed on purpose: the node here is domino's DOM implementation
  // (turndown's Node.js fallback parser, see @mixmark-io/domino), not
  // lib.dom.d.ts's browser types — main's tsconfig has no DOM lib, and
  // shouldn't gain one just for this one rule.
  interface CellLike {
    textContent: string | null
  }
  interface RowLike {
    cells: CellLike[]
  }
  interface TableLike {
    rows: RowLike[]
  }
  td.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      const table = node as unknown as TableLike
      const rows = Array.from(table.rows)
      if (rows.length === 0) return ''
      const cellText = (cell: CellLike): string => (cell.textContent ?? '').trim().replace(/\|/g, '\\|')
      const rowLine = (row: RowLike): string => `| ${Array.from(row.cells).map(cellText).join(' | ')} |`
      const header = rowLine(rows[0])
      const divider = `| ${Array.from(rows[0].cells).map(() => '---').join(' | ')} |`
      const body = rows.slice(1).map(rowLine)
      return `\n\n${[header, divider, ...body].join('\n')}\n\n`
    }
  })

  // turndown escapes every `[` and `]` so prose can't be mistaken for a link.
  // In imported documents that mostly hits citation markers, which then read as
  // "\\[1\\]" on the page — visible backslashes in every reference list. A bare
  // `[1]` is only a link if a `(` or a `[` follows it, so unescaping the pair
  // is safe for prose while leaving turndown's other escaping (`*`, `_`, `#`,
  // backticks) exactly as it was.
  const escape = td.escape.bind(td)
  td.escape = (text: string): string => escape(text).replace(/\\([[\]])/g, '$1')

  return td
}
