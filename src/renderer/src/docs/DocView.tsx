// What a document's tab shows (docs/plans/file-tabs.md): a PDF in Chromium's own
// reader, a Word file as a page, a spreadsheet or CSV as a table, a text file as
// text. Drawn inside the ordinary column (tabs/NotePane.tsx), so a document takes
// a tab, a split, a drag and a close exactly as a note does.
//
// It follows the space's look: everything but the PDF is drawn in the app's own
// colours and note fonts, so it changes with the theme like a note does. A PDF's
// pages are white paper by design; in a dark space they are shown dimmed and
// inverted (the corner button turns that off, for a PDF full of photos).
//
// Text and CSV files can be edited, and every change is saved back into the file
// where it is, a moment after typing stops — the same wait and the same atomic
// write a note gets (main/vault.ts `writeTextDoc`). Word, Excel and PDF files are
// shown, never written.

import { useEffect, useMemo, useRef, useState } from 'react'
import { COULD_NOT_SAVE, noteDocRead, owedDocView, useDarkTheme, useSaver } from './docEdits'
import DOMPurify from 'dompurify'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { csvText, docViewOf, SHEET_MAX_COLS, SHEET_MAX_ROWS, type DocResult, type SheetData } from '../../../shared/docs'
import { Icon } from '../icons'
import { userLocale } from '../intl'

// --- the tab ------------------------------------------------------------------------

interface Props {
  /** the document (vault-relative) */
  path: string
  /** bumped by App when the file changed outside the app */
  version: number
}

export function DocView({ path, version }: Props): React.JSX.Element {
  const view = docViewOf(path)
  if (view === 'pdf') return <PdfView path={path} version={version} />
  // Keyed by file: what's loaded and what's waiting to save belong to ONE file. Shared
  // across a switch, the next file showed this one's words and could be saved with them.
  return <ReadView key={path} path={path} version={version} />
}

/** The quiet message in the middle of an empty tab. */
function Middle({ title, line }: { title: string; line?: string }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <p className="font-display text-xl text-ink-700">{title}</p>
        {line && <p className="mt-1 text-sm text-ink-500">{line}</p>}
      </div>
    </div>
  )
}

/** PDFs shown with dark pages, by file, for as long as the app is open. */
const pdfOriginal = new Set<string>()

function PdfView({ path, version }: Props): React.JSX.Element {
  const dark = useDarkTheme()
  const [src, setSrc] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [original, setOriginal] = useState(() => pdfOriginal.has(path))
  useEffect(() => {
    let live = true
    setGone(false)
    window.api.mediaUrl(path).then(
      // The address changes with the file (its `v`), so a PDF changed outside the
      // app is read again rather than shown from memory.
      // `navpanes=0`: the page thumbnails start folded away (the ☰ button opens
      // them) — more room in a split column, and in a dark space less of the reader's
      // own grey around the darkened pages.
      (u) => live && setSrc(`${u}#navpanes=0`),
      () => live && setGone(true)
    )
    setOriginal(pdfOriginal.has(path))
    return () => {
      live = false
    }
  }, [path, version])
  if (gone) return <Middle title="This file isn’t there any more" line="It may have been moved, renamed or deleted." />
  const dim = dark && !original
  return (
    <div className="absolute inset-0">
      {src && (
        <iframe
          // keyed by address, so a new version is a new frame, not a frame told to navigate
          key={src}
          src={src}
          title={path.slice(path.lastIndexOf('/') + 1)}
          className="doc-pdf h-full w-full border-0"
          data-dim={dim ? '' : undefined}
        />
      )}
      {dark && (
        <button
          className={
            'btn-edge absolute bottom-3 right-5 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-ink-300/30 p-0 shadow-card outline-none backdrop-blur transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
            (dim ? 'bg-surface/90 text-ink-500 hover:text-ink-900' : 'bg-brand-500/15 text-brand-600')
          }
          aria-pressed={!dim}
          data-tip={dim ? 'Show the pages in their own colours' : 'Show the pages darkened, to match this space'}
          aria-label={dim ? 'Show the pages in their own colours' : 'Show the pages darkened'}
          onClick={() => {
            if (dim) pdfOriginal.add(path)
            else pdfOriginal.delete(path)
            setOriginal(!original)
          }}
        >
          <Icon name="sun" className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Word, spreadsheet, CSV and text: read through main (main/docView.ts). */
function ReadView({ path, version }: Props): React.JSX.Element {
  // A change the computer refused comes back with the file, rather than the older
  // words on disk being shown as if it had never been made.
  const [doc, setDoc] = useState<DocResult | null>(() => owedDocView(path))
  const [error, setError] = useState<string | null>(() => (owedDocView(path) ? COULD_NOT_SAVE : null))
  const saver = useSaver(path, setError)
  useEffect(() => {
    let live = true
    // A change made here is never read back over the top of itself: the app's own
    // saves are not announced as outside changes, and while one is waiting the
    // tab keeps what is typed.
    if (saver.dirty.current && doc) return
    window.api.readDocument(path).then((d) => {
      if (!live) return
      noteDocRead(path, d)
      setDoc(d)
    })
    return () => {
      live = false
    }
    // Re-read only when the file is another one or changed outside — never because
    // this tab's own copy changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version])
  if (!doc) return <div className="absolute inset-0" />
  if (doc.kind === 'error') {
    return doc.reason === 'big' ? (
      <Middle title="This file is too big to show here" line="Open it in its own app with the button at the top." />
    ) : doc.reason === 'gone' ? (
      <Middle title="This file isn’t there any more" line="It may have been moved, renamed or deleted." />
    ) : (
      <Middle title="This file can’t be shown here" line="It may be damaged, or saved in a way this app can’t read. Open it in its own app with the button at the top." />
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col">
      {error && (
        <div className="shrink-0 border-b border-ink-300/20 bg-surface/30 px-3 py-1.5 text-[12px] text-ink-700" role="alert">
          {error}
        </div>
      )}
      {doc.kind === 'word' ? (
        <WordPage html={doc.html} />
      ) : doc.kind === 'text' ? (
        <TextFile
          key={path}
          text={doc.text}
          loaded={doc}
          cut={doc.cut}
          editable={doc.editable}
          onEdit={(text) => saver.queue(text, { ...doc, text })}
        />
      ) : (
        <Sheets
          key={path}
          sheets={doc.sheets}
          onEdit={
            doc.editable && doc.csv
              ? (rows) => saver.queue(csvText(rows, doc.csv!), { ...doc, sheets: [{ ...doc.sheets[0], rows }] })
              : undefined
          }
          readOnlyWhy={doc.csv && !doc.editable ? 'csv' : undefined}
        />
      )}
    </div>
  )
}

// --- Word -----------------------------------------------------------------------------

function WordPage({ html }: { html: string }): React.JSX.Element {
  // The HTML comes from a file someone else may have written: cleaned before it is
  // drawn — no script, no styles of its own (it takes the space's), no forms, no
  // frames. Pictures stay, as data: addresses.
  const clean = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'svg', 'math'],
        FORBID_ATTR: ['style', 'class']
      }),
    [html]
  )
  return (
    <div
      className="doc-scroll min-h-0 flex-1 overflow-auto"
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        const href = a.getAttribute('href') ?? ''
        if (href.startsWith('#')) {
          // A footnote or a bookmark inside the document.
          const to = e.currentTarget.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
          to?.scrollIntoView({ block: 'center' })
        } else if (/^(https?:|mailto:)/i.test(href)) void window.api.openExternal(href)
      }}
    >
      {clean.trim() ? (
        <article className="prose-note doc-word" dangerouslySetInnerHTML={{ __html: clean }} />
      ) : (
        <Middle title="This document is empty" />
      )}
    </div>
  )
}

// --- spreadsheets and CSV ---------------------------------------------------------------

/** "A".."Z", "AA".. — a column's name. */
function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

const fmt = (n: number): string => new Intl.NumberFormat(userLocale).format(n)

function Sheets({
  sheets,
  onEdit,
  readOnlyWhy
}: {
  sheets: SheetData[]
  onEdit?: (rows: string[][]) => void
  readOnlyWhy?: 'csv'
}): React.JSX.Element {
  const [at, setAt] = useState(0)
  const [rows, setRows] = useState(sheets[0]?.rows ?? [])
  // Outside changes come in as new `sheets`; take them (editing is held off while
  // a save waits — ReadView).
  useEffect(() => setRows(sheets[Math.min(at, sheets.length - 1)]?.rows ?? []), [sheets, at])
  const sheet = sheets[Math.min(at, sheets.length - 1)]
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null)

  const commit = (r: number, c: number, value: string): void => {
    setEditing(null)
    if ((rows[r]?.[c] ?? '') === value) return
    const next = rows.map((row) => row.slice())
    while (next.length <= r) next.push([])
    while (next[r].length < c) next[r].push('')
    next[r][c] = value
    setRows(next)
    onEdit?.(next)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(sheet?.cut || readOnlyWhy) && (
        <div className="shrink-0 border-b border-ink-300/20 bg-surface/30 px-3 py-1.5 text-[12px] text-ink-500" role="status">
          {sheet?.cut
            ? `Showing the first ${fmt(SHEET_MAX_ROWS)} rows and ${fmt(SHEET_MAX_COLS)} columns. Open it in its own app for the rest${onEdit === undefined && readOnlyWhy ? ' — or to change it' : ''}.`
            : 'This file can’t be changed here — it isn’t saved as plain UTF-8 text. Open it in its own app to change it.'}
        </div>
      )}
      <div className="doc-scroll min-h-0 flex-1 overflow-auto">
        <table className="doc-sheet">
          <thead>
            <tr>
              <th className="doc-corner" />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} scope="col">
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <th scope="row">{r + 1}</th>
                {Array.from({ length: cols }, (_, c) => {
                  const v = row[c] ?? ''
                  const on = editing?.r === r && editing.c === c
                  return (
                    <td
                      key={c}
                      className={(/^-?[\d.,]+%?$/.test(v) ? 'num ' : '') + (onEdit ? 'can-edit' : '')}
                      onDoubleClick={onEdit ? () => setEditing({ r, c }) : undefined}
                      onClick={onEdit ? () => setEditing({ r, c }) : undefined}
                    >
                      {on ? (
                        <input
                          autoFocus
                          defaultValue={v}
                          onBlur={(e) => commit(r, c, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Tab') {
                              e.preventDefault()
                              commit(r, c, e.currentTarget.value)
                              // Enter goes down, Tab across — as in a spreadsheet.
                              const next = e.key === 'Enter' ? { r: r + 1, c } : { r, c: c + 1 }
                              if (next.c < cols || e.key === 'Enter') setEditing(next)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              setEditing(null)
                            }
                          }}
                        />
                      ) : (
                        v
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
            {onEdit && (
              // Room to add a row: the empty row under the last one takes typing.
              <tr className="doc-new-row">
                <th scope="row">{rows.length + 1}</th>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="can-edit" onClick={() => setEditing({ r: rows.length, c })}>
                    {editing?.r === rows.length && editing.c === c ? (
                      <input
                        autoFocus
                        defaultValue=""
                        onBlur={(e) => commit(rows.length, c, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commit(rows.length, c, e.currentTarget.value)
                          } else if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                    ) : null}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sheets.length > 1 && (
        <div className="doc-sheet-tabs flex shrink-0 gap-1 overflow-x-auto border-t border-ink-300/20 bg-surface/40 px-2 py-1.5" role="tablist">
          {sheets.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === at}
              className={
                'shrink-0 rounded-control border-none px-2.5 py-1 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                (i === at ? 'bg-ink-300/20 font-medium text-ink-900' : 'bg-transparent text-ink-500 hover:text-ink-900')
              }
              onClick={() => {
                setEditing(null)
                setAt(i)
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- text -------------------------------------------------------------------------------

/** Marks text that came FROM the file, so it is never saved back to it. Only what
 *  someone typed is an edit: saving a reload rewrote a file nobody had touched, and
 *  cut a too-long one down to the part the tab shows. */
const fromFile = Annotation.define<boolean>()

function TextFile({
  text,
  loaded,
  cut,
  editable,
  onEdit
}: {
  text: string
  /** the read this text came from: a new one is compared with the tab even when
   *  its words are the same as the last read's (another app put them back) */
  loaded: unknown
  cut: boolean
  editable: boolean
  onEdit: (text: string) => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onEditRef = useRef(onEdit)
  onEditRef.current = onEdit
  useEffect(() => {
    if (!host.current) return
    // A plain CodeMirror: the app's editor (rule 3) without any of the Markdown —
    // a text file is shown exactly as its characters are.
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          EditorView.updateListener.of((u) => {
            if (editable && u.transactions.some((t) => t.docChanged && !t.annotation(fromFile))) {
              onEditRef.current(u.state.doc.toString())
            }
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Text file', spellcheck: 'false' })
        ]
      })
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Made once per file (and again if it stops or starts being editable); new text
    // from outside goes in by the effect below, keeping the place and the undo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])
  // A change made outside (another app saved it): take the new text in place.
  useEffect(() => {
    const v = viewRef.current
    if (v && v.state.doc.toString() !== text) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: fromFile.of(true) })
    }
  }, [text, loaded])
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(cut || !editable) && (
        <div className="shrink-0 border-b border-ink-300/20 bg-surface/30 px-3 py-1.5 text-[12px] text-ink-500" role="status">
          {cut
            ? 'Showing the start of this file — it is too long to show whole. Open it in its own app for the rest, or to change it.'
            : 'This file can’t be changed here — it isn’t saved as plain UTF-8 text. Open it in its own app to change it.'}
        </div>
      )}
      <div className="doc-scroll doc-text min-h-0 flex-1 overflow-auto" ref={host} />
    </div>
  )
}
