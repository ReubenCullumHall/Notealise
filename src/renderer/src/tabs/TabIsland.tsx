import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ContextMenu } from '../ContextMenu'
import { Icon } from '../icons'
import { dragCarriesNotes, DRAG_CHIP, pathsFromDrag } from './island'
import { SEG_BASE, SEG_OFF, SEG_ON, TAB_BASE, TAB_OFF } from './tabStyles'

interface Props {
  /** what this space calls its island, already defaulted — never empty */
  name: string
  /** the notes in it, in island order */
  notes: string[]
  /** the focused pane's note, so a chip can show you are already in it */
  active: string | null
  open: boolean
  onToggle: () => void
  /** a new name. Trimming and the empty case are settled here, so App only ever
   *  receives something worth writing. */
  onRename: (name: string) => void
  /** click a chip: open it as an ordinary tab */
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  /** `paths` land in front of `before` (null = at the end) */
  onDropNotes: (paths: string[], before: string | null) => void
}

const titleOf = (p: string): string => {
  const name = p.slice(p.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}

/** The folder a note sits in, by name — what tells two same-titled chips apart.
 *  '' for a note at the vault root. */
const folderOf = (p: string): string => {
  const parts = p.split('/')
  return parts.length > 1 ? parts[parts.length - 2] : ''
}

/** Opening and closing bounce (Reuben, 2026-09-19: "a nice fluid bounce
 *  animation when you open and close"). The island's WIDTH is what moves, so
 *  the tabs beside it ride the same curve and overshoot with it — the bounce
 *  is the whole strip settling, not a box wobbling on its own.
 *
 *  This is an overshoot curve, which CLAUDE.md's motion rule otherwise keeps
 *  for drag feedback only (`.spring` was removed as a consumer-app reflex).
 *  It is here because Reuben asked for it by name, on a click-driven change
 *  of state rather than a hover, and it stays off with the rest of the app's
 *  motion (`data-motion="off"`, or the OS's reduce-motion setting). */
const BOUNCE_MS = 460
const BOUNCE = 'cubic-bezier(0.34, 1.45, 0.64, 1)'
const motionOn = (): boolean =>
  document.documentElement.dataset.motion !== 'off' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A horizontal mask that fades out whichever edges have more past them. */
const FADE = '28px'
const fadeMask = ({ left, right }: { left: boolean; right: boolean }): string =>
  `linear-gradient(to right, ${left ? 'transparent' : 'currentColor'}, currentColor ${left ? FADE : '0px'}, currentColor calc(100% - ${right ? FADE : '0px'}), ${right ? 'transparent' : 'currentColor'})`

/** How long a drag has to rest on a collapsed island before it opens itself.
 *  Same spring-loaded idea as the sidebar's space chips (`spaceHoverTimer`), and
 *  the same reason: you cannot drop a note at a particular POSITION in something
 *  that is folded up, and asking the user to put the note down, expand, and pick
 *  it up again is three gestures for one intention. */
const ARM_MS = 500

/** The tab island: the collapsible group at the left of the tab strip holding
 *  the notes you keep coming back to (Opera's tab islands, Reuben 2026-09-17).
 *
 *  Collapsed it is one pill — chevron, star, the space's name for it, and a
 *  count. Expanded it grows sideways and the notes appear inside it as chips,
 *  pushing the open tabs right. It never takes more than half the strip: past
 *  that the chips scroll within the island, because an island wide enough to
 *  push every real tab off the edge would be a worse problem than the one it
 *  solves.
 *
 *  Clicking a chip opens that note as an ORDINARY tab and folds the island back
 *  up — you came here to fetch something, and the island getting out of the way
 *  afterwards is what keeps the strip short (Reuben's call, from the three that
 *  were put to him). Which notes are in it lives per note in `workspace.json`;
 *  see `island.ts` for why it is not a list. */
export function Island({
  name,
  notes,
  active,
  open,
  onToggle,
  onRename,
  onOpen,
  onRemove,
  onDropNotes
}: Props): React.JSX.Element {
  // The gap a drop would land in: the chip it goes before, or null for the end.
  // `undefined` means the drag is not over the island at all — the same three
  // states, and the same reason for them, as TabStrip's `before`.
  const [before, setBefore] = useState<string | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  // A right-click menu: on a chip (`path`), or on the bookmark itself (`path`
  // null), which is where renaming and pinning live now the name isn't shown.
  const [menu, setMenu] = useState<{ x: number; y: number; path: string | null } | null>(null)
  // Open because the pointer is on it, as distinct from `open`, which is the
  // pinned state a click leaves behind.
  //
  // **Hovering does not open it** (Reuben, 2026-09-19: "it should only expand
  // when clicked on, not hovered over"). It opened on hover for two days; the
  // stress test measured that resting the pointer on it threw the first tab
  // 446px to the right, so the tab you were reaching for ran away. The one
  // non-click way in left is a DRAG resting on it (`ARM_MS`), because you
  // cannot drop a note at a position inside something folded — and that
  // `springOpen` folds again the moment the drag ends.
  const [springOpen, setSpringOpen] = useState(false)
  // A chip is being dragged. Holds the island open for the whole gesture: an
  // island that was only drag-opened used to fold the moment the pointer left it
  // mid-drag, which unmounted the very chip being dragged — so its `dragend`
  // never fired and dragging it out removed nothing (stress test T17).
  const [chipDragging, setChipDragging] = useState(false)
  const arm = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The island's own box, so a chip released outside it can be told from one
  // dropped back inside — see `dragOut`.
  const box = useRef<HTMLDivElement | null>(null)
  // The chips row, and which of its edges have more notes past them. The island
  // hits its half-the-strip cap with as few as three notes, and a row cut off
  // mid-letter ("Inbc") reads as a rendering fault rather than as "there's
  // more this way" (stress test, 2026-09-18). A fade on the side that scrolls
  // says the second thing.
  const row = useRef<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = (): void => {
    const el = row.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
  }

  const empty = notes.length === 0
  // Titles that appear more than once. Two chips both reading "Ideas" (one at
  // the top of the space, one in a project folder) were indistinguishable
  // except by hovering each for its tooltip (stress test T5). Only the clashing
  // ones get their folder added, so the common case stays as short as it was.
  const clash = new Set(
    notes.map(titleOf).filter((t, i, all) => all.indexOf(t) !== i)
  )
  // An empty island is always shown open with its prompt inside: a collapsed
  // pill with nothing in it gives you nothing to aim at and no reason to think
  // it would take a note (Reuben's call). It is not `open` state — collapsing
  // it would be collapsing nothing — so the chevron is not offered either.
  // An empty island opens and closes on the same click as a full one (Reuben,
  // 2026-09-20: "make the bookmark button clickable so when nothing is in it, it
  // can collapse again ... don't make it automatically collapse after a set
  // time"). It still folds ITSELF the moment its last note leaves — that part is
  // App's, and it only fires on the change, so it can't hold an empty one shut.
  const expanded = open || springOpen || chipDragging

  const clearArm = (): void => {
    if (arm.current) clearTimeout(arm.current)
    arm.current = null
  }
  useEffect(() => {
    // A drag that sprang it open is over however it ended — dropped here,
    // dropped elsewhere, or cancelled — and `dragend` is the one event all three
    // share. It fires at the drag's SOURCE, which for a sidebar note is not in
    // this component, so it is listened for on the document.
    const done = (): void => {
      clearArm()
      setSpringOpen(false)
    }
    document.addEventListener('dragend', done)
    document.addEventListener('drop', done)
    return () => {
      clearArm()
      document.removeEventListener('dragend', done)
      document.removeEventListener('drop', done)
    }
  }, [])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  })

  const commitName = (): void => {
    setEditing(false)
    const next = draft.trim()
    // An empty name is a slip, not an instruction: keeping the old one is the
    // only answer that leaves the island still pointable-at.
    if (next && next !== name) onRename(next)
    else setDraft(name)
  }

  /** Where in the island the pointer is asking to drop. Read off the event, not
   *  off state, for the reason TabStrip gives: the drop must land where the
   *  pointer IS, not where the last `dragover` put it. */
  const overChip = (e: React.DragEvent, path: string): void => {
    if (!dragCarriesNotes(e.dataTransfer.types)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const at = notes.indexOf(path)
    setBefore((e.clientX - rect.left) / rect.width > 0.5 ? (notes[at + 1] ?? null) : path)
  }

  const overIsland = (e: React.DragEvent): void => {
    if (!dragCarriesNotes(e.dataTransfer.types)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setBefore((b) => (b === undefined ? null : b))
    // Springs it open for this drag only, rather than pinning it: it used to
    // call onToggle, so an island you had merely dragged a note into stayed
    // open afterwards until you clicked it shut.
    if (!expanded && !arm.current) arm.current = setTimeout(() => setSpringOpen(true), ARM_MS)
  }

  const leave = (): void => {
    clearArm()
    setBefore(undefined)
  }

  const drop = (e: React.DragEvent): void => {
    if (!dragCarriesNotes(e.dataTransfer.types)) return
    e.preventDefault()
    e.stopPropagation()
    const paths = pathsFromDrag(e.dataTransfer)
    // A folder dragged out of the sidebar carries its own path like a note does
    // — the island holds notes, so anything without a note's extension is
    // dropped on the floor rather than becoming a chip that cannot open.
    const files = paths.filter((p) => p.toLowerCase().endsWith('.md'))
    if (files.length) onDropNotes(files, before ?? null)
    leave()
  }

  /** A chip dragged OUT of the island and let go somewhere that does not take
   *  notes (the sidebar, empty chrome) is removed — the reverse of the gesture
   *  that put it there, and one of the three removal routes Reuben asked for
   *  (the x and the right-click menu are the others).
   *
   *  Somewhere that DOES take it decides for itself, which is why `dropEffect`
   *  is checked first: since 2026-09-19 a chip is also an ordinary note drag
   *  (App's drag bridge), so the tab strip and the panes accept it. The strip
   *  moves it out of the island on its own (App's `leaveIsland`); a pane only
   *  shows it, and it stays here — reading an island note in a split is not the
   *  same as taking it out.
   *
   *  For the no-taker case the pointer's final position against the island's
   *  rectangle is what separates "dropped elsewhere" from "dropped back in".
   *  The known cost: Escape, pressed while the pointer is outside the island,
   *  also removes. One drag to undo; the cheaper of the two mistakes. */
  const dragOut = (e: React.DragEvent, path: string): void => {
    const r = box.current?.getBoundingClientRect()
    const out =
      !!r &&
      // A cancelled drag can report 0,0 — never a real position over the strip,
      // and treating it as "outside" would delete a chip on Escape every time.
      (e.clientX !== 0 || e.clientY !== 0) &&
      (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    leave()
    setChipDragging(false)
    if (out && e.dataTransfer.dropEffect === 'none') onRemove(path)
  }

  // FLIP on width: after the DOM has switched between folded and open, read
  // the new width, then play from the old one. Measured every render (not only
  // on a toggle) so the "from" is always the width that was actually on screen
  // — chips arriving while it's open change it too.
  const lastWidth = useRef<number | null>(null)
  const wasExpanded = useRef(expanded)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const to = el.getBoundingClientRect().width
    const from = lastWidth.current
    const toggled = wasExpanded.current !== expanded
    wasExpanded.current = expanded
    lastWidth.current = to
    if (!toggled || from === null || Math.abs(from - to) < 2 || !motionOn()) return
    // Clipped while it moves: the overshoot takes it briefly past its final
    // width on the way out and under it on the way back, and chips spilling
    // over the tabs for those frames is exactly the fault the width cap fixed.
    el.style.overflow = 'hidden'
    const width = el.animate([{ width: `${from}px` }, { width: `${to}px` }], {
      duration: BOUNCE_MS,
      easing: BOUNCE
    })
    const done = (): void => {
      el.style.overflow = ''
      lastWidth.current = el.getBoundingClientRect().width
      measure()
    }
    width.onfinish = done
    width.oncancel = done
    // Opening, the contents arrive a beat behind the edge, so the notes read
    // as coming out of the bookmark rather than being there all along.
    const content = el.lastElementChild
    if (expanded && content && content !== el.firstElementChild) {
      content.animate(
        [
          { opacity: 0, transform: 'translateX(-6px)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 260, delay: 90, easing: 'ease-out', fill: 'backwards' }
      )
    }
  })
  const armed = before !== undefined
  // You are reading one of the island's notes. It has no tab of its own (App's
  // `stripTabs` leaves island notes out), so folded, the bookmark is the only
  // thing on the strip that can say where the note on screen lives — the same
  // accent wash an active tab wears. Open, its chip carries the wash instead.
  const lit = !!active && notes.includes(active)

  const startRename = (): void => {
    setDraft(name)
    setEditing(true)
  }

  /** The bookmark: the island's one fixed piece, in the same place whether it is
   *  folded or open, so opening it never moves the thing you are pointing at.
   *  Folded it carries the count; open, the chips beside it say the same thing,
   *  so it drops to the bookmark alone.
   *
   *  **The name is not written anywhere on the strip** (Reuben, 2026-09-19: open
   *  it "only expands the notes and doesn't have a load of room saying
   *  'commonly accessed' but instead just says that when you hover over the
   *  bookmark area"). It is the bookmark's hover label, and renaming is a
   *  double-click or a right-click on it.
   *
   *  One click pins it open or shut. A double-click is two clicks first, so only
   *  the FIRST of them toggles (`detail === 1`): the pair then leaves it pinned
   *  open, which is what you want while typing a new name into it. */
  const mark = (
    <button
      type="button"
      aria-label={`${name}, ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${open ? ', pinned open' : ''}`}
      aria-expanded={expanded}
      data-tip={empty ? `${name} · drag notes here` : name}
      onClick={(e) => {
        if (e.detail <= 1) onToggle()
      }}
      onDoubleClick={startRename}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY, path: null })
      }}
      // Filled rather than outlined, unlike an inactive tab: at this width a
      // hairline reads as an empty box, and the bookmark has to look like a
      // solid thing with contents.
      className={
        'press-row flex h-6 shrink-0 cursor-pointer select-none items-center gap-1 rounded-lg border-none px-1.5 text-[13px] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
        (lit && !expanded
          ? 'bg-brand-500/15 text-brand-600 '
          : 'bg-ink-300/20 text-ink-600 hover:bg-ink-300/30 hover:text-ink-900 ')
      }
    >
      <Icon name="bookmark" className="h-3.5 w-3.5 shrink-0" />
      {!expanded && !empty && <span className="font-medium tabular-nums">{notes.length}</span>}
    </button>
  )

  /** Only while renaming: a name field right after the bookmark. */
  const renameField = editing ? (
    <input
      autoFocus
      value={draft}
      maxLength={40}
      aria-label="Island name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitName}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commitName()
        if (e.key === 'Escape') {
          setDraft(name)
          setEditing(false)
        }
      }}
      className="w-[130px] min-w-0 shrink-0 border-none bg-transparent p-0 text-[13px] font-medium text-ink-900 outline-none"
    />
  ) : null

  const marker = (path: string | null): React.JSX.Element | null =>
    armed && before === path ? (
      <span className="mx-px h-5 w-0.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
    ) : null

  return (
    <>
      <div
        className="flex min-w-0 items-center"
        style={{ maxWidth: '50%' }}
      >
        <div
          ref={box}
          onDragOver={overIsland}
          onDragLeave={leave}
          onDrop={drop}
          className={
            expanded
              ? // TAB_BASE carries `shrink-0` — right for a tab, fatal here: it
                // held the pill at its full content width, so past a handful of
                // notes it burst out of the 50% box and painted over the open
                // tabs and the + button, and the chips never scrolled (found by
                // the 15-note stress test, 2026-09-18). Shrinkable, the pill
                // fits the box and the chips row takes the remainder and scrolls.
                TAB_BASE.replace('pl-3 pr-1', 'gap-1 px-1').replace('shrink-0 ', '') +
                'min-w-0 max-w-full ' +
                (armed ? 'border-brand-400/60 bg-brand-500/15 text-brand-600 ' : TAB_OFF)
              : // Folded, the stub IS the whole island — no outer pill around it,
                // or the "thin" would be a thin thing inside a tab-sized box. The
                // wrapper stays only to carry the drop handlers and the ref.
                'flex shrink-0 items-center rounded-lg ' +
                (armed ? 'ring-2 ring-brand-400 ' : '')
          }
        >
          {mark}
          {renameField}
          {expanded && (
            <>
              <span className="mx-0.5 h-4 w-px shrink-0 bg-ink-300/40" aria-hidden="true" />
              {empty ? (
                <span className="shrink-0 whitespace-nowrap rounded-md border border-dashed border-ink-300/40 px-2 py-0.5 text-[12px] text-ink-400">
                  Drag notes here
                </span>
              ) : (
                <div
                  ref={row}
                  onScroll={measure}
                  className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
                  // A mask, not an overlay: it fades the chips themselves, so it
                  // is right on every theme and every accent with no colour of
                  // its own. currentColor is only there to be opaque — a mask
                  // reads alpha and ignores the hue.
                  style={
                    edges.left || edges.right
                      ? {
                          maskImage: fadeMask(edges),
                          WebkitMaskImage: fadeMask(edges)
                        }
                      : undefined
                  }
                >
                  {notes.map((path) => (
                    <div key={path} className="flex shrink-0 items-center">
                      {marker(path)}
                      <div
                        role="tab"
                        tabIndex={0}
                        aria-selected={path === active}
                        data-tip={path}
                        draggable
                        onClick={() => onOpen(path)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onOpen(path)
                          }
                        }}
                        onAuxClick={(e) => {
                          if (e.button === 1) onRemove(path) // middle-click, as a tab closes
                        }}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData(DRAG_CHIP, path)
                          setChipDragging(true)
                        }}
                        onDragEnd={(e) => dragOut(e, path)}
                        onDragOver={(e) => overChip(e, path)}
                        onDrop={drop}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setMenu({ x: e.clientX, y: e.clientY, path })
                        }}
                        className={SEG_BASE + (path === active ? SEG_ON : SEG_OFF)}
                      >
                        <span className="max-w-[140px] truncate font-medium">
                          {titleOf(path)}
                          {clash.has(titleOf(path)) && folderOf(path) && (
                            <span className="font-normal text-ink-400"> · {folderOf(path)}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${titleOf(path)} from ${name}`}
                          data-tip="Remove from the island"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemove(path)
                          }}
                          className="press flex h-5 w-5 items-center justify-center rounded-md border-none bg-transparent p-0 text-current opacity-0 outline-none transition duration-150 hover:bg-ink-300/20 focus-visible:opacity-100 group-hover/seg:opacity-100"
                        >
                          <Icon name="x" className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {marker(null)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.path === null
              ? [
                  { label: 'Rename…', onClick: startRename },
                  { label: open ? 'Stop keeping open' : 'Keep open', onClick: onToggle }
                ]
              : [
                  { label: `Open ${titleOf(menu.path)}`, onClick: () => onOpen(menu.path as string) },
                  { label: `Remove from ${name}`, onClick: () => onRemove(menu.path as string) }
                ]
          }
        />
      )}
    </>
  )
}
