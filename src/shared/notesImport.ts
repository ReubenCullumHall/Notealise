// Notes import — types shared by main (importers/) and renderer (import/).
// Pure types only, same rule as the rest of shared/.

export type ImportFormat =
  | 'notion'
  | 'markdown'
  | 'html'
  | 'word'
  | 'googleKeep'
  | 'appleNotes'

export type ImportPhase = 'scanning' | 'writing' | 'done' | 'error'

export interface ImportProgress {
  phase: ImportPhase
  current: number
  total: number
  /** e.g. the note/file currently being written. */
  label: string
}

export interface ImportPreview {
  noteCount: number
  folderCount: number
  /** plain-language callouts about defaults being applied (rule 9) — e.g.
   *  "2 databases found — each row becomes its own note, plus one index note." */
  notes: string[]
  warnings: string[]
}

export interface ImportResult {
  /** vault-relative path of the new space the import landed in. */
  spaceFolder: string
  createdNotes: number
  createdFolders: number
  skipped: { title: string; reason: string }[]
  /** things that imported but lost some fidelity (dropped colour, etc.) */
  lossy: { path: string; note: string }[]
  /** vault-relative path to the written Import Report.md */
  reportPath: string
  /** true when the user stopped it early — the space holds a partial import. */
  cancelled?: boolean
}
