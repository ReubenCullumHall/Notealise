// Settings search: every setting's name, where it lives, and the words people
// type for it — and the matching that turns a typed phrase into a ranked list.
// Moved out of Settings.tsx on 2026-09-29 so it can be tested without drawing
// the window (search.test.ts): the words are the feature (docs/product-rulings.md
// — "typing 'accessibility' must find the Reading section"), and a keyword
// quietly lost in an edit is exactly what nobody notices until someone can't
// find a setting.
//
// Pure — no React, and only TYPE imports from the window's files, so the test
// loads nothing but this.

import type { SectionId } from './Settings'
import type { ExploreTab } from './Explore'

export interface SearchEntry {
  section: SectionId
  /** For the four entries that live on Your collection's Explore page rather
   *  than on the shelves: which tab to open. Searching "make a tint" and
   *  landing on the collection page with the wheel two clicks away is a
   *  search result that didn't finish the job. */
  explore?: ExploreTab
  /** For a setting that lives inside a collapsed fold — Look's Page, Sidebar,
   *  Colour, Note extras, Shortcuts and Advanced, or General's More: which
   *  fold to open on arrival. Without it the search lands you on the right
   *  page with the setting still hidden behind a closed row, which is most of
   *  the way to not having found it. */
  disclosure?: string
  label: string
  /** The words printed on the page at the setting, when they aren't the
   *  label — a search result scrolls to them and lights them up (Settings.tsx,
   *  `landing`). "Terms and privacy" lives under the heading Legal; "Page look
   *  intensity" is the slider labelled Intensity. */
  anchor?: string
  /** For something people look for in Settings that the app does somewhere
   *  else — text size is the View menu's zoom. Shown in the results list in
   *  place of where it lives, so the answer is right there; picking it just
   *  closes the list, and `section` goes unused. */
  answer?: string
  hint: string
  /** Terms someone might type instead of the label above — synonyms, brand
   *  names of things being replaced, related jargon. Never shown in the UI;
   *  matched against same as label/hint. This is what makes "dark mode" find
   *  "Theme": nothing about the algorithm knows that on its own, so it has to
   *  be told. The aliases are the feature, not the box (docs/product-rulings.md). */
  keywords: string
}

// Hand-maintained, not derived from the settings pages themselves — those are
// free-form JSX, not a settings schema. Routes to the PAGE a setting lives on
// (and the fold it is in), not to the control itself. Keep this in sync as
// settings move or get added; nothing enforces that automatically.
export const SEARCH_INDEX: SearchEntry[] = [
  // First on purpose: where ties are broken by order, "notes" and "where are
  // my notes" should find the folder they live in before the font they are
  // written in.
  { section: 'sourceFolder', label: 'Where your notes are stored', anchor: 'Source folder', hint: 'The folder on your computer your notes are kept in.', keywords: 'notes files kept saved location disk folder find lost' },
  { section: 'sourceFolder', label: 'Your vault', anchor: 'Source folder', hint: 'The folder your notes live in, and switching to another one.', keywords: 'vault folder notes location' },
  { section: 'general', label: 'Start with nothing open', anchor: 'Startup', hint: 'Opens on the blank screen — your notes are all still in the sidebar.', keywords: 'blank new launch open opening empty start startup' },
  { section: 'general', label: 'Reopen your tabs', anchor: 'Startup', hint: 'Come back to the notes you left open, split the way you left them.', keywords: 'resume session continue last open tabs startup reopen left off' },
  { section: 'general', label: 'Play startup animation', hint: 'A short wordmark animation while a vault opens.', keywords: 'splash screen logo boot launch intro wordmark startup' },
  { section: 'general', label: 'Check before deleting', hint: 'Ask first when a photo or video is deleted from a note.', keywords: 'photo video image media delete remove confirm ask undo picture attachment warning' },
  { section: 'general', label: 'Interface animations', hint: 'Opening settings, hovers, dropdowns and the like.', keywords: 'motion animation animations transitions effects reduce motion speed slow fast instant disable' },
  { section: 'general', label: 'Date format', hint: 'Used for edit times and for the archive and bin.', keywords: 'date dates day month year dd mm yyyy 12 hour 24 hour 12hr 24hr am pm language locale region british american' },
  { section: 'general', label: 'Time zone', hint: 'Which clock times are shown in.', keywords: 'timezone clock utc gmt local time' },
  { section: 'general', label: 'Number format', hint: 'Choose how numbers are formatted.', keywords: 'decimal comma thousand separator locale numbers language region' },
  { section: 'general', label: 'Terms and privacy', anchor: 'Legal', hint: 'What the app sends, and the full terms on the website.', keywords: 'legal terms privacy policy data tracking analytics gdpr warranty law' },
  // Not a setting: the whole app zooms from the View menu. Here because
  // "text size" is one of the first things people type (Reuben, 2026-09-29).
  { section: 'general', label: 'Text size', answer: 'View menu → Zoom In / Zoom Out · ⌘+ ⌘− (Ctrl on Windows)', hint: 'Make everything bigger or smaller — the whole app zooms from the View menu.', keywords: 'text size font size bigger smaller larger zoom magnify enlarge scale tiny huge readable' },
  { section: 'general', label: 'Open source licences', hint: 'Every third-party package the app ships, and its licence.', keywords: 'legal licenses license copyright open source third party attribution warranty' },
  { section: 'general', disclosure: 'More', label: 'Replay the first-run walkthrough', hint: 'Reopens the introduction you saw the first time.', keywords: 'onboarding tutorial first run walkthrough welcome intro replay redo again reset vault' },
  { section: 'general', disclosure: 'More', label: 'Reset to a blank test vault', hint: 'Switch to a disposable folder to try things out.', keywords: 'test vault wipe clean slate sandbox reset disposable experiment developer' },

  // Look → Every space. The three basics sit above the folds, so they carry
  // no `disclosure`.
  { section: 'customisation', label: 'Look', anchor: 'Theme', hint: 'Theme, colours, fonts and the page, for every space at once.', keywords: 'customisation customization customise customize appearance personalise personalize style design look feel' },
  { section: 'customisation', label: 'Theme', hint: 'Light, dark or extra dark, applied to the whole app.', keywords: 'dark mode light mode night mode black extra dark appearance colour scheme color scheme white background bright darker lighter system automatic oled amoled' },
  { section: 'customisation', label: 'Accent colour', hint: 'The colour headings, titles and switches take.', keywords: 'accent color colour highlight brand main tint hue personalise personalize' },
  { section: 'customisation', label: 'Interface font', hint: 'The font for the sidebar, settings and buttons.', keywords: 'font fonts typeface typography ui interface menu sidebar serif sans' },
  { section: 'customisation', label: 'Notes font', hint: 'The font your notes are written in.', keywords: 'font fonts typeface typography writing note body text serif sans handwriting' },
  { section: 'customisation', label: 'Easier reading font', hint: 'A dyslexia-friendly font for a note’s body text.', keywords: 'dyslexia dyslexic accessibility accessible opendyslexic readability reading difficulty easier legible' },
  // The folds themselves, so typing a fold's own name opens it.
  { section: 'customisation', disclosure: 'Page', label: 'Page', anchor: 'Your page', hint: 'A pattern behind your writing, a colour washed under it, and how wide it runs.', keywords: 'paper writing area background' },
  { section: 'customisation', disclosure: 'Sidebar', label: 'Sidebar', anchor: 'Density', hint: 'How tightly it packs, how it orders notes and folders, and its Note / Folder buttons.', keywords: 'left panel list tree navigation' },
  { section: 'customisation', disclosure: 'Colour', label: 'Sidebar colours', anchor: 'How a colour shows', hint: 'Colouring notes and folders in the sidebar — the Colour fold.', keywords: 'colour colours coloured rows folders notes' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Note extras', anchor: 'Show a note’s links', hint: 'Links, the file path, the bookmark, edit time, Markdown pro, and what stays on screen.', keywords: 'extras note links path bookmark' },
  { section: 'customisation', disclosure: 'Shortcuts', label: 'Shortcuts', anchor: 'Custom buttons', hint: 'The four custom format-bar buttons.', keywords: 'shortcut buttons format bar toolbar' },
  { section: 'customisation', disclosure: 'Advanced', label: 'Advanced', anchor: 'Text colour', hint: 'Text colour on dark themes, how far the accent reaches, and stronger button edges.', keywords: 'advanced extra power' },
  { section: 'customisation', disclosure: 'Page', label: 'Page look', hint: 'A pattern behind your writing — lined, grid, dots, graph, grain.', keywords: 'paper lined lines ruled grid squared dot dots graph texture background writing area notebook' },
  { section: 'customisation', disclosure: 'Page', label: 'Page look intensity', anchor: 'Intensity', hint: 'How faint or bold the pattern is drawn.', keywords: 'intensity strength opacity faint bold pattern lines darker lighter' },
  { section: 'customisation', disclosure: 'Page', label: 'Draw the page look in your accent', anchor: 'Match your accent colour', hint: 'Lines, dots and grid in your accent colour.', keywords: 'accent colour color pattern lines match' },
  { section: 'customisation', disclosure: 'Page', label: 'Tint', hint: 'A colour washed under the words, per space.', keywords: 'tint overlay colour wash page colour dyslexia visual stress reading' },
  { section: 'customisation', disclosure: 'Page', label: 'Editor width', hint: 'How wide the writing area grows.', keywords: 'line length text width column wide narrow full width reading margins' },
  { section: 'customisation', disclosure: 'Sidebar', label: 'Density', hint: 'How tightly notes and folders pack in the sidebar.', keywords: 'compact spacing sidebar rows tight loose comfortable size cramped roomy bigger smaller' },
  { section: 'customisation', disclosure: 'Sidebar', label: 'Mix notes and folders freely', hint: 'One shared order instead of folders-then-notes.', keywords: 'sort sorting order arrange alphabetical mixed together folders first' },
  { section: 'customisation', disclosure: 'Sidebar', label: 'Nav buttons', hint: 'Icons only for the Note / Folder buttons above the sidebar list.', keywords: 'note folder buttons icons compact labels' },
  { section: 'customisation', disclosure: 'Colour', label: 'How a colour shows', hint: 'A coloured tag, a tinted row, or a solid row.', keywords: 'colour color style tag dot tinted row solid display' },
  { section: 'customisation', disclosure: 'Colour', label: 'Notes and folders inside a folder', hint: 'Take their folder’s colour, and show colours fainter.', keywords: 'inherit inheritance colour color folder notes propagate nested subfolder fade faint opacity intensity' },
  { section: 'customisation', disclosure: 'Colour', label: 'Your palette', hint: 'The colours offered when colouring a note or folder.', keywords: 'colour color palette custom colours hex swatch picker' },
  { section: 'customisation', disclosure: 'Colour', label: 'Colour new folders automatically', hint: 'Give a new folder a colour as soon as it’s made.', keywords: 'auto colour color automatic random new folder' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Show a note’s links', hint: 'A strip listing what a note points at and what points back at it.', keywords: 'backlinks links wiki links connections graph show hide' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Where the links strip sits', anchor: 'Show a note’s links', hint: 'At the top of the note, or fixed to the bottom.', keywords: 'links backlinks top bottom position move strip' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Show the file path', hint: 'A bar between the tabs and the format bar reading Space › Folder › Note.', keywords: 'breadcrumb path bar folder location show hide' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Show the bookmark', hint: 'The bookmark at the start of the tab strip, for the notes you come back to.', keywords: 'bookmark bookmarks favourites favorites starred pinned tabs' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Show when it was last edited', hint: 'The edit time beside the word count.', keywords: 'edit edited time count last modified timestamp' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Markdown pro', hint: 'A button that switches between the formatted view and raw Markdown.', keywords: 'raw markdown source view code syntax show hide marks symbols asterisks hashes stars plain' },
  { section: 'customisation', disclosure: 'Note extras', label: 'How the marks look in Markdown pro', hint: 'Faded, or highlighted like code.', keywords: 'raw markdown marks syntax faded dim grey highlighted monospace code source' },
  { section: 'customisation', disclosure: 'Note extras', label: 'Keep bars on screen while you scroll', anchor: 'Keep on screen while you scroll', hint: 'The tab strip, file path bar, heading row and links strip.', keywords: 'pin pinned sticky scroll scrolling fixed stay tabs tab strip path breadcrumb header heading row links hide' },
  { section: 'customisation', disclosure: 'Shortcuts', label: 'Custom buttons', hint: 'The four custom format-bar shortcut buttons.', keywords: 'format bar shortcuts toolbar bold italic custom buttons' },
  { section: 'customisation', disclosure: 'Advanced', label: 'Text colour', hint: 'How bright the writing sits on a dark background.', keywords: 'white grey gray text brightness dark theme readability contrast' },
  { section: 'customisation', disclosure: 'Advanced', label: 'How far the accent reaches', hint: 'Just the writing and titles, or surfaces and controls too.', keywords: 'accent tint tinted text only surfaces controls colour color reach mode' },
  { section: 'customisation', disclosure: 'Advanced', label: 'Colour all UI text', hint: 'Let every label in the app take the accent, not just headings and titles.', keywords: 'accent ui text label everywhere hints sidebar tabs colour color red heading title' },
  { section: 'customisation', disclosure: 'Advanced', label: 'Stronger button edges', hint: 'How hard the edges of buttons and controls read against the page.', keywords: 'button outline border contrast ui buttons edges definition' },

  // Look → Your collection
  { section: 'collection', label: 'Your collection', anchor: 'Fonts', hint: 'The fonts, page looks and tints you have.', keywords: 'fonts page looks tints library collection installed owned' },
  { section: 'collection', explore: 'fonts', label: 'Explore and install more', hint: 'Download fonts, add page looks, make a tint.', keywords: 'browse download install explore catalogue catalog get more add new' },
  { section: 'collection', explore: 'fonts', label: 'Import your own font', anchor: 'Import your own', hint: 'Bring in a .ttf, .otf, .woff or .woff2 from your machine.', keywords: 'custom font file ttf otf woff import own upload add' },
  { section: 'collection', explore: 'tints', label: 'Make a tint', hint: 'Any hex colour, at a strength you set, washed under your words.', keywords: 'tint colour overlay wash hex opacity dyslexia visual stress irlen cream paper colour' },
  { section: 'collection', explore: 'pageLooks', label: 'Request a page look', anchor: 'Ask us for one', hint: 'Ask us to build the paper you want.', keywords: 'request page look paper ask' },

  { section: 'spaces', label: 'Add a space', hint: 'A new set of notes with its own look and folder.', keywords: 'new space create workspace' },
  { section: 'spaces', label: 'Space name', anchor: 'Name', hint: 'What a space is called.', keywords: 'rename space title name' },
  { section: 'spaces', label: 'Representational emoji', hint: 'Shown on the switcher and the tab above, so you can tell spaces apart.', keywords: 'emoji icon space icon avatar colour color accent monochrome mono full colour' },
  { section: 'spaces', label: 'Delete a space', anchor: 'Delete space', hint: 'Remove a space and send its folder to your computer’s bin.', keywords: 'delete remove space folder rid' },
  { section: 'spaces', label: 'Saved presets', hint: 'Reusable looks you can apply to any space.', keywords: 'preset presets template save look apply' },

  { section: 'sourceFolder', label: 'Source folder', hint: 'Where your vault lives on disk, and switching to a different one.', keywords: 'data vault folder location switch change move disk path sync synced onedrive dropbox icloud google drive cloud saved stored' },
  { section: 'recovery', label: 'Recovery', hint: 'A 7-day safety net for anything deleted — restore or purge it.', keywords: 'data trash bin recycle bin deleted restore undo delete recover backup lost missing gone accidentally retrieve' },
  { section: 'import', label: 'Import', anchor: 'Import data', hint: 'Bring notes in from Notion, Word, Google Keep, Apple Notes, HTML or Markdown.', keywords: 'data notion word docx google keep apple notes html markdown migrate transfer evernote onenote obsidian bring in' },
  { section: 'transferData', label: 'Transfer data', hint: 'Move your presets, custom fonts and update setting to another computer.', keywords: 'data transfer move migrate new mac new computer switch backup restore export import presets custom fonts app cleaner lost settings preferences device windows mac' },

  { section: 'tutorials', label: 'Tutorials', hint: 'Guides for using the app, including linking your notes.', keywords: 'help guide guides how to learn walkthrough tutorial tips manual' },
  { section: 'tutorials', label: 'Linking your notes', hint: 'A guide to every kind of link, in Tutorials.', keywords: 'link links linking wiki backlinks connect connecting' },
  { section: 'reportBug', label: 'Report a bug', hint: 'Email us about something that went wrong.', keywords: 'help bug crash issue problem broken feedback support email contact' },
  { section: 'requestFeature', label: 'Request a feature', hint: 'Email us an idea for something new.', keywords: 'help feature request suggest idea feedback contact' },

  { section: 'updates', label: 'Install updates automatically', hint: 'Downloads new versions quietly and applies them when you quit. Windows only — a Mac cannot replace a running app.', keywords: 'auto update background version download install upgrade newer latest' },
  { section: 'updates', label: 'Check for updates', anchor: 'Check now', hint: 'Manually check for a new version.', keywords: 'check version update updates manual refresh which version' }
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
// ("a") sitting in the haystack, and the old `token.includes(w)` made THAT
// match almost any query that happened to contain the letter "a" (which is
// most of them). Same failure mode for the leftover "s" a split on `note's` produces.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'is', 'are', 'it', 'its', 'your',
  'you', 'for', 'as', 'at', 'by', 'be', 'this', 'that', 'with', 'from', 'into', 'so', 'or', 'and',
  // People type questions, not keywords — "how do i make the app dark",
  // "where is the backup". Every one of these words used to be a real token
  // hunting for a match, and the damage was worse than noise: `fieldScore`
  // then scored a 3-letter substring hit at 2, so "how" matched every entry
  // containing "show" — "Show the file path", "Show a note's links", "How a
  // colour shows" — and outranked the entry the person actually wanted.
  // Dropped from the haystack too, which is why "How a colour shows" is still
  // reachable: it indexes as "colour" + "shows".
  'how', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'where', 'what',
  'when', 'why', 'who', 'which', 'make', 'makes', 'change', 'changing', 'set',
  'setting', 'settings', 'turn', 'get', 'my', 'me', 'i', 'want', 'need', 'please',
  'app', 'option', 'options', 'there', 'here', 'have', 'has', 'was', 'were', 'am', 'if'
])

// American spellings, folded onto the British ones the index is written in —
// "color" is what half the people looking for the accent colour will type,
// and on its own it only reached the entries that happened to list both
// spellings (which put Theme, not Accent colour, first). Applied to the
// query and the index alike.
const US_TO_UK: Record<string, string> = {
  color: 'colour',
  colors: 'colours',
  colored: 'coloured',
  coloring: 'colouring',
  gray: 'grey',
  favorite: 'favourite',
  favorites: 'favourites',
  customize: 'customise',
  customizing: 'customising',
  customization: 'customisation',
  license: 'licence',
  licenses: 'licences',
  center: 'centre',
  organize: 'organise',
  behavior: 'behaviour'
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => US_TO_UK[w] ?? w)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

/** Edit distance, counting two neighbouring letters swapped as ONE edit
 *  rather than two — "dakr", "fnot", "accnet" are the typos people actually
 *  make, and as two edits each they fell outside the typo allowance and found
 *  nothing (or, worse, something else). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prevPrev: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prevPrev[j - 2] + 1)
      }
      row.push(d)
    }
    prevPrev = prev
    prev = row
  }
  return prev[b.length]
}

// How many typo'd characters a query word may be from a field word before it
// stops counting as a match. 0 below 4 letters — short words collide too
// easily ("on" is one edit from "no") — rising slowly after that.
function typoBudget(len: number): number {
  if (len <= 3) return 0
  if (len <= 6) return 1
  return 2
}

/** Is one word the other with an ordinary ending added — "font" → fonts,
 *  "update" → updates, "link" → linking, "confirm" → confirmation? That kind
 *  of partial match is what someone typing a word short means. A word found
 *  in the MIDDLE or END of another is not: until 2026-09-29 that counted too,
 *  and "update" ranked Date format first (upDATE), "evernote" found a note's
 *  links (everNOTE), "spellcheck" found Check before deleting and "password"
 *  found the word count. Nor is a stem of a different word — "custom" is not
 *  "customise" (it put Custom buttons above Look), "short" is not
 *  "shortcuts" — which is why the rest has to be an ending, not just any
 *  letters. */
const ENDINGS = new Set(['s', 'es', 'd', 'ed', 'ing', 'er', 'ers', 'or', 'ors', 'y', 'ly', 'al', 'ion', 'ions', 'ation', 'ations'])
function startsEither(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 3 && long.startsWith(short) && (long === short || ENDINGS.has(long.slice(short.length)))
}

/** Best match strength between one query word and one field's words: 3 exact,
 *  2 one word starts the other, 1 within typo budget, 0 no match. */
function fieldScore(token: string, fieldWords: string[]): number {
  let best = 0
  for (const w of fieldWords) {
    if (w === token) return 3
    if (startsEither(token, w)) best = Math.max(best, 2)
    else if (editDistance(token, w) <= typoBudget(token.length)) best = Math.max(best, 1)
  }
  return best
}

// Partial credit, not strict AND: a query word that matches nothing costs
// that word's share of the total rather than disqualifying the entry
// outright. Without this, "12 hour clock" scored zero on Date format, because
// "clock" (fair enough — that's Time zone's word) killed the other two words'
// otherwise-solid match. matchedCount/queryTokens.length still means a full
// match always outranks a partial one for the same raw score.
//
// Then, worth at most one point, how much of the setting's NAME the query
// covered: a tie-break, not a score. "tutorial" matched Replay the first-run
// walkthrough (it has the word as a keyword) exactly as well as it matched
// Tutorials, and the older one won by being higher in the list. A name that
// is mostly what you typed is the better answer.
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
  const named = labelWords.filter((w) => queryTokens.some((t) => t === w || startsEither(t, w))).length
  return raw * (matched / queryTokens.length) + (labelWords.length ? named / labelWords.length : 0)
}

const SEARCH_FIELDS = SEARCH_INDEX.map(
  (e): [string[], string[], string[]] => [tokenize(e.label), tokenize(e.keywords), tokenize(e.hint)]
)

export function searchSettings(query: string): SearchEntry[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const scored = SEARCH_INDEX.map((e, i) => ({ e, score: scoreEntry(tokens, SEARCH_FIELDS[i]) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
  // Only what is in the same league as the best match. The typo allowance is
  // generous, so "dark mode" also reached "Explore and install more" (more is
  // one letter from mode) and four other rows like it — harmless in the old
  // list down the side, noise in a drop-down under the box. A quarter of the
  // top score keeps the near misses a sentence-typer wants ("dark mode" →
  // Theme, then Text colour) and drops the accidents.
  const floor = (scored[0]?.score ?? 0) * 0.25
  return scored.filter((r) => r.score >= floor).map((r) => r.e)
}
