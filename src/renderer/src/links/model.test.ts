import { describe, expect, it } from 'vitest'
import type { TreeNode } from '../../../shared/types'
import type { LinkRow, NoteRef } from '../../../shared/links'
import { ancestorsOf, crumbsFor, incomingLinks, indexFingerprint, linkChoices, liveIndex, noteRefs, outgoingLinks, type SpaceMark } from './model'

const dir = (path: string, children: TreeNode[]): TreeNode => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  type: 'dir',
  children
})
const file = (path: string): TreeNode => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  type: 'file'
})

const TREE: TreeNode[] = [
  dir('Physics', [dir('Physics/Term 3', [file('Physics/Term 3/Waves.md')]), file('Physics/Optics.md')]),
  dir('Maths', [file('Maths/Algebra.md')]),
  file('Inbox.md')
]

const SPACES: SpaceMark[] = [
  { folder: 'Physics', emoji: '📚' },
  { folder: 'Maths', emoji: '🔢' }
]

const NOTES = noteRefs(TREE)

describe('noteRefs', () => {
  it('walks the whole vault, not one space', () => {
    // A [[link]] may point anywhere — that is the entire reason the cross-space
    // emoji exists. Scoping this to the active space would make every link out
    // of it read as unwritten.
    // Folders are in the list too — `[[Term 3]]` is a perfectly good link, and a
    // vault you can't reference a folder in is a filing system you can't talk
    // about.
    expect(NOTES.map((n) => n.kind + ' ' + n.path)).toEqual([
      'dir Physics',
      'dir Physics/Term 3',
      'note Physics/Term 3/Waves.md',
      'note Physics/Optics.md',
      'dir Maths',
      'note Maths/Algebra.md',
      'note Inbox.md'
    ])
    expect(NOTES.find((n) => n.path === 'Inbox.md')?.title).toBe('Inbox')
  })

  it('handles an empty vault', () => {
    expect(noteRefs([])).toEqual([])
  })
})

describe('liveIndex', () => {
  const DISK: LinkRow[] = [
    { path: 'Inbox.md', links: [{ target: 'Optics', heading: null, alias: null, line: 1, context: 'old [[Optics]]' }] },
    { path: 'Maths/Algebra.md', links: [] }
  ]

  it('replaces a note main scanned with the buffer the user is typing in', () => {
    // Main's index is disk state and is deliberately not rescanned per keystroke.
    // Without this overlay a link you just typed would not show as a backlink in
    // the other column until the 400ms autosave landed.
    const rows = liveIndex(DISK, new Map([['Inbox.md', 'now [[Waves]]']]))
    expect(rows.find((r) => r.path === 'Inbox.md')?.links.map((l) => l.target)).toEqual(['Waves'])
    expect(rows).toHaveLength(2)
  })

  it('leaves notes that are not open exactly as main reported them', () => {
    expect(liveIndex(DISK, new Map()).map((r) => r.path)).toEqual(['Inbox.md', 'Maths/Algebra.md'])
  })

  it('adds a note that is open but was never on disk', () => {
    const rows = liveIndex(DISK, new Map([['New.md', '[[Waves]]']]))
    expect(rows.map((r) => r.path)).toContain('New.md')
  })

  it('ignores the blank column, which has no note behind it', () => {
    expect(liveIndex(DISK, new Map([['', 'nothing']])).map((r) => r.path)).toEqual([
      'Inbox.md',
      'Maths/Algebra.md'
    ])
  })
})

describe('linkChoices', () => {
  const from = 'Physics/Optics.md' // writing in the Physics space

  it('offers your own space, and nothing from the others', () => {
    // A vault divided into spaces is divided for a reason. A picker listing
    // every note in every space undoes that the moment you go to link something.
    const out = linkChoices(NOTES, SPACES, from, '')
    expect(out.map((c) => c.ref.path)).toEqual([
      'Physics/Term 3/Waves.md',
      'Physics/Term 3'
    ])
  })

  it('reaches another space when you name it, which is the way out', () => {
    const out = linkChoices(NOTES, SPACES, from, 'Maths')
    expect(out.map((c) => c.ref.path)).toEqual(['Maths/Algebra.md'])
  })

  it('narrows within a named space once you keep typing', () => {
    expect(linkChoices(NOTES, SPACES, from, 'Maths/Alg').map((c) => c.ref.title)).toEqual(['Algebra'])
    expect(linkChoices(NOTES, SPACES, from, 'Maths Alg').map((c) => c.ref.title)).toEqual(['Algebra'])
    expect(linkChoices(NOTES, SPACES, from, 'Maths/Nope')).toEqual([])
  })

  it('inserts a bare title at home and a full path across spaces', () => {
    // A title is enough where the resolver will look; reaching into another
    // space needs the path, or the link would resolve back to something local.
    expect(linkChoices(NOTES, SPACES, from, 'Wav')[0].insert).toBe('Waves')
    expect(linkChoices(NOTES, SPACES, from, 'Maths')[0].insert).toBe('Maths/Algebra')
  })

  it('says where something is, relative to its space — not its raw parent folder', () => {
    // The raw parent used to be shown, which on a vault whose space is called
    // "New folder" read as an offer to create one. Blank at the space's root.
    expect(linkChoices(NOTES, SPACES, from, 'Wav')[0].where).toBe('Term 3')
    expect(linkChoices(NOTES, SPACES, 'Physics/Term 3/Waves.md', 'Optics')[0].where).toBe('')
  })

  it('names the space on every row, with its emoji, for the picker’s right column', () => {
    // The picker shows one space at a time, so this looks redundant — until you
    // type another space's name, when it is the only thing telling you the list
    // has moved.
    const home = linkChoices(NOTES, SPACES, from, 'Wav')[0]
    expect([home.space, home.spaceEmoji, home.otherSpace]).toEqual(['Physics', '📚', false])
    const away = linkChoices(NOTES, SPACES, from, 'Maths')[0]
    expect([away.space, away.spaceEmoji, away.otherSpace]).toEqual(['Maths', '🔢', true])
  })

  it('puts notes before folders', () => {
    // You are usually linking a note; a stable order also means the first row
    // doesn't move under you as you type.
    expect(linkChoices(NOTES, SPACES, from, '').map((c) => c.ref.kind)).toEqual(['note', 'dir'])
  })

  it('never offers the note you are writing in', () => {
    expect(linkChoices(NOTES, SPACES, 'Maths/Algebra.md', '').map((c) => c.ref.path)).toEqual([])
  })

  it('does not offer the space folder itself', () => {
    // "Physics" as a link target, written from inside Physics, is a link to
    // where you already are.
    expect(linkChoices(NOTES, SPACES, from, 'Physics').map((c) => c.ref.path)).not.toContain('Physics')
  })
})

describe('outgoingLinks', () => {
  it('lists links in document order with the line each sits on', () => {
    const text = ['# Waves', '', 'see [[Optics]] and [[Algebra]]'].join('\n')
    const out = outgoingLinks('Physics/Term 3/Waves.md', text, NOTES, SPACES)
    expect(out.map((e) => e.title)).toEqual(['Optics', 'Algebra'])
    expect(out[0].context).toBe('see [[Optics]] and [[Algebra]]')
    expect(out.every((e) => e.kind === 'out')).toBe(true)
  })

  it('marks only the links that leave this note’s space', () => {
    const out = outgoingLinks('Physics/Term 3/Waves.md', '[[Optics]] [[Algebra]]', NOTES, SPACES)
    // Optics is in Physics, same space — an emoji on it would be noise on nearly
    // every link. Algebra is in Maths, which is the case worth seeing.
    expect(out[0].emoji).toBe('')
    expect(out[1].emoji).toBe('🔢')
  })

  it('shows an unwritten link with nowhere to go, and where it would be made', () => {
    const out = outgoingLinks('Physics/Optics.md', 'see [[Diffraction]]', NOTES, SPACES)
    expect(out[0].path).toBeNull()
    expect(out[0].suggestedPath).toBe('Physics/Diffraction.md')
  })

  it('uses the alias as the label, because that is what the sentence says', () => {
    const out = outgoingLinks('Inbox.md', '[[Optics|the lenses bit]]', NOTES, SPACES)
    expect(out[0].title).toBe('the lenses bit')
    expect(out[0].path).toBe('Physics/Optics.md')
  })

  it('keeps two links to the same note as two entries', () => {
    // They are two connections with two different contexts; collapsing them
    // would hide the second one's reason for existing.
    const out = outgoingLinks('Inbox.md', 'a [[Optics]]\nb [[Optics]]', NOTES, SPACES)
    expect(out).toHaveLength(2)
    expect(out[0].context).not.toBe(out[1].context)
    expect(out[0].key).not.toBe(out[1].key)
  })

  it('leaves a same-note jump out of the block', () => {
    // [[#Heading]] moves you around inside the note you are already reading. It
    // is navigation, not a connection to somewhere else, and listing it under
    // "links out" would overstate what the note is connected to.
    expect(outgoingLinks('Inbox.md', 'see [[#Later]]', NOTES, SPACES)).toEqual([])
  })

  it('flags a link that could have meant more than one note', () => {
    const two: NoteRef[] = [...NOTES, { path: 'Maths/Optics.md', title: 'Optics', kind: 'note' }]
    expect(outgoingLinks('Inbox.md', '[[Optics]]', two, SPACES)[0].ambiguous).toBe(true)
    expect(outgoingLinks('Inbox.md', '[[Physics/Optics]]', two, SPACES)[0].ambiguous).toBe(false)
  })
})

describe('incomingLinks', () => {
  const INDEX: LinkRow[] = [
    {
      path: 'Maths/Algebra.md',
      links: [{ target: 'Optics', heading: null, alias: null, line: 3, context: 'the [[Optics]] note covers this' }]
    },
    { path: 'Inbox.md', links: [{ target: 'Waves', heading: null, alias: null, line: 1, context: '[[Waves]] first' }] }
  ]

  it('gives the note, the line and the sentence the link sits in', () => {
    const back = incomingLinks('Physics/Optics.md', INDEX, NOTES, SPACES)
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({
      kind: 'back',
      path: 'Maths/Algebra.md',
      title: 'Algebra',
      context: 'the [[Optics]] note covers this',
      emoji: '🔢'
    })
  })

  it('says nothing links here when nothing does', () => {
    expect(incomingLinks('Inbox.md', INDEX, NOTES, SPACES)).toEqual([])
  })
})

describe('crumbsFor', () => {
  it('reads as space then folders then note', () => {
    expect(crumbsFor('Physics/Term 3/Waves.md', SPACES)).toEqual([
      { label: 'Physics', emoji: '📚', path: 'Physics' },
      { label: 'Term 3', emoji: '', path: 'Physics/Term 3' },
      { label: 'Waves', emoji: '', path: null }
    ])
  })

  it('gives the note no path, because there is nothing to reveal about where you are', () => {
    expect(crumbsFor('Inbox.md', SPACES)).toEqual([{ label: 'Inbox', emoji: '', path: null }])
  })

  it('leaves a folder with no matching space unmarked rather than guessing', () => {
    expect(crumbsFor('Archive/Old.md', SPACES)[0]).toEqual({ label: 'Archive', emoji: '', path: 'Archive' })
  })

  it('has nothing to show when no note is open', () => {
    expect(crumbsFor('', SPACES)).toEqual([])
  })
})

describe('ancestorsOf', () => {
  it('is the set that has to stay open for a folder to be visible', () => {
    expect([...ancestorsOf('Physics/Term 3')]).toEqual(['Physics', 'Physics/Term 3'])
    expect([...ancestorsOf('Physics')]).toEqual(['Physics'])
  })
})


// The index is only re-derived when this string changes, so anything missing
// from it is a change the app is blind to. Embeds were missing, and the cost
// was a photo shared by two notes being deleted with no warning — see
// `indexFingerprint` for the full account.
describe('indexFingerprint', () => {
  it('changes when a link is added', () => {
    expect(indexFingerprint('hello')).not.toBe(indexFingerprint('hello [[Other]]'))
  })

  // The regression that mattered.
  it('changes when an EMBED is added', () => {
    expect(indexFingerprint('hello')).not.toBe(indexFingerprint('hello\n\n![](beach.png)'))
  })

  it('changes when an embed is removed', () => {
    expect(indexFingerprint('a\n\n![](beach.png)')).not.toBe(indexFingerprint('a\n'))
  })

  it('changes when an embed is repointed at another file', () => {
    expect(indexFingerprint('![](a.png)')).not.toBe(indexFingerprint('![](b.png)'))
  })

  it('notices a video embed too, not just an image', () => {
    const none = indexFingerprint('text')
    expect(indexFingerprint('text\n<video controls src="clip.mp4"></video>')).not.toBe(none)
  })

  // The reason it costs anything: rebuilding every open note's backlinks on
  // each keystroke is what this is avoiding.
  it('does NOT change when only prose is edited', () => {
    expect(indexFingerprint('one [[X]] ![](a.png)')).toBe(indexFingerprint('one more [[X]] ![](a.png)'))
  })

  it('keeps a link and an embed of the same name apart', () => {
    expect(indexFingerprint('[[a.png]]')).not.toBe(indexFingerprint('![](a.png)'))
  })
})
