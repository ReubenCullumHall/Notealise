import { describe, expect, it } from 'vitest'
import {
  backlinksFor,
  indexLinks,
  resolveLink,
  rewriteLinks,
  scanLinks,
  titleOf,
  toContext,
  type LinkRow,
  type NoteRef,
  type WikiLink
} from './links'

// A small vault used by most of the resolver tests. Two notes deliberately share
// the title "Waves" so the disambiguation rules have something to disambiguate.
const note = (path: string): NoteRef => ({ path, title: titleOf(path), kind: 'note' })
const folder = (path: string): NoteRef => ({ path, title: path.slice(path.lastIndexOf('/') + 1), kind: 'dir' })

const VAULT: NoteRef[] = [
  note('Physics/Term 3/Waves.md'),
  note('Physics/Optics.md'),
  note('Maths/Waves.md'),
  note('Inbox.md'),
  folder('Physics'),
  folder('Physics/Term 3'),
  folder('Maths')
]

const one = (text: string): WikiLink => {
  const links = scanLinks(text)
  expect(links).toHaveLength(1)
  return links[0]
}

describe('scanLinks', () => {
  it('reads the four forms', () => {
    expect(one('[[Waves]]')).toMatchObject({ target: 'Waves', heading: null, alias: null, text: 'Waves' })
    expect(one('[[Physics/Waves]]')).toMatchObject({ target: 'Physics/Waves', text: 'Waves' })
    expect(one('[[Waves|the waves chapter]]')).toMatchObject({
      target: 'Waves',
      alias: 'the waves chapter',
      text: 'the waves chapter'
    })
    expect(one('[[Waves#Interference]]')).toMatchObject({
      target: 'Waves',
      heading: 'Interference',
      text: 'Waves › Interference'
    })
  })

  it('reads a same-note jump', () => {
    expect(one('[[#Interference]]')).toMatchObject({ target: '', heading: 'Interference', text: '#Interference' })
  })

  it('reports offsets covering both bracket pairs', () => {
    const l = one('see [[Waves]] today')
    expect([l.from, l.to]).toEqual([4, 13])
    expect('see [[Waves]] today'.slice(l.from, l.to)).toBe('[[Waves]]')
  })

  it('takes the alias off before the heading, so prose may contain a #', () => {
    // "#" after the bar is display text, not a heading — otherwise you could
    // never write a link labelled "chapter #3".
    expect(one('[[Waves#Top|chapter #3]]')).toMatchObject({
      target: 'Waves',
      heading: 'Top',
      alias: 'chapter #3'
    })
  })

  it('keeps every bar after the first in the alias', () => {
    // A display string is prose; prose is allowed a "|". Splitting on the last
    // bar instead would silently truncate a table-ish label.
    expect(one('[[Waves|a | b]]')).toMatchObject({ target: 'Waves', alias: 'a | b' })
  })

  it('trims the parts', () => {
    expect(one('[[  Waves  #  Top  |  see here  ]]')).toMatchObject({
      target: 'Waves',
      heading: 'Top',
      alias: 'see here'
    })
  })

  it('finds several links on one line, in order', () => {
    expect(scanLinks('[[A]] and [[B]] and [[C]]').map((l) => l.target)).toEqual(['A', 'B', 'C'])
  })

  // The "nothing happens" cases below are all the same user: someone part-way
  // through typing a link. Rendering a half-written link as a widget would make
  // it jump under the cursor, and swallowing the rest of the note looking for a
  // close bracket would blank the page — so declining is the visible behaviour
  // we want, not merely what the code does.
  it('ignores an unclosed link rather than running to the end of the note', () => {
    expect(scanLinks('[[Waves')).toEqual([])
    expect(scanLinks('[[Waves\nnext line]]')).toEqual([])
  })

  it('ignores a link with nothing to point at', () => {
    for (const text of ['[[]]', '[[|x]]', '[[  ]]', '[[#]]']) expect(scanLinks(text)).toEqual([])
  })

  it('stops at a fresh [[ instead of pairing across two half-typed links', () => {
    // Typing a second link before finishing the first must not produce one link
    // spanning both — the widget would cover text the user is still editing.
    expect(scanLinks('[[A [[B]]').map((l) => l.target)).toEqual(['B'])
  })

  it('does not treat single brackets as a link', () => {
    expect(scanLinks('[Waves](url) and [x] and ]]Waves[[')).toEqual([])
  })

  // Found in the live app, 2026-08-02: the editor refused to render `[[Waves]]`
  // inside code (it has the syntax tree) while the index and the links block
  // both counted it (they don't). A backlink appeared from a note that had
  // pointedly not made one.
  it('ignores a link inside inline code — that is writing ABOUT a link', () => {
    expect(scanLinks('use `[[Waves]]` to link')).toEqual([])
    expect(scanLinks('``[[a]]`` and ``code`` then [[Real]]').map((l) => l.target)).toEqual(['Real'])
  })

  it('steps over a stray backtick instead of swallowing the rest of the line', () => {
    expect(scanLinks('a ` b [[Waves]]').map((l) => l.target)).toEqual(['Waves'])
  })

  it('ignores an escaped bracket', () => {
    expect(scanLinks('\\[[Waves]]')).toEqual([])
  })

  it('shifts offsets by base', () => {
    expect(scanLinks('[[A]]', 100)[0]).toMatchObject({ from: 100, to: 105 })
  })

  it('is idempotent over its own slice', () => {
    const text = 'a [[X|y]] b [[Z#h]] c'
    for (const l of scanLinks(text)) {
      expect(scanLinks(text.slice(l.from, l.to))).toHaveLength(1)
    }
  })
})

describe('resolveLink', () => {
  it('finds a note by title, case-insensitively', () => {
    // Both platforms ship case-insensitive filesystems, so [[optics]] opening
    // Optics.md is what a user expects the file to do.
    expect(resolveLink(one('[[optics]]'), VAULT, 'Inbox.md')).toEqual({
      kind: 'note',
      path: 'Physics/Optics.md',
      isDir: false,
      heading: null,
      ambiguous: false
    })
  })

  it('prefers the note in the same folder when titles collide', () => {
    expect(resolveLink(one('[[Waves]]'), VAULT, 'Maths/Algebra.md')).toMatchObject({
      path: 'Maths/Waves.md',
      ambiguous: true
    })
  })

  it('falls back to the nearest note by shared path when neither is a sibling', () => {
    expect(resolveLink(one('[[Waves]]'), VAULT, 'Physics/Term 1/Revision.md')).toMatchObject({
      path: 'Physics/Term 3/Waves.md',
      ambiguous: true
    })
  })

  it('tie-breaks alphabetically so the answer never depends on tree order', () => {
    // The index is built from a directory walk and the editor from the sidebar
    // tree; without a total order the same link could resolve differently in the
    // two, and a backlink would appear on the wrong note.
    const shuffled = [...VAULT].reverse()
    const a = resolveLink(one('[[Waves]]'), VAULT, 'Inbox.md')
    const b = resolveLink(one('[[Waves]]'), shuffled, 'Inbox.md')
    expect(a).toEqual(b)
    expect(a).toMatchObject({ path: 'Maths/Waves.md' })
  })

  it('marks a single match unambiguous', () => {
    expect(resolveLink(one('[[Inbox]]'), VAULT, 'Physics/Optics.md')).toMatchObject({ ambiguous: false })
  })

  it('honours an explicit path exactly, never falling back to the title', () => {
    // [[Maths/Waves]] is a promise about where the note is. Falling back to a
    // title match would quietly open the physics one instead — the precise form
    // would be less precise than the loose one.
    expect(resolveLink(one('[[Maths/Waves]]'), VAULT, 'Inbox.md')).toMatchObject({ path: 'Maths/Waves.md' })
    expect(resolveLink(one('[[Chemistry/Waves]]'), VAULT, 'Inbox.md')).toEqual({
      kind: 'missing',
      suggestedPath: 'Chemistry/Waves.md'
    })
  })

  it('accepts a target written with the extension', () => {
    expect(resolveLink(one('[[Maths/Waves.md]]'), VAULT, 'Inbox.md')).toMatchObject({ path: 'Maths/Waves.md' })
  })

  it('carries the heading through', () => {
    expect(resolveLink(one('[[Optics#Lenses]]'), VAULT, 'Inbox.md')).toMatchObject({ heading: 'Lenses' })
  })

  it('suggests a missing note beside the note that mentioned it', () => {
    expect(resolveLink(one('[[Diffraction]]'), VAULT, 'Physics/Term 3/Waves.md')).toEqual({
      kind: 'missing',
      suggestedPath: 'Physics/Term 3/Diffraction.md'
    })
    expect(resolveLink(one('[[Diffraction]]'), VAULT, 'Inbox.md')).toEqual({
      kind: 'missing',
      suggestedPath: 'Diffraction.md'
    })
  })

  it('reads a bare heading as a jump within the note it is written in', () => {
    expect(resolveLink(one('[[#Lenses]]'), VAULT, 'Physics/Optics.md')).toEqual({ kind: 'self', heading: 'Lenses' })
  })

  it('finds a folder, which is a thing worth linking to', () => {
    // A vault divided into folders and unable to reference one of them is a
    // filing system you can't talk about.
    expect(resolveLink(one('[[Term 3]]'), VAULT, 'Inbox.md')).toMatchObject({
      path: 'Physics/Term 3',
      isDir: true
    })
    expect(resolveLink(one('[[Physics/Term 3]]'), VAULT, 'Inbox.md')).toMatchObject({
      path: 'Physics/Term 3',
      isDir: true
    })
  })

  it('prefers a note over a folder of the same name', () => {
    // The folder is where you keep things; the note is the thing you wrote, and
    // it is nearly always what you meant. The folder is still reachable by path.
    const both = [...VAULT, folder('Archive/Optics')]
    expect(resolveLink(one('[[Optics]]'), both, 'Inbox.md')).toMatchObject({
      path: 'Physics/Optics.md',
      isDir: false
    })
    expect(resolveLink(one('[[Archive/Optics]]'), both, 'Inbox.md')).toMatchObject({ isDir: true })
  })

  it('resolves against an empty vault without throwing', () => {
    expect(resolveLink(one('[[Waves]]'), [], 'Inbox.md')).toEqual({ kind: 'missing', suggestedPath: 'Waves.md' })
  })
})

describe('indexLinks', () => {
  const DOC = ['# Waves', '', 'revise [[Waves]] before the mock', 'and see [[Optics|the lenses bit]]'].join('\n')

  it('records the 1-based line and the whole line as context', () => {
    expect(indexLinks(DOC)).toEqual([
      { target: 'Waves', heading: null, alias: null, line: 3, context: 'revise [[Waves]] before the mock' },
      { target: 'Optics', heading: null, alias: 'the lenses bit', line: 4, context: 'and see [[Optics|the lenses bit]]' }
    ])
  })

  it('handles CRLF without leaving a stray return in the context', () => {
    // Notes written on Windows arrive with \r\n; the context string is shown to
    // a human, so a trailing \r would render as a gap at the end of the row.
    expect(indexLinks('a [[X]]\r\nb [[Y]]\r\n').map((l) => l.context)).toEqual(['a [[X]]', 'b [[Y]]'])
  })

  it('returns nothing for a note with no links', () => {
    expect(indexLinks('# Just a heading\n\nsome prose')).toEqual([])
  })

  // A fence spans lines, so it cannot be judged one line at a time — which is
  // why `eachLinkLine` exists and why both the index and the links block go
  // through it rather than each splitting the text themselves.
  it('skips a fenced code block entirely', () => {
    const doc = ['[[Before]]', '```md', '[[Inside]]', '```', '[[After]]'].join('\n')
    expect(indexLinks(doc).map((l) => l.target)).toEqual(['Before', 'After'])
  })

  it('closes a fence only on its own character', () => {
    // ``` opened, ~~~ does not close it — otherwise a note that documents both
    // fence styles would leak the links between them.
    const doc = ['```', '[[Inside]]', '~~~', '[[StillInside]]', '```', '[[Out]]'].join('\n')
    expect(indexLinks(doc).map((l) => l.target)).toEqual(['Out'])
  })

  it('treats an unclosed fence as running to the end, as a Markdown renderer does', () => {
    expect(indexLinks('[[A]]\n```\n[[B]]')).toEqual([
      { target: 'A', heading: null, alias: null, line: 1, context: '[[A]]' }
    ])
  })
})

describe('toContext', () => {
  it('trims and clips long lines', () => {
    expect(toContext('   spaced   ')).toBe('spaced')
    const long = 'x'.repeat(400)
    expect(toContext(long)).toHaveLength(160)
    expect(toContext(long).endsWith('…')).toBe(true)
  })
})

describe('backlinksFor', () => {
  const INDEX: LinkRow[] = [
    {
      path: 'Physics/Term 3/Plan.md',
      links: [{ target: 'Waves', heading: null, alias: null, line: 4, context: 'revise [[Waves]] this week' }]
    },
    {
      path: 'Maths/Algebra.md',
      links: [{ target: 'Waves', heading: null, alias: null, line: 2, context: 'not the physics [[Waves]]' }]
    },
    {
      path: 'Inbox.md',
      links: [
        { target: 'Physics/Term 3/Waves', heading: null, alias: null, line: 9, context: 'see [[Physics/Term 3/Waves]]' },
        { target: 'Physics/Term 3/Waves', heading: 'Interference', alias: null, line: 1, context: 'top [[…#Interference]]' }
      ]
    }
  ]

  it('resolves from the linking note, not the linked one', () => {
    // Algebra.md's [[Waves]] resolves to Maths/Waves.md because Algebra sits in
    // Maths — so it is NOT a backlink of the physics note, even though the title
    // matches. Matching on title alone is the obvious shortcut and it is wrong.
    const b = backlinksFor('Physics/Term 3/Waves.md', INDEX, VAULT)
    expect(b.map((x) => x.path)).toEqual(['Inbox.md', 'Inbox.md', 'Physics/Term 3/Plan.md'])
    expect(backlinksFor('Maths/Waves.md', INDEX, VAULT).map((x) => x.path)).toEqual(['Maths/Algebra.md'])
  })

  it('carries the line and its context', () => {
    expect(backlinksFor('Physics/Term 3/Waves.md', INDEX, VAULT)[2]).toEqual({
      path: 'Physics/Term 3/Plan.md',
      title: 'Plan',
      line: 4,
      context: 'revise [[Waves]] this week'
    })
  })

  it('sorts by note then line, so the block does not reshuffle on every rebuild', () => {
    const inbox = backlinksFor('Physics/Term 3/Waves.md', INDEX, VAULT).filter((b) => b.path === 'Inbox.md')
    expect(inbox.map((b) => b.line)).toEqual([1, 9])
  })

  it('never lists a note as its own backlink', () => {
    // A note that references itself is a note organising itself, not a
    // connection to somewhere else — listing it would be noise on every hub note.
    const self: LinkRow[] = [
      { path: 'Inbox.md', links: [{ target: 'Inbox', heading: null, alias: null, line: 1, context: '[[Inbox]]' }] }
    ]
    expect(backlinksFor('Inbox.md', self, VAULT)).toEqual([])
  })

  it('ignores index rows whose links resolve nowhere', () => {
    const dangling: LinkRow[] = [
      { path: 'Inbox.md', links: [{ target: 'Nope', heading: null, alias: null, line: 1, context: '[[Nope]]' }] }
    ]
    expect(backlinksFor('Physics/Optics.md', dangling, VAULT)).toEqual([])
  })
})

describe('rewriteLinks', () => {
  it('follows a renamed note, keeping the form the user wrote', () => {
    const text = 'see [[Optics]] and [[Physics/Optics]] and [[Optics|the lenses bit]] and [[Optics#Lenses]]'
    expect(rewriteLinks(text, 'Inbox.md', 'Physics/Optics.md', 'Physics/Lenses.md', VAULT)).toBe(
      'see [[Lenses]] and [[Physics/Lenses]] and [[Lenses|the lenses bit]] and [[Lenses#Lenses]]'
    )
  })

  it('leaves links to other notes alone', () => {
    // Only links that actually RESOLVE to the renamed note are touched. A text
    // replace would rewrite "Waves" inside [[Waves in water]] and inside prose
    // that merely looks like a link.
    const text = 'see [[Waves in water]] and [[Inbox]] and the word Optics on its own'
    expect(rewriteLinks(text, 'Inbox.md', 'Physics/Optics.md', 'Physics/Lenses.md', VAULT)).toBeNull()
  })

  it('rewrites only the nearest match when titles collide', () => {
    const text = 'physics [[Waves]]'
    // Written in Maths/, [[Waves]] means Maths/Waves.md — renaming the physics
    // one must not touch it.
    expect(rewriteLinks(text, 'Maths/Notes.md', 'Physics/Term 3/Waves.md', 'Physics/Term 3/Ripples.md', VAULT)).toBeNull()
    expect(rewriteLinks(text, 'Maths/Notes.md', 'Maths/Waves.md', 'Maths/Ripples.md', VAULT)).toBe('physics [[Ripples]]')
  })

  it('returns null rather than an identical string, so a caller can skip the write', () => {
    expect(rewriteLinks('no links here', 'Inbox.md', 'a.md', 'b.md', VAULT)).toBeNull()
  })

  it('rewrites several links in one pass without corrupting offsets', () => {
    const text = '[[Inbox]] x [[Inbox]] y [[Inbox|home]]'
    expect(rewriteLinks(text, 'Physics/Optics.md', 'Inbox.md', 'Archive/Old inbox.md', VAULT)).toBe(
      '[[Old inbox]] x [[Old inbox]] y [[Old inbox|home]]'
    )
  })
})

describe('titleOf', () => {
  it('drops the folder and the extension', () => {
    expect(titleOf('Physics/Term 3/Waves.md')).toBe('Waves')
    expect(titleOf('Waves.MD')).toBe('Waves')
    expect(titleOf('Waves')).toBe('Waves')
  })
})
