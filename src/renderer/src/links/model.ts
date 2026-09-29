import type { TreeNode } from '../../../shared/types'
import { indexEmbeds } from '../../../shared/attachments'
import { blockIdOf, headingShown, indexBlocks, indexHeadings, type BlockInfo } from '../../../shared/blocks'
import {
  backlinksFor,
  dirName,
  eachLinkLine,
  indexLinks,
  resolveLink,
  titleOf,
  toContext,
  type Backlink,
  type LinkRow,
  type NoteRef,
  type WikiLink
} from '../../../shared/links'

// Renderer-side derivation over the link model. `shared/links.ts` holds the
// arithmetic (what a link IS); this holds the questions the UI asks (what does
// this note link to, what links back, where does this note live).
//
// Nothing here reads a file. The link index comes from main via `scanLinks`, and
// the notes the user currently has open come from App's own buffers.

/** Just enough of a Space to mark a link that crosses out of one. The full
 *  `Space` carries a dozen appearance fields, none of which the link code has
 *  any business seeing. */
export interface SpaceMark {
  folder: string
  emoji: string
}

/** Everything in the WHOLE vault a link may point at — notes AND folders.
 *
 *  Deliberately not `spaceTree`: search is scoped to the active space because its
 *  results have to be clickable in the sidebar, but a link that has already been
 *  WRITTEN must keep resolving wherever it points. What the space scopes is what
 *  the `[[` picker OFFERS (see `linkChoices`), not what resolves. */
export function noteRefs(tree: TreeNode[]): NoteRef[] {
  const out: NoteRef[] = []
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.type === 'file') out.push({ path: n.path, title: titleOf(n.path), kind: 'note' })
      else {
        out.push({ path: n.path, title: n.name, kind: 'dir' })
        if (n.children) walk(n.children)
      }
    }
  }
  walk(tree)
  return out
}

/** One row of the `[[` picker. */
export interface LinkChoice {
  ref: NoteRef
  /** what typing this inserts — a bare title inside your own space, a full path
   *  when the target is somewhere else and the short form wouldn't find it */
  insert: string
  /** the folder it sits in, relative to its space; "" at the space's own root */
  where: string
  /** which space it lives in — always filled, because the picker names the space
   *  on every row so you can see at a glance where a link is about to reach */
  space: string
  /** that space's emoji, when it has one */
  spaceEmoji: string
  /** true when that space is NOT the one you are writing in */
  otherSpace: boolean
}

/**
 * What the `[[` picker offers, given what has been typed so far.
 *
 * **Your own space, by default.** A vault divided into spaces is divided for a
 * reason, and a picker that lists every note in every space makes the division
 * pointless the moment you go to link something. So the list is the space you
 * are writing in — unless the first word you type NAMES another space, which is
 * how you reach across deliberately:
 *
 *     [[Wav          → notes in this space matching "Wav"
 *     [[Physics      → everything in the Physics space
 *     [[Physics/Wav  → notes in Physics matching "Wav"
 *
 * Nothing is hidden that you can't get to — you just have to say where you're
 * going, which is the same thing the path form of a link already means.
 */
export function linkChoices(
  refs: NoteRef[],
  spaces: SpaceMark[],
  fromPath: string,
  typed: string
): LinkChoice[] {
  const home = spaceOf(fromPath)
  const q = typed.trim().toLowerCase()
  // Does what's been typed start with the name of a space other than this one?
  const named = spaces.find(
    (sp) => sp.folder && sp.folder.toLowerCase() !== home.toLowerCase() && q.startsWith(sp.folder.toLowerCase())
  )
  const scope = named ? named.folder : home
  // The rest of the query, once the space name has been consumed.
  const rest = named ? q.slice(named.folder.length).replace(/^\//, '').trim() : q

  const out: LinkChoice[] = []
  for (const ref of refs) {
    if (ref.path === fromPath) continue // a note cannot usefully link to itself
    const sp = spaceOf(ref.path)
    if (sp !== scope) continue
    if (ref.kind === 'dir' && ref.path === sp) continue // the space's own folder is not a target
    if (rest && !ref.title.toLowerCase().includes(rest)) continue
    const within = scope ? dirWithin(ref.path, scope) : dirName(ref.path)
    out.push({
      ref,
      // A title is enough inside your own space; reaching into another one needs
      // the path, or the link would resolve back to something local.
      insert: named ? stripExt(ref.path) : ref.title,
      where: within,
      space: scope || 'Vault root',
      spaceEmoji: spaces.find((sp) => sp.folder === scope)?.emoji ?? '',
      otherSpace: !!named
    })
  }
  // Notes before folders, then alphabetically: you are usually linking a note,
  // and a stable order means the first row doesn't move as you type.
  return out.sort(
    (a, b) =>
      (a.ref.kind === b.ref.kind ? 0 : a.ref.kind === 'note' ? -1 : 1) ||
      a.ref.title.localeCompare(b.ref.title)
  )
}

/**
 * What choosing a row in the `[[` picker writes: the title AND the closing `]]`,
 * with the cursor left after them so the link renders at once instead of waiting
 * for you to type the brackets and step out.
 *
 * `tail` is the rest of the line after the cursor. Brackets that are already there
 * are used rather than doubled — `/link` inserts `[[]]` up front, so its `]]` is
 * waiting when you choose. `text` replaces what was typed; `cursor` is measured from
 * where that replacement starts.
 *
 * Returns null when the cursor is in the MIDDLE of a link that is already closed
 * further along (`[[Wa|ves]]`): there is no right answer for the letters after the
 * cursor, so the caller leaves the plain insert alone.
 */
export function closeWikiLink(insert: string, tail: string): { text: string; cursor: number } | null {
  const close = tail.indexOf(']]')
  if (close > 0 && !tail.slice(0, close).includes('[')) return null
  const have = tail.startsWith(']]') ? 2 : tail.startsWith(']') ? 1 : 0
  return { text: insert + ']]'.slice(have), cursor: insert.length + 2 }
}

const stripExt = (p: string): string => (p.toLowerCase().endsWith('.md') ? p.slice(0, -3) : p)

// ---------------------------------------------------------------------------
// The `[[` picker's screens (2026-09-29, Reuben: "go through a series of
// screens to pick a folder, note, heading"). The screen is read off what has
// been typed after the `[[`, so stepping in and out is just editing that text:
// a step into a folder types its name and a `/`, a step into a note types its
// name and a `#`, and Backspace is always a way back.
//
//     [[                 the space you're in: its top-level folders and notes,
//                        then the other spaces
//     [[Term 3/          inside that folder; typing searches everything in it
//     [[Waves#           inside that note: its headings and blocks
//     [[Wav              a search of the space, as it has always been
// ---------------------------------------------------------------------------

export type PickerScreen =
  | { kind: 'root' }
  | {
      kind: 'folder'
      /** the folder's vault path */
      folder: string
      /** how it was typed, without the trailing `/` */
      typed: string
      query: string
    }
  | {
      kind: 'note'
      /** the link's target as typed — "" for a heading in this very note */
      target: string
      query: string
    }
  | { kind: 'search'; typed: string }

export function pickerScreen(typed: string, refs: NoteRef[], fromPath: string): PickerScreen | null {
  // An alias has been started: the target is chosen, and offering to replace it
  // would fight the user mid-sentence.
  if (typed.includes('|')) return null
  const hash = typed.indexOf('#')
  if (hash !== -1) return { kind: 'note', target: typed.slice(0, hash), query: typed.slice(hash + 1) }
  if (typed === '') return { kind: 'root' }
  const slash = typed.lastIndexOf('/')
  if (slash !== -1) {
    const folder = findFolder(refs, fromPath, typed.slice(0, slash))
    if (folder !== null) return { kind: 'folder', folder, typed: typed.slice(0, slash), query: typed.slice(slash + 1) }
  }
  return { kind: 'search', typed }
}

/** A typed folder path, tried inside this note's space first, then from the
 *  vault's top — the same two readings `resolveLink` gives a path target. */
function findFolder(refs: NoteRef[], fromPath: string, typed: string): string | null {
  const home = spaceOf(fromPath)
  const want = typed.trim().toLowerCase()
  if (!want) return null
  for (const t of home ? [home.toLowerCase() + '/' + want, want] : [want]) {
    const hit = refs.find((r) => r.kind === 'dir' && r.path.toLowerCase() === t)
    if (hit) return hit.path
  }
  return null
}

/** One row of a browsing screen. */
export interface BrowseRow {
  ref: NoteRef
  /** what choosing the row writes as the link's target */
  insert: string
  /** what stepping into it types after the `[[` — "" when it can't be */
  step: string
  /** true for a whole space on the first screen */
  isSpace: boolean
  emoji: string
}

/** How to name a note or folder in a link that has to find exactly it: its title
 *  when nothing else in the vault shares it, else its path — which `resolveLink`
 *  honours exactly, from anywhere. */
export function uniqueName(refs: NoteRef[], ref: NoteRef): string {
  const t = ref.title.toLowerCase()
  const same = refs.filter((r) => r.title.toLowerCase() === t && (r.kind === ref.kind || ref.kind === 'dir'))
  return same.length <= 1 ? ref.title : stripExt(ref.path)
}

/** What stepping into a folder types: its path inside this space, or from the
 *  vault's top when it is somewhere else. */
function folderStep(path: string, home: string): string {
  return (home && path.toLowerCase().startsWith(home.toLowerCase() + '/') ? path.slice(home.length + 1) : path) + '/'
}

/** A name a link can step THROUGH. `#` would read as the start of a heading
 *  and `|` as an alias, so a note or folder named with one can still be linked
 *  but not stepped into (`step` is then ""). */
export const canStepInto = (name: string): boolean => !/[#|]|\]\]/.test(name)

function row(refs: NoteRef[], ref: NoteRef, home: string, emoji = '', isSpace = false): BrowseRow {
  const insert = uniqueName(refs, ref)
  const step = ref.kind === 'dir' ? folderStep(ref.path, home) : insert + '#'
  return {
    ref,
    insert,
    step: canStepInto(ref.kind === 'dir' ? ref.path : insert) ? step : '',
    isSpace,
    emoji
  }
}

/** Folders first, then notes, each alphabetically — how a folder reads in the
 *  sidebar and in Finder or Explorer. */
const byKindThenName = (a: BrowseRow, b: BrowseRow): number =>
  (a.ref.kind === b.ref.kind ? 0 : a.ref.kind === 'dir' ? -1 : 1) || a.ref.title.localeCompare(b.ref.title)

/** The first screen: what sits at the top of the space you're writing in, then
 *  every other space as a way in. */
export function rootRows(refs: NoteRef[], spaces: SpaceMark[], fromPath: string): { here: BrowseRow[]; others: BrowseRow[] } {
  const home = spaceOf(fromPath)
  const here = refs
    .filter((r) => dirName(r.path) === home && !(r.kind === 'dir' && spaces.some((sp) => sp.folder === r.path && sp.folder !== home)))
    .map((r) => row(refs, r, home))
    .sort(byKindThenName)
  const others: BrowseRow[] = []
  for (const sp of spaces) {
    if (!sp.folder || sp.folder === home) continue
    const ref = refs.find((r) => r.kind === 'dir' && r.path === sp.folder)
    if (ref) others.push(row(refs, ref, home, sp.emoji, true))
  }
  others.sort((a, b) => a.ref.title.localeCompare(b.ref.title))
  return { here, others }
}

/** Inside a folder. With nothing typed, what is directly in it; with a query,
 *  everything anywhere inside it that matches — so `[[Physics/Wav` still finds
 *  a note three folders down, as it always has. */
export function folderRows(refs: NoteRef[], folder: string, query: string, fromPath: string): BrowseRow[] {
  const home = spaceOf(fromPath)
  const q = query.trim().toLowerCase()
  const inside = folder.toLowerCase() + '/'
  return refs
    .filter((r) =>
      q
        ? r.path.toLowerCase().startsWith(inside) && r.title.toLowerCase().includes(q)
        : dirName(r.path).toLowerCase() === folder.toLowerCase()
    )
    .map((r) => row(refs, r, home))
    .sort(byKindThenName)
}

/**
 * Where the `[[` picker opens when a link is right-clicked to point it somewhere
 * else (Reuben, 2026-09-29): on that note's headings when the heading half was
 * clicked (or a block's words, or a link to a heading in this note), so another
 * heading is one click away; otherwise in the folder the note sits in, so a
 * neighbour is. A link to a note nobody has written yet opens the first screen.
 * The back arrow still goes anywhere.
 */
export function relinkStep(link: WikiLink, refs: NoteRef[], fromPath: string, part: 'target' | 'heading'): string {
  const target = link.target.trim()
  if (!target) return '#'
  if (part === 'heading' && canStepInto(target)) return target + '#'
  const r = resolveLink(link, refs, fromPath)
  if (r.kind !== 'note') return ''
  const home = spaceOf(fromPath)
  const dir = dirName(r.path)
  return !dir || dir === home ? '' : folderStep(dir, home)
}

/** Where the back arrow goes from a screen: the folder above, or the first
 *  screen. `notePath` is the note a note screen is showing. */
export function backStep(screen: PickerScreen, fromPath: string, notePath: string | null): string {
  const home = spaceOf(fromPath)
  if (screen.kind === 'folder') {
    const at = screen.typed.lastIndexOf('/')
    return at === -1 ? '' : screen.typed.slice(0, at) + '/'
  }
  if (screen.kind === 'note' && screen.target && notePath) {
    const dir = dirName(notePath)
    return dir === home || dir === '' ? '' : folderStep(dir, home)
  }
  return ''
}

/** The folder part of `path`, with `space/` taken off the front. */
function dirWithin(path: string, space: string): string {
  const dir = dirName(path)
  if (dir === space) return ''
  return dir.startsWith(space + '/') ? dir.slice(space.length + 1) : dir
}

/**
 * The link index as it stands *right now*: what main read from disk, with the
 * notes the user has open laid over the top.
 *
 * The overlay is what makes the block honest while you type. Main's index is
 * disk state, and the app deliberately does not rescan on a keystroke — but a
 * `[[link]]` you just typed in one column should appear as a backlink in the
 * other before the 400ms autosave, not after it.
 */
/** A fingerprint of everything in a note that the INDEX cares about.
 *
 *  Typing must not cost a rebuild of every open note's backlinks, so the index
 *  is only re-derived when this string changes rather than on each keystroke.
 *  Which makes what it covers load-bearing, and it used to cover links alone.
 *
 *  Embeds belong here because the same index answers "which notes hold this
 *  photo", and that is what the delete dialog reads before warning you that
 *  another note is about to lose its picture. With embeds outside the
 *  fingerprint, pasting `![](beach.png)` into a second note — the only way to
 *  make two notes share one file — never reached the index. No warning was
 *  shown, the delete went through, and the other note only revealed the damage
 *  after a restart, once the blob cache that had been masking it was empty.
 *
 *  The two kinds are prefixed so a link and an embed naming the same string
 *  cannot swap places without the fingerprint noticing. */
export function indexFingerprint(text: string): string {
  return [
    ...indexLinks(text).map((l) => 'l:' + l.target + '#' + (l.heading ?? '')),
    ...indexEmbeds(text).map((t) => 'e:' + t),
    // A tagged block's first words are what links to it show elsewhere, so a
    // change to them has to reach those links. Only tagged blocks count, so
    // typing in an ordinary paragraph still costs nothing.
    ...indexBlocks(text).map((b) => 'b:' + b.id + '#' + b.label),
    // Headings too: whether `[[Note#a#b]]` is shown as a path or as words
    // depends on which headings the note has.
    ...indexHeadings(text).map((h) => 'h:' + h)
    // A literal NUL in App.tsx once made grep and ripgrep treat the whole file
    // as BINARY and silently skip it. Same separator, written as an escape.
  ].join('\u0000')
}

export function liveIndex(disk: LinkRow[], open: Map<string, string>): LinkRow[] {
  const rows = disk.filter((r) => !open.has(r.path))
  for (const [path, text] of open) {
    if (!path) continue // the blank column has no note behind it
    rows.push({
      path,
      links: indexLinks(text),
      embeds: indexEmbeds(text),
      blocks: indexBlocks(text),
      headings: indexHeadings(text)
    })
  }
  return rows
}

/** One entry in the links block. `(O)` outgoing or `(B)` a backlink. */
export interface LinkEntry {
  kind: 'out' | 'back'
  /** the note it opens, or null for a link to a note that isn't written yet */
  path: string | null
  /** where an unresolved link would create the note */
  suggestedPath: string
  title: string
  heading: string | null
  /** what the `#…` part reads as: the heading itself, or for a block link
   *  (`^k3x9`) the block's first words */
  headingText: string | null
  /** true when the target is a folder — shown in the sidebar, not opened */
  isDir: boolean
  /** true when the other note lives in a different space */
  cross: boolean
  /** the other space's folder name, for the hover card */
  space: string
  /** that space's emoji, when it has one — a space is not obliged to have one */
  emoji: string
  /** the line the link sits on — the "why does that note point here?" */
  context: string
  ambiguous: boolean
  /** a stable key for React, since one note can link to another several times */
  key: string
}

const spaceOf = (p: string): string => {
  const at = p.indexOf('/')
  return at === -1 ? '' : p.slice(0, at)
}

/** The emoji for the space `target` lives in, but only when that isn't the space
 *  `from` lives in. A link inside its own space gets none — marking every link
 *  would say nothing; the point is to notice the ones that cross. */
function crossing(from: string, target: string, spaces: SpaceMark[]): { cross: boolean; space: string; emoji: string } {
  const to = spaceOf(target)
  if (to === spaceOf(from)) return { cross: false, space: '', emoji: '' }
  return { cross: true, space: to, emoji: spaces.find((s) => s.folder === to)?.emoji ?? '' }
}

/** The links this note makes, in the order they appear in it. Duplicates are
 *  kept: linking to the same note from two different paragraphs is two different
 *  connections, and collapsing them would hide the second one's context. */
export function outgoingLinks(
  path: string,
  text: string,
  notes: NoteRef[],
  spaces: SpaceMark[],
  blocks?: ReadonlyMap<string, BlockInfo[]>,
  headings?: ReadonlyMap<string, string[]>
): LinkEntry[] {
  const out: LinkEntry[] = []
  // The same walk the index uses, so the block and the backlinks it produces
  // elsewhere can never disagree about what counts as a link (fenced code, in
  // particular, is skipped by both because it is skipped here).
  eachLinkLine(text, (l, line, lineText) => {
    const r = resolveLink(l, notes, path)
    if (r.kind === 'self') return // a jump inside this note is not a connection to another
    const target = r.kind === 'note' ? r.path : null
    out.push({
      kind: 'out',
      path: target,
      suggestedPath: r.kind === 'note' ? r.path : r.suggestedPath,
      title: l.alias ?? titleOf(r.kind === 'note' ? r.path : l.target),
      heading: l.heading,
      headingText: headingText(l.heading, r.kind === 'note' ? r.path : null, blocks, headings),
      isDir: r.kind === 'note' && r.isDir,
      ...(target ? crossing(path, target, spaces) : { cross: false, space: '', emoji: '' }),
      context: toContext(lineText),
      ambiguous: r.kind === 'note' && r.ambiguous,
      key: `out:${line}:${l.from}`
    })
  })
  return out
}

/** A link's `#…` part as a reader should see it. A block link names a tag, which
 *  means nothing to anyone — its block's first words do. */
function headingText(
  heading: string | null,
  target: string | null,
  blocks?: ReadonlyMap<string, BlockInfo[]>,
  headings?: ReadonlyMap<string, string[]>
): string | null {
  const id = blockIdOf(heading)
  if (!id) return heading && headingShown(heading, target ? headings?.get(target) : undefined)
  const found = target ? blocks?.get(target)?.find((b) => b.id.toLowerCase() === id.toLowerCase()) : undefined
  return found ? found.label : 'block not found'
}

/** The notes that link TO this one, each with the line its link sits on. */
export function incomingLinks(path: string, index: LinkRow[], notes: NoteRef[], spaces: SpaceMark[]): LinkEntry[] {
  return backlinksFor(path, index, notes).map((b: Backlink) => ({
    kind: 'back' as const,
    path: b.path,
    suggestedPath: b.path,
    title: b.title,
    heading: null,
    headingText: null,
    isDir: false, // only a note can hold a link, so only a note can be a backlink
    ...crossing(path, b.path, spaces),
    context: b.context,
    ambiguous: false,
    key: `back:${b.path}:${b.line}`
  }))
}

/** One step of the file-path bar. `path` is what clicking it reveals; the note
 *  itself has none, because there is nothing to reveal about where you already
 *  are. */
export interface Crumb {
  label: string
  emoji: string
  /** the folder to reveal, or null for the note at the end of the trail */
  path: string | null
}

/**
 * `📚 Physics › Term 3 › Waves` for `Physics/Term 3/Waves.md`.
 *
 * The first segment is a space when one matches — a space IS a top-level folder,
 * so the trail reads the same whether or not the vault has been divided up.
 */
export function crumbsFor(path: string, spaces: SpaceMark[]): Crumb[] {
  if (!path) return []
  const parts = path.split('/')
  const out: Crumb[] = []
  let sofar = ''
  for (let i = 0; i < parts.length; i++) {
    sofar = sofar ? sofar + '/' + parts[i] : parts[i]
    const last = i === parts.length - 1
    out.push({
      label: last ? titleOf(parts[i]) : parts[i],
      emoji: i === 0 && !last ? (spaces.find((s) => s.folder === parts[i])?.emoji ?? '') : '',
      path: last ? null : sofar
    })
  }
  return out
}

/** Every folder on the way to `path`, itself included — the set that has to be
 *  open for it to be visible in the sidebar. Everything else collapses. */
export function ancestorsOf(path: string): Set<string> {
  const out = new Set<string>()
  const parts = path.split('/')
  let sofar = ''
  for (const part of parts) {
    sofar = sofar ? sofar + '/' + part : part
    out.add(sofar)
  }
  return out
}
