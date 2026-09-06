// Notes import — types shared by main (importers/) and renderer (import/).
// Pure types only, same rule as the rest of shared/.

export type ImportFormat =
  | 'notion'
  | 'markdown'
  | 'html'
  | 'word'
  | 'googleKeep'
  | 'appleNotes'

/** One entry per source-picking dialog the UI should offer for a format.
 *
 *  `both` is a single dialog that accepts either a file or a folder. Only macOS
 *  can show one: on Windows and Linux Electron drops the file half whenever
 *  `openDirectory` is present, so `['openFile', 'openDirectory']` silently
 *  became folder-ONLY there — a Windows user could not select their Notion
 *  `.zip` at all, against a dialog whose own title said a `.zip` was fine
 *  (confirmed on Windows 11, 2026-09-05). Those platforms get `file` and
 *  `folder` as two separate buttons instead.
 *
 *  Which modes a format offers is decided in main and sent to the renderer with
 *  the format list, for the same reason the list itself is — see
 *  `listImporters`. The renderer must not branch on `process.platform`. */
export type ImportPickMode = 'both' | 'file' | 'folder'

/** What `importFormats` reports: the formats this build can import, and how the
 *  user names a source for each on THIS platform. */
export interface ImportFormatInfo {
  id: ImportFormat
  pickModes: ImportPickMode[]
}

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
