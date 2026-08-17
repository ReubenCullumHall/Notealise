import { Icon } from '../icons'
import type { OpenHow } from '../editor/linkEnv'
import type { Inspect } from './LinkInspector'
import type { LinkEntry } from './model'

// The note's connections, in one strip — at the top of the note by default, or
// fixed to the bottom (Settings → Linking content → position).
//
// Chrome, never text: nothing here is written into the .md file (rule 1 — the
// file is the source of truth, and a generated header would make this app the
// author of half of it). Delete the app and the note reads exactly as before.
//
//   Optics   the lenses chapter   Term 3 plan   🔢 Algebra   Diffraction
//
// **Direction is not on the face of a link.** Whether a connection points out of
// this note or back into it is a fact about the connection, not about the note
// you are scanning for — and a row of (O)/(B) badges makes you read the badges
// instead of the names. It is on the hover card instead, which is where you go
// when you want to know more about one of them.
//
// Outgoing come first, then backlinks, so the order is still meaningful without
// being labelled.
//
// The strip scrolls sideways rather than wrapping. That is not a stylistic
// preference: this sits in the editor chrome, and the chrome may not change
// height with what a note happens to contain (CLAUDE.md) — a wrapping list would
// push the first line of a well-connected note halfway down the column. It is
// also why an empty strip says so rather than collapsing.

/** The strip's fixed height, in the one place both the block and the editor's
 *  scroll padding read it. */
export const LINKS_BLOCK_HEIGHT = 34

interface Props {
  outgoing: LinkEntry[]
  incoming: LinkEntry[]
  /** stays put while the note scrolls (Settings → General) */
  pinned: boolean
  /** which side touches the note text: 'top' borders its own bottom edge (text
   *  sits below it), 'bottom' borders its own top edge (text sits above it).
   *  Defaults 'top', the long-standing spot. */
  edge?: 'top' | 'bottom'
  onOpen: (path: string, how: OpenHow, heading?: string | null) => void
  onCreate: (suggestedPath: string, how: OpenHow) => void
  onDrag: (path: string | null) => void
  /** what is being hovered, for the shared inspector card (null = nothing) */
  onInspect: (at: Inspect | null) => void
}

// Same as an in-text link: following a connection opens a tab, so the note that
// sent you there stays where it is.
const howFrom = (e: React.MouseEvent): OpenHow =>
  e.metaKey || e.ctrlKey ? 'replace' : e.altKey ? 'split' : 'tab'

const CHIP =
  'group flex max-w-[14rem] shrink-0 cursor-pointer items-center gap-1 rounded-md border-none px-1.5 py-0.5 text-[11.5px] outline-none transition duration-150 focus-visible:ring-2 focus-visible:ring-brand-300 '
const CHIP_ON = 'bg-wash/[0.06] text-ink-700 hover:bg-wash/[0.14] hover:text-brand-600 '
// Not written yet. A different axis from direction — this one IS on the face,
// because it changes what clicking does (it makes the note rather than opening
// one) and because an unwritten link is a note you owe yourself.
const CHIP_NEW =
  'bg-transparent text-ink-400 underline decoration-dashed underline-offset-2 hover:text-brand-600 '

function Chip({
  entry,
  onOpen,
  onCreate,
  onDrag,
  onInspect
}: {
  entry: LinkEntry
} & Pick<Props, 'onOpen' | 'onCreate' | 'onDrag' | 'onInspect'>): React.JSX.Element {
  const missing = entry.path === null
  const show = (e: React.SyntheticEvent<HTMLElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    onInspect({
      kind: missing ? 'missing' : entry.isDir ? 'folder' : entry.kind,
      title: entry.title,
      path: entry.path,
      suggestedPath: entry.suggestedPath,
      space: entry.space,
      emoji: entry.emoji,
      cross: entry.cross,
      ambiguous: entry.ambiguous,
      context: entry.context,
      rect: { left: r.left, top: r.top, bottom: r.bottom }
    })
  }
  const label = entry.title + (entry.heading ? ' › ' + entry.heading : '')
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        // Only a link that goes somewhere: dragging one that doesn't would have
        // to create the file mid-drag for a drop that may never land.
        draggable={!missing}
        onDragStart={(e) => {
          if (missing) return
          onInspect(null)
          e.dataTransfer.effectAllowed = 'move'
          // The tab strip's own MIME type, so a chip lands in exactly the
          // columns a dragged tab does.
          e.dataTransfer.setData('application/x-notes-tab', entry.path as string)
          onDrag(entry.path)
        }}
        onDragEnd={() => onDrag(null)}
        onMouseEnter={show}
        onMouseLeave={() => onInspect(null)}
        // Keyboard gets the same inspection: the direction of a link isn't
        // available any other way, so it can't be mouse-only.
        onFocus={show}
        onBlur={() => onInspect(null)}
        onClick={(e) => {
          if (missing) onCreate(entry.suggestedPath, howFrom(e))
          else onOpen(entry.path as string, howFrom(e), entry.heading)
        }}
        // A folder has no document to drag into a column.
        {...(entry.isDir ? { draggable: false } : {})}
        className={CHIP + (missing ? CHIP_NEW : CHIP_ON)}
      >
        {/* What kind of thing it is, on the face of the chip — the same
            distinction the editor's links draw. Direction is deliberately NOT
            here; that is what the hover card is for. */}
        <Icon
          name={entry.isDir ? 'folder' : 'doc'}
          className="h-3 w-3 shrink-0 opacity-60"
        />
        {entry.emoji && (
          <span aria-hidden="true" className="shrink-0 text-[10px] leading-none">
            {entry.emoji}
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </span>
  )
}

export function LinksBlock({ outgoing, incoming, pinned, edge = 'top', ...rest }: Props): React.JSX.Element {
  const all = [...outgoing, ...incoming]
  return (
    <div
      // Same box either way — where it SITS is the pane's business, not the
      // block's. Only the backdrop differs: unpinned it floats over the note's
      // own text as that text scrolls up behind it.
      className={
        'links-block flex shrink-0 items-center gap-1 border-ink-300/20 px-3 ' +
        (edge === 'bottom' ? 'border-t ' : 'border-b ') +
        (pinned ? 'bg-surface/30' : 'bg-paper/85 backdrop-blur')
      }
      style={{ height: LINKS_BLOCK_HEIGHT }}
      aria-label="Links"
    >
      {/* Properties (a note's own `---` frontmatter) will sit alongside the links
          when they land. The row is left able to take them so adding them later
          is not a re-layout of everything below. */}
      {all.length === 0 ? (
        <span className="truncate text-[11.5px] text-ink-300">
          No links yet — type <span className="font-medium">[[</span> to connect this note to another
        </span>
      ) : (
        <div className="links-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {all.map((e) => (
            <Chip key={e.key} entry={e} {...rest} />
          ))}
        </div>
      )}
    </div>
  )
}
