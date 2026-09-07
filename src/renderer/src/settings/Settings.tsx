import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STARTUPS, type AppSettings } from './model'
import { Icon, type IconName } from '../icons'
import { Select, SettingRow, ToggleRow } from './primitives'
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
import { DATE_FORMATS, NUMBER_FORMATS, formatDate, localZone, timezones } from '../intl'
import { MAC_INSTALL_GUIDE_URL, type UpdateStatus } from '../../../shared/update'
import type { PresetActions } from './Presets'
import type { SpacePreset } from '../../../shared/presets'
import type { RecoveryItem } from '../../../shared/workspace'
import { useInstalledFonts } from './useInstalledFonts'
import { escapeClaimed } from './escapeClaims'

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
  { id: 'tutorials', label: 'Tutorials', icon: 'book' },
  { id: 'sourceFolder', label: 'Source folder', icon: 'folder' },
  { id: 'recovery', label: 'Recovery', icon: 'restore' },
  // Import → Transfer data → Updates as one run: getting set up and staying
  // current. Bring your notes in, bring the app's own settings across from
  // another machine, then keep the app itself up to date. Transfer data sits
  // with Import because that's the mental slot it lands in, not with Source
  // folder.
  { id: 'import', label: 'Import', icon: 'import' },
  { id: 'transferData', label: 'Transfer data', icon: 'export' },
  { id: 'updates', label: 'Updates', icon: 'restore' },
  { id: 'reportBug', label: 'Report a bug', icon: 'flag' },
  { id: 'requestFeature', label: 'Request a feature', icon: 'star' }
]

const SECTION_LABEL: Record<SectionId, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.label])
) as Record<SectionId, string>

interface SearchEntry {
  section: SectionId
  /** For the four entries that live on Your collection's Explore page rather
   *  than on the shelves: which tab to open. Searching "make a tint" and
   *  landing on the collection page with the wheel two clicks away is a
   *  search result that didn't finish the job. */
  explore?: ExploreTab
  /** For the customisation entries, which live inside a collapsed fold on
   *  SpaceForm: which fold to open on arrival. Without it the search lands you
   *  on the right page with the setting still hidden behind one of nine rows,
   *  which is most of the way to not having found it. */
  disclosure?: string
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
  { section: 'general', label: 'Start with nothing open', hint: 'Opens on the blank screen — your notes are all still in the sidebar.', keywords: 'blank new launch open empty start' },
  { section: 'general', label: 'Reopen your tabs', hint: 'Come back to the notes you left open, split the way you left them.', keywords: 'resume restore session continue last open tabs' },
  { section: 'general', label: 'Play startup animation', hint: 'A short wordmark animation while a vault opens.', keywords: 'splash screen logo boot launch intro' },
  { section: 'general', label: 'Check before deleting', hint: 'Ask first when a photo or video is deleted from a note.', keywords: 'photo video image media delete remove confirm ask undo picture attachment' },
  { section: 'general', label: 'Interface animations', hint: 'Opening settings, hovers, dropdowns and the like.', keywords: 'motion transitions effects reduce motion speed disable' },
  { section: 'general', label: 'Date format', hint: 'Used for edit times and for the archive and bin.', keywords: 'day month year dd mm yyyy 12 hour 24 hour 12hr 24hr am pm dates language locale region british american' },
  { section: 'general', label: 'Time zone', hint: 'Which clock times are shown in.', keywords: 'timezone clock utc gmt local time' },
  { section: 'general', label: 'Number format', hint: 'Choose how numbers are formatted.', keywords: 'decimal comma thousand separator locale numbers language region' },
  { section: 'general', label: 'Replay the first-run walkthrough', hint: 'Reopens the introduction you saw the first time.', keywords: 'onboarding tutorial first run walkthrough welcome intro replay redo again reset vault' },
  { section: 'general', label: 'Reset to a blank test vault', hint: 'Switch to a disposable folder to try things out.', keywords: 'test vault wipe clean slate sandbox reset disposable experiment developer' },
  { section: 'general', label: 'Open source licences', hint: 'Every third-party package the app ships, and its licence.', keywords: 'legal licenses license copyright open source third party attribution warranty' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Theme', hint: 'Light, dark or extra dark, applied to the whole app.', keywords: 'dark mode light mode night mode black extra dark appearance colour scheme white black background bright darker lighter' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Text colour', hint: 'How bright the writing sits on a dark background.', keywords: 'white grey text brightness dark theme readability contrast' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Accent colour', hint: 'Pick a colour, then choose how far it reaches.', keywords: 'accent color highlight brand colour tint hue' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Colour all UI text', hint: 'Let every label in the app take the accent, not just headings and titles.', keywords: 'accent ui text label everywhere hints sidebar tabs colour red heading title word count' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Stronger button edges', hint: 'How hard the edges of buttons and controls read against the page.', keywords: 'button outline border contrast ui buttons edges' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Density', hint: 'How tightly notes and folders pack in the sidebar.', keywords: 'compact spacing sidebar rows tight loose comfortable size cramped roomy bigger smaller' },
  { section: 'customisation', disclosure: 'Appearance', label: 'Editor width', hint: 'How wide the writing area grows.', keywords: 'line length text width column wide narrow reading margins' },
  { section: 'customisation', disclosure: 'Fonts', label: 'Fonts', hint: 'Interface font, notes font, and an easier-reading override.', keywords: 'font family typeface typography ui font' },
  { section: 'customisation', disclosure: 'Fonts', label: 'Easier reading font', hint: 'A dyslexia-friendly override for a note’s body text.', keywords: 'dyslexia dyslexic accessibility opendyslexic readability reading difficulty easier' },
  { section: 'customisation', disclosure: 'Colour', label: 'How a colour shows', hint: 'A coloured tag, a tinted row, or a solid row.', keywords: 'colour style tag dot tinted row solid display' },
  { section: 'customisation', disclosure: 'Colour', label: 'Notes take their folder’s colour', hint: 'Colour inheritance for notes inside a coloured folder.', keywords: 'inherit colour folder notes propagate' },
  { section: 'customisation', disclosure: 'Colour', label: 'Reduce opacity for nested colours', hint: 'Fades colour the deeper it’s nested.', keywords: 'opacity fade nested subfolder colour intensity' },
  { section: 'customisation', disclosure: 'Colour', label: 'Your palette', hint: 'The colours offered when colouring a note or folder.', keywords: 'colour palette custom colours hex swatch picker' },
  { section: 'customisation', disclosure: 'Colour', label: 'Colour new folders automatically', hint: 'Give a new folder a colour as soon as it’s made.', keywords: 'auto colour automatic random new folder' },
  { section: 'customisation', disclosure: 'Arranging', label: 'Mix notes and folders freely', hint: 'One shared order instead of folders-then-notes.', keywords: 'sort order arrange alphabetical mixed together' },
  { section: 'customisation', disclosure: 'Arranging', label: 'Nav buttons', hint: 'Icons only for the Note / Folder buttons above the sidebar list.', keywords: 'note folder buttons icons toolbar compact labels' },
  { section: 'customisation', disclosure: 'Links', label: 'Show a note’s links', hint: 'A strip listing what a note points at and what points back at it.', keywords: 'backlinks links wiki links connections graph show hide' },
  { section: 'customisation', disclosure: 'While scrolling', label: 'Keep links on screen', hint: 'The links strip stays put however far you scroll.', keywords: 'pin links sticky scroll fixed while scrolling' },
  { section: 'customisation', disclosure: 'While scrolling', label: 'Keep the tab strip on screen', hint: 'The open-notes tab strip stays put however far you scroll.', keywords: 'pin tabs sticky scroll fixed while scrolling' },
  { section: 'customisation', disclosure: 'While scrolling', label: 'Keep the file path bar on screen', hint: 'The Space › Folder › Note bar stays put however far you scroll.', keywords: 'pin path breadcrumb sticky scroll fixed while scrolling' },
  { section: 'customisation', disclosure: 'While scrolling', label: "Keep the note's heading row on screen", hint: 'Bold, italic, the title, stats and split view stay put however far you scroll.', keywords: 'pin header heading row sticky scroll fixed while scrolling' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Show the file path', hint: 'A bar between the tabs and the format bar reading Space › Folder › Note.', keywords: 'breadcrumb path bar folder location show hide' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Show when it was last edited', hint: 'The edit time beside the word count.', keywords: 'edit time word count last modified timestamp' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Markdown pro', hint: 'A button that switches between the formatted view and raw Markdown.', keywords: 'raw markdown source view syntax show hide marks symbols asterisks hashes stars plain' },
  { section: 'customisation', disclosure: 'Note extras', label: 'How the marks look in Markdown pro', hint: 'Faded, or highlighted like code.', keywords: 'raw markdown marks syntax faded dim grey highlighted monospace code source' },
  { section: 'customisation', disclosure: 'Shortcuts', label: 'Custom buttons', hint: 'The four custom format-bar shortcut buttons.', keywords: 'format bar shortcuts toolbar bold italic custom' },
  { section: 'spaces', label: 'Add a space', hint: 'A new set of notes with its own look and folder.', keywords: 'new space create workspace' },
  { section: 'spaces', label: 'Space name', hint: 'What a space is called.', keywords: 'rename space title name' },
  { section: 'spaces', label: 'Representational emoji', hint: 'Shown on the switcher and the tab above, so you can tell spaces apart.', keywords: 'emoji icon space icon avatar' },
  { section: 'spaces', label: 'Delete a space', hint: 'Remove a space and send its folder to your computer’s bin.', keywords: 'delete remove space folder rid' },
  { section: 'spaces', label: 'Saved presets', hint: 'Reusable looks you can apply to any space.', keywords: 'preset template save look apply' },
  { section: 'collection', label: 'Your collection', hint: 'The fonts, page looks and tints you have.', keywords: 'fonts page looks tints library collection installed owned' },
  { section: 'collection', explore: 'fonts', label: 'Explore and install more', hint: 'Download fonts, add page looks, make a tint.', keywords: 'browse download install explore catalogue catalog get more add new' },
  { section: 'collection', explore: 'fonts', label: 'Import your own font', hint: 'Bring in a .ttf, .otf, .woff or .woff2 from your machine.', keywords: 'custom font file ttf otf woff import own upload add' },
  { section: 'collection', explore: 'tints', label: 'Make a tint', hint: 'Any hex colour, at a strength you set, washed under your words.', keywords: 'tint colour overlay wash hex opacity dyslexia visual stress irlen cream paper colour' },
  { section: 'collection', explore: 'pageLooks', label: 'Request a page look', hint: 'Ask us to build the paper you want.', keywords: 'request page look paper suggest ask feedback' },
  { section: 'customisation', disclosure: 'Page', label: 'Page look', hint: 'A pattern behind your writing — lined, grid, dots, graph, grain.', keywords: 'paper lined ruled grid squared dot graph texture background writing area notebook' },
  { section: 'customisation', disclosure: 'Page', label: 'Tint', hint: 'A colour washed under the words, per space.', keywords: 'tint overlay colour wash page colour dyslexia visual stress reading' },
  { section: 'tutorials', label: 'Tutorials', hint: 'Guides for using the app, including linking your notes.', keywords: 'help guide how to learn walkthrough' },
  { section: 'sourceFolder', label: 'Source folder', hint: 'Where your vault lives on disk, and switching to a different one.', keywords: 'vault folder location switch change move disk path sync synced onedrive dropbox icloud google drive cloud saved stored' },
  { section: 'recovery', label: 'Recovery', hint: 'A 7-day safety net for anything deleted — restore or purge it.', keywords: 'trash bin recycle bin deleted restore undo delete recover backup lost missing gone accidentally recover retrieve' },
  { section: 'import', label: 'Import', hint: 'Bring notes in from Notion, Word, Google Keep, Apple Notes, HTML or Markdown.', keywords: 'notion word docx google keep apple notes html markdown migrate transfer evernote onenote obsidian' },
  { section: 'transferData', label: 'Transfer data', hint: 'Move your presets, custom fonts and update setting to another computer.', keywords: 'transfer move migrate new mac new computer switch backup restore export import presets custom fonts app cleaner lost settings preferences device windows mac' },
  { section: 'updates', label: 'Install updates automatically', hint: 'Downloads new versions quietly and applies them when you quit. Windows only — a Mac cannot replace a running app.', keywords: 'auto update background version download install upgrade newer latest' },
  { section: 'updates', label: 'Check for updates', hint: 'Manually check for a new version.', keywords: 'check version update manual refresh' },
  { section: 'reportBug', label: 'Report a bug', hint: 'Email us about something that went wrong.', keywords: 'bug crash issue problem broken feedback support email contact' },
  { section: 'requestFeature', label: 'Request a feature', hint: 'Email us an idea for something new.', keywords: 'feature request suggest idea feedback contact' }
]

// --- Fuzzy search, so "dark mode" finds Theme and a typo like "recovry"
// still finds Recovery, without pulling in a search library for 55 static
// rows. Scoring is a weighted OR, not an AND: an entry needs at least ONE
// query word to mean something in one of its fields, and `scoreEntry` then
// scales its score by the fraction of words that landed. So "date format"
// does still surface "Number format" — it just ranks well below "Date
// format", which matched both words. That is deliberate, and the comment
// here claimed the opposite (a strict AND) until 2026-09-02: degrading to
// "here is the closest thing" beats an empty list when someone types a
// sentence, and a sentence is what most people type. Results are ranked by
// how well they matched, label counting for most, so a direct hit always
// beats an incidental mention in a hint.
// Dropped from every field, query included, before matching — otherwise a
// hint like "A coloured tag, a tinted row" leaves stray one-letter tokens
// ("a") sitting in the haystack, and `token.includes(w)` makes THAT match
// almost any query that happens to contain the letter "a" (which is most of
// them). Same failure mode for the leftover "s" a split on `note's` produces.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'is', 'are', 'it', 'its', 'your',
  'you', 'for', 'as', 'at', 'by', 'be', 'this', 'that', 'with', 'from', 'into', 'so', 'or', 'and',
  // People type questions, not keywords — "how do i make the app dark",
  // "where is the backup". Every one of these words used to be a real token
  // hunting for a match, and the damage was worse than noise: `fieldScore`
  // scores a 3-letter substring hit at 2, so "how" matched every entry
  // containing "show" — "Show the file path", "Show a note's links", "How a
  // colour shows" — and outranked the entry the person actually wanted.
  // Dropped from the haystack too, which is why "How a colour shows" is still
  // reachable: it indexes as "colour" + "shows".
  'how', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'where', 'what',
  'when', 'why', 'who', 'which', 'make', 'makes', 'change', 'changing', 'set',
  'setting', 'settings', 'turn', 'get', 'my', 'me', 'i', 'want', 'need', 'please',
  'app', 'option', 'options', 'there', 'here', 'have', 'has', 'was', 'were', 'am', 'if'
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
  // every block at once (Startup, Vault reset, Formatting, Legal) instead of
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
  /** Which fold on Customisation a search result asked to open, and a counter
   *  that makes each ask distinct. The counter is the whole point: search
   *  "density" (Appearance opens), close it by hand, search "editor width" —
   *  the fold is the same string, so on its own it would be `===` to last
   *  time, Disclosure's effect would not re-run, and the second search would
   *  land on a closed fold. Cleared by any ordinary navigation, so reaching
   *  Customisation from the nav gives you the page as you left it. */
  const [openDisclosure, setOpenDisclosure] = useState<{ fold: string; n: number } | null>(null)
  const askCount = useRef(0)

  const goTo = (target: SectionId, tab: ExploreTab | null = null, fold: string | null = null): void => {
    setSection(target)
    setExplore(tab)
    setOpenDisclosure(fold ? { fold, n: ++askCount.current } : null)
  }

  const [query, setQuery] = useState('')
  const matches = useMemo(() => searchSettings(query), [query])
  const jumpTo = (target: SearchEntry): void => {
    goTo(target.section, target.explore ?? null, target.disclosure ?? null)
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
          className="rounded-lg border-none bg-transparent p-1.5 text-ink-400 outline-none transition duration-200 hover:bg-ink-300/15 hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300"
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
                if (e.key === 'Enter' && matches.length > 0) jumpTo(matches[0])
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
                className="shrink-0 rounded-full border-none bg-transparent p-1 text-ink-400 outline-none transition-colors hover:bg-transparent hover:text-ink-900"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* A search that found nothing used to REPLACE the section list with
              one sentence, so the moment you typed a word this window doesn't
              know ("spellcheck", "password") you lost the only way to browse
              and had to clear the box to get it back. The list stays. */}
          {query.trim() && matches.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {matches.map((m, i) => (
                <button
                  key={m.section + m.label + i}
                  onClick={() => jumpTo(m)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-xl border-none px-2.5 py-2 text-left outline-none transition duration-200 hover:bg-ink-300/15 focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <span className="text-[12.5px] font-medium text-ink-700">{m.label}</span>
                  <span className="text-[11px] text-ink-400">{SECTION_LABEL[m.section]}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {query.trim() && (
                <p className="px-2.5 pb-1 pt-2 text-[12px] leading-relaxed text-ink-400">
                  Nothing matched &ldquo;{query.trim()}&rdquo;. The pages themselves:
                </p>
              )}
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => goTo(s.id)}
                  aria-current={section === s.id}
                  className={
                    'flex w-full items-center gap-2 rounded-xl border-none px-2.5 py-2 text-left text-[13px] font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-brand-300 ' +
                    // The settings window's own sidebar takes the accent
                    // alongside the section headings — the two are what give
                    // this window its shape (Reuben, 2026-09-06). Everything
                    // else in here stays ink unless "Colour all UI text" is on.
                    (section === s.id
                      ? 'bg-accent-500/15 text-accent-600'
                      : 'bg-transparent text-accent-500 hover:bg-ink-300/15 hover:text-accent-600')
                  }
                >
                  <Icon name={s.icon} className="h-4 w-4" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* The scroll container. `min-h-0` on the row above is what lets it
            actually scroll instead of stretching the window past its height. */}
        <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
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
                  <VaultReset />
                </div>
                <div>
                  <Formatting settings={settings} onChange={onChange} />
                </div>
                <p className="rounded-xl bg-ink-300/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-500 ring-1 ring-ink-300/25">
                  <span className="font-medium text-brand-600">Looking for the theme, colours or
                  the sidebar?</span>{' '}
                  Those belong to a space, not to the app — see{' '}
                  <span className="font-medium text-ink-600">Customisation</span> to set them
                  everywhere at once, or <span className="font-medium text-ink-600">Spaces</span> to
                  set one on its own.
                </p>
                <div>
                  <Legal onOpenLicences={() => setShowLicenses(true)} />
                </div>
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
              without affecting your real vault. Switch back any time from Source folder.
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
