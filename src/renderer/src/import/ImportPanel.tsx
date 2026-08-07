import { useEffect, useState } from 'react'
import { SettingRow, Select } from '../settings/primitives'
import type {
  ImportFormat,
  ImportPreview,
  ImportProgress,
  ImportResult
} from '../../../shared/notesImport'

interface FormatInfo {
  id: ImportFormat
  label: string
  hint: string
  helpUrl?: string
  pickLabel: string
  defaultSpaceName: string
  /** Formats whose source is an app on this machine, not files you choose. */
  noSourcePicker?: boolean
}

const FORMATS: FormatInfo[] = [
  {
    id: 'notion',
    label: 'Notion',
    hint: 'Export your workspace from Notion (Settings → Export → Markdown & CSV), then choose the downloaded .zip below — or an already-unzipped folder.',
    helpUrl: 'https://www.notion.so/help/export-your-content',
    pickLabel: 'Choose .zip or folder…',
    defaultSpaceName: 'Notion Import'
  },
  {
    id: 'markdown',
    label: 'Markdown',
    hint: 'Choose .md files or a whole folder of them — an Obsidian vault, a Bear export, anything already in Markdown. Nothing is converted: the text is copied exactly as it is, folders and all, with any images beside it.',
    pickLabel: 'Choose files or folder…',
    defaultSpaceName: 'Markdown Import'
  },
  {
    id: 'html',
    label: 'HTML',
    hint: 'Choose .html files, or a folder of them, and each page becomes a note. Folders inside are kept.',
    pickLabel: 'Choose files or folder…',
    defaultSpaceName: 'HTML Import'
  },
  {
    id: 'googleKeep',
    label: 'Google Keep',
    hint: 'Download your notes from Google Takeout, unzip it, then choose the "Keep" folder inside. Checklists stay ticked, pictures come across, and each note is filed under its first Keep label.',
    helpUrl: 'https://takeout.google.com/',
    pickLabel: 'Choose Takeout "Keep" folder…',
    defaultSpaceName: 'Google Keep'
  },
  {
    id: 'word',
    label: 'Word',
    hint: 'Choose one or more Word .docx files — each becomes a note, with its pictures copied in alongside. Older .doc files (pre-2007) can’t be read; open one in Word and save it as .docx first.',
    pickLabel: 'Choose files…',
    defaultSpaceName: 'Word Import'
  },
  {
    id: 'appleNotes',
    label: 'Apple Notes',
    hint: 'Brings in the notes from the Apple Notes app on this Mac, keeping your folders. macOS will ask once for permission to read them. Notes locked with a password can’t be read by anything outside Apple Notes, and pictures stay behind — both are listed in the Import Report.',
    pickLabel: 'Read Apple Notes',
    defaultSpaceName: 'Apple Notes',
    noSourcePicker: true
  }
]

type Stage = 'setup' | 'running' | 'done'

interface Props {
  /** Reload the tree, register the new folder as a space, and switch to it.
   *  Not optional in practice: the importer's writes are echo-guarded, so
   *  without this the notes land on disk and the sidebar never mentions them. */
  onOpenSpace: (folder: string) => Promise<void>
  /** Close the Settings window, so the imported space is actually on screen. */
  onClose: () => void
}

/** Lands in Settings — see Settings.tsx's "import" section. A format dropdown,
 *  a source picker, an output-folder name, and an Import button; every run
 *  lands in one new space, never merged into existing notes. */
export function ImportPanel({ onOpenSpace, onClose }: Props): React.JSX.Element {
  const [format, setFormat] = useState<ImportFormat>('notion')
  const [paths, setPaths] = useState<string[]>([])
  const [spaceName, setSpaceName] = useState(FORMATS[0].defaultSpaceName)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [stage, setStage] = useState<Stage>('setup')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')
  // Stopping is a request, not an instant: the run halts at the next note.
  const [stopping, setStopping] = useState(false)

  // What main can ACTUALLY import. Apple Notes is only registered on macOS, so
  // asking the registry keeps the dropdown honest without the renderer needing
  // to know what platform it's on.
  const [available, setAvailable] = useState<ImportFormat[] | null>(null)
  useEffect(() => {
    void window.api.importFormats().then(setAvailable)
  }, [])
  const formats = available ? FORMATS.filter((f) => available.includes(f.id)) : FORMATS
  const current = formats.find((f) => f.id === format) ?? formats[0] ?? FORMATS[0]

  const chooseFormat = (id: string): void => {
    const info = formats.find((f) => f.id === id) ?? FORMATS[0]
    setFormat(info.id)
    setPaths([])
    setPreview(null)
    setSpaceName(info.defaultSpaceName)
  }

  // Unpacking a .zip and scanning it happen AFTER the dialog closes and can
  // take minutes on a big export, so they get their own visible busy state —
  // without it the app looks like it ignored the file you just chose.
  const [picking, setPicking] = useState(false)
  const pick = async (): Promise<void> => {
    setError('')
    const picked = await window.api.importPickSource(format)
    if (!picked) return
    setPicking(true)
    setPaths([])
    setPreview(null)
    try {
      const prepared = await window.api.importPrepare(format, picked)
      setPaths(prepared)
      setPreview(await window.api.importPreview(format, prepared))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that source')
    } finally {
      setPicking(false)
    }
  }

  const run = async (): Promise<void> => {
    setStage('running')
    setError('')
    setStopping(false)
    const unsubscribe = window.api.onImportProgress(setProgress)
    try {
      const r = await window.api.importRun(format, paths, spaceName.trim() || current.defaultSpaceName)
      setResult(r)
      setStage('done')
      // Show what was just imported. Everything the importer wrote is
      // echo-guarded, so the sidebar has no idea any of it happened until the
      // tree is reloaded and the new folder registered as a space.
      await onOpenSpace(r.spaceFolder)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
      setStage('setup')
    } finally {
      unsubscribe()
    }
  }

  const reset = (): void => {
    setStage('setup')
    setPaths([])
    setPreview(null)
    setResult(null)
    setProgress(null)
    setError('')
  }

  if (stage === 'done' && result) {
    return (
      <>
        <h3 className="font-display text-[15px] font-semibold text-ink-900">
          {result.cancelled ? 'Import stopped' : 'Import complete'}
        </h3>
        <p className="mt-2 text-[13px] text-ink-600">
          {result.createdNotes} note{result.createdNotes === 1 ? '' : 's'} created in{' '}
          <span className="font-medium text-ink-800">{result.spaceFolder}</span>, now open in the
          sidebar behind this window.
        </p>
        {(result.skipped.length > 0 || result.lossy.length > 0) && (
          <p className="mt-1 text-[12px] text-ink-500">
            {result.skipped.length} skipped, {result.lossy.length} imported with some loss — see
            the Import Report note in that space for details.
          </p>
        )}
        <div className="mt-4 flex items-center gap-2">
          <button className="mini" onClick={onClose}>
            Show me the notes
          </button>
          <button className="mini" onClick={reset}>
            Import something else
          </button>
        </div>
      </>
    )
  }

  if (stage === 'running') {
    const pct = progress && progress.total > 0 ? Math.min(100, (progress.current / progress.total) * 100) : 0
    return (
      <>
        <h3 className="font-display text-[15px] font-semibold text-ink-900">Importing…</h3>
        <p className="mt-2 truncate text-[13px] text-ink-600">{progress?.label ?? 'Working…'}</p>
        {progress && progress.total > 0 && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-500/12">
            <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        )}
        <button
          className="mini mt-4"
          disabled={stopping}
          onClick={() => {
            setStopping(true)
            void window.api.importCancel()
          }}
        >
          {stopping ? 'Stopping…' : 'Stop import'}
        </button>
        <p className="mt-2 text-[11.5px] text-ink-400">
          Stopping keeps whatever has already come across, in its own space, for you to keep or
          delete.
        </p>
      </>
    )
  }

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Import data</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Bring notes in from another app as plain Markdown.</p>

      <SettingRow title="File format" desc={current.hint}>
        <Select
          value={format}
          options={formats.map((f) => ({ id: f.id, label: f.label }))}
          onChange={chooseFormat}
        />
      </SettingRow>
      {current.helpUrl && (
        <p className="-mt-2 text-[11.5px]">
          <button
            className="text-brand-600 underline-offset-2 hover:underline"
            onClick={() => void window.api.openExternal(current.helpUrl!)}
          >
            Learn more about exporting from {current.label}
          </button>
        </p>
      )}
      <div className="border-t border-ink-300/15" />

      <div className="flex items-center gap-3 py-3.5">
        <button className="mini shrink-0" disabled={picking} onClick={() => void pick()}>
          {current.pickLabel}
        </button>
        <span className="min-w-0 truncate text-[12px] text-ink-500">
          {picking
            ? current.noSourcePicker
              ? 'Reading your notes…'
              : 'Unpacking and scanning… a large export can take a few minutes.'
            : paths.length === 0
              ? current.noSourcePicker
                ? 'Reads the Notes app on this Mac'
                : 'Nothing chosen yet'
              : current.noSourcePicker
                ? 'Ready to import'
                : format === 'notion'
                  ? paths[0]
                  : `${paths.length} file${paths.length === 1 ? '' : 's'} chosen`}
        </span>
      </div>

      {preview && (
        <div className="rounded-xl bg-brand-500/8 px-3 py-2.5 text-[12px] leading-relaxed text-ink-600 ring-1 ring-brand-300/40">
          <p>
            {preview.noteCount} note{preview.noteCount === 1 ? '' : 's'}
            {preview.folderCount > 0
              ? `, ${preview.folderCount} folder${preview.folderCount === 1 ? '' : 's'}`
              : ''}{' '}
            will be created.
          </p>
          {preview.notes.map((n) => (
            <p key={n} className="mt-1">
              {n}
            </p>
          ))}
        </div>
      )}

      {/* Warnings are a separate, louder box from `notes`: `notes` explain what
          the import will do, warnings say something may not be what you want
          (most often "you've imported this already"). Same tone as the amber
          highlight rather than the brand tint, so it reads as a caution. */}
      {preview?.warnings.map((w) => (
        <div
          key={w}
          className="import-warning rounded-xl px-3 py-2.5 text-[12px] leading-relaxed text-ink-700"
        >
          {w}
        </div>
      ))}

      <div className="border-t border-ink-300/15" />
      <SettingRow title="Output folder" desc="Created as a new space in your vault — never merged into existing notes.">
        <input
          value={spaceName}
          onChange={(e) => setSpaceName(e.target.value)}
          className="w-48 rounded-lg border border-ink-300/30 bg-surface/70 px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        />
      </SettingRow>

      {error && <p className="text-[12px] text-red-500">{error}</p>}

      <button className="mini mt-2 self-start" disabled={paths.length === 0} onClick={() => void run()}>
        Import
      </button>
    </>
  )
}
