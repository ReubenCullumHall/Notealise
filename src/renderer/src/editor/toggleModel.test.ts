import { describe, expect, it } from 'vitest'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  depthOfLine,
  findToggles,
  guarded,
  hiddenLine,
  isToggleMarkup,
  snapHead,
  toggleMarkdown,
  toggleText,
  unwrapSpec,
  wrappable,
  wrapSpec,
  zones
} from './toggleModel'
import { toggleMarker } from './formatModel'
import { blockRange } from './blockMove'
import { toggleList } from './formatCommands'

function state(doc: string, anchor = 0): EditorState {
  const s = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [markdown({ base: markdownLanguage, extensions: [toggleMarkdown] })]
  })
  // Finish the parse, then hand the finished tree to the state: a cold first
  // run can leave the initial parse short, and the tree a state reports only
  // catches up on its next transaction.
  ensureSyntaxTree(s, s.doc.length, 5000)
  return s.update({}).state
}

const T = (title: string, body: string[], open = true): string => toggleText(title, body, open)

describe('the file format', () => {
  it('writes the <details> form GitHub reads, with the blank lines it needs', () => {
    expect(T('Title', ['a', 'b'])).toBe('<details open><summary>Title</summary>\n\na\nb\n\n</details>')
    expect(T('Shut', [], false)).toBe('<details><summary>Shut</summary>\n\n\n\n</details>')
  })

  it('knows its own markup lines, and nothing else', () => {
    expect(isToggleMarkup('<details open><summary>x</summary>')).toBe(true)
    expect(isToggleMarkup('<details><summary></summary>')).toBe(true)
    expect(isToggleMarkup('</details>')).toBe(true)
    expect(isToggleMarkup('<details>')).toBe(false) // another app's layout: left as HTML
    expect(isToggleMarkup('text </details>')).toBe(false)
  })
})

describe('findToggles', () => {
  it('reads the title, the body lines and the end', () => {
    const s = state('before\n\n' + T('Title', ['one', 'two']) + '\n\nafter')
    const [t] = findToggles(s)
    const doc = s.doc
    expect(doc.sliceString(t.prefixEnd, t.titleEnd)).toBe('Title')
    expect(t.open).toBe(true)
    expect(doc.line(t.body!.first).text).toBe('one')
    expect(doc.line(t.body!.last).text).toBe('two')
    expect(doc.line(t.endLine).text).toBe('</details>')
    expect(t.tailLine).toBe(t.endLine + 1) // the blank line after it is its own
  })

  it('is not fooled by <details> inside a code block', () => {
    const s = state('```\n' + T('x', ['y']) + '\n```')
    expect(findToggles(s)).toEqual([])
  })

  it('ignores a title with no end, and an end with no title', () => {
    expect(findToggles(state('<details open><summary>x</summary>\n\nbody'))).toEqual([])
    expect(findToggles(state('para\n\n</details>'))).toEqual([])
  })

  it('parses the title as Markdown, so bold and colour work in it', () => {
    const s = state(T('a **b** <mark class="hl-amber">c</mark>', ['x']))
    const names: string[] = []
    ensureSyntaxTree(s, s.doc.length)!.iterate({ enter: (n) => void names.push(n.name) })
    expect(names).toContain('ToggleSummary')
    expect(names).toContain('StrongEmphasis')
    expect(names).toContain('HTMLTag')
    expect(names).not.toContain('HTMLBlock')
  })

  it('reads a heading, a list and a table inside as themselves', () => {
    const s = state(T('t', ['## Head', '- item', '', '| a | b |', '| --- | --- |', '| 1 | 2 |']))
    const names: string[] = []
    ensureSyntaxTree(s, s.doc.length)!.iterate({ enter: (n) => void names.push(n.name) })
    expect(names).toEqual(expect.arrayContaining(['ATXHeading2', 'BulletList', 'Table']))
  })

  it('reads a line written straight under </details> as its own paragraph', () => {
    const s = state(T('t', ['x']) + '\n## Next')
    const names: string[] = []
    ensureSyntaxTree(s, s.doc.length)!.iterate({ enter: (n) => void names.push(n.name) })
    expect(names).toContain('ATXHeading2')
  })

  it('nests: depth, parent, and what a shut parent hides', () => {
    const inner = T('inner', ['deep'])
    const s = state(T('outer', [inner], false))
    const [outer, t] = findToggles(s)
    expect(outer.depth).toBe(0)
    expect(t.depth).toBe(1)
    expect(t.parent).toBe(outer)
    expect(t.hidden).toBe(true) // outer is shut
    const deep = s.doc.toString().split('\n').indexOf('deep') + 1
    expect(depthOfLine(findToggles(s), deep)).toBe(2)
    expect(hiddenLine(findToggles(s), deep)).toBe(true)
  })

  it('an inner toggle ending with its parent does not claim the parent\'s blank line', () => {
    const s = state(T('outer', [T('inner', ['x'])]))
    const [outer, inner] = findToggles(s)
    // inner's tail blank IS outer's blank above </details>; outer keeps it
    expect(inner.tailLine).toBe(outer.endLine - 1)
    expect(outer.body!.last).toBe(inner.endLine)
  })
})

describe('where the cursor may rest', () => {
  const doc = 'above\n' + T('Title', ['body']) + '\nbelow'
  const s = state(doc)
  const [t] = findToggles(s)
  const list = zones(s.doc, findToggles(s))
  const bodyFrom = s.doc.line(t.body!.first).from
  const bodyTo = s.doc.line(t.body!.last).to
  const below = s.doc.line(s.doc.lines).from

  it('leaves visible places alone', () => {
    for (const p of [t.prefixEnd, t.titleEnd, bodyFrom, bodyTo, below, 0]) expect(snapHead(list, p, p, false)).toBe(p)
  })
  it('a click past the end of the title lands at its end, not on the next line', () => {
    expect(snapHead(list, t.lineEnd, 0, true)).toBe(t.titleEnd)
  })
  it('Right at the end of the title goes inside; End stays on the title', () => {
    expect(snapHead(list, t.lineEnd, t.titleEnd, false)).toBe(bodyFrom)
    expect(snapHead(list, t.lineEnd, t.prefixEnd, false)).toBe(t.titleEnd)
  })
  it('Left at the start of the title goes up a line; Home and clicks stay on it', () => {
    expect(snapHead(list, t.from, t.prefixEnd, false)).toBe(t.from - 1)
    expect(snapHead(list, t.from, t.titleEnd, false)).toBe(t.prefixEnd)
    expect(snapHead(list, t.from, 0, true)).toBe(t.prefixEnd)
  })
  it('never rests in the hidden lines under the body', () => {
    expect(snapHead(list, bodyTo + 1, bodyTo, false)).toBe(below)
    expect(snapHead(list, below - 1, below, false)).toBe(bodyTo)
  })
  it('a shut toggle last in the note: its hidden end is not somewhere to type', () => {
    const s2 = state(T('x', ['y'], false))
    const [t2] = findToggles(s2)
    expect(snapHead(zones(s2.doc, [t2]), s2.doc.length, t2.titleEnd, false)).toBe(t2.titleEnd)
  })
})

describe('guarded', () => {
  it('covers the hidden stretches, not the words', () => {
    const s = state('x\n' + T('Title', ['body']))
    const [t] = findToggles(s)
    const g = guarded(s.doc, [t], () => false)
    const text = g.map((r) => s.doc.sliceString(r.from, r.to))
    expect(text[0]).toBe('\n<details open><summary>')
    expect(text[1]).toBe('</summary>\n\n')
    expect(text[2]).toBe('\n\n</details>')
  })
  it('lets a toggle an edit covers whole go, markup and all', () => {
    const s = state(T('Title', ['body']))
    expect(guarded(s.doc, findToggles(s), () => true)).toEqual([])
  })
})

describe('edits', () => {
  it('wraps a line, and the lines selected under it go inside', () => {
    const s = state('Title\nkept\nthird')
    const spec = wrapSpec(s, 1, 2, 'Title', 'end')
    const out = s.update(spec).state.doc.toString()
    expect(out).toBe(T('Title', ['kept']) + '\n\nthird') // a hidden blank keeps "third" out of it
  })
  it('refuses to cut an existing toggle in half', () => {
    const s = state('a\n' + T('t', ['x']))
    expect(wrappable(s, 1, 2)).toBe(false)
    expect(wrappable(s, 1, s.doc.lines)).toBe(true)
  })
  it('unwraps back to the words, dropping the empty line kept to type into', () => {
    const s = state(T('Title', ['a', 'b']) + '\n\nafter')
    const [t] = findToggles(s)
    expect(s.update(unwrapSpec(s, t, 2)).state.doc.toString()).toBe('Title\na\nb\nafter')
    const e = state(T('Only', ['']))
    expect(e.update(unwrapSpec(e, findToggles(e)[0])).state.doc.toString()).toBe('Only')
  })
})

describe('the rest of the editor leaves the markup alone', () => {
  it('a list button over a whole toggle marks the words, not the markup', () => {
    const lines = T('t', ['a', 'b']).split('\n')
    expect(toggleMarker(lines, 'bullet')).toEqual([
      '<details open><summary>t</summary>',
      '',
      '- a',
      '- b',
      '',
      '</details>'
    ])
  })
  it('a heading button on a title does nothing rather than break it', () => {
    const lines = ['<details open><summary>t</summary>']
    expect(toggleMarker(lines, 'h1')).toEqual(lines)
  })
  it('the line grip picks up the whole toggle by its title', () => {
    const doc = 'p\n\n' + T('t', ['a', '', 'b']) + '\n\nq'
    const s = state(doc, doc.indexOf('summary>t') + 8)
    const r = blockRange(s)
    expect(s.doc.sliceString(r.from, r.to)).toBe(T('t', ['a', '', 'b']))
  })
  it('a paragraph inside does not glue itself to the title', () => {
    const doc = '<details open><summary>t</summary>\nbody line\n\n</details>'
    const s = state(doc, doc.indexOf('body') + 1)
    const r = blockRange(s)
    expect(s.doc.sliceString(r.from, r.to)).toBe('body line')
  })
})

describe('the Toggle list command', () => {
  function harness(doc: string, from: number, to = from): { view: EditorView; read: () => string } {
    let s = state(doc, from)
    if (to !== from) s = s.update({ selection: { anchor: from, head: to } }).state
    const view = {
      get state() {
        return s
      },
      dispatch: (spec: TransactionSpec) => {
        s = s.update(spec).state
      },
      focus: () => {}
    }
    const read = (): string => {
      const h = s.selection.main.head
      return s.doc.toString().slice(0, h) + '|' + s.doc.toString().slice(h)
    }
    return { view: view as unknown as EditorView, read }
  }

  it('makes an empty toggle on an empty line with the cursor in its title', () => {
    const { view, read } = harness('', 0)
    toggleList(view, 'set')
    expect(read()).toBe('<details open><summary>|</summary>\n\n\n\n</details>')
  })
  it('keeps a line\'s words as the title, without its bullet', () => {
    const { view, read } = harness('- groceries', 4)
    toggleList(view, 'set')
    expect(read()).toBe('<details open><summary>groceries|</summary>\n\n\n\n</details>')
  })
  it('the button on a title takes the toggle away again; "/" leaves it', () => {
    const doc = T('Title', ['x'])
    const at = doc.indexOf('Title') + 2
    const a = harness(doc, at)
    toggleList(a.view, 'set')
    expect(a.read().replace('|', '')).toBe(doc)
    const b = harness(doc, at)
    toggleList(b.view, 'toggle')
    expect(b.read()).toBe('Ti|tle\nx')
  })
})
