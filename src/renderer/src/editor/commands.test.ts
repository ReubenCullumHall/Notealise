import { describe, expect, it } from 'vitest'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { ACTION_GROUPS, EDITOR_COMMANDS, findAction, matchesQuery, SLASH_COMMANDS } from './commands'

// The registry is a `.tsx` holding JSX glyphs, but nothing here renders one — a
// command's `run` is plain CodeMirror arithmetic, and CodeMirror's EditorState is
// pure, so the same stub-view trick formatCommands.test.ts uses works here too.
// (It only works because commands.tsx imports EditorView as a TYPE. Make that a
// value import and this file pulls in the DOM build and dies.)

function harness(doc: string, from: number, to = from): { view: EditorView; read: () => string } {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to } })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
    focus: () => {}
  } as unknown as EditorView
  return { view, read: () => state.doc.toString() }
}

// The ids every vault's settings.json may already contain. `toolbarSlots` stores
// them verbatim, so renaming one silently empties that slot for every user who
// had it — this list is a file format, and this test is the thing that says so
// out loud when someone edits the catalogue.
const PERSISTED_IDS = [
  'h1',
  'h2',
  'h3',
  'bullet',
  'numbered',
  'checklist',
  'quote',
  'code',
  'codeBlock',
  'math',
  'link',
  'table',
  'rule'
]

describe('the command registry', () => {
  it('still carries every id that has ever been written to a settings.json', () => {
    for (const id of PERSISTED_IDS) expect(findAction(id), `missing command id "${id}"`).not.toBeNull()
  })

  it('has no duplicate ids', () => {
    const ids = EDITOR_COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every command a label, a hint, a group and something to search on', () => {
    for (const c of EDITOR_COMMANDS) {
      expect(c.label.length, c.id).toBeGreaterThan(0)
      expect(c.hint.length, c.id).toBeGreaterThan(0)
      expect(c.group.length, c.id).toBeGreaterThan(0)
      expect(c.terms.length, c.id).toBeGreaterThan(0)
    }
  })

  it('reads an unknown id as an empty slot rather than throwing', () => {
    // An older vault, or a hand-edited settings.json. An empty slot shows "?" and
    // opens the picker, which is a recoverable state; an exception here would
    // take the whole format bar down with it.
    for (const junk of ['', 'nope', 'H1', 'wikiLink']) expect(findAction(junk)).toBeNull()
  })

  it('groups the catalogue without splitting a group in two', () => {
    // ACTION_GROUPS folds *adjacent* commands, so a command filed under a group
    // its neighbours don't share would silently produce a second heading with
    // the same name in the picker.
    const names = ACTION_GROUPS.map((g) => g.group)
    expect(new Set(names).size).toBe(names.length)
    expect(ACTION_GROUPS.flatMap((g) => g.actions)).toEqual(EDITOR_COMMANDS)
  })
})

describe('the two surfaces stay in step', () => {
  it('offers every command in the "/" menu unless it opts out', () => {
    // The whole point of merging the catalogues: a command added to the picker is
    // in the "/" menu on the same line of code. Before this, "/" had nine of the
    // thirteen and nothing said which four were missing.
    expect(SLASH_COMMANDS).toEqual(EDITOR_COMMANDS)
  })

  it('honours an explicit opt-out', () => {
    expect([{ slash: false }, { slash: true }, {}].filter((c) => (c as { slash?: boolean }).slash !== false)).toHaveLength(2)
  })
})

describe('matchesQuery', () => {
  it('matches on the label', () => {
    expect(matchesQuery(findAction('checklist')!, 'check')).toBe(true)
  })

  it('matches on the extra terms, which is the whole reason they exist', () => {
    // "ul" appears nowhere in "Bulleted list"; someone who thinks in HTML should
    // still find it.
    expect(matchesQuery(findAction('bullet')!, 'ul')).toBe(true)
    expect(matchesQuery(findAction('checklist')!, 'todo')).toBe(true)
    expect(matchesQuery(findAction('math')!, 'latex')).toBe(true)
  })

  it('offers the note link before the web link for "link"', () => {
    // Both match, and catalogue order is the ranking, so "/link" must land on the
    // note link — that is what the user reaches for.
    const hits = SLASH_COMMANDS.filter((c) => matchesQuery(c, 'link'))
    expect(hits[0].id).toBe('wikilink')
    expect(hits.map((c) => c.id)).toContain('link')
  })

  it('offers everything for an empty query', () => {
    expect(SLASH_COMMANDS.filter((c) => matchesQuery(c, ''))).toEqual(SLASH_COMMANDS)
  })

  it('is case-insensitive', () => {
    expect(matchesQuery(findAction('h1')!, 'HEAD')).toBe(true)
  })
})

describe('a "/" invocation', () => {
  it('deletes the typed query before acting', () => {
    // Without this the command formats the text the user typed to summon it:
    // "/h1" on an empty line would become "# /h1".
    const { view, read } = harness('/h1', 0, 0)
    findAction('h1')!.run(view, { from: 0, to: 3 })
    expect(read()).toBe('# ')
  })

  it('leaves the rest of the line alone', () => {
    const { view, read } = harness('some text /bullet', 10, 10)
    findAction('bullet')!.run(view, { from: 10, to: 17 })
    expect(read()).toBe('- some text ')
  })

  it('acts on the selection normally when there is no query to consume', () => {
    const { view, read } = harness('hello', 0, 0)
    findAction('h1')!.run(view)
    expect(read()).toBe('# hello')
  })

  it('runs every command against an empty document without throwing', () => {
    // The state a user is actually in on a brand-new note. CLAUDE.md's worked
    // example: a block command that silently declined to act on an empty line
    // shipped once already, wired correctly and doing nothing.
    for (const c of EDITOR_COMMANDS) {
      const { view, read } = harness('', 0)
      expect(() => c.run(view), c.id).not.toThrow()
      expect(read().length, `${c.id} produced no text on an empty note`).toBeGreaterThan(0)
    }
  })
})
