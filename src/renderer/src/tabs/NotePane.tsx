import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from '../editor'
import { FormatToolbar } from '../editor/FormatToolbar'
import { Icon } from '../icons'
import { formatDateTime, formatNumber, formatWhenShort } from '../intl'
import { HoverCard } from '../HoverCard'
import { LinksBlock, LINKS_BLOCK_HEIGHT } from '../links/LinksBlock'
import type { Inspect } from '../links/LinkInspector'
import { incomingLinks, outgoingLinks } from '../links/model'
import type { LinkEnv, LinkHandlers, OpenHow } from '../editor/linkEnv'
import { dirName, titleOf, type LinkRow } from '../../../shared/links'
import type { AppSettings, LinksPosition } from '../../../shared/settings'

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
  /** when the file was made and last written, epoch ms — absent when the
   *  filesystem doesn't record it (see TreeNode) */
  createdAt?: number
  updatedAt?: number
  /** show those two beside the word count (Settings → Linking content) */
  showNoteInfo: boolean
  dateFormat: AppSettings['dateFormat']
  timezone: string
  /** the vault as this column's editor sees it, for resolving `[[links]]` */
  env: Omit<LinkEnv, 'path'> & { path: string }
  /** what a link clicked or dragged INSIDE the editor does */
  linkHandlers: LinkHandlers
  /** every note's outgoing links, for the backlink half of the block */
  linkIndex: LinkRow[]
  /** what is being hovered, for the one shared inspector card App renders */
  onInspect: (at: Inspect | null) => void
  /** the same three things, for the links block's own chips */
  onFollowLink: (path: string, how: OpenHow, heading?: string | null) => void
  onCreateLink: (dir: string, title: string, how: OpenHow) => void
  onDragLink: (path: string | null) => void
  /** scroll to this heading once the note has loaded (`[[Note#Heading]]`) */
  revealHeading: string | null
  /** show the strip of this note's links at all (Settings → Linking content) */
  showLinks: boolean
  /** and keep it on screen while the note scrolls, instead of letting it go.
   *  Ignored when `linksPosition` is 'bottom' — that spot is always fixed. */
  pinLinks: boolean
  /** top (under the format bar) or fixed to the bottom of the note */
  linksPosition: LinksPosition
  /** Markdown pro is on for this space: show the corner button at all */
  markdownPro: boolean
  /** this note is currently showing its raw Markdown */
  raw: boolean
  onToggleRaw: () => void
  /** this note is showing the code behind each photo and video */
  mediaSource: boolean
  onToggleMediaSource: () => void
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
  /** this column's share of the row (`paneSizes`), applied as `flex-grow`
   *  against a zero basis so the numbers are pure proportions — 0.6/0.4 lays out
   *  identically at any window width. Deliberately NOT a `min-width`: the clamp
   *  that keeps a column readable is enforced in pixels at the drag
   *  (`MIN_PANE_PX`), because a CSS minimum would overflow a narrow window
   *  instead of just refusing to shrink. */
  size: number
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
  createdAt,
  updatedAt,
  showNoteInfo,
  dateFormat,
  timezone,
  env,
  linkHandlers,
  linkIndex,
  onFollowLink,
  onCreateLink,
  onDragLink,
  onInspect,
  revealHeading,
  showLinks,
  pinLinks,
  linksPosition,
  markdownPro,
  raw,
  onToggleRaw,
  mediaSource,
  onToggleMediaSource,
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
  onDropTab,
  size
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

  const outgoing = useMemo(
    () => (blank ? [] : outgoingLinks(path, doc, env.notes, env.spaces)),
    [blank, path, doc, env.notes, env.spaces]
  )
  const incoming = useMemo(
    () => (blank ? [] : incomingLinks(path, linkIndex, env.notes, env.spaces)),
    [blank, path, linkIndex, env.notes, env.spaces]
  )

  // Scroll-away: the block is absolutely positioned over the top of the editor
  // and slides up as you read, revealing the text underneath. CodeMirror keeps
  // its own scroller (touching that would change scrolling for every note), so
  // the block is translated by the scroll offset instead and the editor carries
  // matching top padding — the text starts below the block and stays clear of it.
  //
  // Pinned, or at the bottom, none of that happens: it is an ordinary row
  // instead (above the editor when pinned, below it at the bottom — see the
  // sibling rows around `.pane-body` below).
  const floatingTop = showLinks && linksPosition === 'top' && !pinLinks
  const [scrolled, setScrolled] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (blank || !floatingTop) return
    const scroller = bodyRef.current?.querySelector<HTMLElement>('.cm-scroller')
    if (!scroller) return
    const onScroll = (): void => setScrolled(Math.min(scroller.scrollTop, LINKS_BLOCK_HEIGHT))
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
    // `version` re-runs this after a note switch, when CodeMirror has a new
    // scroll position but the same scroller element.
  }, [blank, floatingTop, path, version])

  // Only "last edited" is on the row — it is the one that changes, and the one
  // you look for. When it was CREATED is a thing you want occasionally, so it
  // lives on the hover card rather than taking permanent width.
  // These return null for a missing timestamp rather than "1970", so a
  // filesystem that doesn't record a creation time simply omits that line.
  const edited = showNoteInfo ? formatWhenShort(updatedAt, dateFormat, timezone) : null
  const [timesAt, setTimesAt] = useState<{ left: number; top: number; bottom: number } | null>(null)

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
        'pane-col relative flex min-w-0 flex-col ' +
        (split ? 'border-l border-ink-300/25 first:border-l-0 ' : '')
      }
      // `flex-1` in the class list would be `flex: 1 1 0%` — an equal share,
      // hardcoded. The same thing with the grow factor made a variable, so a
      // dragged column keeps its proportion at any window size. `.pane-col`
      // carries the transition that makes it glide when the number changes.
      style={{ flexGrow: size, flexShrink: 1, flexBasis: 0 }}
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
              'min-w-0 truncate font-note font-semibold text-ink-300 ' +
              (split ? 'w-[5.5rem] shrink-0 text-[15px] ' : 'flex-1 text-lg ')
            }
          >
            Select a note
          </span>
        ) : (
        <input
          className={
            'min-w-0 truncate bg-transparent font-note font-semibold text-ink-900 outline-none placeholder:text-ink-300 ' +
            // Which element is elastic flips with the width. Wide: the title
            // grows and the commands sit centred at their natural size. Narrow:
            // the title is fixed and the COMMANDS take what's left — leave the
            // title elastic there and its `flex-1` swallows the row, squeezing
            // the bar down to two buttons and a scrollbar.
            (split ? 'w-[5.5rem] shrink-0 text-[15px] ' : 'flex-1 text-lg ')
          }
          value={titleDraft}
          placeholder="Untitled"
          data-tip={path}
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
          {/* The word count and, optionally, when the note was written. Both go
              when the column narrows: Tailwind's `sm:` is viewport width, which
              says nothing about a third of the window, so the split decides.
              Dates are only ever ADDED beside the count, never in place of it —
              the row's height is fixed either way. */}
          {!split && !blank && (
            <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap pl-6 pr-1 text-xs text-ink-300 sm:flex">
              {edited && (
                <span
                  // The same "hover for detail" gesture the links use, and the
                  // same card — not a native tooltip, which the OS parks at the
                  // cursor after a delay of its choosing.
                  onMouseEnter={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setTimesAt({ left: r.left, top: r.top, bottom: r.bottom })
                  }}
                  onMouseLeave={() => setTimesAt(null)}
                >
                  Edited {edited}
                </span>
              )}
              <span>
                {formatNumber(wordCount, numberFormat)} {wordCount === 1 ? 'word' : 'words'}
              </span>
            </span>
          )}
          {/* Hidden rather than disabled at the cap: in a split the row is
              ~80px of commands wide, and a button that can do nothing is dead
              weight taking space Bold and Italic need. A blank column has
              nothing to split off in the first place. */}
          {!blank && canSplit && (
          <button
            className={ROW_BTN}
            data-tip={'Open another column  (Cmd/Ctrl+\\)  ·  or drag a tab to the edge'}
            aria-label="Split the screen"
            onClick={onSplit}
          >
            <Icon name="splitView" className="h-4 w-4" />
          </button>
          )}
          {split && (
            <button
              className={ROW_BTN}
              data-tip="Close this column (the note stays open as a tab)"
              aria-label="Close this column"
              onClick={onClosePane}
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {!blank && showLinks && linksPosition === 'top' && pinLinks && (
        <LinksBlock
          outgoing={outgoing}
          incoming={incoming}
          pinned
          onOpen={onFollowLink}
          onCreate={(suggested, how) => onCreateLink(dirName(suggested), titleOf(suggested), how)}
          onDrag={onDragLink}
          onInspect={onInspect}
        />
      )}

      <div className="pane-body" ref={bodyRef}>
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
          <div
            className="edit-layer"
            // The editor's own top padding, so the first line starts below the
            // block rather than underneath it. A CSS variable rather than a
            // style on .cm-scroller: the scroller is CodeMirror's DOM, and
            // reaching into it from React is how these two stop agreeing.
            style={{ '--links-inset': floatingTop ? `${LINKS_BLOCK_HEIGHT}px` : '0px' } as React.CSSProperties}
          >
            <CodeEditor
              path={path}
              doc={doc}
              version={version}
              onDocChange={onDocChange}
              editorRef={viewRef}
              env={env}
              linkHandlers={linkHandlers}
              revealHeading={revealHeading}
              raw={raw}
              mediaSource={mediaSource}
            />
            {/* The eye. Sits above the Markdown pro switch in the same corner
                stack, and unlike that one it is always here: "what is this
                picture actually pointing at" is an ordinary question, not a
                Markdown person's question. Shown only when the note HAS a photo
                or video would be better still, but that means asking the editor
                what it contains on every render — the button is 8px of chrome,
                and a fixed-height row that never appears or disappears is worth
                more than hiding it (CLAUDE.md: nothing may shift the text). */}
            <button
              onClick={onToggleMediaSource}
              aria-pressed={mediaSource}
              data-tip={
                mediaSource
                  ? 'Showing the code behind each photo and video — click to hide it'
                  : 'Show the code behind each photo and video'
              }
              aria-label={
                mediaSource
                  ? 'Hide the code behind each photo and video'
                  : 'Show the code behind each photo and video'
              }
              className={
                'btn-edge absolute right-3 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-ink-300/30 p-0 shadow-card outline-none backdrop-blur transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                (markdownPro ? 'bottom-[52px] ' : 'bottom-3 ') +
                (mediaSource ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500 hover:text-brand-600')
              }
            >
              <Icon name="eye" className="h-4 w-4" />
            </button>
            {/* Markdown pro's switch. Absolutely positioned inside `.edit-layer`
                (which is already `position: absolute`), so it costs no layout at
                all — the editor chrome is fixed-height rows and nothing may
                appear or disappear in a way that shifts the text (CLAUDE.md).
                Solid rather than fading in on hover, by the user's call:
                findable beats unobtrusive for a mode switch. */}
            {markdownPro && (
              <button
                onClick={onToggleRaw}
                aria-pressed={raw}
                data-tip={
                  raw ? 'Showing raw Markdown — click for the formatted view' : 'Show the raw Markdown'
                }
                aria-label={raw ? 'Show the formatted view' : 'Show the raw Markdown'}
                className={
                  'btn-edge absolute bottom-3 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-ink-300/30 p-0 shadow-card outline-none backdrop-blur transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                  (raw ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500 hover:text-brand-600')
                }
              >
                <Icon name="code" className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {!blank && floatingTop && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10"
            // Slides out of the way as the note scrolls, so the connections are
            // there when you arrive and out of the way once you're reading.
            style={{ transform: `translateY(${-scrolled}px)` }}
          >
            <div className="pointer-events-auto">
              <LinksBlock
                outgoing={outgoing}
                incoming={incoming}
                pinned={false}
                onOpen={onFollowLink}
                onCreate={(suggested, how) => onCreateLink(dirName(suggested), titleOf(suggested), how)}
                onDrag={onDragLink}
                onInspect={onInspect}
              />
            </div>
          </div>
        )}

        {timesAt && (
          <HoverCard at={timesAt} width={228}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-600">
              This note
            </p>
            {/* Full dates here, never "Today": the row already gives you the
                quick answer, so the card is where you come for the precise one. */}
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[11.5px]">
              {formatDateTime(createdAt, 'full', timezone) && (
                <>
                  <dt className="text-ink-400">Created</dt>
                  <dd className="text-ink-700">{formatDateTime(createdAt, 'full', timezone)}</dd>
                </>
              )}
              <dt className="text-ink-400">Last edited</dt>
              <dd className="text-ink-700">{formatDateTime(updatedAt, 'full', timezone)}</dd>
            </dl>
            {!createdAt && (
              // Not every filesystem records a creation time. Saying so beats
              // showing 1970, and beats silently listing only one date.
              <p className="mt-1.5 text-[11px] leading-snug text-ink-400">
                This drive doesn’t record when a file was created.
              </p>
            )}
          </HoverCard>
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

      {!blank && showLinks && linksPosition === 'bottom' && (
        <LinksBlock
          outgoing={outgoing}
          incoming={incoming}
          pinned
          edge="bottom"
          onOpen={onFollowLink}
          onCreate={(suggested, how) => onCreateLink(dirName(suggested), titleOf(suggested), how)}
          onDrag={onDragLink}
          onInspect={onInspect}
        />
      )}
    </section>
  )
}
