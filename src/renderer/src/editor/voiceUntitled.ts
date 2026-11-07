import { Transaction } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view'
import { nameChange, voiceNotesIn } from './audioPass'
import { notePathOf } from './viewRegistry'
import { linkEnv } from './linkEnv'

// A voice note with no name gets the vault's next "Untitled N" written onto its line (Reuben,
// 2026-11-07: "when a voicenote doesn't have a name, just have it as 'untitled' … make sure it
// adds to that tally"; voice notes made before this get theirs the first time their note is
// open). One count with new notes and folders (shared/untitled.ts), kept by main, so no two
// things share a number and naming one never renumbers another.
//
// It looks after any change — a recording landing, a file dropped in, a name cleared, the parser
// reaching further down a long note — waits a moment, asks main for as many numbers as there are
// unnamed voice notes, and writes them in one change kept out of undo (undoing the recording
// still takes the named line back out; the name is part of the voice note, not a step of yours).

/** Notes asking for numbers right now: two panes on one note ask once. */
const asking = new Set<string>()

async function nameThem(view: EditorView): Promise<void> {
  const path = notePathOf(view)
  if (!path || !view.dom.isConnected || view.state.readOnly || asking.has(path)) return
  if (!window.api?.untitledNames) return
  const count = voiceNotesIn(view.state, 0, view.state.doc.length).filter((v) => v.name === '').length
  if (!count) return
  asking.add(path)
  try {
    const names = await window.api.untitledNames(count)
    // The note may have changed under the ask; the unnamed ones are found again now. A number
    // asked for and not used is simply skipped — gaps are fine, repeats are not.
    if (!view.dom.isConnected || notePathOf(view) !== path) return
    const state = view.state
    const unnamed = voiceNotesIn(state, 0, state.doc.length).filter((v) => v.name === '')
    const changes = unnamed.slice(0, names.length).flatMap((v, i) => nameChange(state.doc, v, names[i]) ?? [])
    if (changes.length) view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) })
  } catch {
    // No vault, or main refused: they stay unnamed until the next look.
  } finally {
    asking.delete(path)
  }
}

export const nameUntitledVoiceNotes = ViewPlugin.fromClass(
  class implements PluginValue {
    private timer: ReturnType<typeof setTimeout> | null = null
    constructor(private readonly view: EditorView) {
      this.soon()
    }
    update(u: ViewUpdate): void {
      // A note switch swaps the text first and the path a moment later (CodeEditor.tsx): both
      // restart the wait, so the names are only ever written once the two agree.
      const pathMoved = (u.startState.field(linkEnv, false)?.path ?? '') !== notePathOf(u.view)
      if (u.docChanged || pathMoved || syntaxTree(u.startState) !== syntaxTree(u.state)) this.soon()
    }
    /** After a short wait: a note being opened arrives as more than one change. */
    private soon(): void {
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => {
        this.timer = null
        void nameThem(this.view)
      }, 400)
    }
    destroy(): void {
      if (this.timer) clearTimeout(this.timer)
    }
  }
)
