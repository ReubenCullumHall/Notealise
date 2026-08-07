import type {
  ImportFormat,
  ImportPreview,
  ImportProgress,
  ImportResult
} from '../../shared/notesImport'

/** What every format's importer implements. `paths` are absolute filesystem
 *  paths the user picked (a single folder for Notion's unzipped export, one
 *  or more files for HTML) — never vault-relative, since they're outside the
 *  vault until written. */
export interface ImportRunner {
  preview(paths: string[]): Promise<ImportPreview>
  run(
    paths: string[],
    spaceName: string,
    onProgress: (p: ImportProgress) => void
  ): Promise<ImportResult>
}

// --- cancellation -----------------------------------------------------------
// A module-level flag rather than an AbortSignal threaded through every runner:
// there is only ever ONE import in flight (the panel blocks starting a second),
// so a token per run would be ceremony around a single boolean. Runners check
// it between notes, which is the only place stopping is safe — mid-note would
// leave a half-written file.
let cancelRequested = false

/** Called by the IPC handler as a run starts, so a cancel from a previous run
 *  can't kill the next one before it writes anything. */
export function beginImport(): void {
  cancelRequested = false
}
export function requestImportCancel(): void {
  cancelRequested = true
}
export function importCancelled(): boolean {
  return cancelRequested
}

const registry: Partial<Record<ImportFormat, ImportRunner>> = {}

/** Called once per format at startup — the seam a new format (Apple Notes,
 *  OneNote, ...) slots into without touching the IPC shell. */
export function registerImporter(format: ImportFormat, runner: ImportRunner): void {
  registry[format] = runner
}

/** Which formats this build can actually import. The dropdown is driven off
 *  THIS rather than a platform flag in the renderer: Apple Notes is only
 *  registered on macOS, so "what main can do" and "what the UI offers" cannot
 *  drift apart. */
export function listImporters(): ImportFormat[] {
  return Object.keys(registry) as ImportFormat[]
}

export function getImporter(format: ImportFormat): ImportRunner {
  const runner = registry[format]
  if (!runner) throw new Error(`No importer registered for format: ${format}`)
  return runner
}
