import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../icons'
import type { TransferImportResult, TransferInventory } from '../../../shared/transfer'

// Settings → Transfer data. Moving the app's OWN state between machines — as
// distinct from the notes, which are the user's files and were never the app's
// to move. See shared/transfer.ts and main/transfer.ts.
//
// The whole reason this page exists: almost everything a person tunes (theme,
// colours, fonts, spaces, arranging, the bin) lives in <vault>/.mdnotes/ and
// travels with the folder already. A few things don't — the saved-preset
// library, custom fonts, the downloaded-font cache, the update channel — and
// this is where those cross a gap the folder doesn't bridge: an app-cleaner
// that wiped this Mac, a new machine, or a switch between Mac and Windows.

interface Props {
  /** run after an import lands, so the rest of Settings re-reads the preset
   *  library and the installed-font list (both of which this page just changed
   *  behind their backs) */
  onImported?: () => void
}

const ZERO: TransferInventory = {
  presets: 0,
  customFonts: 0,
  downloadedFonts: 0,
  autoUpdate: false,
  betaChannel: false
}

type Notice =
  | { kind: 'exported'; file: string; presets: number; fonts: number }
  | { kind: 'imported'; result: TransferImportResult }
  | { kind: 'error'; message: string }
  | null

export function TransferData({ onImported }: Props): React.JSX.Element {
  const [inv, setInv] = useState<TransferInventory>(ZERO)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [dropping, setDropping] = useState(false)
  // The update channel the imported file carried, offered as an explicit apply —
  // a single toggle can't be "added as a copy" the way a preset can, so import
  // never changes it silently. Cleared once applied or dismissed.
  const [pendingChannel, setPendingChannel] = useState<{ autoUpdate: boolean; betaChannel: boolean } | null>(null)
  const [channelApplied, setChannelApplied] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setInv(await window.api.transferInventory())
    } catch {
      /* a failed count is not worth a visible error — the buttons still work */
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runExport = useCallback(async () => {
    setBusy('export')
    setNotice(null)
    try {
      const res = await window.api.exportTransfer()
      if (res) {
        setNotice({
          kind: 'exported',
          file: res.path.split(/[\\/]/).pop() ?? res.path,
          presets: res.summary.presets,
          fonts: res.summary.customFonts
        })
      }
    } catch (e) {
      setNotice({ kind: 'error', message: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }, [])

  const runImport = useCallback(
    async (text?: string) => {
      setBusy('import')
      setNotice(null)
      setChannelApplied(false)
      try {
        const result = await window.api.importTransfer(text)
        if (result.cancelled) return
        setNotice({ kind: 'imported', result })
        if (!result.invalid) {
          setPendingChannel(result.updatePrefs)
          onImported?.()
          void refresh()
        }
      } catch (e) {
        setNotice({ kind: 'error', message: (e as Error).message })
      } finally {
        setBusy(null)
      }
    },
    [onImported, refresh]
  )

  const applyChannel = useCallback(async () => {
    if (!pendingChannel) return
    try {
      await window.api.setAutoUpdate(pendingChannel.autoUpdate)
      await window.api.setBetaChannel(pendingChannel.betaChannel)
      setChannelApplied(true)
      void refresh()
    } catch (e) {
      setNotice({ kind: 'error', message: (e as Error).message })
    }
  }, [pendingChannel, refresh])

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Transfer data</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Your notes are ordinary files in your vault folder — no uninstaller, app-cleaner or new
        computer can touch them, and moving that folder is all it takes to bring them with you.
        Most of how the app looks travels the same way: theme, colours, fonts, spaces, arranging
        and the bin all live in a hidden <code className="font-mono text-ink-700">.mdnotes</code>{' '}
        folder inside the vault. This page is for the few things that don&rsquo;t.
      </p>

      <div className="mt-3 rounded-xl px-3.5 py-3 ring-1 ring-ink-300/20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400">
          Lives only on this computer
        </p>
        <ul className="mt-1.5 flex flex-col gap-1 text-[12px] leading-relaxed text-ink-600">
          <li>· Your saved space presets — kept in the app so they outlast any one vault</li>
          <li>· Fonts you added yourself from a file on your machine</li>
          <li>· Which catalogue fonts have been downloaded</li>
          <li>· The update channel (automatic updates, and test builds)</li>
        </ul>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
          Clear this app&rsquo;s data with a cleanup tool, or move to another computer, and these
          don&rsquo;t come across on their own — the folder doesn&rsquo;t carry them. A transfer
          file does.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-brand-500/6 px-3.5 py-2.5 text-[11.5px] text-ink-500 ring-1 ring-brand-300/30">
        <span className="font-medium text-ink-600">On this computer now</span>
        <span>{inv.presets} {inv.presets === 1 ? 'preset' : 'presets'}</span>
        <span>{inv.customFonts} custom {inv.customFonts === 1 ? 'font' : 'fonts'}</span>
        <span>{inv.downloadedFonts} downloaded {inv.downloadedFonts === 1 ? 'font' : 'fonts'}</span>
        <span>Updates: {inv.betaChannel ? 'test builds' : 'stable'}{inv.autoUpdate ? ', automatic' : ''}</span>
      </div>

      <h3 className="mt-7 font-display text-[15px] font-semibold text-ink-900">
        Move to another computer
      </h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Save a transfer file on this computer, move it across however you like, then open it in the
        app on the other one. It carries the four things above, plus a copy of the current
        vault&rsquo;s space looks so a brand-new vault can be set to match. Nothing you already have
        is overwritten — presets and fonts are added alongside, never replaced. This works between
        Mac and Windows in either direction.
      </p>

      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDropping(true)
          }
        }}
        onDragLeave={(e) => {
          // Only when the pointer actually leaves the box — not on every hop
          // onto a child button, which also fires dragleave and would flicker
          // the highlight off and on.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={(e) => {
          setDropping(false)
          const file = e.dataTransfer.files[0]
          if (!file || busy) return
          e.preventDefault()
          void file.text().then((text) => runImport(text))
        }}
        className={
          'mt-3 flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-center transition-colors duration-150 ' +
          (dropping ? 'border-brand-400 bg-brand-500/10' : 'border-ink-300/35')
        }
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => void runExport()}
            disabled={busy !== null}
            className="btn-edge flex items-center gap-2 rounded-lg border border-ink-300/35 bg-surface/70 px-3 py-2 text-[13px] font-medium text-ink-700 outline-none transition duration-200 hover:border-brand-300 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-50"
          >
            <Icon name="export" className="h-4 w-4" />
            {busy === 'export' ? 'Saving…' : 'Save a transfer file'}
          </button>
          <button
            onClick={() => void runImport()}
            disabled={busy !== null}
            className="btn-edge flex items-center gap-2 rounded-lg border border-ink-300/35 bg-surface/70 px-3 py-2 text-[13px] font-medium text-ink-700 outline-none transition duration-200 hover:border-brand-300 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 disabled:opacity-50"
          >
            <Icon name="import" className="h-4 w-4" />
            {busy === 'import' ? 'Opening…' : 'Open a transfer file'}
          </button>
        </div>
        <p className="text-[11px] text-ink-400">or drop a transfer file here</p>
      </div>

      {notice && (
        <div className="mt-3 rounded-xl px-3.5 py-3 text-[12px] leading-relaxed ring-1 ring-ink-300/20">
          {notice.kind === 'error' && (
            <p className="text-[#e5484d]">Couldn&rsquo;t finish: {notice.message}</p>
          )}
          {notice.kind === 'exported' && (
            <p className="text-ink-600">
              Saved <span className="font-medium text-ink-800">{notice.file}</span> — {notice.presets}{' '}
              {notice.presets === 1 ? 'space look' : 'space looks'}
              {notice.fonts > 0 ? ` and ${notice.fonts} custom ${notice.fonts === 1 ? 'font' : 'fonts'}` : ''}.
              Open it in the app on the other computer.
            </p>
          )}
          {notice.kind === 'imported' && <ImportedSummary result={notice.result} />}

          {notice.kind === 'imported' &&
            !notice.result.invalid &&
            pendingChannel &&
            // Show while the file's channel differs from this machine's — and
            // keep showing once applied, so the "Applied" state doesn't vanish
            // the instant the refreshed inventory matches.
            (channelApplied ||
              pendingChannel.autoUpdate !== inv.autoUpdate ||
              pendingChannel.betaChannel !== inv.betaChannel) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-ink-300/15 pt-2.5">
                <span className="flex-1 text-[11.5px] text-ink-500">
                  That file&rsquo;s update setting:{' '}
                  <span className="font-medium text-ink-700">
                    {pendingChannel.betaChannel ? 'test builds' : 'stable'}
                    {pendingChannel.autoUpdate ? ', automatic' : ''}
                  </span>
                  . It hasn&rsquo;t been applied.
                </span>
                {channelApplied ? (
                  <span className="flex items-center gap-1 text-[11.5px] font-medium text-brand-600">
                    <Icon name="check" className="h-3.5 w-3.5" /> Applied
                  </span>
                ) : (
                  <button className="mini shrink-0" onClick={() => void applyChannel()}>
                    Apply it
                  </button>
                )}
              </div>
            )}
        </div>
      )}

      <p className="mt-6 text-[11.5px] leading-relaxed text-ink-400">
        There&rsquo;s a note called <span className="italic">Used Notealise before?</span> in your
        welcome notes with the same steps, for when the app is already open on the other computer.
      </p>
    </>
  )
}

function ImportedSummary({ result }: { result: TransferImportResult }): React.JSX.Element {
  if (result.invalid) {
    return (
      <p className="text-ink-600">
        That doesn&rsquo;t look like a Notealise transfer file. Open the one saved from{' '}
        <span className="font-medium">Save a transfer file</span> on your other computer.
      </p>
    )
  }

  const bits: string[] = []
  if (result.presetsAdded > 0) {
    bits.push(`${result.presetsAdded} ${result.presetsAdded === 1 ? 'space look' : 'space looks'}`)
  }
  if (result.customFontsAdded > 0) {
    bits.push(`${result.customFontsAdded} custom ${result.customFontsAdded === 1 ? 'font' : 'fonts'}`)
  }
  if (result.downloadedFontsFetched > 0) {
    bits.push(
      `re-downloaded ${result.downloadedFontsFetched} ${
        result.downloadedFontsFetched === 1 ? 'font' : 'fonts'
      }`
    )
  }

  return (
    <>
      <p className="text-ink-600">
        {bits.length > 0
          ? `Added ${bits.join(', ')}.`
          : result.presetsLibraryFull
            ? 'Nothing added.'
            : 'Nothing new to add — this computer already has everything in that file.'}
      </p>
      {result.presetsLibraryFull && (
        <p className="mt-1 text-[11.5px] text-ink-400">
          Your saved-preset library is full (60). Delete some in Spaces &rsaquo; Saved presets, then
          import again to bring the rest across.
        </p>
      )}
      {result.downloadedFontsFailed > 0 && (
        <p className="mt-1 text-[11.5px] text-ink-400">
          {result.downloadedFontsFailed}{' '}
          {result.downloadedFontsFailed === 1 ? 'font' : 'fonts'} couldn&rsquo;t be re-downloaded —
          check the connection, or get {result.downloadedFontsFailed === 1 ? 'it' : 'them'} from Your
          collection later.
        </p>
      )}
    </>
  )
}
