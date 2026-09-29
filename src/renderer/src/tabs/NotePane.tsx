import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { CodeEditor } from '../editor'
import { FormatToolbar } from '../editor/FormatToolbar'
import { Icon } from '../icons'
import { BOUNCE_MS, BOUNCE_SOFT, motionOn } from './tabStyles'
import { takePaneStart } from './stripMotion'
import { startPaneReorder } from './paneReorder'
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

/** What is being dragged: a tab from the strip, which may not be open yet.
 *  (Columns used to be dragged through here too, as `kind: 'pane'`; they are
 *  rearranged by their top edge now, which never goes through a drop —
 *  tabs/paneReorder.ts.) */
export interface Drag {
  kind: 'tab'
  path: string
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
  /** show those two beside the word count (Settings → Note extras) */
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
  /** vault path of a photo/video to scroll to — the delete dialog's jump */
  revealEmbed: string | null
  /** show the strip of this note's links at all (Settings → Links) */
  showLinks: boolean
  /** and keep it on screen while the note scrolls, instead of letting it go.
   *  Ignored when `linksPosition` is 'bottom' — that spot is always fixed. */
  pinLinks: boolean
  /** top (under the format bar) or fixed to the bottom of the note */
  linksPosition: LinksPosition
  /** keep the heading row (Bold/Italic/custom buttons, title, stats, split
   *  view) on screen while the note scrolls, instead of letting it go */
  pinNoteHeader: boolean
  /** Report this pane's own scroll position — true once scrolled past the
   *  very top — to whoever is driving the shared tab strip / path bar hide
   *  state. Only ever passed for the FOCUSED pane (App.tsx passes `undefined`
   *  to every other one), since those two bars render once for the whole
   *  editor area and follow whichever column has the keyboard. */
  onScrollTopChange?: (scrolledPastTop: boolean) => void
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
  /** the column's x: closes the NOTE, tab and all, exactly like the x on its
   *  tab — keeping it open is a drag of its tab out of the split (Reuben,
   *  2026-09-27) */
  onClosePane: () => void
  /** swap this column with the one on its LEFT — the button beside the split
   *  control. Undefined for the leftmost column, which has nothing to its left
   *  to trade with; every other column can reach any position by repeating it.
   *  Redundant with dragging the column by its top edge (`onReorder`), and
   *  deliberately so: the button is the route a keyboard can reach. */
  onSwapLeft?: () => void
  /** move THIS column to position `to` — the drag along its top edge (only
   *  offered in a split — one column has no order to rearrange) */
  onReorder: (to: number) => void
  /** what is being dragged right now, or null */
  dragging: Drag | null
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
  'press flex shrink-0 items-center justify-center rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300'

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
  revealEmbed,
  showLinks,
  pinLinks,
  linksPosition,
  pinNoteHeader,
  onScrollTopChange,
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
  onSwapLeft,
  onReorder,
  dragging,
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
    () => (blank ? [] : outgoingLinks(path, doc, env.notes, env.spaces, env.blocks, env.headings)),
    [blank, path, doc, env.notes, env.spaces, env.blocks, env.headings]
  )
  const incoming = useMemo(
    () => (blank ? [] : incomingLinks(path, linkIndex, env.notes, env.spaces)),
    [blank, path, linkIndex, env.notes, env.spaces]
  )

  // Hide-on-scroll, shared by the links block (floating) and the heading row
  // (in flow): visible only at the very top of the note, and disappears the
  // instant you scroll away from it — not a slide tied to scroll position.
  // Neither one collapses its own layout space when hidden — the note
  // underneath does not reflow to fill the gap, same as this already worked
  // for the links block before the tab strip / path bar / heading row grew
  // the same behaviour (SpaceForm's "While scrolling"). The links block's
  // spot is fixed (`--links-inset` below), a floating box over the editor;
  // the heading row is an ordinary flex child that just fades in place.
  //
  // Deliberately NOT "hide on scroll down, reveal on scroll up": that pattern
  // (common in mobile browsers) would flicker it in and out on ordinary
  // up/down reading anywhere in the middle of a long note. Reappearing is
  // reserved for actually being back at scrollTop 0.
  //
  // Replaced 2026-08-29: the links block used to slide continuously instead
  // (`transform: translateY(-scrolled)`, clamped to LINKS_BLOCK_HEIGHT) — and
  // that clamped resting position landed exactly on top of the heading row
  // sitting above `.pane-body`, its near-opaque background painting over that
  // row's own content. The row was never actually scrolling away; this was
  // silently hiding it. See CLAUDE.md's Gotchas.
  //
  // Pinned, or at the bottom, none of that happens for the links block: it is
  // an ordinary row instead (above the editor when pinned, below it at the
  // bottom — see the sibling rows around `.pane-body` below).
  const floatingTop = showLinks && linksPosition === 'top' && !pinLinks
  const [scrolledPastTop, setScrolledPastTop] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // A blank pane has no CodeMirror to scroll — permanently "at the top",
    // so its heading row never has reason to hide.
    if (blank) {
      setScrolledPastTop(false)
      return
    }
    const scroller = bodyRef.current?.querySelector<HTMLElement>('.cm-scroller')
    if (!scroller) return
    const onScroll = (): void => setScrolledPastTop(scroller.scrollTop > 0)
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
    // `version` re-runs this after a note switch, when CodeMirror has a new
    // scroll position but the same scroller element.
  }, [blank, path, version])
  // Reported separately from the effect above so a focus change (App.tsx
  // flips which pane's `onScrollTopChange` isn't undefined) reports this
  // pane's CURRENT position immediately, without waiting for its next scroll
  // event.
  useEffect(() => {
    onScrollTopChange?.(scrolledPastTop)
  }, [scrolledPastTop, onScrollTopChange])
  const linksHidden = scrolledPastTop
  const headerHidden = scrolledPastTop && !pinNoteHeader

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

  // A column added to a split grows out from nothing on the tab strip's bounce
  // (Reuben, 2026-09-23), rather than arriving at full width. Keyed off the
  // NOTE, not the mount: the columns are keyed by position, so a note dropped on
  // the left edge lands in the first column while React mounts the last one.
  // App's `applyLayout` says which note joined (stripMotion.ts). A split
  // restored at launch, switched to with its space, or gone back to from the
  // strip just appears.
  const col = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = col.current
    const from = takePaneStart(path)
    if (!el || from === null || !motionOn()) return
    if (from > 0) {
      // A column the join pushed along starts at the width it had and gives way
      // the way any column does when the split changes — `.pane-col`'s own
      // transition, read back rather than copied so the two can't drift.
      const cs = getComputedStyle(el)
      el.animate([{ flexGrow: from }, { flexGrow: el.style.flexGrow || 1 }], {
        duration: parseFloat(cs.transitionDuration) * 1000,
        easing: cs.transitionTimingFunction
      })
      return
    }
    // Clipped while it is narrower than its contents, or the first frames spill
    // the "Select a note" prompt past the window edge.
    el.style.overflow = 'hidden'
    // The soft curve: the full bounce swung the divider between the columns
    // too far (Reuben, 2026-09-24 — cut by about 70%).
    const grow = el.animate([{ flexGrow: 0 }, { flexGrow: el.style.flexGrow || 1 }], {
      duration: BOUNCE_MS,
      easing: BOUNCE_SOFT
    })
    const done = (): void => {
      el.style.overflow = ''
    }
    grow.onfinish = done
    grow.oncancel = done
  }, [path])

  const zoneBox: Record<DropZone, string> = {
    left: 'inset-y-2 left-2 w-[calc(50%-0.5rem)]',
    right: 'inset-y-2 right-2 w-[calc(50%-0.5rem)]',
    center: 'inset-2'
  }

  return (
    <section
      ref={col}
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
      {/* The column's drag handle, in a split: the 10px of padding between the
          top of the column and the format buttons (Reuben, 2026-09-26). Not
          dressed as a control — empty space until hovered, when the app's
          six-dot grip fades in, turned to lie across the strip. It stops 10px
          short of each side so it never sits on the divider's grab area, and
          ends where the buttons begin, so it covers nothing (CLAUDE.md,
          "Nothing covers a control"). This replaced dragging the whole row,
          which lived in the gaps between buttons nobody could find. */}
      {split && !headerHidden && (
        <div
          aria-hidden
          className="pane-grab group absolute inset-x-[10px] top-0 z-20 flex h-[10px] cursor-grab touch-none items-center justify-center"
          onPointerDown={(e) => col.current && startPaneReorder(e, col.current, onReorder)}
        >
          <Icon
            name="grip"
            className="pane-grip h-3.5 w-3.5 rotate-90 text-ink-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          />
        </div>
      )}
      <div
        className={
          ROW_CLASS +
          ' transition-[opacity,transform] duration-150' +
          (headerHidden ? ' pointer-events-none -translate-y-1 opacity-0' : ' translate-y-0 opacity-100') +
          // In a split, the accent line is how you can see which column the
          // keyboard is pointing at. A single pane has nothing to distinguish
          // itself from, so it leaves the reserved line transparent.
          (split && focused ? ' border-t-brand-400/70' : '')
        }
      >
        {/* The title used to live HERE, and moved into the text column on
            2026-09-04 — see `.note-title-row` below. What took its place was a
            bare spacer mirroring the block at the other end, which is what
            keeps the format bar centred over the column now that nothing
            elastic sits on the left.

            The word count moved INTO that spacer on 2026-09-05 (Reuben, from
            tester feedback: "word count goes next to the note name on the top
            bar, to the left, fixed next to the top bar controls despite the
            note name length — not next to the split view"). It reads as a
            property of the note, and beside the split-view and close buttons it
            read as a third control. `flex-1` on both ends is still what centres
            the toolbar: the count is short and fixed-width enough not to eat
            its share, and `whitespace-nowrap` keeps it one line.

            In a split there is no spacer, no centring and no count: the bar
            takes the whole row and scrolls, exactly as it did before. */}
        {!split && (
          <span className="note-info flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap pr-4 text-xs">
            {!blank && (
              <>
                {/* The count first, then the date — the date is optional
                    (Settings → Note extras) and appending it must not shift
                    the count, which is the thing being pinned here. */}
                <span>
                  {formatNumber(wordCount, numberFormat)} {wordCount === 1 ? 'word' : 'words'}
                </span>
                {edited && (
                  <span
                    // The same "hover for detail" gesture the links use, and the
                    // same card — not a native tooltip, which the OS parks at
                    // the cursor after a delay of its choosing.
                    className="hidden truncate sm:block"
                    onMouseEnter={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setTimesAt({ left: r.left, top: r.top, bottom: r.bottom })
                    }}
                    onMouseLeave={() => setTimesAt(null)}
                  >
                    Edited {edited}
                  </span>
                )}
              </>
            )}
          </span>
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
          {/* The word count and the edit stamp used to sit HERE, immediately
              left of the split-view button — which is what put them "next to
              the split view". They are now at the other end of the row; see the
              spacer above. */}
          {/* Only in a split, and never on the leftmost column. Same reasoning
              as the cap-hidden split button below: a control that can do
              nothing is dead weight in a row this narrow. */}
          {onSwapLeft && (
            <button
              className={ROW_BTN}
              data-tip="Move this column to the left  ·  or drag its top edge"
              aria-label="Move this column to the left"
              onClick={onSwapLeft}
            >
              <Icon name="swapColumns" className="h-4 w-4" />
            </button>
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
              data-tip="Close this note  ·  to keep it open, drag its tab out of the split"
              aria-label="Close this note"
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
            className="edit-layer has-title"
            // The editor's own top padding, so the first line starts below the
            // block rather than underneath it. A CSS variable rather than a
            // style on .cm-scroller: the scroller is CodeMirror's DOM, and
            // reaching into it from React is how these two stop agreeing.
            style={{ '--links-inset': floatingTop ? `${LINKS_BLOCK_HEIGHT}px` : '0px' } as React.CSSProperties}
          >
            {/* The note's title, in the note's own column.
                It sat in the command row above until 2026-09-04, where it was
                `flex-1` from the pane's left edge while the body is a centred
                `--editor-max-width` column — so the two started at different x
                and the gap GREW with the window: 176px at 1400px, ~450px
                maximised. A document's title belongs over the document.

                `.note-title-row` reproduces `.cm-content`'s geometry exactly
                (same max-width, same auto margins, the same 28px gutter
                `.cm-line` carries), which is what lands the title's first
                letter on the note's first letter. Those numbers live in
                `editor/highlight.ts` — if they move, this moves with them.

                It is PINNED rather than scrolling away with the text, which is
                the same choice `pinNoteHeader` already makes for the rest of
                this chrome. */}
            <div className="note-title-row">
              <input
                className={
                  'w-full min-w-0 truncate bg-transparent font-note font-semibold text-ink-900 outline-none placeholder:text-ink-300 ' +
                  // 30px, which is deliberately ABOVE the note's own `# heading`
                  // (`heading1` is 1.7em of the editor's fixed 16px base =
                  // 27.2px — editor/highlight.ts). A great many notes open with
                  // an H1 repeating their own name, and a title that renders
                  // SMALLER than the first line of the document it names reads
                  // as a mistake. 24px was tried first and lost that comparison.
                  // If the editor's base size ever stops being fixed at 16px,
                  // this has to become relative to it.
                  // A split column drops to 20px — still above its body text,
                  // but a third of the window is not a reading view.
                  (split ? 'text-[20px]' : 'text-[30px]')
                }
                value={titleDraft}
                placeholder="Untitled"
                data-tip={path}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    // Enter takes the name AND puts you in the note (Reuben,
                    // 2026-09-20). The blur is what commits it; focus goes to
                    // the editor a frame later, because `commitTitle` starts a
                    // rename whose re-render would otherwise land on top of the
                    // focus call and leave the caret nowhere. The caret keeps
                    // whatever position it had, which on a note you have just
                    // named is the start of an empty document.
                    ;(e.target as HTMLInputElement).blur()
                    requestAnimationFrame(() => viewRef.current?.focus())
                  } else if (e.key === 'Escape') {
                    setTitleDraft(stripMd(nameOf(path)))
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
              />
            </div>
            <CodeEditor
              path={path}
              doc={doc}
              version={version}
              onDocChange={onDocChange}
              editorRef={viewRef}
              env={env}
              linkHandlers={linkHandlers}
              revealHeading={revealHeading}
              revealEmbed={revealEmbed}
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
            {/* Hidden in raw view: the markdown behind every photo and video is
                already on screen there, so the eye has nothing left to reveal.
                Reuben's call, 2026-08-29. Safe against the "nothing may change
                the row's height" rule because this button is absolutely
                positioned inside `.edit-layer` and costs no layout either way. */}
            {!raw && (
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
                (mediaSource ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500 hover:text-ink-900')
              }
            >
              <Icon name="eye" className="h-4 w-4" />
            </button>
            )}
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
                  (raw ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500 hover:text-ink-900')
                }
              >
                <Icon name="code" className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {!blank && floatingTop && (
          <div
            // pointer-events-none out here regardless of hidden state, so the
            // padding this box reserves never blocks a click meant for the
            // text below it — only the inner wrapper (sized to the block
            // itself) re-enables clicking, and only while visible: an
            // invisible chip must not still be clickable.
            className={
              'pointer-events-none absolute inset-x-0 top-0 z-10 transition-[opacity,transform] duration-150 ' +
              (linksHidden ? '-translate-y-1 opacity-0' : 'translate-y-0 opacity-100')
            }
          >
            <div className={linksHidden ? 'pointer-events-none' : 'pointer-events-auto'}>
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
