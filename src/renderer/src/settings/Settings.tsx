import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STARTUPS, type AppSettings } from './model'
import { Icon, type IconName } from '../icons'
import { PageTabs, Select, SettingRow, ToggleRow } from './primitives'
import { Spaces, type SpaceActions } from './Spaces'
import { Collection } from './Collection'
import { Explore, type ExploreTab } from './Explore'
import { RequestForm } from './RequestForm'
import { Customisation } from './Customisation'
import { Tutorials } from './tutorials'
import { OssLicenses } from './OssLicenses'
import { SourceFolder } from './SourceFolder'
import { TransferData } from './TransferData'
import { Recovery } from './Recovery'
import { ImportPanel } from '../import/ImportPanel'
import { motionOn } from '../tabs/tabStyles'
import { DATE_FORMATS, NUMBER_FORMATS, formatDate, localZone, timezones } from '../intl'
import { MAC_INSTALL_GUIDE_URL, type UpdateStatus } from '../../../shared/update'
import type { PresetActions } from './Presets'
import type { SpacePreset } from '../../../shared/presets'
import type { RecoveryItem } from '../../../shared/workspace'
import { useInstalledFonts } from './useInstalledFonts'
import { claimEscape, escapeClaimed } from './escapeClaims'
import { searchSettings, type SearchEntry } from './search'

/** What a plain settings section needs. Kept free of `spaceActions` so General
 *  and Formatting don't have to carry a dependency only Spaces uses. */
interface Props {
  settings: AppSettings
  onChange: (partial: Partial<AppSettings>) => void
}

/** …plus the folder operations the Spaces page needs, which are owned by App,
 *  and the vault itself for the Source folder page. */
type ShellProps = Props & {
  spaceActions: SpaceActions
  vault: string | null
  onPickVault: () => void
  /** the saved-preset library, which App owns because it outlives the open vault */
  presets: SpacePreset[]
  presetActions: PresetActions
  /** the 7-day safety net beneath the bin — see shared/workspace.ts's
   *  RecoveryItem. Settings-only; not shown in the sidebar's bin view. */
  recovery: RecoveryItem[]
  onRestoreRecovery: (ids: string[]) => void
  onPurgeRecovery: (ids?: string[]) => void
  /** held file path, and the note it came out of (null if it wasn't in one) */
  onRevealHeld: (path: string, note: string | null) => void
  /** run after a Transfer data import — App re-reads the preset library, which
   *  that import changed behind its back (fonts are refreshed here, since the
   *  font library is created in SettingsWindow, not App) */
  onTransferChanged?: () => void
}

export type SectionId =
  | 'general'
  | 'customisation'
  | 'spaces'
  | 'collection'
  | 'tutorials'
  | 'sourceFolder'
  | 'recovery'
  | 'import'
  | 'transferData'
  | 'updates'
  | 'reportBug'
  | 'requestFeature'

// The left-hand list. SIX entries — it was twelve until 2026-09-29, one per
// page, and Reuben asked for the window to be debloated and easier to find
// your way round. Pages that belong together now share one entry and sit
// behind a row of tabs at the top of it (`PageTabs`):
//
//   General        — one app launch, one locale. Startup, dates, numbers, the
//                    clock. Nothing here is per-space and nothing ever will be.
//   Look           — how the app LOOKS and what it shows, for every space at
//                    once (the tab that was the Customisation page), plus Your
//                    collection: the fonts, page looks and tints you have.
//   Spaces         — the same look settings, one space at a time.
//   Data           — where your notes live and moving things in and out:
//                    Source folder, Recovery, Import, Transfer data.
//   Help           — Tutorials, Report a bug, Request a feature.
//   Updates
//
// **The split between General and Look is the rule this window is built on.**
// Every setting on Look belongs to a SPACE; the page writes to all of them at
// once, and links to Spaces for setting just one. They were one page ("Master
// settings") and it meant a user looking for the date format scrolled past the
// entire appearance system, while a user looking for the theme had no reason
// to think "master" was where it lived. Keep them apart.
//
// A PAGE (`SectionId`) is still the unit everything else routes to — search
// results, the File menu's jumps ('import', 'updates'), goTo. A GROUP is only
// how the pages are listed, so moving a page between groups never breaks a
// route.
type GroupId = 'general' | 'look' | 'spaces' | 'data' | 'help' | 'updates'

interface Group {
  id: GroupId
  label: string
  icon: IconName
  /** the tabs, in order; the first is where the list entry lands */
  pages: { id: SectionId; label: string }[]
}

const GROUPS: Group[] = [
  { id: 'general', label: 'General', icon: 'sliders', pages: [{ id: 'general', label: 'General' }] },
  {
    id: 'look',
    label: 'Look',
    icon: 'sun',
    pages: [
      { id: 'customisation', label: 'Every space' },
      { id: 'collection', label: 'Your collection' }
    ]
  },
  { id: 'spaces', label: 'Spaces', icon: 'spaces', pages: [{ id: 'spaces', label: 'Spaces' }] },
  {
    id: 'data',
    label: 'Data',
    icon: 'folder',
    // Source folder first: it is where the notes themselves are. Then the
    // safety net, then the two ways things come in from elsewhere — Import
    // for notes, Transfer data for the app's own settings.
    pages: [
      { id: 'sourceFolder', label: 'Source folder' },
      { id: 'recovery', label: 'Recovery' },
      { id: 'import', label: 'Import' },
      { id: 'transferData', label: 'Transfer data' }
    ]
  },
  {
    id: 'help',
    label: 'Help',
    icon: 'book',
    pages: [
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'reportBug', label: 'Report a bug' },
      { id: 'requestFeature', label: 'Request a feature' }
    ]
  },
  { id: 'updates', label: 'Updates', icon: 'restore', pages: [{ id: 'updates', label: 'Updates' }] }
]

const GROUP_OF = Object.fromEntries(
  GROUPS.flatMap((g) => g.pages.map((p) => [p.id, g]))
) as Record<SectionId, Group>

const PAGE_LABEL = Object.fromEntries(
  GROUPS.flatMap((g) => g.pages.map((p) => [p.id, p.label]))
) as Record<SectionId, string>

/** Where a result lives, as the reader would click to it: "Look › Every
 *  space › Page", "Data › Recovery", "General › More". */
function whereIs(e: SearchEntry): string {
  const g = GROUP_OF[e.section]
  const parts = [g.label]
  if (g.pages.length > 1) parts.push(PAGE_LABEL[e.section])
  if (e.explore) parts.push('Explore')
  if (e.disclosure) parts.push(e.disclosure)
  return parts.join(' › ')
}

/** Interface animations on, and the computer not asking for less motion — the
 *  same test as tabs/tabStyles.ts's `motionOn`, written out here so the
 *  search's glow doesn't depend on that file (TabIsland.tsx does the same). */
const glowAllowed = (): boolean =>
  document.documentElement.dataset.motion !== 'off' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The first heading or label on the page whose own words are `text` — how a
 *  search result finds the setting it named (see `landing`). Its OWN words
 *  only, so a paragraph that merely mentions the name doesn't count. Never
 *  the row of tabs at the top, which repeats page names, nor a fold's own
 *  row: the Advanced fold's summary begins "Text colour on dark themes…",
 *  and matching that parked the page on the closed fold instead of the Text
 *  colour setting inside it. A heading or label may carry more after the name
 *  ("Intensity — 50%"); anything else has to match exactly. */
function findOnPage(root: HTMLElement | null, text: string): HTMLElement | null {
  if (!root) return null
  for (const el of root.querySelectorAll<HTMLElement>('h3, span, p, button, label')) {
    if (el.closest('[role=tablist], [aria-expanded]')) continue
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (own === text) return el
    if ((el.tagName === 'H3' || el.tagName === 'LABEL') && own.startsWith(text + ' ')) return el
  }
  return null
}

/** The search box, centred in the window's title bar, with its results in a
 *  list that drops down beneath it. Arrow keys move through the results,
 *  Enter takes the highlighted one (the best match until you move), and
 *  Escape clears the search before it would close the window.
 *
 *  Focused when Settings opens, so you can open it and just type — the
 *  quickest route to a setting you can't see (Reuben, 2026-09-29: "make sure
 *  the settings are easy to find"). An empty box has no claim on Escape, so
 *  Escape still closes the window the way it always has.
 *
 *  A search that finds nothing says so in the list and leaves the pages on
 *  the left alone — it used to replace them, so a word this window doesn't
 *  know ("spellcheck", "password") took away the only other way to browse. */
function SettingsSearch({ onPick }: { onPick: (e: SearchEntry) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // The list shows only while the box has focus. It used to show whenever
  // there was text in the box, so typing, then clicking a page on the left,
  // left the list lying over the page you'd just opened.
  const [focused, setFocused] = useState(false)
  const matches = useMemo(() => searchSettings(query), [query])
  const open = focused && query.trim().length > 0
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    input.current?.focus({ preventScroll: true })
  }, [])

  // A new query starts at the best match again.
  useEffect(() => setActive(0), [query])

  // Keep the highlighted result in view as the arrow keys move it.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-result="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Claimed only while there is a search to clear — see escapeClaims.ts for
  // why the window's own close-on-Escape needs telling.
  useEffect(() => {
    if (!open) return
    const release = claimEscape()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setQuery('')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      release()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const pick = (m: SearchEntry): void => {
    // An answer has nowhere to go — it was read in the list.
    if (!m.answer) onPick(m)
    setQuery('')
  }

  return (
    <div className="relative w-[min(400px,38vw)]">
      <div className="btn-edge flex items-center gap-1.5 rounded-full border border-ink-300/30 bg-surface/70 py-1.5 pl-3 pr-1.5 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
        <span className="shrink-0 text-ink-300">
          <Icon name="search" className="h-3.5 w-3.5" />
        </span>
        <input
          ref={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && matches.length > 0) {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp' && matches.length > 0) {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter' && matches.length > 0) {
              e.preventDefault()
              pick(matches[Math.min(active, matches.length - 1)])
            }
          }}
          placeholder="Search settings"
          spellCheck={false}
          role="combobox"
          aria-label="Search settings"
          aria-expanded={open}
          aria-controls="settings-search-results"
          aria-activedescendant={open && matches.length > 0 ? `settings-result-${active}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-900 outline-none placeholder:text-ink-300"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('')
              input.current?.focus()
            }}
            data-tip="Clear"
            aria-label="Clear search"
            // `-my-1`: the button is taller than the line of text, and without
            // it the box — and with it the whole window below the title bar —
            // grew a few pixels the moment you typed the first letter.
            className="-my-1 shrink-0 rounded-full border-none bg-transparent p-1 text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-ink-900"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div
          ref={list}
          id="settings-search-results"
          role="listbox"
          aria-label="Matching settings"
          className="fade-in absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[min(420px,60vh)] overflow-y-auto rounded-xl border border-ink-300/25 bg-surface p-1 shadow-float"
          // `.fade-in` holds its last frame, a 3D transform, for as long as the
          // list is open — and a list of words resting on a 3D transform loses
          // Windows' sharp text (CLAUDE.md). Held only before it starts, it
          // comes to rest at no transform instead; the motion is the same.
          style={{ animationFillMode: 'backwards' }}
        >
          {matches.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] leading-relaxed text-ink-400">
              Nothing matched &ldquo;{query.trim()}&rdquo;. Try another word, or pick a page on the
              left.
            </p>
          ) : (
            matches.map((m, i) => (
              <button
                key={m.section + m.label}
                id={`settings-result-${i}`}
                data-result={i}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                // mousedown, not click: the input keeps focus, so the list
                // doesn't blink shut between press and release.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => pick(m)}
                className={
                  'flex w-full flex-col items-start gap-0.5 rounded-lg border-none px-2.5 py-2 text-left outline-none transition-colors duration-150 ' +
                  (i === active ? 'bg-ink-300/15' : 'bg-transparent')
                }
              >
                <span className="text-[12.5px] font-medium text-ink-700">{m.label}</span>
                {m.answer ? (
                  <span className="text-[11px] text-ink-500">{m.answer}</span>
                ) : (
                  <span className="text-[11px] text-ink-400">{whereIs(m)}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** General's small "More" fold, at the foot of the page. Styled as the quiet
 *  "Open source licences ›" link above it rather than as one of the big
 *  settings rows: what it holds is rarely wanted, and the fold shouldn't
 *  compete with the page. `openSignal` works as Disclosure's does (Spaces.tsx)
 *  — a changing number from a search result opens it, and the window's
 *  `landing` then scrolls to the row that was asked for. */
function MoreFold({
  openSignal,
  children
}: {
  openSignal?: number
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (openSignal !== undefined) setOpen(true)
  }, [openSignal])
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="settings-more"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border-none bg-transparent px-2 py-1 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        More
        <span className={'inline-flex transition-transform duration-200 ' + (open ? 'rotate-90' : '')}>
          <Icon name="chevron" className="h-3.5 w-3.5" />
        </span>
      </button>
      {open && (
        // `backwards` for the same Windows reason as the search list above.
        <div id="settings-more" className="fade-in mt-3" style={{ animationFillMode: 'backwards' }}>
          {children}
        </div>
      )}
    </div>
  )
}

/** The gear. It lives in the sidebar's bottom-left strip, beside the bin, the
 *  way legacy pins it (legacy/src/App.jsx:997-1015) — hence the card styling and
 *  hover lift rather than a flat header button. */
export function SettingsButton({
  settings,
  onChange,
  spaceActions,
  vault,
  onPickVault,
  presets,
  presetActions,
  recovery,
  onRestoreRecovery,
  onPurgeRecovery,
  onRevealHeld,
  onTransferChanged,
  jumpToSection,
  onJumpHandled
}: ShellProps & {
  /** Set (e.g. from a File-menu command) to open the window straight to a
   *  section, bypassing the gear. Consumed once via onJumpHandled. */
  jumpToSection?: SectionId | null
  onJumpHandled?: () => void
}): React.JSX.Element {
  const [mounted, setMounted] = useState(false) // in the DOM, including while closing
  const [armed, setArmed] = useState(false) // laid out, safe to animate
  const [closing, setClosing] = useState(false)
  const [initialSection, setInitialSection] = useState<SectionId>('general')
  const btn = useRef<HTMLButtonElement>(null)
  const win = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!jumpToSection) return
    setInitialSection(jumpToSection)
    setClosing(false)
    setMounted(true)
    onJumpHandled?.()
  }, [jumpToSection, onJumpHandled])

  // A jump target is spent once the window has gone. Without this it sticks:
  // SettingsWindow seeds `section` from it on every mount, so one File-menu jump
  // to Report a bug meant the GEAR opened there too, for the rest of the
  // session — and the gear is the general-purpose way in, so it has to land on
  // General.
  //
  // Keyed on the window actually being unmounted, NOT done in close(): close()
  // only starts the genie animation, and SettingsWindow re-syncs `section` from
  // this prop, so resetting there would snap the page to General in front of
  // the user while it shrinks away.
  useEffect(() => {
    if (!mounted) setInitialSection('general')
  }, [mounted])

  // Closing before the animation is armed (Escape hammered within a frame or two
  // of opening) would wait forever for an animationend that never comes, so that
  // case unmounts outright.
  const armedRef = useRef(false)
  const close = useCallback(() => {
    if (armedRef.current) setClosing(true)
    else {
      setMounted(false)
      setClosing(false)
    }
  }, [])

  // Safety net. Unmounting normally happens on animationend, but this modal
  // covers the whole window, so if that event is ever missed the app is left
  // unclickable. Nothing that severe should hang on a single event arriving.
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, 600)
    return () => clearTimeout(t)
  }, [closing])

  // Aim the genie at the gear. Measured before paint so the first animation
  // frame already collapses toward the right point.
  useLayoutEffect(() => {
    if (!mounted) {
      armedRef.current = false
      setArmed(false)
      return
    }
    if (!win.current || !btn.current) return
    const g = btn.current.getBoundingClientRect()
    const w = win.current.offsetWidth
    const h = win.current.offsetHeight
    const left = (window.innerWidth - w) / 2
    const top = (window.innerHeight - h) / 2
    win.current.style.transformOrigin = `${g.left + g.width / 2 - left}px ${g.top + g.height / 2 - top}px`

    // Hold the animation back a full frame: mounting costs a layout and paint of
    // the whole settings UI, and a dropped first frame is what a stutter is. Two
    // rAFs, because the first still runs inside the frame being painted.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        armedRef.current = true
        setArmed(true)
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    // capture, so Escape closes this before the sidebar clears its selection
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // A nested overlay (a Select dropdown, the emoji picker, a confirm
        // dialog) wants first claim — this handler registers the moment
        // Settings opens, before any such overlay exists to register its
        // own Escape listener, so it would otherwise always run FIRST and
        // close the whole window out from under the overlay. See
        // escapeClaims.ts and CLAUDE.md's Gotchas.
        if (escapeClaimed()) return
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mounted, close])

  const open = mounted && !closing

  return (
    <>
      <button
        ref={btn}
        // Same material as the Bin/Archive control beside it — border, surface,
        // blur, radius — but a SEPARATE object from it, and flat like it.
        //
        // This went ghost (no border, no fill) earlier on 2026-09-04, because
        // dressing it identically to Bin and Archive implied you could drop a
        // note on it, which you cannot. That reasoning is now carried by the
        // GROUPING instead: those two became two halves of one control, and
        // being outside that control is what marks this as the odd one out. So
        // the fill can come back — it makes the foot of the sidebar read as one
        // row of the same stuff, which is what Reuben asked for — without
        // re-implying a drop target. Keep it OUT of that wrapper; the moment it
        // moves inside, the old problem is back.
        //
        // No `shadow-card`: nothing in the sidebar floats any more (app.css).
        // `btn-edge` returns with the border it colours.
        className={
          'btn-edge pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ink-300/30 outline-none backdrop-blur transition duration-200 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
          (open ? 'bg-accent-500/15 text-accent-600' : 'bg-surface/90 text-accent-500 hover:bg-ink-300/15')
        }
        data-tip="Settings"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => (open ? close() : (setClosing(false), setMounted(true)))}
      >
        <span
          className={'inline-flex transition-transform duration-500 ' + (open ? 'rotate-180 scale-90' : '')}
        >
          <Icon name="gear" className="h-4 w-4" />
        </span>
      </button>

      {/* PORTAL, and not optional. The sidebar <aside> carries `backdrop-blur`,
          and backdrop-filter makes an element a containing block for fixed-
          position descendants — so rendering in place pinned this to the 288px
          sidebar instead of the viewport. The strip is also pointer-events-none,
          which the modal would inherit. document.body escapes both. */}
      {mounted &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div
              onClick={close}
              aria-hidden="true"
              className={'genie-backdrop absolute inset-0 bg-paper/50 backdrop-blur-[5px] ' + (closing ? 'closing' : '')}
            />
            <SettingsWindow
              winRef={win}
              settings={settings}
              onChange={onChange}
              spaceActions={spaceActions}
              vault={vault}
              onPickVault={onPickVault}
              presets={presets}
              presetActions={presetActions}
              recovery={recovery}
              onRestoreRecovery={onRestoreRecovery}
              onPurgeRecovery={onPurgeRecovery}
              onRevealHeld={onRevealHeld}
              onTransferChanged={onTransferChanged}
              initialSection={initialSection}
              onClose={close}
              armed={armed}
              closing={closing}
              onAnimationEnd={(e) => {
                if (closing && e.target === win.current) {
                  setMounted(false)
                  setClosing(false)
                }
              }}
            />
          </div>,
          document.body
        )}
    </>
  )
}

function SettingsWindow({
  winRef,
  settings,
  onChange,
  spaceActions,
  vault,
  onPickVault,
  presets,
  presetActions,
  recovery,
  onRestoreRecovery,
  onPurgeRecovery,
  onRevealHeld,
  onTransferChanged,
  initialSection,
  onClose,
  armed,
  closing,
  onAnimationEnd
}: ShellProps & {
  winRef: React.RefObject<HTMLDivElement | null>
  initialSection: SectionId
  onClose: () => void
  armed: boolean
  closing: boolean
  onAnimationEnd: (e: React.AnimationEvent) => void
}): React.JSX.Element {
  const [section, setSection] = useState<SectionId>(initialSection)
  // Re-syncs if a File-menu jump fires again while the window is already
  // open — a plain useState initialiser only runs once, on first mount.
  // Closes Explore with it, for the reason `goTo` below explains.
  useEffect(() => {
    setSection(initialSection)
    setExplore(null)
  }, [initialSection])

  // General's "Open source licences" swaps the whole General page for the
  // licence list. Held here rather than inside General so the swap replaces
  // every block at once (Startup, Formatting, Legal, More) instead of
  // dropping the list in underneath them. Reset on any section change.
  const [showLicenses, setShowLicenses] = useState(false)
  useEffect(() => {
    setShowLicenses(false)
  }, [section])

  // Your collection's "Explore and install more" swaps the whole page the same
  // way, and for the same reason — the shelves and the catalogue must never be
  // on screen together, which is the entire point of the split (Collection.tsx).
  // Non-null IS "the explore page is open", and the value is which tab, so the
  // three doors on Collection can each open on their own one.
  const [explore, setExplore] = useState<ExploreTab | null>(null)

  /** Every section change goes through here, so that leaving Your collection
   *  always closes Explore behind you — coming back to a page you left three
   *  sections ago and finding the catalogue instead of your shelves is a lie
   *  about where you are.
   *
   *  NOT the `useEffect(..., [section])` that `showLicenses` uses beside it,
   *  which looks like the same problem and isn't. An effect keyed on `section`
   *  fires AFTER the commit, so it would run after a search result set both
   *  the section AND its tab — clearing the tab it had just asked for, and
   *  landing "make a tint" on the shelves every time. Nothing jumps INTO the
   *  licence list, so the effect is still right for it. */
  /** Which fold a search result asked to open — one of Look's, or General's
   *  More — and a counter that makes each ask distinct. The counter is the
   *  whole point: search "density" (Sidebar opens), close it by hand, search
   *  "nav buttons" — the fold is the same string, so on its own it would be
   *  `===` to last time, Disclosure's effect would not re-run, and the second
   *  search would land on a closed fold. Cleared by any ordinary navigation,
   *  so reaching a page from the list gives you it as you left it. */
  const [openDisclosure, setOpenDisclosure] = useState<{ fold: string; n: number } | null>(null)
  const askCount = useRef(0)

  const goTo = (target: SectionId, tab: ExploreTab | null = null, fold: string | null = null): void => {
    setSection(target)
    setExplore(tab)
    setOpenDisclosure(fold ? { fold, n: ++askCount.current } : null)
  }

  /** The list entry the current page belongs to — which one is lit, and
   *  which tabs show above the page. */
  const group = GROUP_OF[section]

  // ONE instance, shared by Customisation/Spaces (the picker: only shows
  // what's installed) and Collection (the catalogue: preview, download,
  // import your own) — so a download made from any of the three shows up in
  // all of them without a refresh. See useInstalledFonts.ts.
  const fontLibrary = useInstalledFonts()

  /** The page area — the one part of the window that scrolls. A search result
   *  scrolls it to the setting (`landing`, below). */
  const pageRef = useRef<HTMLDivElement>(null)

  // The window flies out of the gear as a clean sheet, then fills: the nav
  // ripples in top to bottom, then the page (Reuben, 2026-09-25). Started the
  // moment the genie is armed, so the delays count from its first frame. WAAPI
  // rather than CSS so it plays exactly once per opening — a CSS entrance would
  // replay every time the nav remounts, which it does whenever a settings
  // search is cleared. No `fill: forwards`: the content rests at no transform,
  // which Windows needs for sharp text (CLAUDE.md).
  const navRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!armed || !motionOn()) return
    const rise = [
      { opacity: 0, transform: 'translateY(6px)' },
      { opacity: 1, transform: 'none' }
    ]
    const ease = 'cubic-bezier(0.16, 1, 0.3, 1)'
    navRef.current?.querySelectorAll<HTMLElement>('[data-arrive]').forEach((el, i) => {
      el.animate(rise, { duration: 300, delay: 90 + i * 12, easing: ease, fill: 'backwards' })
    })
    pageRef.current?.animate(rise, { duration: 340, delay: 150, easing: ease, fill: 'backwards' })
  }, [armed])

  // Changing page settles the new one in with the same small rise, instead of
  // swapping it in a single frame. The first render is the opening above.
  const shownSection = useRef(section)
  useLayoutEffect(() => {
    if (shownSection.current === section) return
    shownSection.current = section
    if (!motionOn()) return
    pageRef.current?.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' }
      ],
      { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    )
  }, [section])

  /** Where a search result goes: its page (and tab, and fold), and then the
   *  setting itself. Landing on the right page wasn't enough — testing every
   *  result on 2026-09-29 found eleven that opened the right page or fold
   *  with the setting still below the bottom edge (Editor width at the foot
   *  of Page, Delete a space at the foot of Spaces, Number format under
   *  General's toggles). So the page is carried to the setting, centred, and
   *  it glows for a moment so the eye finds it.
   *
   *  Found by the words shown on the page — the entry's `anchor`, or its
   *  label when that is what's printed — because the pages are free-form, with
   *  no ids to aim at. Looked for over the next few frames: a setting inside
   *  a fold only exists once the fold has opened, which is a render later. */
  const [landing, setLanding] = useState<{ text: string; n: number } | null>(null)
  const landCount = useRef(0)
  const jumpTo = (target: SearchEntry): void => {
    // Back to the top first, so a result that can't be found on its page (the
    // Mac has no automatic-updates switch to find) lands at the page's start
    // rather than wherever the last one was scrolled to.
    pageRef.current?.scrollTo({ top: 0 })
    goTo(target.section, target.explore ?? null, target.disclosure ?? null)
    setLanding({ text: target.anchor ?? target.label, n: ++landCount.current })
  }
  useEffect(() => {
    if (!landing) return
    let frame = 0
    let tries = 0
    const seek = (): void => {
      const el = findOnPage(pageRef.current, landing.text)
      if (!el) {
        if (++tries < 30) frame = requestAnimationFrame(seek)
        return
      }
      el.scrollIntoView({ block: 'center' })
      if (!glowAllowed()) return
      // A colour, not a movement: nothing that sits still may move (the
      // motion rules in CLAUDE.md). The row it's on, not just its words.
      // Rises, holds, then fades, over three seconds. It was a 1.6s flash
      // that faded from its first frame, and Reuben found it too fast to
      // catch (2026-09-29: "needs to be a slower glow").
      const row = el.closest<HTMLElement>('button, section, [role=group]') ?? el.parentElement ?? el
      const glow = 'rgb(var(--accent-500) / 0.18)'
      const none = 'rgb(var(--accent-500) / 0)'
      row.animate(
        [
          { backgroundColor: none, easing: 'ease-out' },
          { backgroundColor: glow, offset: 0.12 },
          { backgroundColor: glow, offset: 0.45, easing: 'ease-in-out' },
          { backgroundColor: none }
        ],
        { duration: 3000 }
      )
    }
    // Two frames in: the fold a result opens is drawn in the render after
    // this one, and its own nearest-scroll runs first.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(seek)
    })
    return () => cancelAnimationFrame(frame)
  }, [landing])

  return (
    <div
      ref={winRef}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onAnimationEnd={onAnimationEnd}
      className={
        // Sized off the WINDOW, with the caps only there to stop it sprawling on
        // a very large display. 720×600 was a fixed box that looked stranded in
        // the middle of a normal desktop window, and the settings pages have
        // grown enough to want the room.
        'genie relative flex h-[min(820px,84vh)] w-[min(1040px,80vw)] flex-col overflow-hidden border border-ink-300/25 bg-surface shadow-float ' +
        (armed ? 'run ' : '') +
        (closing ? 'closing' : '')
      }
    >
      <div className="grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-ink-300/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-brand-500">
            <Icon name="gear" className="h-4 w-4" />
          </span>
          <p className="font-display text-[15px] font-semibold text-ink-900">Settings</p>
        </div>
        {/* Centred in the title bar, and there on every page — the quickest way
            to anything in here is to type what you're after (Reuben,
            2026-09-29). It used to sit at the top of the left-hand list. */}
        <SettingsSearch onPick={jumpTo} />
        <div className="flex justify-end">
          <button
            onClick={onClose}
            data-tip="Close (Esc)"
            aria-label="Close"
            className="rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* `gap-2`: six entries in a tall column read as a cramped block at
            the old 2px gap (Reuben, 2026-09-29: "space the icons out a bit
            more"). */}
        <nav ref={navRef} aria-label="Settings pages" className="flex w-48 shrink-0 flex-col gap-2 border-r border-ink-300/20 p-2">
          {GROUPS.map((g) => {
            const on = group.id === g.id
            return (
              <button
                key={g.id}
                data-arrive
                onClick={() => goTo(g.pages[0].id)}
                aria-current={on}
                className={
                  'flex w-full items-center gap-2 rounded-xl border-none px-2.5 py-2 text-left text-[13px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                  // The settings window's own sidebar takes the accent
                  // alongside the section headings — the two are what give
                  // this window its shape (Reuben, 2026-09-06). Everything
                  // else in here stays ink unless "Colour all UI text" is on.
                  (on
                    ? 'bg-accent-500/15 text-accent-600'
                    : 'bg-transparent text-accent-500 hover:bg-ink-300/15 hover:text-accent-600')
                }
              >
                <Icon name={g.icon} className="h-4 w-4" />
                <span>{g.label}</span>
              </button>
            )
          })}
        </nav>

        {/* The scroll container. `min-h-0` on the row above is what lets it
            actually scroll instead of stretching the window past its height. */}
        <div ref={pageRef} className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {/* The pages of a merged entry. Hidden while Explore is open: that
              page has its own back button and its own row of tabs, and two
              rows of tabs stacked is one too many. */}
          {group.pages.length > 1 && !(section === 'collection' && explore) && (
            <PageTabs tabs={group.pages} value={section} onPick={(id) => goTo(id)} label={group.label} />
          )}
          {section === 'general' &&
            (showLicenses ? (
              <OssLicenses onBack={() => setShowLicenses(false)} />
            ) : (
              // Each block wrapped so the container's `gap-6` separates the
              // sections and each section's own margins do the rest — General
              // and Formatting return flat fragments, so without a wrapper
              // every heading floated a full gap off its own subtitle.
              <>
                <div>
                  <General settings={settings} onChange={onChange} />
                </div>
                <div>
                  <Formatting settings={settings} onChange={onChange} />
                </div>
                <p className="rounded-xl bg-ink-300/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-500 ring-1 ring-ink-300/25">
                  <span className="font-medium text-brand-600">Looking for the theme, colours or
                  the sidebar?</span>{' '}
                  Those belong to a space, not to the app — see{' '}
                  <button type="button" className={LEGAL_LINK} onClick={() => goTo('customisation')}>
                    Look
                  </button>{' '}
                  to set them everywhere at once, or{' '}
                  <button type="button" className={LEGAL_LINK} onClick={() => goTo('spaces')}>
                    Spaces
                  </button>{' '}
                  to set one on its own.
                </p>
                <div>
                  <Legal onOpenLicences={() => setShowLicenses(true)} />
                </div>
                {/* Last, and folded: starting over is something you reach for
                    rarely, so it shouldn't sit between the everyday settings
                    (Reuben, 2026-09-29). Search still reaches it — both rows
                    carry `disclosure: 'More'` and open this on arrival. */}
                <MoreFold
                  openSignal={openDisclosure?.fold === 'More' ? openDisclosure.n : undefined}
                >
                  <VaultReset />
                </MoreFold>
              </>
            ))}
          {section === 'customisation' && (
            <Customisation
              settings={settings}
              onChange={onChange}
              onColorExisting={() =>
                spaceActions.onColorExistingFolders(settings.spaces.map((s) => s.folder))
              }
              onGoToSpaces={() => goTo('spaces')}
              fontLibrary={fontLibrary}
              openDisclosure={openDisclosure}
            />
          )}
          {section === 'sourceFolder' && <SourceFolder vault={vault} onPickVault={onPickVault} />}
          {section === 'transferData' && (
            <TransferData
              onImported={() => {
                onTransferChanged?.()
                void fontLibrary.reload()
              }}
            />
          )}
          {section === 'recovery' && (
            <Recovery
              items={recovery}
              onRestore={onRestoreRecovery}
              onPurge={onPurgeRecovery}
              onRevealHeld={onRevealHeld}
            />
          )}
          {section === 'import' && (
            <>
              <button
                type="button"
                onClick={() => goTo('transferData')}
                className="btn-edge flex w-full items-center gap-2.5 rounded-xl border border-ink-300/30 bg-ink-300/10 px-3.5 py-2.5 text-left outline-none transition duration-200 hover:border-ink-300/60 focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <Icon name="export" className="h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-ink-700">
                    Moving your setup from another computer?
                  </span>
                  <span className="block text-[11.5px] leading-relaxed text-ink-400">
                    Presets, custom fonts and the update channel move separately from your notes —
                    manage that in Transfer data.
                  </span>
                </span>
                <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300" />
              </button>
              <ImportPanel onOpenSpace={spaceActions.onOpenSpace} onClose={onClose} variant="settings" />
            </>
          )}
          {section === 'tutorials' && <Tutorials />}
          {section === 'spaces' && (
            <Spaces
              settings={settings}
              onChange={onChange}
              actions={spaceActions}
              presets={presets}
              presetActions={presetActions}
              vault={vault}
              fontLibrary={fontLibrary}
            />
          )}
          {section === 'collection' &&
            (explore ? (
              <Explore
                tab={explore}
                onTab={setExplore}
                onBack={() => setExplore(null)}
                settings={settings}
                onChange={onChange}
                fontLibrary={fontLibrary}
              />
            ) : (
              <Collection
                settings={settings}
                onChange={onChange}
                onGoToSpaces={() => goTo('spaces')}
                onExplore={setExplore}
                fontLibrary={fontLibrary}
              />
            ))}
          {section === 'updates' && <UpdatesSection />}
          {section === 'reportBug' && <ReportBug />}
          {section === 'requestFeature' && <RequestFeature />}
        </div>
      </div>
    </div>
  )
}

function General({ settings, onChange }: Props): React.JSX.Element {
  return (
    <>
      <h3 className="accent-heading font-display text-[15px] font-semibold">Startup</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">What you see when the app opens.</p>
      {/* Was two full-height option cards — the same "pick one of these" shape
          as Date format and Time zone below, just given special-case treatment.
          A select box says it in the same language as the rest of the page;
          `size="lg"` keeps each option's description readable rather than
          truncating it the way Date format's short live-examples can afford to. */}
      <div className="relative mt-3 inline-block">
        <Select
          value={settings.startup}
          options={STARTUPS.map((s) => ({ id: s.id, label: s.label, example: s.hint }))}
          onChange={(v) => onChange({ startup: v as AppSettings['startup'] })}
          align="left"
          size="lg"
        />
      </div>

      <div className="mt-5">
        <ToggleRow
          on={settings.playStartupAnimation}
          onClick={() => onChange({ playStartupAnimation: !settings.playStartupAnimation })}
          label="Play startup animation"
          hint="A short wordmark animation while a vault opens, in white or ink to match your theme."
        />
      </div>

      <h3 className="mt-6 accent-heading font-display text-[15px] font-semibold">Animations</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Motion used throughout the interface.</p>
      <div className="mt-3">
        <ToggleRow
          on={settings.animationsEnabled}
          onClick={() => onChange({ animationsEnabled: !settings.animationsEnabled })}
          label="Interface animations"
          hint="Opening settings, hovers, dropdowns and the like. Off makes all of it instant."
        />
      </div>

      <h3 className="mt-6 accent-heading font-display text-[15px] font-semibold">Photos and video</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Deleting one from a note.</p>
      <div className="mt-3">
        <ToggleRow
          on={settings.confirmMediaDelete}
          onClick={() => onChange({ confirmMediaDelete: !settings.confirmMediaDelete })}
          label="Check before deleting"
          hint="On, you're asked before it goes to the bin. Off, you get an Undo instead — the same choice the dialog's own Always ask / Never ask again buttons set."
        />
      </div>
    </>
  )
}

/** Two ways to start the app fresh without reinstalling: replay the first-run
 *  flow, or switch to a disposable vault to experiment in. Both talk to main
 *  directly (app-level, in userData/config.json), the same way Updates and
 *  Recovery own their reads. Neither touches the notes in the real vault.
 *  Was the "Developer" section — pulled out under its own heading because a
 *  returning user genuinely reaches for both of these, not only someone
 *  testing the app. */
function VaultReset(): React.JSX.Element {
  const [replaying, setReplaying] = useState(false)
  const replayOnboarding = (): void => {
    setReplaying(true)
    // A full reload into the flow, not a live state flip: a boot from scratch
    // is a truer first run. Clearing the saved step stops it resuming wherever
    // a past mid-flow quit left off instead of starting at Welcome.
    void window.api
      .setOnboarded(false)
      .then(() => window.api.setOnboardingStep(null))
      .then(() => window.location.reload())
  }

  const [resetting, setResetting] = useState(false)
  const resetTestVault = (): void => {
    setResetting(true)
    void window.api.resetOnboardingTestVault().then(() => window.location.reload())
  }

  return (
    <>
      <h3 className="accent-heading font-display text-[15px] font-semibold">Vault reset</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Start over without reinstalling. Neither of these touches the notes in your real vault.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <div className="btn-edge flex items-center gap-3 rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink-700">
              Replay the first-run walkthrough
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">
              Reloads the app and opens the introduction you saw the first time. It recognises this
              vault, so nothing is re-created — your notes and settings stay as they are.
            </span>
          </span>
          <button
            type="button"
            disabled={replaying}
            onClick={replayOnboarding}
            className="mini shrink-0"
          >
            {replaying ? 'Opening…' : 'Replay'}
          </button>
        </div>
        <div className="btn-edge flex items-center gap-3 rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink-700">
              Reset to a blank test vault
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">
              Switches to a separate, disposable folder and wipes it clean, for trying things out
              without affecting your real vault. Switch back any time from Data → Source folder.
            </span>
          </span>
          <button
            type="button"
            disabled={resetting}
            onClick={resetTestVault}
            className="mini shrink-0"
          >
            {resetting ? 'Resetting…' : 'Reset'}
          </button>
        </div>
      </div>
    </>
  )
}

/** The canonical legal text is the website (site/terms.html, site/privacy.html);
 *  the section below is the in-app summary of it. Keep the two in step when
 *  either changes. `openExternal` hands the URL to the system browser
 *  (main/externalLinks.ts allows http/https/mailto). */
const TERMS_URL = 'https://notealise.com/terms.html'
const PRIVACY_URL = 'https://notealise.com/privacy.html'
const LEGAL_LINK =
  'rounded border-none bg-transparent p-0 font-medium text-brand-600 underline underline-offset-2 outline-none transition-colors hover:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-300'

/** The plain-English legal summary and the open-source licences link — last on
 *  the General page. `onOpenLicences` is owned by SettingsWindow, not local
 *  state, so opening the list replaces the whole General page rather than
 *  stacking under the sections above it. */
function Legal({ onOpenLicences }: { onOpenLicences: () => void }): React.JSX.Element {
  const point = 'text-[12px] leading-relaxed text-ink-500'
  return (
    <>
      <h3 className="accent-heading font-display text-[15px] font-semibold">Legal</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        The essentials are below. The full terms of use and privacy policy are on the
        website.
      </p>

      <div className="mt-3 flex flex-col gap-2.5">
        <div className={point}>
          <span className="font-medium text-ink-700">Your notes are yours.</span> They are
          plain files in the folder you chose. Notealise never uploads them and cannot read
          them remotely. Delete the app and they stay exactly where they are.
        </div>
        <div className={point}>
          <span className="font-medium text-ink-700">What the app sends.</span> It asks
          GitHub whether a newer version exists a few times a day &mdash; that tells GitHub
          your device&rsquo;s IP address and a short app-version and operating-system string.
          Nothing else is sent unless you download an optional font. No account, no
          analytics, no tracking.
        </div>
        <div className={point}>
          <span className="font-medium text-ink-700">No warranty.</span> Notealise is
          provided as-is, with no warranty of any kind. Software can have bugs &mdash; back
          up anything important. The author is not liable for lost data, and nothing here
          affects your statutory consumer rights.
        </div>
        <div className={point}>
          <span className="font-medium text-ink-700">Governing law.</span> These terms are
          governed by the law of England and Wales.
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-500">
        Full text:{' '}
        <button
          type="button"
          className={LEGAL_LINK}
          onClick={() => void window.api.openExternal(TERMS_URL)}
        >
          Terms of use
        </button>
        {' · '}
        <button
          type="button"
          className={LEGAL_LINK}
          onClick={() => void window.api.openExternal(PRIVACY_URL)}
        >
          Privacy policy
        </button>
        <span className="text-ink-400"> &mdash; opens notealise.com in your browser.</span>
      </p>

      <button
        type="button"
        onClick={onOpenLicences}
        className="mt-2 flex items-center gap-1 rounded-lg border-none bg-transparent px-2 py-1 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        Open source licences
        <Icon name="chevron" className="h-3.5 w-3.5" />
      </button>
    </>
  )
}

function Formatting({ settings, onChange }: Props): React.JSX.Element {
  const tz = settings.timezone
  const now = Date.now()
  const dateOpts = useMemo(
    () => DATE_FORMATS.map((f) => ({ ...f, example: formatDate(now, f.id, tz) })),
    [tz, now]
  )
  const zoneOpts = useMemo(
    () =>
      timezones().map((z) =>
        z === 'system'
          ? { id: 'system', label: 'System default', example: localZone() }
          : { id: z, label: z.replace(/_/g, ' ') }
      ),
    []
  )

  return (
    <>
      <SettingRow title="Date format" desc="Used for edit times and for the archive and bin.">
        <Select
          value={settings.dateFormat}
          options={dateOpts}
          onChange={(v) => onChange({ dateFormat: v as AppSettings['dateFormat'] })}
        />
      </SettingRow>
      {/* Sits with Date format, not at the foot of the group — it's the worked
          example of what the format above does to a note's own header. */}
      <p className="-mt-1.5 px-1 pb-1 text-[11.5px] leading-relaxed text-ink-400">
        A note's header shows when it was last edited — {formatDate(now, settings.dateFormat, tz)} right
        now. Hover it for the exact time, and when the note was created.
      </p>
      <div className="border-t border-ink-300/15" />

      <SettingRow title="Time zone" desc="Which clock times are shown in. Hover a note's edit time to see it.">
        <Select value={tz} options={zoneOpts} filter onChange={(v) => onChange({ timezone: v })} />
      </SettingRow>
      <div className="border-t border-ink-300/15" />

      <SettingRow title="Number format" desc="Choose how numbers are formatted. Default uses your language setting.">
        <Select
          value={settings.numberFormat}
          options={NUMBER_FORMATS}
          onChange={(v) => onChange({ numberFormat: v as AppSettings['numberFormat'] })}
        />
      </SettingRow>
    </>
  )
}

/** Which version you're on, whether to update in the background, a manual check,
 *  and the live status. Self-contained — it talks to main directly rather than
 *  threading update state through the settings props, because it is the only
 *  place that needs the version and the preference. */
function UpdatesSection(): React.JSX.Element {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [autoUpdate, setAuto] = useState(true)
  /** false on the unsigned macOS build. Read from main rather than inferred
   *  from `status.manual`, which does not exist until a check has run — and
   *  this decides whether a control is rendered at all. */
  const [selfInstall, setSelfInstall] = useState(true)

  useEffect(() => {
    void (async () => {
      const s = await window.api.getUpdateState()
      setVersion(s.version)
      setStatus(s.status)
      setAuto(s.prefs.autoUpdate)
      setSelfInstall(s.selfInstall)
    })()
    return window.api.onUpdateStatus(setStatus)
  }, [])

  const blocked = status.state === 'unsupported'
  const busy = status.state === 'checking' || status.state === 'downloading'

  // macOS reaches every state below EXCEPT that it can never apply anything —
  // Squirrel.Mac refuses an unsigned update. So the words change, not the
  // states: "ready" is a file in Downloads rather than something staged, and
  // "up to date" carries the doubt when the check could not run at all.
  const manual = status.manual === true

  const line = ((): string => {
    switch (status.state) {
      case 'checking':
        return 'Checking…'
      case 'none':
        return manual && status.message ? status.message : "You're up to date."
      case 'available':
        return status.version
          ? `Version ${status.version} is out.`
          : 'An update is available.'
      case 'downloading':
        return `Downloading… ${status.percent ?? 0}%`
      case 'ready':
        return manual
          ? `Version ${status.version ?? ''} is in your Downloads folder. Open it and drag Notealise across to replace this copy.`.replace(
              '  ',
              ' '
            )
          : 'An update is ready — restart to apply.'
      case 'error':
        return `Couldn't check: ${status.message ?? 'unknown error'}`
      case 'unsupported':
        return status.message ?? 'Updates are unavailable on this build.'
      default:
        return ''
    }
  })()

  return (
    <section className="settings-group">
      <h3>Updates</h3>
      <p className="hint">
        {version
          ? selfInstall
            ? "You're all set."
            : // MAC_UNSIGNED_WORKAROUND — with the toggle gone (below), this
              // line is the only thing left saying the app is looking at all.
              // Without it the macOS page reads as inert: a heading, a
              // version, and a button, with nothing to say checking happens.
              'Notealise checks for a new version each time it opens, and tells you when there is one.'
          : 'Checking for updates…'}
      </p>

      {/* MAC_UNSIGNED_WORKAROUND — hidden on macOS, where it has nothing left to
          control. The check now runs on every launch regardless of this pref
          (see main/updater.ts's initUpdater), and a Mac never downloads without
          a click, so on that platform the toggle governed nothing a user could
          observe. A control that does nothing is worse than an absent one.
          Comes back on its own when the app is signed and `selfInstall` is
          true everywhere. */}
      {selfInstall && (
        <div className="mode-row">
          <button
            className={'mode-btn' + (autoUpdate && !blocked ? ' on' : '')}
            aria-pressed={autoUpdate && !blocked}
            disabled={blocked}
            onClick={() => {
              const next = !autoUpdate
              setAuto(next)
              void window.api.setAutoUpdate(next)
            }}
          >
            <span className="t">Install updates automatically</span>
            <span className="s">
              {blocked
                ? 'Not available on this build'
                : 'Downloads new versions quietly and applies them when you quit. Either way, Notealise checks for one each time it opens and tells you.'}
            </span>
          </button>
        </div>
      )}

      <div className="mode-row">
        <button
          className="mini"
          disabled={busy}
          onClick={() => {
            if (blocked) window.api.openReleases()
            else void window.api.checkForUpdate()
          }}
        >
          {blocked ? 'Open downloads page' : busy ? 'Checking…' : 'Check now'}
        </button>
        {status.state === 'ready' && !manual && (
          <button className="mini" onClick={() => window.api.installUpdate()}>
            Restart &amp; install
          </button>
        )}
        {status.state === 'ready' && manual && (
          <button className="mini" onClick={() => void window.api.revealUpdate()}>
            Show it in Finder
          </button>
        )}
        {status.state === 'available' && !blocked && (
          <button className="mini" onClick={() => void window.api.downloadUpdate()}>
            {/* Named on macOS, because this is where the toast's "Get it" lands
                and a bare "Download" gives no clue what arrives or how big. */}
            {manual ? `Download ${status.version ?? ''}`.trim() : 'Download'}
          </button>
        )}
      </div>

      {line && <p className="hint">{line}</p>}

      {/* MAC_UNSIGNED_WORKAROUND — the walkthrough, reachable at any time rather
          than only in the moment a download finishes (App.tsx's prompt). Someone
          who dismissed that dialog, or who is part-way through the steps and
          stuck, needs a way back to them, and Settings → Updates is where they
          will look. Goes when the app is signed. */}
      {!selfInstall && (
        <p className="hint">
          <button
            className="rounded border-none bg-transparent p-0 font-medium text-brand-600 underline underline-offset-2 outline-none transition-colors hover:bg-transparent hover:text-brand-700"
            onClick={() => void window.api.openExternal(MAC_INSTALL_GUIDE_URL)}
          >
            How to open a new version on a Mac
          </button>
        </p>
      )}
    </section>
  )
}

/** Both of these are the shared RequestForm (RequestForm.tsx) with a different
 *  inbox behind them; Explore's "ask us for a page look" is the third. */
function ReportBug(): React.JSX.Element {
  return (
    <RequestForm
      idPrefix="bug"
      title="Report a bug"
      hint="Opens your email app with this pre-filled, addressed to our support inbox."
      placeholder="What happened, and what did you expect instead?"
      send={(email, message) => window.api.sendBugReport(email, message)}
    />
  )
}

function RequestFeature(): React.JSX.Element {
  return (
    <RequestForm
      idPrefix="feature"
      title="Request a feature"
      hint="Opens your email app with this pre-filled, addressed to our features inbox."
      placeholder="What would you like to see?"
      send={(email, message) => window.api.sendFeatureRequest(email, message)}
    />
  )
}
