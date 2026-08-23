import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { linkHandlersFacet, notifyError, notifyUser, type LinkHandlers } from './linkEnv'

// EditorState is pure — only EditorView needs a DOM — so this runs with no jsdom,
// the same way formatCommands.test.ts exercises the real commands (see CLAUDE.md).
//
// What's worth testing here is the message the USER ends up seeing. An error
// crossing Electron's IPC bridge is wrapped in machinery nobody outside the app
// should ever read, and the whole point of surfacing attachment failures at all
// is that the sentence is comprehensible.

function stateWith(notify: (m: string) => void): EditorState {
  const handlers = { notify } as unknown as LinkHandlers
  return EditorState.create({ extensions: [linkHandlersFacet.of({ current: handlers })] })
}

/** The last message a state's handler was told, or null. */
function sayWhat(run: (s: EditorState) => void): string | null {
  let said: string | null = null
  run(stateWith((m) => (said = m)))
  return said
}

describe('notifyUser', () => {
  it('passes the line straight through', () => {
    expect(sayWhat((s) => notifyUser(s, 'Saved clip.mp4.'))).toBe('Saved clip.mp4.')
  })

  it('does nothing when nothing is listening', () => {
    // The browser preview and the tests both build editors with no handlers.
    // A message is never worth throwing over, so this must not be an error.
    const bare = EditorState.create({})
    expect(() => notifyUser(bare, 'anything')).not.toThrow()
    const unset = EditorState.create({ extensions: [linkHandlersFacet.of({ current: null })] })
    expect(() => notifyUser(unset, 'anything')).not.toThrow()
  })
})

describe('notifyError', () => {
  it("strips Electron's IPC wrapper off the reason", () => {
    // What ipcRenderer.invoke actually rejects with when a main handler throws.
    const e = new Error(
      "Error invoking remote method 'asset:write': Error: Not a photo or video: notes.md"
    )
    expect(sayWhat((s) => notifyError(s, "Couldn't add notes.md", e))).toBe(
      "Couldn't add notes.md — Not a photo or video: notes.md"
    )
  })

  it("keeps main's own wording, which is written for people", () => {
    // renameWithRetry raises this on a synced vault, and it tells the user
    // exactly what to do — losing it would make the message worse, not tidier.
    const e = new Error(
      "Error invoking remote method 'asset:write': Error: This folder is still syncing " +
        '(OneDrive, Google Drive or iCloud) — wait a moment and try again.'
    )
    expect(sayWhat((s) => notifyError(s, "Couldn't add photo.png", e))).toBe(
      "Couldn't add photo.png — This folder is still syncing (OneDrive, Google Drive or " +
        'iCloud) — wait a moment and try again.'
    )
  })

  it('handles an error that never crossed the bridge', () => {
    expect(sayWhat((s) => notifyError(s, "Couldn't add it", new Error('Disk full')))).toBe(
      "Couldn't add it — Disk full"
    )
  })

  it('falls back to just the what when there is no usable why', () => {
    expect(sayWhat((s) => notifyError(s, "Couldn't add it", new Error('')))).toBe("Couldn't add it")
    expect(sayWhat((s) => notifyError(s, "Couldn't add it", new Error('Error: ')))).toBe(
      "Couldn't add it"
    )
  })

  it('survives something thrown that is not an Error at all', () => {
    expect(sayWhat((s) => notifyError(s, "Couldn't add it", 'just a string'))).toBe(
      "Couldn't add it — just a string"
    )
    expect(sayWhat((s) => notifyError(s, "Couldn't add it", null))).toBe("Couldn't add it — null")
  })
})
