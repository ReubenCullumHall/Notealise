// How the editor asks for the voice note editor: the voice note (audioPass.ts)
// hands over what it is and how to write the result back, and the one panel
// App mounts (ClipEditor.tsx) opens. A tiny store rather than a prop chain —
// the voice note lives inside CodeMirror, which App's React tree doesn't reach.

import type { VoiceSettings } from '../../../../shared/voiceNote'

/** One saved recording, ready to go on a voice note's line. */
export interface SavedClip {
  /** vault-relative path of the new file */
  rel: string
  /** the voice note's name for it ('' for none) */
  name: string
}

export interface ClipSaveResult {
  files: SavedClip[]
  /** true: these take the original's place; false: they go under it */
  replace: boolean
  /** the speed was saved into the files, so the mixer's own goes back to 1× */
  speedSaved: boolean
}

export interface ClipApplied {
  text: string
  /** Put the voice note's original line back in place of what Save wrote
   *  ("Put back" on the notice). False when that text can't be found any more. */
  revert(): boolean
}

export interface ClipEditRequest {
  /** the recording, vault-relative */
  rel: string
  /** the note it is in, vault-relative */
  notePath: string
  /** the voice note's name ('' for none) */
  name: string
  settings: VoiceSettings
  /** Write the result into the note. Answers the note's text afterwards and a
   *  way to put the original line back, or null when the voice note couldn't
   *  be found any more (the note changed). */
  apply(result: ClipSaveResult): ClipApplied | null
  /** a line on the app's notice strip */
  notify(message: string): void
}

type Listener = (req: ClipEditRequest) => void
let listener: Listener | null = null
let open = false

/** Open the panel for this voice note. Ignored while one is already open. */
export function openClipEditor(req: ClipEditRequest): void {
  if (open || !listener) return
  listener(req)
}

/** ClipEditor.tsx's host: the one place that opens. */
export function onClipEditor(fn: Listener): () => void {
  listener = fn
  return () => {
    if (listener === fn) listener = null
  }
}

export function setClipEditorOpen(v: boolean): void {
  open = v
}

// --- the app menu's shortcuts while the editor is open ---------------------------
// A menu shortcut is acted on by the app's menu before the editor ever sees the
// key, so Cmd/Ctrl+S toggled the sidebar BEHIND the panel (Reuben, 2026-11-05:
// "make sure any duplicate commands are isolated to the editor when its open").
// App's menu handler asks here first; while the editor is open every menu
// command is the editor's — Cmd/Ctrl+S saves, the rest do nothing.
let commandHandler: ((cmd: string) => void) | null = null

/** App's menu handler: true when the editor took the command. */
export function clipEditorTakesCommand(cmd: string): boolean {
  if (!open) return false
  commandHandler?.(cmd)
  return true
}

export function onClipEditorCommand(fn: (cmd: string) => void): () => void {
  commandHandler = fn
  return () => {
    if (commandHandler === fn) commandHandler = null
  }
}
