import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from '../icons'
import type { InstalledFont } from '../../../shared/fonts'
import { prepareNote, previewDoc, readLook, saveNote, usesLetter, type PreparedNote, type PrintMode, type SaveFormat } from './page'

// Save as… / Print… for a note (Reuben, 2026-11-03: "a notealise menu to choose
// what and how you want to save it, and what format ... make it a really nice
// interface"). One window: the page itself on the left, drawn from the note as it
// will be saved; the choices on the right; Save… opens the computer's own save
// box. Print… opens the same window without the format choice.
//
// The preview IS the page — the same body and stylesheet main saves or prints
// (print/page.ts), in a frame that runs nothing (`sandbox` without
// allow-scripts). It shares the app's origin only so the app's own font files
// load in it.
//
// In the confirm window's frame (`.confirm-backdrop`) and `aria-modal`, so the
// app's shortcuts don't act on the notes behind it.

export type SaveAsMode = 'save' | 'print'

interface Props {
  path: string
  mode: SaveAsMode
  /** the note's text — the open copy if it has one */
  readText: () => Promise<string>
  /** the choices last used, so the window opens on them */
  format: 'pdf' | 'html'
  look: PrintMode
  onChoose: (format: 'pdf' | 'html', look: PrintMode) => void
  /** saved or sent to the printer: the window closes and App says where it went */
  onDone: (result: { saved: string } | { printed: true }) => void
  onClose: () => void
}

/** Width of the sheet the preview lays out at, in CSS pixels: A4 or Letter for
 *  paper, a browser window's reading width for a web page. */
const SHEET_PX = { a4: 794, letter: 816, web: 920 }

function Choice({
  on,
  onPick,
  icon,
  title,
  line
}: {
  on: boolean
  onPick: () => void
  icon: IconName
  title: string
  line: string
}): React.JSX.Element {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onPick} className={'saveas-choice' + (on ? ' on' : '')}>
      <span className="saveas-choice-icon" aria-hidden="true">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="saveas-choice-title">{title}</span>
        <span className="saveas-choice-line">{line}</span>
      </span>
      <span className="saveas-radio" aria-hidden="true" />
    </button>
  )
}

export function SaveAs({ path, mode, readText, format: format0, look: look0, onChoose, onDone, onClose }: Props): React.JSX.Element {
  const [note, setNote] = useState<PreparedNote | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [format, setFormat] = useState<'pdf' | 'html'>(format0)
  const [look, setLook] = useState<PrintMode>(look0)
  const [busy, setBusy] = useState(false)
  const [installed, setInstalled] = useState<InstalledFont[]>([])
  const shown: SaveFormat = mode === 'print' ? 'print' : format

  // Both looks are read once, as the window opens: reading one flips the page's
  // theme for an instant (page.ts `readLight`), which must not happen while you
  // click between them.
  const looks = useMemo(() => ({ plain: readLook('plain'), look: readLook('look') }), [])

  useEffect(() => {
    let live = true
    readText()
      .then((text) => prepareNote(text, path))
      .then((n) => live && setNote(n))
      .catch(() => live && setFailed('This note could not be read.'))
    window.api
      .listInstalledFonts()
      .then((f) => live && setInstalled(f))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [path, readText])

  // The sheet is laid out at its real width and scaled down to fit the well, so
  // the preview wraps lines exactly where the saved page will.
  const well = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = well.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const sheetPx = shown === 'html' ? SHEET_PX.web : usesLetter() ? SHEET_PX.letter : SHEET_PX.a4
  const pad = shown === 'html' ? 0 : 24
  const scale = box.w ? Math.min(1, (box.w - pad * 2) / sheetPx) : 0.5
  const srcDoc = useMemo(
    () => (note ? previewDoc(note, looks[look], shown, installed) : ''),
    [note, looks, look, shown, installed]
  )

  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    boxRef.current?.focus()
  }, [])
  const before = useRef<Element | null>(document.activeElement)
  const close = (): void => {
    const el = before.current
    onClose()
    if (el instanceof HTMLElement && el.isConnected) requestAnimationFrame(() => el.focus())
  }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const go = async (): Promise<void> => {
    if (!note || busy) return
    setBusy(true)
    setFailed(null)
    onChoose(format, look)
    try {
      const res = await saveNote(note, looks[look], shown)
      if (res.ok === 'saved') onDone({ saved: res.path })
      else if (res.ok === 'printed') onDone({ printed: true })
      else if (res.ok === 'failed') {
        setFailed(mode === 'print' ? 'It could not be printed. Nothing was sent.' : `It could not be saved. ${res.reason}`)
      }
      // cancelled in the computer's own box: stay open, as you left it
    } catch {
      setFailed(mode === 'print' ? 'It could not be printed. Nothing was sent.' : 'It could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const action = mode === 'print' ? 'Print…' : 'Save…'
  return (
    <div className="confirm-backdrop" onClick={close}>
      <div
        className="saveas"
        role="dialog"
        aria-modal="true"
        aria-label={`${mode === 'print' ? 'Print' : 'Save'} ${note?.title ?? ''}`}
        ref={boxRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault()
            void go()
          }
        }}
      >
        <div ref={well} className={'saveas-well' + (shown === 'html' ? ' web' : '')} aria-label="Preview">
          {note && (
            <div
              className="saveas-sheet"
              style={{ width: sheetPx * scale, height: shown === 'html' ? box.h : box.h - pad }}
            >
              <iframe
                title="Preview"
                sandbox="allow-same-origin"
                srcDoc={srcDoc}
                tabIndex={-1}
                style={{
                  width: sheetPx,
                  height: (shown === 'html' ? box.h : box.h - pad) / scale,
                  transform: `scale(${scale})`
                }}
              />
            </div>
          )}
          {note && shown !== 'html' && <p className="saveas-caption">{usesLetter() ? 'US Letter page' : 'A4 page'}</p>}
          {!note && !failed && <p className="saveas-wait">Making the page…</p>}
        </div>

        <div className="saveas-side">
          <header className="saveas-head">
            <div className="min-w-0">
              <div className="prompt-title mb-0">{mode === 'print' ? 'Print' : 'Save as'}</div>
              <div className="truncate text-[12.5px] text-ink-500">{note?.title ?? ' '}</div>
            </div>
            <button className="saveas-x" aria-label="Close" data-tip="Close" onClick={close}>
              <Icon name="x" className="h-4 w-4" />
            </button>
          </header>

          <div className="saveas-choices">
            {mode === 'save' && (
              <div role="radiogroup" aria-label="Format">
                <p className="saveas-label">Format</p>
                <Choice
                  on={format === 'pdf'}
                  onPick={() => setFormat('pdf')}
                  icon="doc"
                  title="PDF"
                  line="A fixed page, ready to hand in, email or print."
                />
                <Choice
                  on={format === 'html'}
                  onPick={() => setFormat('html')}
                  icon="globe"
                  title="Web page"
                  line="One HTML file that opens in any browser."
                />
              </div>
            )}
            <div role="radiogroup" aria-label="Page">
              <p className="saveas-label">Page</p>
              <Choice
                on={look === 'plain'}
                onPick={() => setLook('plain')}
                icon="text"
                title="Plain page"
                line="Black on white, in a plain font. Best for handing in."
              />
              <Choice
                on={look === 'look'}
                onPick={() => setLook('look')}
                icon="sliders"
                title="Keep my look"
                line="This space's fonts and colours, on white paper."
              />
            </div>
            {note?.hasStandIns && (
              <p className="saveas-aside">Voice notes and videos can't go on a page, so each one shows as a label with its name.</p>
            )}
          </div>

          <footer className="saveas-foot">
            {failed && <p className="saveas-failed">{failed}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={close}>Cancel</button>
              <button className="primary" disabled={!note || busy} onClick={() => void go()}>
                <Icon name={mode === 'print' ? 'printer' : 'export'} className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
                {busy ? (mode === 'print' ? 'Printing…' : 'Saving…') : action}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}
