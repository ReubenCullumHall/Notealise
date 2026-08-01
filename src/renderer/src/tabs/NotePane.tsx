import { useEffect, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from '../editor'
import { FormatToolbar } from '../editor/FormatToolbar'
import { Icon } from '../icons'
import { formatNumber } from '../intl'
import type { AppSettings } from '../../../shared/settings'

/** Where a dragged tab or column would land in this pane. */
export type DropZone = 'left' | 'center' | 'right'

/** What is being dragged. A tab comes from the strip and may not be open yet; a
 *  column is already on screen and carries the index it came from, which is what
 *  lets a drop reorder the panes instead of opening anything. */
export interface Drag {
  kind: 'tab' | 'pane'
  path: string
  from?: number
}

interface Props {
  /** the note this pane shows (vault-relative) */
  path: string
  doc: string
  /** bumped by App on load / external change — never on typing */
  version: number
  wordCount: number
  numberFormat: AppSettings['numberFormat']
  /** the pane the keyboard acts on */
  focused: boolean
  /** true while more than one pane is on screen */
  split: boolean
  /** the active space's four custom format-bar buttons (AppSettings.toolbarSlots) */
  slots: string[]
  onSetSlot: (index: number, id: string) => void
  onFocus: () => void
  onDocChange: (text: string) => void
  /** commit an edited title; resolves to the name the file actually got */
  onRename: (title: string) => Promise<string | null>
  /** open an empty column beside this one, for a note to be picked into */
  onSplit: () => void
  /** false at the column cap — the only thing that can stop a new column now */
  canSplit: boolean
  onClosePane: () => void
  /** what is being dragged right now, or null */
  dragging: Drag | null
  /** start dragging THIS column (only offered in a split — one column has no
   *  order to rearrange) */
  onDragPane: () => void
  onDragEnd: () => void
  /** whether the left/right zones are offered for the drag in progress: a
   *  column being rearranged always may, a tab needs room for a new column */
  edgeDrops: boolean
  onDropTab: (zone: DropZone) => void
}

const nameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
const stripMd = (s: string): string => (s.toLowerCase().endsWith('.md') ? s.slice(0, -3) : s)

// One shell for both the live row and App's placeholder, so the two can't drift
// in height — the whole point of keeping the row on screen when nothing is open
// is that opening a note doesn't shift the page.
// The transparent top border is not decoration: a split pane marks the focused
// column with an accent line there, and reserving those 2px in every state is
// what stops splitting nudging the text down.
export const ROW_CLASS =
  'flex shrink-0 items-center gap-2 border-b border-t-2 border-ink-300/25 border-t-transparent bg-surface/40 px-3 py-2 backdrop-blur'
// Icon buttons at the right-hand end (split, close pane). Quiet until hovered,
// like the sidebar's own collapse control, which is the pair this reads with.
export const ROW_BTN =
  'flex shrink-0 items-center justify-center rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300'

/** One column of the editor area: its title, its commands and its CodeMirror.
 *
 *  There is no Edit/Read toggle: the editor already renders as it goes — a
 *  heading is a heading until the cursor enters the line — so a reading *mode*
 *  was a second way to look at the same thing.
 *
 *  With `path === ''` this is the blank column the "+" button and the split
 *  button open: same chrome, inert, waiting for a note to be clicked. */
export function NotePane({
  path,
  doc,
  version,
  wordCount,
  numberFormat,
  focused,
  split,
  slots,
  onSetSlot,
  onFocus,
  onDocChange,
  onRename,
  onSplit,
  canSplit,
  onClosePane,
  dragging,
  onDragPane,
  onDragEnd,
  edgeDrops,
  onDropTab
}: Props): React.JSX.Element {
  // This pane's live CodeMirror, for its own format bar. Per pane, not per app:
  // each column's commands act on the column they sit in.
  const viewRef = useRef<EditorView | null>(null)
  // A tab opened with "+" has no note in it yet: same chrome, inert, with the
  // invitation where the editor goes. Clicking any note in the sidebar fills it
  // (a plain click replaces the focused tab, and this IS the focused tab).
  const blank = path === ''
  const [titleDraft, setTitleDraft] = useState(() => stripMd(nameOf(path)))
  const [zone, setZone] = useState<DropZone | null>(null)

  useEffect(() => {
    setTitleDraft(stripMd(nameOf(path)))
  }, [path])

  const commitTitle = (): void => {
    const next = titleDraft.trim()
    if (!next || next === stripMd(nameOf(path))) {
      setTitleDraft(stripMd(nameOf(path)))
      return
    }
    void onRename(next).then((actual) => setTitleDraft(actual ?? stripMd(nameOf(path))))
  }

  // Read straight off the event, never off `zone`: the drop must land where the
  // pointer is, and React state from the last dragover can be a frame behind.
  const zoneAt = (e: React.DragEvent): DropZone => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    return !edgeDrops ? 'center' : x < 0.28 ? 'left' : x > 0.72 ? 'right' : 'center'
  }

  const overZone = (e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setZone(zoneAt(e))
  }

  const zoneBox: Record<DropZone, string> = {
    left: 'inset-y-2 left-2 w-[calc(50%-0.5rem)]',
    right: 'inset-y-2 right-2 w-[calc(50%-0.5rem)]',
    center: 'inset-2'
  }

  return (
    <section
      className={
        'relative flex min-w-0 flex-1 flex-col ' +
        (split ? 'border-l border-ink-300/25 first:border-l-0 ' : '')
      }
      onMouseDownCapture={onFocus}
      onFocusCapture={onFocus}
      aria-label={blank ? 'Select a note' : stripMd(nameOf(path))}
    >
      <div
        // The row is the column's own drag handle. Guarded rather than wrapped
        // in a separate grip: at a third of the window there is no room for one,
        // and a drag that starts on the title or a button must stay theirs.
        draggable={split}
        onDragStart={(e) => {
          if ((e.target as HTMLElement).closest('input, button')) {
            e.preventDefault()
            return
          }
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('application/x-notes-pane', path)
          onDragPane()
        }}
        onDragEnd={onDragEnd}
        className={
          ROW_CLASS +
          (split ? ' cursor-grab active:cursor-grabbing' : '') +
          // In a split, the accent line is how you can see which column the
          // keyboard is pointing at. A single pane has nothing to distinguish
          // itself from, so it leaves the reserved line transparent.
          (split && focused ? ' border-t-brand-400/70' : '')
        }
      >
        {blank ? (
          <span
            className={
              'min-w-0 truncate font-display font-semibold text-ink-300 ' +
              (split ? 'w-[5.5rem] shrink-0 text-[15px] ' : 'flex-1 text-lg ')
            }
          >
            Select a note
          </span>
        ) : (
        <input
          className={
            'min-w-0 truncate bg-transparent font-display font-semibold text-ink-900 outline-none placeholder:text-ink-300 ' +
            // Which element is elastic flips with the width. Wide: the title
            // grows and the commands sit centred at their natural size. Narrow:
            // the title is fixed and the COMMANDS take what's left — leave the
            // title elastic there and its `flex-1` swallows the row, squeezing
            // the bar down to two buttons and a scrollbar.
            (split ? 'w-[5.5rem] shrink-0 text-[15px] ' : 'flex-1 text-lg ')
          }
          value={titleDraft}
          placeholder="Untitled"
          title={path}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              setTitleDraft(stripMd(nameOf(path)))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        )}

        <div className={blank ? 'pointer-events-none flex min-w-0 flex-1 opacity-40' : 'contents'}>
          <FormatToolbar viewRef={viewRef} slots={slots} onSetSlot={onSetSlot} compact={split} />
        </div>

        <div
          className={
            'flex items-center justify-end gap-1 ' +
            // Wide: a mirror of the title's flex-1, which is what keeps the
            // commands centred over the text column. Narrow: icons only, and
            // every pixel it doesn't take is one the title keeps.
            (split ? 'shrink-0' : 'min-w-0 flex-1')
          }
        >
          {/* The word count is the first thing to go when the column narrows —
              Tailwind's `sm:` is viewport-width, which says nothing about a
              third of the window, so the split decides it instead. */}
          {!split && !blank && (
            <span className="hidden shrink-0 whitespace-nowrap pr-1 text-xs text-ink-300 sm:block">
              {formatNumber(wordCount, numberFormat)} {wordCount === 1 ? 'word' : 'words'}
            </span>
          )}
          {/* Hidden rather than disabled at the cap: in a split the row is
              ~80px of commands wide, and a button that can do nothing is dead
              weight taking space Bold and Italic need. A blank column has
              nothing to split off in the first place. */}
          {!blank && canSplit && (
          <button
            className={ROW_BTN}
            title={'Open another column  (Cmd/Ctrl+\\)  ·  or drag a tab to the edge'}
            aria-label="Split the screen"
            onClick={onSplit}
          >
            <Icon name="splitView" className="h-4 w-4" />
          </button>
          )}
          {split && (
            <button
              className={ROW_BTN}
              title="Close this column (the note stays open as a tab)"
              aria-label="Close this column"
              onClick={onClosePane}
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="pane-body">
        {blank ? (
          <div className="edit-layer items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-surface/70 text-brand-300 shadow-card">
                <Icon name="doc" className="h-8 w-8" />
              </div>
              <p className="font-display text-xl text-ink-700">Select a note</p>
              <p className="mt-1 text-sm text-ink-500">
                Click one in the sidebar, or a tab above, to open it here.
              </p>
            </div>
          </div>
        ) : (
          <div className="edit-layer">
            <CodeEditor
              path={path}
              doc={doc}
              version={version}
              onDocChange={onDocChange}
              editorRef={viewRef}
            />
          </div>
        )}

        {dragging && (
          <div
            className="absolute inset-0 z-30"
            onDragOver={overZone}
            onDragLeave={() => setZone(null)}
            onDrop={(e) => {
              e.preventDefault()
              setZone(null)
              onDropTab(zoneAt(e))
            }}
          >
            {zone && (
              <div
                className={
                  // Solid accent edge, not a tint: on the dark themes `brand` is
                  // a muted grey-lavender, and a 10% wash of it over the page is
                  // very nearly invisible — the border is what reads.
                  'pointer-events-none absolute rounded-xl border-2 border-brand-400 bg-brand-500/20 shadow-float ' +
                  zoneBox[zone]
                }
              />
            )}
          </div>
        )}
      </div>
    </section>
  )
}
