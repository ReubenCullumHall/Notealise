import { describe, expect, it } from 'vitest'
import {
  asRestoreResult,
  isSelfOrDescendant,
  isWorkspace,
  normalizeWorkspace,
  remapPath,
  spliceMediaBack,
  type MediaOrigin
} from './workspace'

// workspace.json is a sidecar the user can edit, sync, or corrupt. The contract
// is that it NEVER stops the vault opening (rule 1: files are the source of
// truth, the sidecar is losable), so every test here feeds it something broken.

describe('normalizeWorkspace', () => {
  it('never throws on junk', () => {
    for (const junk of [null, undefined, 0, '', 'nope', [], true, NaN]) {
      expect(() => normalizeWorkspace(junk)).not.toThrow()
      expect(normalizeWorkspace(junk)).toEqual({ entries: {}, trash: [], recovery: [] })
    }
  })

  it('keeps valid entry fields and drops invalid ones', () => {
    const ws = normalizeWorkspace({
      entries: {
        'a.md': { order: 2, pinned: true, archived: false, archivedAt: 1700, collapsed: true },
        'b.md': { order: 'first', pinned: 'yes', archived: null }
      }
    })
    expect(ws.entries['a.md']).toEqual({
      order: 2,
      pinned: true,
      archived: false,
      archivedAt: 1700,
      collapsed: true
    })
    // b.md survives as an entry, but every bad field is dropped rather than coerced
    expect(ws.entries['b.md']).toEqual({})
  })

  it('canonicalises a colour and drops one that is not a colour', () => {
    // `color` is interpolated into a CSS custom property on the row, so a value
    // that reaches the DOM unvalidated is the one field in this file that could
    // do more than lose a preference.
    const ws = normalizeWorkspace({
      entries: {
        'a.md': { color: '#F0A' },
        'b.md': { color: 'red' },
        'c.md': { color: 'rgb(1,2,3)' },
        'd.md': { color: 42 }
      }
    })
    expect(ws.entries['a.md']).toEqual({ color: '#ff00aa' })
    for (const p of ['b.md', 'c.md', 'd.md']) expect(ws.entries[p]).toEqual({})
  })

  it('clears a colour when the field is absent, so "No colour" is expressible', () => {
    // Main merges a partial with a spread, so clearing is `{ color: undefined }`
    // — exactly how un-archiving clears archivedAt. If normalizeEntry kept the
    // key as undefined instead of dropping it, the cleared colour would come
    // back as the string "undefined" in the JSON.
    const ws = normalizeWorkspace({ entries: { 'a.md': { pinned: true, color: undefined } } })
    expect(ws.entries['a.md']).toEqual({ pinned: true })
    expect('color' in ws.entries['a.md']).toBe(false)
  })

  it('drops non-finite numbers rather than storing NaN/Infinity', () => {
    const ws = normalizeWorkspace({ entries: { 'a.md': { order: NaN, archivedAt: Infinity } } })
    expect(ws.entries['a.md']).toEqual({})
  })

  it('drops trash items that could not be restored', () => {
    const ws = normalizeWorkspace({
      trash: [
        { id: 'x1', from: 'notes/a.md', deletedAt: 5, type: 'file' },
        { from: 'notes/b.md', deletedAt: 5 }, // no id -> file can't be found
        { id: 'x3', deletedAt: 5 }, // no `from` -> nowhere to put it back
        { id: 'x4', from: 'notes/d.md' }, // no timestamp
        'not an object'
      ]
    })
    expect(ws.trash.map((t) => t.id)).toEqual(['x1'])
  })

  it('infers a missing display name from the path', () => {
    const ws = normalizeWorkspace({ trash: [{ id: 'x', from: 'a/b/c.md', deletedAt: 1 }] })
    expect(ws.trash[0].name).toBe('c.md')
  })

  it('defaults an unknown trash type to file', () => {
    const ws = normalizeWorkspace({ trash: [{ id: 'x', from: 'a.md', deletedAt: 1, type: 'wat' }] })
    expect(ws.trash[0].type).toBe('file')
  })

  // The recovery safety net (RecoveryItem) mirrors TrashItem field-for-field
  // except deletedAt -> purgedAt, so it needs the same "never lose the app"
  // guarantees on malformed input.
  it('drops recovery items that could not be restored', () => {
    const ws = normalizeWorkspace({
      recovery: [
        { id: 'x1', from: 'notes/a.md', purgedAt: 5, type: 'file' },
        { from: 'notes/b.md', purgedAt: 5 }, // no id -> file can't be found
        { id: 'x3', purgedAt: 5 }, // no `from` -> nowhere to put it back
        { id: 'x4', from: 'notes/d.md' }, // no timestamp
        'not an object'
      ]
    })
    expect(ws.recovery.map((r) => r.id)).toEqual(['x1'])
  })

  it('infers a missing recovery display name from the path', () => {
    const ws = normalizeWorkspace({ recovery: [{ id: 'x', from: 'a/b/c.md', purgedAt: 1 }] })
    expect(ws.recovery[0].name).toBe('c.md')
  })

  it('defaults an unknown recovery type to file', () => {
    const ws = normalizeWorkspace({ recovery: [{ id: 'x', from: 'a.md', purgedAt: 1, type: 'wat' }] })
    expect(ws.recovery[0].type).toBe('file')
  })
})

describe('isSelfOrDescendant', () => {
  it('matches on whole segments, not string prefixes', () => {
    expect(isSelfOrDescendant('notes/a.md', 'notes')).toBe(true)
    expect(isSelfOrDescendant('notes', 'notes')).toBe(true)
    // the bug this exists to prevent: a startsWith() check would say true here
    expect(isSelfOrDescendant('notesX/a.md', 'notes')).toBe(false)
    expect(isSelfOrDescendant('notes-old/a.md', 'notes')).toBe(false)
  })

  it('treats the vault root as containing everything', () => {
    expect(isSelfOrDescendant('anything/at/all.md', '')).toBe(true)
  })
})

describe('remapPath', () => {
  it('re-keys the moved entry itself', () => {
    expect(remapPath('a.md', 'a.md', 'b.md')).toBe('b.md')
  })

  it('re-keys descendants', () => {
    expect(remapPath('old/deep/x.md', 'old', 'new')).toBe('new/deep/x.md')
  })

  it('leaves unrelated paths alone, including prefix look-alikes', () => {
    expect(remapPath('older/x.md', 'old', 'new')).toBe('older/x.md')
    expect(remapPath('other.md', 'old', 'new')).toBe('other.md')
  })
})

// --- putting a restored photo back into its note ---------------------------
// The one part of Restore that can produce a plausible-looking WRONG note
// rather than an obvious failure, so it is pinned down here rather than left
// to the click-through.
describe('spliceMediaBack', () => {
  // No anchors: an older bin record, written before they existed. These keep
  // the legacy coordinate path honest.
  const origin = (over: Partial<MediaOrigin> = {}): MediaOrigin => ({
    note: 'Space/Note.md',
    text: '![](photo.png)\n',
    line: 3,
    col: 0,
    ...over
  })

  describe('older records, with only a line and column', () => {
    it('puts a whole-line embed back on its own line', () => {
      const out = spliceMediaBack('One\n\nThree\n', origin())
      expect(out.how).toBe('aimed')
      expect(out.doc).toBe('One\n\n![](photo.png)\nThree\n')
    })

    it('puts a mid-sentence embed back mid-sentence', () => {
      const out = spliceMediaBack('One\n\nBefore  after\n', origin({ text: '![](photo.png)', line: 3, col: 7 }))
      expect(out.how).toBe('aimed')
      expect(out.doc).toBe('One\n\nBefore ![](photo.png) after\n')
    })

    it('appends when the note has lost that line', () => {
      const out = spliceMediaBack('Only one line\n', origin({ line: 9 }))
      expect(out.how).toBe('appended')
      expect(out.doc).toBe('Only one line\n\n![](photo.png)\n')
    })

    it('appends when the line survives but is too short for the column', () => {
      const out = spliceMediaBack('One\n\nHi\n', origin({ text: '![](p.png)', line: 3, col: 40 }))
      expect(out.how).toBe('appended')
      expect(out.doc).toBe('One\n\nHi\n\n![](p.png)\n')
    })

    it('restores a last-line embed cut with its LEADING newline', () => {
      const out = spliceMediaBack('One\nTwo', origin({ text: '\n![](photo.png)', line: 2, col: 3 }))
      expect(out.how).toBe('aimed')
      expect(out.doc).toBe('One\nTwo\n![](photo.png)')
    })
  })

  // The anchored path. `before`/`after` are what the note looked like either
  // side of the cut, so a restore is a search rather than a coordinate.
  describe('anchored to the text around it', () => {
    const anchored = (over: Partial<MediaOrigin> = {}): MediaOrigin =>
      origin({ before: 'One\n\n', after: 'Three\n', ...over })

    it('lands on the seam between the two neighbours', () => {
      const out = spliceMediaBack('One\n\nThree\n', anchored())
      expect(out.how).toBe('anchored')
      expect(out.doc).toBe('One\n\n![](photo.png)\nThree\n')
    })

    // The bug this whole mechanism exists for: two paragraphs typed at the top
    // moved every line below, and the coordinate then aimed at the heading.
    it('is unmoved by an edit ABOVE it that shifts every line', () => {
      const doc = 'New para.\n\nAnother.\n\nOne\n\nThree\n'
      const out = spliceMediaBack(doc, anchored())
      expect(out.how).toBe('anchored')
      expect(out.doc).toBe('New para.\n\nAnother.\n\nOne\n\n![](photo.png)\nThree\n')
    })

    it('is unmoved by an edit BELOW it', () => {
      const out = spliceMediaBack('One\n\nThree\nand more\n', anchored())
      expect(out.how).toBe('anchored')
      expect(out.doc).toBe('One\n\n![](photo.png)\nThree\nand more\n')
    })

    it('still finds the spot when the far end of a neighbour was edited', () => {
      // The opening of `before` is gone, but its last 14 characters — the ones
      // actually touching the picture — are still there, so the short rung
      // catches what the full-length one misses.
      const m = anchored({ before: 'Some long preamble here\n\n', after: 'Three\n' })
      const out = spliceMediaBack('Rewritten. A preamble here\n\nThree\n', m)
      expect(out.how).toBe('anchored')
      expect(out.doc).toBe('Rewritten. A preamble here\n\n![](photo.png)\nThree\n')
    })

    it('uses the recorded line to choose between identical anchors', () => {
      // The same seam three times over; line 7 names the middle one.
      const doc = 'One\n\nThree\nOne\n\nThree\nOne\n\nThree\n'
      const out = spliceMediaBack(doc, anchored({ line: 5 }))
      expect(out.how).toBe('anchored')
      expect(out.doc).toBe('One\n\nThree\nOne\n\n![](photo.png)\nThree\nOne\n\nThree\n')
    })

    it('appends rather than guessing when the note was rewritten around it', () => {
      // Neither neighbour survives. The old code would have aimed at line 3 and
      // reported success; a wrong position stated confidently is the failure
      // this replaces.
      const out = spliceMediaBack('Completely\n\ndifferent\n', anchored())
      expect(out.how).toBe('appended')
      expect(out.doc).toBe('Completely\n\ndifferent\n\n![](photo.png)\n')
    })

    it('matches on one side when the picture was at the very top', () => {
      const out = spliceMediaBack('Rest of it\n', anchored({ before: '', after: 'Rest of it\n' }))
      expect(out.how).toBe('aimed')
      expect(out.doc).toBe('![](photo.png)\nRest of it\n')
    })

    it('matches on one side when the picture was at the very bottom', () => {
      const out = spliceMediaBack('All of it\n', anchored({ before: 'All of it\n', after: '' }))
      expect(out.how).toBe('aimed')
      expect(out.doc).toBe('All of it\n![](photo.png)\n')
    })

    it('a one-sided anchor that occurs twice is too weak — appends instead', () => {
      const out = spliceMediaBack('Rest of it\nRest of it\n', anchored({ before: '', after: 'Rest of it\n' }))
      expect(out.how).toBe('appended')
    })
  })

  it('appending twice does not stack blank lines', () => {
    const once = spliceMediaBack('Text\n', origin({ line: 99 }))
    const twice = spliceMediaBack(once.doc, origin({ text: '![](b.png)\n', line: 99 }))
    expect(twice.doc).toBe('Text\n\n![](photo.png)\n\n![](b.png)\n')
  })

  it('handles an empty note', () => {
    const out = spliceMediaBack('', origin({ line: 5 }))
    expect(out.doc).toBe('![](photo.png)\n')
  })
})

// --- refusing a bad reply from main ----------------------------------------
// One IPC reply of the wrong shape reached React state and blanked the entire
// window: React unmounts the whole tree on a render error, and there was no
// boundary. These two guards are what stops that at the door.
describe('isWorkspace', () => {
  const good = { entries: {}, trash: [], recovery: [] }

  it('accepts a real one', () => {
    expect(isWorkspace(good)).toBe(true)
  })

  it('refuses everything a broken IPC call can hand back', () => {
    for (const bad of [undefined, null, 0, '', 'workspace', [], {}, { entries: {} }, { entries: {}, trash: [] }, { entries: null, trash: [], recovery: [] }, { entries: {}, trash: {}, recovery: [] }]) {
      expect(isWorkspace(bad)).toBe(false)
    }
  })
})

describe('asRestoreResult', () => {
  const ws = { entries: {}, trash: [], recovery: [] }

  it('takes the new shape as it is', () => {
    expect(asRestoreResult({ workspace: ws, landed: { a: 'A.md' } })).toEqual({
      workspace: ws,
      landed: { a: 'A.md' }
    })
  })

  // The real failure: in dev the renderer hot-reloads and main does not, so a
  // renderer on the new contract talks to a main still on the old one.
  it('accepts a bare Workspace from a main process that has not reloaded', () => {
    expect(asRestoreResult(ws)).toEqual({ workspace: ws, landed: {} })
  })

  it('tolerates a missing or malformed landed map', () => {
    expect(asRestoreResult({ workspace: ws })).toEqual({ workspace: ws, landed: {} })
    expect(asRestoreResult({ workspace: ws, landed: 'nope' })).toEqual({ workspace: ws, landed: {} })
  })

  it('returns null rather than something unusable', () => {
    for (const bad of [undefined, null, {}, { workspace: null }, { workspace: { entries: {} } }]) {
      expect(asRestoreResult(bad)).toBeNull()
    }
  })
})
