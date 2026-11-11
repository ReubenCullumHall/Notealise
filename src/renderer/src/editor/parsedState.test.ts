// The test helper every editor test builds its note with (parsedState.ts): a state whose
// first parse ran out of time must still report the whole note.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { findToggles, toggleMarkdown, toggleText } from './toggleModel'
import { parsed } from './parsedState'

const DOC = ['A first paragraph.', '', 'A second one.', '', toggleText('Lectures', ['inside the toggle'], true), '', 'after'].join('\n')

/** A new state on a machine too busy to finish the first parse: the clock jumps a second
 *  every time CodeMirror looks at it, so its 20 ms are gone after one step. */
function createdUnderLoad(): EditorState {
  let now = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000))
  try {
    return EditorState.create({ doc: DOC, extensions: [markdown({ base: markdownLanguage, extensions: [toggleMarkdown] })] })
  } finally {
    clock.mockRestore()
  }
}

afterEach(() => vi.restoreAllMocks())

describe('an editor state built for a test', () => {
  it('the fault: finishing the parse does not put the finished tree in the state', () => {
    const s = createdUnderLoad()
    expect(ensureSyntaxTree(s, s.doc.length, 5000)).not.toBeNull() // the parse IS finished…
    expect(findToggles(s)).toEqual([]) // …and the state still reports the short tree
  })

  it('parsed() hands back a state that reports the whole note', () => {
    const s = parsed(createdUnderLoad())
    expect(findToggles(s).length).toBe(1)
    expect(s.doc.toString()).toBe(DOC)
  })

  it('keeps the selection it was given', () => {
    const s = parsed(EditorState.create({ doc: DOC, selection: { anchor: 3, head: 9 }, extensions: [markdown()] }))
    expect([s.selection.main.anchor, s.selection.main.head]).toEqual([3, 9])
  })
})
