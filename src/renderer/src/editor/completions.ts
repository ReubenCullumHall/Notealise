import {
  autocompletion,
  completionStatus,
  insertCompletionText,
  pickedCompletion,
  selectedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection
} from '@codemirror/autocomplete'
import { Prec, type EditorState, type Extension } from '@codemirror/state'
import { keymap, type EditorView } from '@codemirror/view'
import { baseName, resolveLink, titleOf } from '../../../shared/links'
import { matchesQuery, SLASH_COMMANDS } from './commands'
import { linkEnv, linkHandlersFacet, type LinkEnv, type LinkHandlers } from './linkEnv'
import { headingAnchor, linkTargets, stateForText } from './blockIds'
import {
  backStep,
  canStepInto,
  closeWikiLink,
  folderRows,
  linkChoices,
  pickerScreen,
  rootRows,
  type BrowseRow,
  type PickerScreen
} from '../links/model'

// The editor's two completion menus. Both are thin: neither owns a list.
//
//   "/"   → the command registry in commands.tsx
//   "[["  → the notes in the vault, via the linkEnv StateField
//
// This file used to carry a SLASH_COMMANDS array of its own — a second, slightly
// different implementation of nine commands the format bar already had. See the
// header of commands.tsx for why that is gone and must not come back.

/** "/command" at the start of a line or after whitespace. */
function slashSource(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/(?:^|\s)\/[\w-]*/)
  if (!m) return null
  const slashIdx = m.text.indexOf('/')
  const from = m.from + slashIdx
  const typed = m.text.slice(slashIdx + 1).toLowerCase()
  const options: Completion[] = SLASH_COMMANDS.filter((c) => matchesQuery(c, typed)).map((c) => ({
    label: c.label,
    detail: c.hint,
    type: 'keyword',
    // The command deletes the "/query" itself — it has to, because every command
    // acts on the current selection and would otherwise format the text the user
    // typed to summon it.
    apply: (view, _completion, cFrom, cTo) => c.run(view, { from: cFrom, to: cTo })
  }))
  // `filter: false`: the matching above is ours (labels AND the extra terms, so
  // "ul" finds Bulleted list), and CodeMirror's own filter would then discard
  // everything whose label doesn't literally contain the query.
  return options.length ? { from, options, filter: false } : null
}

/**
 * "[[" — the notes and folders you can link to. This is what makes `/link` a
 * picker without anything having to build one: the wikiLink command inserts
 * `[[]]` and puts the cursor between the brackets, which is precisely the state
 * this source fires on. Typing `[[` by hand gets the same menu, which is the
 * point.
 *
 * **Scoped to the space you're writing in**, with the space's own name as the
 * way out — see `linkChoices`. A picker that listed every note in every space
 * would undo the division the moment you went to link something.
 *
 * **It steps (2026-09-29).** Folders and notes carry an arrow: → or a click on
 * it goes inside, and inside a note the rows are its headings. Which
 * screen you are on is read off the text after `[[` — see `pickerScreen` — so
 * a step is just typing, and Backspace or ← is always the way back.
 */
function wikiSource(context: CompletionContext): CompletionResult | null | Promise<CompletionResult | null> {
  // Up to the cursor, no closing brackets and no line break: a link never spans
  // a line, and matching past a `]]` would keep the menu open after the link is
  // finished.
  const m = context.matchBefore(/\[\[[^\]\n]*/)
  if (!m) return null
  const env = context.state.field(linkEnv, false)
  if (!env || env.notes.length === 0) return null
  const typed = m.text.slice(2)
  const from = m.from + 2
  const to = context.pos
  const screen = pickerScreen(typed, env.notes, env.path)
  if (!screen) return null

  if (screen.kind === 'note') return noteScreen(context, env, screen, from, to)

  if (screen.kind === 'search') {
    const options: WikiRow[] = linkChoices(env.notes, env.spaces, env.path, typed)
      .slice(0, MAX_HITS)
      .map((c) => ({
        label: c.ref.title,
        // The row's quiet second column is the SPACE, pushed to the right-hand
        // edge under a "Space" heading — see `spaceColumn` below. It used to be
        // the raw parent folder, which on a vault whose space is called "New
        // folder" read as an offer to create one; and the space is the thing
        // worth knowing here, because it is what decides whether a bare title
        // will find this at all.
        space: c.space,
        // apart from the name so it can take the accent (app.css `.space-emoji`)
        spaceEmoji: c.spaceEmoji,
        // CodeMirror's own icon classes: `type` becomes `cm-completionIcon-<type>`,
        // which app.css draws as a folder or a page.
        type: c.ref.kind === 'dir' ? 'folder' : 'note',
        step: !canStepInto(c.ref.kind === 'dir' ? c.ref.path : c.insert)
          ? ''
          : c.ref.kind === 'dir'
            ? stripSpace(c.ref.path, env.path) + '/'
            : c.insert + '#',
        apply: (view, completion, cFrom, cTo) => writeLink(view, completion, cFrom, cTo, c.insert)
      }))
    return options.length ? { from, options, filter: false } : null
  }

  const home = homeOf(env.path)
  const homeMark = env.spaces.find((sp) => sp.folder === home)
  const enter = takeStep(typed)
  // `showSpace`: the first screen names each row's space under its Space
  // heading. Inside a folder every row is in the same one, and there is no
  // heading, so it would only be noise.
  const browse = (r: BrowseRow, section?: CompletionSection, showSpace = false): WikiRow => ({
    label: r.ref.title,
    type: r.ref.kind === 'dir' ? 'folder' : 'note',
    step: r.step,
    enter,
    ...(section && { section }),
    ...(r.isSpace
      ? // A whole space is somewhere to go, not something to link to.
        { spaceEmoji: r.emoji, apply: (view: EditorView) => stepTo(view, from, to, r.step, 'in') }
      : {
          ...(showSpace && { space: home || 'Vault root', spaceEmoji: homeMark?.emoji ?? '' }),
          apply: (view: EditorView, completion: Completion, cFrom: number, cTo: number) =>
            writeLink(view, completion, cFrom, cTo, r.insert)
        })
  })

  if (screen.kind === 'root') {
    const { here, others } = rootRows(env.notes, env.spaces, env.path)
    const elsewhere: CompletionSection = { name: 'Other spaces', rank: 1 }
    const options = [...here.slice(0, MAX_BROWSE).map((r) => browse(r, undefined, true)), ...others.map((r) => browse(r, elsewhere))]
    return options.length ? { from, options, filter: false } : null
  }

  // Inside a folder.
  const rows = folderRows(env.notes, screen.folder, screen.query, env.path).slice(0, MAX_BROWSE)
  const back = backSection(context.view, baseName(screen.folder), backStep(screen, env.path, null), from, to, enter)
  const options = rows.map((r) => browse(r, back))
  return { from, options: options.length ? options : [emptyRow(back, 'Nothing in here', enter)], filter: false }
}

/** Inside a note: its headings. */
async function noteScreen(
  context: CompletionContext,
  env: LinkEnv,
  screen: Extract<PickerScreen, { kind: 'note' }>,
  from: number,
  to: number
): Promise<CompletionResult | null> {
  // Taken before the note is read: by the time the read comes back, more may
  // have been typed, and the screen that arrives then is not the one stepped to.
  const enter = takeStep(context.state.sliceDoc(from, to))
  const self = screen.target.trim() === ''
  let path = env.path
  if (!self) {
    const link = { from: 0, to: 0, target: screen.target.trim(), heading: null, alias: null, text: '' }
    const r = resolveLink(link, env.notes, env.path)
    // A note nobody has written yet, or a folder, has nothing inside to list.
    if (r.kind !== 'note' || r.isDir) return null
    path = r.path
  }
  let state: EditorState
  if (self) {
    state = context.state
  } else {
    const handlers = context.state.facet(linkHandlersFacet)?.current
    if (!handlers) return null
    const text = await readCached(handlers, path)
    if (text === null || context.aborted) return null
    state = stateForText(text)
  }

  // Headings only (Reuben, 2026-09-29): a long note listed block by block
  // buries the headings you're looking for. A single paragraph is linked the
  // other way — right-click its grip, Copy link to block, paste.
  const q = screen.query.trim().toLowerCase()
  const all = linkTargets(state)
  const headings = all.filter(
    (t) => t.kind === 'heading' && (!q || t.label.toLowerCase().includes(q) || (t.heading ?? '').toLowerCase().includes(q))
  )
  const back = backSection(
    context.view,
    self ? 'This note' : titleOf(path),
    backStep(screen, env.path, self ? null : path),
    from,
    to,
    enter
  )
  const target = screen.target.trim()
  const options: WikiRow[] = headings.slice(0, MAX_TARGETS).map((t) => ({
    label: t.label,
    // `heading h2` → two icon classes; app.css draws "H2", the format bar's word
    type: 'heading h' + t.level,
    section: back,
    enter,
    apply: (view: EditorView, completion: Completion, cFrom: number, cTo: number) =>
      writeLink(view, completion, cFrom, cTo, target + '#' + headingAnchor(all, t))
  }))
  return {
    from,
    options: options.length ? options : [emptyRow(back, q ? 'No heading matches' : 'No headings in this note', enter)],
    filter: false
  }
}

/** Extra fields a `[[` row carries alongside CodeMirror's own. */
interface WikiRow extends Completion {
  space?: string
  spaceEmoji?: string
  /** what stepping into this row types after the `[[` */
  step?: string
  /** this row belongs to a screen just stepped to — it slides in */
  enter?: 'in' | 'out' | null
}

/** Write `inner` as the link and close it: the `]]` too, with the cursor
 *  stepped out past it, so it renders the moment it is chosen — see
 *  `closeWikiLink`. */
function writeLink(view: EditorView, completion: Completion, cFrom: number, cTo: number, inner: string): void {
  const line = view.state.doc.lineAt(cTo)
  const done = closeWikiLink(inner, line.text.slice(cTo - line.from))
  view.dispatch({
    ...insertCompletionText(view.state, done ? done.text : inner, cFrom, cTo),
    ...(done && { selection: { anchor: cFrom + done.cursor } }),
    annotations: pickedCompletion.of(completion)
  })
}

/** Step to another screen: replace what is typed after `[[` and open the menu
 *  on what that now says. `dir` is which way the new screen slides in. */
function stepTo(view: EditorView, from: number, to: number, typed: string, dir: 'in' | 'out'): void {
  pendingStep = { typed, dir, at: Date.now() }
  view.dispatch({ changes: { from, to, insert: typed }, selection: { anchor: from + typed.length } })
  startCompletion(view)
}

/** The step just taken, waiting for the screen it leads to. The next screen
 *  drawn for exactly that text slides in from the side it came from (Reuben,
 *  2026-09-29: "a smooth animation when you click the arrow") — in from the
 *  right going inside, from the left coming back out. Taken once, so the same
 *  screen redrawn as you type after it doesn't slide again. */
let pendingStep: { typed: string; dir: 'in' | 'out'; at: number } | null = null
function takeStep(typed: string): 'in' | 'out' | null {
  const p = pendingStep
  if (!p || p.typed !== typed || Date.now() - p.at > 1500) return null
  pendingStep = null
  return p.dir
}

/** The class a row or header wears to slide in (app.css `.cm-wiki-enter-*`). */
const enterClass = (dir: 'in' | 'out' | null): string => (dir ? 'cm-wiki-enter-' + dir : '')

/** The `[[…` the cursor is in, if any — what a step replaces. */
function typedRange(state: EditorState): { from: number; to: number; typed: string } | null {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const m = /\[\[([^\]\n]*)$/.exec(line.text.slice(0, head - line.from))
  return m ? { from: head - m[1].length, to: head, typed: m[1] } : null
}

/** The header of a folder or note screen: its name, with the way back. A real
 *  element in the list, where a click can reach it — the Content / Space
 *  heading on the first screen is drawn by CSS and can't be clicked. */
function backSection(
  view: EditorView | undefined,
  title: string,
  back: string,
  from: number,
  to: number,
  enter: 'in' | 'out' | null
): CompletionSection {
  return {
    name: title,
    header: () => {
      const el = document.createElement('completion-section')
      el.className = ('cm-wiki-back ' + enterClass(enter)).trim()
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', 'Back')
      // drawn by CSS (app.css `.cm-wiki-back-arrow`), the app's own chevron
      const arrow = document.createElement('span')
      arrow.className = 'cm-wiki-back-arrow'
      const name = document.createElement('span')
      name.className = 'cm-wiki-back-name'
      name.textContent = title
      el.append(arrow, name)
      el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (view) stepTo(view, from, to, back, 'out')
      })
      return el
    }
  }
}

/** A row that says why a screen is empty. Choosing it does nothing. */
function emptyRow(section: CompletionSection, text: string, enter: 'in' | 'out' | null): WikiRow {
  return { label: text, type: 'empty', section, enter, apply: () => {} }
}

/** A note's text, read once per visit rather than on every key typed on its
 *  screen. Three seconds is long enough to type a search in, short enough that
 *  an edit made elsewhere shows up the next time you step in. */
const readCache = new Map<string, { text: string; at: number }>()
async function readCached(handlers: LinkHandlers, path: string): Promise<string | null> {
  const hit = readCache.get(path)
  if (hit && Date.now() - hit.at < 3000) return hit.text
  try {
    const text = await handlers.readNote(path)
    readCache.set(path, { text, at: Date.now() })
    return text
  } catch {
    return null
  }
}

const homeOf = (p: string): string => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')
/** A folder path as typed from inside `fromPath`'s space. */
const stripSpace = (path: string, fromPath: string): string => {
  const home = homeOf(fromPath)
  return home && path.toLowerCase().startsWith(home.toLowerCase() + '/') ? path.slice(home.length + 1) : path
}

/** → steps into the chosen folder or note; ← on a screen with nothing typed on
 *  it steps back out. Anywhere else both keys move the cursor as usual. */
const stepKeys = Prec.highest(
  keymap.of([
    {
      key: 'ArrowRight',
      run: (view) => {
        if (completionStatus(view.state) !== 'active') return false
        const row = selectedCompletion(view.state) as WikiRow | null
        const at = typedRange(view.state)
        if (!row?.step || !at) return false
        stepTo(view, at.from, at.to, row.step, 'in')
        return true
      }
    },
    {
      key: 'ArrowLeft',
      run: (view) => {
        if (completionStatus(view.state) !== 'active') return false
        const at = typedRange(view.state)
        const env = view.state.field(linkEnv, false)
        if (!at || !env) return false
        const screen = pickerScreen(at.typed, env.notes, env.path)
        if (!screen || (screen.kind !== 'folder' && screen.kind !== 'note') || screen.query !== '') return false
        let notePath: string | null = null
        if (screen.kind === 'note' && screen.target.trim()) {
          const link = { from: 0, to: 0, target: screen.target.trim(), heading: null, alias: null, text: '' }
          const r = resolveLink(link, env.notes, env.path)
          notePath = r.kind === 'note' ? r.path : null
        }
        stepTo(view, at.from, at.to, backStep(screen, env.path, notePath), 'out')
        return true
      }
    }
  ])
)

/** The arrow at the end of a folder or note row: click it to go inside. */
const stepArrow = {
  render(completion: Completion, _state: EditorState, view: EditorView): HTMLElement | null {
    const step = (completion as WikiRow).step
    if (!step) return null
    const el = document.createElement('span')
    // drawn by CSS (app.css `.cm-wiki-step`), the app's own chevron
    el.className = 'cm-wiki-step'
    el.setAttribute('aria-label', 'Look inside')
    el.dataset.tip = 'Look inside'
    // Ahead of the popup's own mousedown, which would choose the row.
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const at = typedRange(view.state)
      if (at) stepTo(view, at.from, at.to, step, 'in')
    })
    return el
  },
  // After the space column (90), at the row's far end.
  position: 95
}

/** Enough to choose from without the popup becoming a file browser. */
const MAX_HITS = 14
/** A folder being browsed shows everything in it, up to a point. */
const MAX_BROWSE = 60
/** A note's headings. */
const MAX_TARGETS = 80

/** The right-hand column of a `[[` row. A rendered element rather than
 *  CodeMirror's own `detail`, because `detail` sits immediately after the label
 *  and this has to sit against the far edge, under its heading. */
const spaceColumn = {
  render(completion: Completion): HTMLElement | null {
    const { space, spaceEmoji } = completion as Completion & { space?: string; spaceEmoji?: string }
    if (!space && !spaceEmoji) return null // the "/" menu's rows have no space
    const el = document.createElement('span')
    el.className = 'cm-wiki-space'
    if (spaceEmoji) {
      const em = document.createElement('span')
      em.className = 'space-emoji'
      // the space stays outside it: Noto Emoji's space is a whole emoji wide
      em.textContent = spaceEmoji
      el.append(em, ' ')
    }
    el.append(space ?? '')
    return el
  },
  // After the label; the CSS pushes it the rest of the way with margin-left:auto.
  position: 90
}

export function completionExtension(): Extension {
  return [stepKeys, completionMenu()]
}

function completionMenu(): Extension {
  return autocompletion({
    override: [slashSource, wikiSource],
    addToOptions: [spaceColumn, stepArrow],
    optionClass: (c) => [c.type === 'empty' ? 'cm-wiki-empty' : '', enterClass((c as WikiRow).enter ?? null)].join(' ').trim(),
    // Marks the popup as the note picker so it can wear the Content / Space
    // headings. The "/" menu is one column and needs neither.
    tooltipClass: (state) => {
      const at = typedRange(state)
      if (!at) return ''
      // A folder's or a note's screen has its own header — its name and the way
      // back — in place of the Content / Space one.
      const env = state.field(linkEnv, false)
      const screen = env ? pickerScreen(at.typed, env.notes, env.path) : null
      return screen && (screen.kind === 'folder' || screen.kind === 'note') ? 'cm-wiki-menu cm-wiki-steps' : 'cm-wiki-menu'
    },
    activateOnTyping: true,
    // The [[ menu shows a folder/page icon per row, so icons stay ON; the "/"
    // menu's rows are all commands and its glyph column would be empty.
    icons: true,
    closeOnBlur: true,
    defaultKeymap: true
  })
}
