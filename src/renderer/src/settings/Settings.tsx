import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STARTUPS, type AppSettings } from './model'
import { Icon, type IconName } from '../icons'
import { Select, SettingRow, ToggleRow } from './primitives'
import { Spaces, type SpaceActions } from './Spaces'
import { Collection } from './Collection'
import { Customisation } from './Customisation'
import { Tutorials } from './tutorials'
import { OssLicenses } from './OssLicenses'
import { SourceFolder } from './SourceFolder'
import { Recovery } from './Recovery'
import { ImportPanel } from '../import/ImportPanel'
import { DATE_FORMATS, NUMBER_FORMATS, formatDate, localZone, timezones } from '../intl'
import {
  isPrereleaseVersion,
  MAC_INSTALL_GUIDE_URL,
  type UpdateStatus
} from '../../../shared/update'
import type { PresetActions } from './Presets'
import type { SpacePreset } from '../../../shared/presets'
import type { RecoveryItem } from '../../../shared/workspace'
import { useInstalledFonts } from './useInstalledFonts'

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
}

export type SectionId =
  | 'general'
  | 'customisation'
  | 'spaces'
  | 'collection'
  | 'sourceFolder'
  | 'recovery'
  | 'import'
  | 'tutorials'
  | 'updates'
  | 'reportBug'
  | 'requestFeature'

// Legacy's SECTIONS + SECTION_ICON (legacy/src/settings.js:35, legacy/src/App.jsx:1042).
// Appearance / Arranging / Shortcuts are NOT top-level entries: they belong to a
// space, and are reached either through Customisation (all spaces) or Spaces
// (one). Spaces, Your collection, Updates and Report a bug have no legacy
// counterpart.
//
// **The split between the first two is the rule this window is built on:**
//
//   General        — one app launch, one locale. Startup, dates, numbers, the
//                    clock. Nothing here is per-space and nothing ever will be.
//   Customisation  — how the app LOOKS and what it shows. Every setting on that
//                    page belongs to a SPACE; the page writes to all of them at
//                    once, and links to Spaces for setting just one.
//
// Keep them apart. They were one page ("Master settings") and it meant a user
// looking for the date format scrolled past the entire appearance system, while
// a user looking for the theme had no reason to think "master" was where it
// lived.
const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'customisation', label: 'Customisation', icon: 'sun' },
  { id: 'spaces', label: 'Spaces', icon: 'spaces' },
  { id: 'collection', label: 'Your collection', icon: 'library' },
  { id: 'sourceFolder', label: 'Source folder', icon: 'folder' },
  { id: 'recovery', label: 'Recovery', icon: 'restore' },
  { id: 'import', label: 'Import', icon: 'import' },
  { id: 'tutorials', label: 'Tutorials', icon: 'book' },
  { id: 'updates', label: 'Updates', icon: 'restore' },
  { id: 'reportBug', label: 'Report a bug', icon: 'flag' },
  { id: 'requestFeature', label: 'Request a feature', icon: 'star' }
]

const SECTION_LABEL: Record<SectionId, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.label])
) as Record<SectionId, string>

interface SearchEntry {
  section: SectionId
  label: string
  hint: string
  /** Terms someone might type instead of the label above — synonyms, brand
   *  names of things being replaced, related jargon. Never shown in the UI;
   *  matched against same as label/hint. This is what makes "dark mode" find
   *  "Theme": nothing about the algorithm knows that on its own, so it has to
   *  be told. */
  keywords: string
}

// Hand-maintained, not derived from the section components below — those are
// free-form JSX, not a settings schema. Routes to the SECTION a setting lives
// on, not to the control itself. Keep this in sync as settings move or get
// added; nothing enforces that automatically.
const SEARCH_INDEX: SearchEntry[] = [
  { section: 'general', label: 'Start empty', hint: 'Open on the blank screen and pick a note.', keywords: 'blank new launch open' },
  { section: 'general', label: 'Reopen your tabs', hint: 'Come back to the notes you left open, split the way you left them.', keywords: 'resume restore session continue last open tabs' },
  { section: 'general', label: 'Play startup animation', hint: 'A short wordmark animation while a vault opens.', keywords: 'splash screen logo boot launch intro' },
  { section: 'general', label: 'Interface animations', hint: 'Opening settings, hovers, dropdowns and the like.', keywords: 'motion transitions effects reduce motion speed disable' },
  { section: 'general', label: 'Date format', hint: 'Used for edit times and for the archive and bin.', keywords: 'day month year dd mm yyyy 12 hour 24 hour 12hr 24hr am pm dates' },
  { section: 'general', label: 'Time zone', hint: 'Which clock times are shown in.', keywords: 'timezone clock utc gmt local time' },
  { section: 'general', label: 'Number format', hint: 'Choose how numbers are formatted.', keywords: 'decimal comma thousand separator locale numbers' },
  { section: 'general', label: 'Onboarding completed', hint: 'Dev tool — reloads into the first-run flow.', keywords: 'onboarding tutorial first run walkthrough developer testing' },
  { section: 'general', label: 'Reset test vault', hint: 'Wipes a disposable test folder and clears onboarding.', keywords: 'test vault wipe clean slate developer sandbox' },
  { section: 'general', label: 'Open source licences', hint: 'Every third-party package the app ships, and its licence.', keywords: 'legal licenses license copyright open source third party attribution warranty' },
  { section: 'customisation', label: 'Theme', hint: 'Light, dark or extra dark, applied to the whole app.', keywords: 'dark mode light mode night mode black extra dark appearance colour scheme' },
  { section: 'customisation', label: 'Text colour', hint: 'How bright the writing sits on a dark background.', keywords: 'white grey text brightness dark theme readability contrast' },
  { section: 'customisation', label: 'Accent colour', hint: 'Pick a colour, then choose how far it reaches.', keywords: 'accent color highlight brand colour tint hue' },
  { section: 'customisation', label: 'Stronger button edges', hint: 'How hard the edges of buttons and controls read against the page.', keywords: 'button outline border contrast ui buttons edges' },
  { section: 'customisation', label: 'Density', hint: 'How tightly notes and folders pack in the sidebar.', keywords: 'compact spacing sidebar rows tight loose comfortable size' },
  { section: 'customisation', label: 'Editor width', hint: 'How wide the writing area grows.', keywords: 'line length text width column wide narrow reading margins' },
  { section: 'customisation', label: 'Fonts', hint: 'Interface font, notes font, and an easier-reading override.', keywords: 'font family typeface typography ui font' },
  { section: 'customisation', label: 'Easier reading font', hint: 'A dyslexia-friendly override for a note’s body text.', keywords: 'dyslexia dyslexic accessibility opendyslexic readability' },
  { section: 'customisation', label: 'How a colour shows', hint: 'A coloured tag, a tinted row, or a solid row.', keywords: 'colour style tag dot tinted row solid display' },
  { section: 'customisation', label: 'Notes take their folder’s colour', hint: 'Colour inheritance for notes inside a coloured folder.', keywords: 'inherit colour folder notes propagate' },
  { section: 'customisation', label: 'Reduce opacity for nested colours', hint: 'Fades colour the deeper it’s nested.', keywords: 'opacity fade nested subfolder colour intensity' },
  { section: 'customisation', label: 'Your palette', hint: 'The colours offered when colouring a note or folder.', keywords: 'colour palette custom colours hex swatch picker' },
  { section: 'customisation', label: 'Colour new folders automatically', hint: 'Give a new folder a colour as soon as it’s made.', keywords: 'auto colour automatic random new folder' },
  { section: 'customisation', label: 'Mix notes and folders freely', hint: 'One shared order instead of folders-then-notes.', keywords: 'sort order arrange alphabetical mixed together' },
  { section: 'customisation', label: 'Nav buttons', hint: 'Icons only for the Note / Folder buttons above the sidebar list.', keywords: 'note folder buttons icons toolbar compact labels' },
  { section: 'customisation', label: 'Show a note’s links', hint: 'A strip listing what a note points at and what points back at it.', keywords: 'backlinks links wiki links connections graph show hide' },
  { section: 'customisation', label: 'Keep links on screen', hint: 'The links strip stays put however far you scroll.', keywords: 'pin links sticky scroll fixed' },
  { section: 'customisation', label: 'Show the file path', hint: 'A bar between the tabs and the format bar reading Space › Folder › Note.', keywords: 'breadcrumb path bar folder location show hide' },
  { section: 'customisation', label: 'Show when it was last edited', hint: 'The edit time beside the word count.', keywords: 'edit time word count last modified timestamp' },
  { section: 'customisation', label: 'Markdown pro', hint: 'A button that switches between the formatted view and raw Markdown.', keywords: 'raw markdown source view syntax show hide marks' },
  { section: 'customisation', label: 'Custom buttons', hint: 'The four custom format-bar shortcut buttons.', keywords: 'format bar shortcuts toolbar bold italic custom' },
  { section: 'spaces', label: 'Add a space', hint: 'A new set of notes with its own look and folder.', keywords: 'new space create workspace' },
  { section: 'spaces', label: 'Space name', hint: 'What a space is called.', keywords: 'rename space title name' },
  { section: 'spaces', label: 'Representational emoji', hint: 'Shown on the switcher and the tab above, so you can tell spaces apart.', keywords: 'emoji icon space icon avatar' },
  { section: 'spaces', label: 'Saved presets', hint: 'Reusable looks you can apply to any space.', keywords: 'preset template save look apply' },
  { section: 'collection', label: 'Your collection', hint: 'Browse, download and import fonts.', keywords: 'fonts browse download library install' },
  { section: 'sourceFolder', label: 'Source folder', hint: 'Where your vault lives on disk, and switching to a different one.', keywords: 'vault folder location switch change move disk path' },
  { section: 'recovery', label: 'Recovery', hint: 'A 7-day safety net for anything deleted — restore or purge it.', keywords: 'trash bin recycle bin deleted restore undo delete recover backup' },
  { section: 'import', label: 'Import', hint: 'Bring notes in from Notion, Word, Google Keep, Apple Notes, HTML or Markdown.', keywords: 'notion word docx google keep apple notes html markdown migrate transfer evernote onenote obsidian' },
  { section: 'tutorials', label: 'Tutorials', hint: 'Guides for using the app, including linking your notes.', keywords: 'help guide how to learn walkthrough' },
  { section: 'updates', label: 'Install updates automatically', hint: 'Downloads new versions quietly and applies them when you quit. Windows only — a Mac cannot replace a running app.', keywords: 'auto update background version download install' },
  { section: 'updates', label: 'Receive test builds', hint: 'Early versions, for helping test.', keywords: 'beta channel early access prerelease test build' },
  { section: 'updates', label: 'Check for updates', hint: 'Manually check for a new version.', keywords: 'check version update manual refresh' },
  { section: 'reportBug', label: 'Report a bug', hint: 'Email us about something that went wrong.', keywords: 'bug crash issue problem broken feedback support email contact' },
  { section: 'requestFeature', label: 'Request a feature', hint: 'Email us an idea for something new.', keywords: 'feature request suggest idea feedback contact' }
]

// --- Fuzzy search, so "dark mode" finds Theme and a typo like "recovry"
// still finds Recovery, without pulling in a search library for 45 static
// rows. Every word in the query has to mean SOMETHING (exact, substring, or a
// close typo) in SOME field, or the entry doesn't match at all — that AND
// across words is what keeps "date format" from also surfacing "Number
// format". Results are ranked by how well they matched, label counting for
// most, so a direct hit always beats an incidental mention in a hint.
// Dropped from every field, query included, before matching — otherwise a
// hint like "A coloured tag, a tinted row" leaves stray one-letter tokens
// ("a") sitting in the haystack, and `token.includes(w)` makes THAT match
// almost any query that happens to contain the letter "a" (which is most of
// them). Same failure mode for the leftover "s" a split on `note's` produces.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'is', 'are', 'it', 'its', 'your',
  'you', 'for', 'as', 'at', 'by', 'be', 'this', 'that', 'with', 'from', 'into', 'so', 'or', 'and'
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const dp = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) dp[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

// How many typo'd characters a query word may be from a field word before it
// stops counting as a match. 0 below 4 letters — short words collide too
// easily ("on" is one edit from "no") — rising slowly after that.
function typoBudget(len: number): number {
  if (len <= 3) return 0
  if (len <= 6) return 1
  return 2
}

/** Best match strength between one query word and one field's words: 3 exact,
 *  2 substring either direction (only once both words have some length —
 *  otherwise a 2-letter fragment matches almost anything), 1 within typo
 *  budget, 0 no match. */
function fieldScore(token: string, fieldWords: string[]): number {
  let best = 0
  for (const w of fieldWords) {
    if (w === token) return 3
    if (token.length >= 3 && w.length >= 3 && (w.includes(token) || token.includes(w))) best = Math.max(best, 2)
    else if (levenshtein(token, w) <= typoBudget(token.length)) best = Math.max(best, 1)
  }
  return best
}

// Partial credit, not strict AND: a query word that matches nothing costs
// that word's share of the total rather than disqualifying the entry
// outright. Without this, "12 hour clock" scored zero on Date format, because
// "clock" (fair enough — that's Time zone's word) killed the other two words'
// otherwise-solid match. matchedCount/queryTokens.length still means a full
// match always outranks a partial one for the same raw score.
function scoreEntry(queryTokens: string[], fields: [string[], string[], string[]]): number {
  const [labelWords, keywordWords, hintWords] = fields
  let matched = 0
  let raw = 0
  for (const t of queryTokens) {
    const s = Math.max(
      fieldScore(t, labelWords) * 3,
      fieldScore(t, keywordWords) * 2,
      fieldScore(t, hintWords) * 1
    )
    if (s > 0) {
      matched++
      raw += s
    }
  }
  if (matched === 0) return 0
  return raw * (matched / queryTokens.length)
}

const SEARCH_FIELDS = SEARCH_INDEX.map(
  (e): [string[], string[], string[]] => [tokenize(e.label), tokenize(e.keywords), tokenize(e.hint)]
)

function searchSettings(query: string): SearchEntry[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  return SEARCH_INDEX.map((e, i) => ({ e, score: scoreEntry(tokens, SEARCH_FIELDS[i]) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.e)
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
  const [initialSection, setInitialSection] = useState<SectionId>(SECTIONS[0].id)
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
    if (!mounted) setInitialSection(SECTIONS[0].id)
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
        className={
          'btn-edge pointer-events-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ink-300/30 shadow-card outline-none backdrop-blur transition duration-200 spring hover:-translate-y-0.5 hover:text-brand-600 focus-visible:ring-4 focus-visible:ring-brand-100 ' +
          (open ? 'bg-brand-500/15 text-brand-600' : 'bg-surface/90 text-ink-500')
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
  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchSettings(query), [query])
  const jumpTo = (target: SectionId): void => {
    setSection(target)
    setQuery('')
  }

  // ONE instance, shared by Customisation/Spaces (the picker: only shows
  // what's installed) and Collection (the catalogue: preview, download,
  // import your own) — so a download made from any of the three shows up in
  // all of them without a refresh. See useInstalledFonts.ts.
  const fontLibrary = useInstalledFonts()

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
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-300/20 px-4 py-3">
        <span className="text-brand-500">
          <Icon name="gear" className="h-4 w-4" />
        </span>
        <p className="flex-1 font-display text-[15px] font-semibold text-ink-900">Settings</p>
        <button
          onClick={onClose}
          data-tip="Close (Esc)"
          aria-label="Close"
          className="rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-52 shrink-0 flex-col border-r border-ink-300/20 p-2">
          <div className="btn-edge mb-2 flex shrink-0 items-center gap-1.5 rounded-full border border-ink-300/30 bg-surface/70 py-1.5 pl-3 pr-1.5 focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
            <span className="shrink-0 text-ink-300">
              <Icon name="search" className="h-3.5 w-3.5" />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && matches.length > 0) jumpTo(matches[0].section)
              }}
              placeholder="Search settings"
              spellCheck={false}
              aria-label="Search settings"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink-900 outline-none placeholder:text-ink-300"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                data-tip="Clear"
                aria-label="Clear search"
                className="shrink-0 rounded-full border-none bg-transparent p-1 text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-brand-600"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {query.trim() ? (
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {matches.length === 0 && (
                <p className="px-2.5 py-2 text-[12px] leading-relaxed text-ink-400">
                  No settings found for &ldquo;{query.trim()}&rdquo;.
                </p>
              )}
              {matches.map((m, i) => (
                <button
                  key={m.section + m.label + i}
                  onClick={() => jumpTo(m.section)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-xl border-none px-2.5 py-2 text-left outline-none transition duration-200 hover:bg-brand-500/8 focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <span className="text-[12.5px] font-medium text-ink-700">{m.label}</span>
                  <span className="text-[11px] text-ink-400">{SECTION_LABEL[m.section]}</span>
                </button>
              ))}
            </div>
          ) : (
            SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                aria-current={section === s.id}
                className={
                  'flex w-full items-center gap-2 rounded-xl border-none px-2.5 py-2 text-left text-[13px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                  (section === s.id
                    ? 'bg-brand-500/12 text-brand-600'
                    : 'bg-transparent text-ink-500 hover:bg-brand-500/8 hover:text-brand-600')
                }
              >
                <Icon name={s.icon} className="h-4 w-4" />
                <span>{s.label}</span>
              </button>
            ))
          )}
        </nav>

        {/* The scroll container. `min-h-0` on the row above is what lets it
            actually scroll instead of stretching the window past its height. */}
        <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
          {section === 'general' && (
            <>
              <General settings={settings} onChange={onChange} />
              <Formatting settings={settings} onChange={onChange} />
              <p className="mt-2 rounded-xl bg-brand-500/8 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-500 ring-1 ring-brand-300/40">
                <span className="font-medium text-brand-600">Looking for the theme, colours or
                the sidebar?</span>{' '}
                Those belong to a space, not to the app — see{' '}
                <span className="font-medium text-ink-600">Customisation</span> to set them
                everywhere at once, or <span className="font-medium text-ink-600">Spaces</span> to
                set one on its own.
              </p>
            </>
          )}
          {section === 'customisation' && (
            <Customisation
              settings={settings}
              onChange={onChange}
              onColorExisting={() =>
                spaceActions.onColorExistingFolders(settings.spaces.map((s) => s.folder))
              }
              onGoToSpaces={() => setSection('spaces')}
              fontLibrary={fontLibrary}
            />
          )}
          {section === 'sourceFolder' && <SourceFolder vault={vault} onPickVault={onPickVault} />}
          {section === 'recovery' && (
            <Recovery
              items={recovery}
              onRestore={onRestoreRecovery}
              onPurge={onPurgeRecovery}
              onRevealHeld={onRevealHeld}
            />
          )}
          {section === 'import' && (
            <ImportPanel onOpenSpace={spaceActions.onOpenSpace} onClose={onClose} variant="settings" />
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
          {section === 'collection' && (
            <Collection onGoToSpaces={() => setSection('spaces')} fontLibrary={fontLibrary} />
          )}
          {section === 'updates' && <UpdatesSection />}
          {section === 'reportBug' && <ReportBug />}
          {section === 'requestFeature' && <RequestFeature />}
        </div>
      </div>
    </div>
  )
}

function General({ settings, onChange }: Props): React.JSX.Element {
  // Not part of AppSettings (it's app-level, in userData/config.json, like
  // vaultPath) — read straight off the IPC rather than threaded through
  // `settings`/`onChange`, the same way Updates/Recovery below own their reads.
  const [onboarded, setOnboardedState] = useState(true)
  useEffect(() => {
    void window.api.getOnboarded().then(setOnboardedState)
  }, [])
  const toggleOnboarding = (): void => {
    const next = !onboarded
    setOnboardedState(next)
    // A reload, not a live prop update: this is a dev testing hook, and a
    // full boot from scratch is a truer "different setup" than patching
    // Onboarding's live React state would be. Also clears the resume step —
    // without it, flipping this off would resume wherever a PAST mid-flow
    // quit left off rather than genuinely restarting at Welcome.
    void window.api
      .setOnboarded(next)
      .then(() => window.api.setOnboardingStep(null))
      .then(() => window.location.reload())
  }

  const [resetting, setResetting] = useState(false)
  const resetTestVault = (): void => {
    setResetting(true)
    void window.api.resetOnboardingTestVault().then(() => window.location.reload())
  }

  const [showLicenses, setShowLicenses] = useState(false)
  if (showLicenses) return <OssLicenses onBack={() => setShowLicenses(false)} />

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Startup</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">What you see when the app opens.</p>
      <div className="mt-3 flex flex-col gap-1">
        {STARTUPS.map((s) => {
          const active = settings.startup === s.id
          return (
            <button
              key={s.id}
              onClick={() => onChange({ startup: s.id })}
              aria-pressed={active}
              className={
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                (active ? 'bg-brand-500/12 ring-1 ring-brand-300/60' : 'ring-1 ring-transparent hover:bg-brand-500/8')
              }
            >
              <span className="min-w-0 flex-1">
                <span className={'block text-[13px] font-medium ' + (active ? 'text-brand-600' : 'text-ink-700')}>
                  {s.label}
                </span>
                <span className="block text-[11.5px] text-ink-400">{s.hint}</span>
              </span>
              <span className={'shrink-0 text-brand-600 transition-opacity ' + (active ? 'opacity-100' : 'opacity-0')}>
                <Icon name="check" className="h-4 w-4" />
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        <ToggleRow
          on={settings.playStartupAnimation}
          onClick={() => onChange({ playStartupAnimation: !settings.playStartupAnimation })}
          label="Play startup animation"
          hint="A short wordmark animation while a vault opens, in white or ink to match your theme."
        />
      </div>

      <h3 className="mt-6 font-display text-[15px] font-semibold text-ink-900">Animations</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Motion used throughout the interface.</p>
      <div className="mt-3">
        <ToggleRow
          on={settings.animationsEnabled}
          onClick={() => onChange({ animationsEnabled: !settings.animationsEnabled })}
          label="Interface animations"
          hint="Opening settings, hovers, dropdowns and the like. Off makes all of it instant."
        />
      </div>

      <h3 className="mt-6 font-display text-[15px] font-semibold text-ink-900">Photos and video</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Deleting one from a note.</p>
      <div className="mt-3">
        <ToggleRow
          on={settings.confirmMediaDelete}
          onClick={() => onChange({ confirmMediaDelete: !settings.confirmMediaDelete })}
          label="Check before deleting"
          hint="Select a photo or video by its grip and press Backspace and the file goes to the bin, alongside your deleted notes. On, you get asked first. Off, you get an Undo instead. This is what the dialog's Always ask and Never ask again set."
        />
      </div>

      <h3 className="mt-6 font-display text-[15px] font-semibold text-ink-900">Developer</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">Testing tools — not meant for a shipped build.</p>
      <div className="mt-3 flex flex-col gap-2">
        <ToggleRow
          on={onboarded}
          onClick={toggleOnboarding}
          label="Onboarding completed"
          hint="Off reloads straight into the first-run flow, to run through different setups without reinstalling. On skips it again."
        />
        <div className="btn-edge flex items-center gap-3 rounded-xl px-3 py-3 ring-1 ring-ink-300/20">
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink-700">Reset test vault</span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-400">
              Wipes a disposable folder, switches to it, and clears onboarding — a genuinely blank
              slate every time. Never touches your real vault.
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

      <h3 className="mt-6 font-display text-[15px] font-semibold text-ink-900">Legal</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">
        Notealise is provided as-is, with no warranty of any kind. Back up anything important —
        software can have bugs, and the app's author is not liable for lost data.
      </p>
      <button
        type="button"
        onClick={() => setShowLicenses(true)}
        className="mt-2 flex items-center gap-1 rounded-lg border-none bg-transparent px-2 py-1 text-[12px] text-ink-500 outline-none transition duration-150 hover:bg-brand-500/10 hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-300"
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

      <p className="mt-4 px-1 text-[11.5px] leading-relaxed text-ink-400">
        A note's header shows when it was last edited — {formatDate(now, settings.dateFormat, tz)} right now. Hover
        it for the exact time, and when the note was created.
      </p>
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
  const [beta, setBeta] = useState(false)
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
      setBeta(s.prefs.betaChannel)
      setSelfInstall(s.selfInstall)
    })()
    return window.api.onUpdateStatus(setStatus)
  }, [])

  const blocked = status.state === 'unsupported'
  const busy = status.state === 'checking' || status.state === 'downloading'
  const isBeta = isPrereleaseVersion(version)

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
          ? isBeta
            ? "You're on a test build — thanks for helping try things early."
            : selfInstall
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

      {/* Only a build that is ALREADY a test build offers this, so an ordinary
          download has no route onto the beta channel. It's kept here (rather
          than removed) so a tester can turn it off and come back to stable.
          Main enforces the same rule — this is presentation, not the gate. */}
      {isBeta && (
        <div className="mode-row">
          <button
            className={'mode-btn' + (beta && !blocked ? ' on' : '')}
            aria-pressed={beta && !blocked}
            disabled={blocked}
            onClick={() => {
              const next = !beta
              setBeta(next)
              void window.api.setBetaChannel(next)
            }}
          >
            <span className="t">Receive test builds</span>
            <span className="s">
              {blocked
                ? 'Not available on this build'
                : 'Early versions, for helping test. They can be rough — turn this off to go back to the stable release.'}
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Sends via the OS default mail app (mailto:) opened by main — no account or
 *  API key needed here. The fixed destination lives in src/main/support.ts. */
function ReportBug(): React.JSX.Element {
  const [fromEmail, setFromEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const canSend = EMAIL_RE.test(fromEmail.trim()) && message.trim().length > 0

  const send = useCallback(async () => {
    setStatus('sending')
    const ok = await window.api.sendBugReport(fromEmail.trim(), message.trim())
    if (ok) {
      setMessage('')
      setStatus('sent')
    } else {
      setStatus('error')
    }
  }, [fromEmail, message])

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Report a bug</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">
        Opens your email app with this pre-filled, addressed to our support inbox.
      </p>

      <div className="mt-4 flex flex-col gap-1">
        <label htmlFor="bug-email" className="text-[12.5px] font-medium text-ink-700">
          Your email
        </label>
        <input
          id="bug-email"
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="bug-message" className="text-[12.5px] font-medium text-ink-700">
          Message
        </label>
        <textarea
          id="bug-message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What happened, and what did you expect instead?"
          className="w-full resize-y rounded-lg bg-brand-500/8 px-2.5 py-2 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="mini" disabled={!canSend || status === 'sending'} onClick={() => void send()}>
          {status === 'sending' ? 'Opening…' : 'Send'}
        </button>
        {status === 'sent' && (
          <span className="text-[11.5px] text-ink-400">
            Your default mail app should now have this ready to send.
          </span>
        )}
        {status === 'error' && (
          <span className="text-[11.5px] text-ink-400">
            Couldn&apos;t open a mail app automatically — email us directly instead.
          </span>
        )}
      </div>
    </>
  )
}

/** Sends via the OS default mail app (mailto:) opened by main — no account or
 *  API key needed here. The fixed destination lives in src/main/support.ts. */
function RequestFeature(): React.JSX.Element {
  const [fromEmail, setFromEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const canSend = EMAIL_RE.test(fromEmail.trim()) && message.trim().length > 0

  const send = useCallback(async () => {
    setStatus('sending')
    const ok = await window.api.sendFeatureRequest(fromEmail.trim(), message.trim())
    if (ok) {
      setMessage('')
      setStatus('sent')
    } else {
      setStatus('error')
    }
  }, [fromEmail, message])

  return (
    <>
      <h3 className="font-display text-[15px] font-semibold text-ink-900">Request a feature</h3>
      <p className="mt-0.5 text-[12px] text-ink-500">
        Opens your email app with this pre-filled, addressed to our features inbox.
      </p>

      <div className="mt-4 flex flex-col gap-1">
        <label htmlFor="feature-email" className="text-[12.5px] font-medium text-ink-700">
          Your email
        </label>
        <input
          id="feature-email"
          type="email"
          value={fromEmail}
          onChange={(e) => setFromEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg bg-brand-500/8 px-2.5 py-1.5 text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="feature-message" className="text-[12.5px] font-medium text-ink-700">
          Message
        </label>
        <textarea
          id="feature-message"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What would you like to see?"
          className="w-full resize-y rounded-lg bg-brand-500/8 px-2.5 py-2 text-[12.5px] text-ink-900 outline-none placeholder:text-ink-400"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="mini" disabled={!canSend || status === 'sending'} onClick={() => void send()}>
          {status === 'sending' ? 'Opening…' : 'Send'}
        </button>
        {status === 'sent' && (
          <span className="text-[11.5px] text-ink-400">
            Your default mail app should now have this ready to send.
          </span>
        )}
        {status === 'error' && (
          <span className="text-[11.5px] text-ink-400">
            Couldn&apos;t open a mail app automatically — email us directly instead.
          </span>
        )}
      </div>
    </>
  )
}
