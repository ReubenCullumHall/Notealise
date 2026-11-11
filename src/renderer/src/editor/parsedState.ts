// Test support: an editor state whose syntax tree is finished. Only tests import this.
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'

/** `state`, with the whole note parsed and that finished tree in place.
 *
 *  CodeMirror gives a new state 20 ms to parse. On a busy machine (GitHub's release
 *  check, the cold first test of a file) that can run out, and the state then reports
 *  an UNFINISHED tree until its next transaction: `ensureSyntaxTree` finishes the parse
 *  but hands the tree back rather than putting it in the state. A test that goes on to
 *  read `syntaxTree(state)` — or calls anything that does, `findToggles` and the passes
 *  among them — then sees a note with nothing in it, at random. That is how
 *  toggleTranscript.test.ts failed once in four full runs on 2026-11-09 ("expected 0 to
 *  be 1") and passed every time after. The empty transaction is what moves the finished
 *  tree into the state; toggleModel.test.ts had already found the same thing for itself. */
export function parsed(state: EditorState): EditorState {
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state.update({}).state
}
