import type { TreeNode } from '../../../shared/types'
import { indexEmbeds } from '../../../shared/attachments'
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
  type NoteRef
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

const stripExt = (p: string): string => (p.toLowerCase().endsWith('.md') ? p.slice(0, -3) : p)

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
export function liveIndex(disk: LinkRow[], open: Map<string, string>): LinkRow[] {
  const rows = disk.filter((r) => !open.has(r.path))
  for (const [path, text] of open) {
    if (!path) continue // the blank column has no note behind it
    rows.push({ path, links: indexLinks(text), embeds: indexEmbeds(text) })
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
export function outgoingLinks(path: string, text: string, notes: NoteRef[], spaces: SpaceMark[]): LinkEntry[] {
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
      isDir: r.kind === 'note' && r.isDir,
      ...(target ? crossing(path, target, spaces) : { cross: false, space: '', emoji: '' }),
      context: toContext(lineText),
      ambiguous: r.kind === 'note' && r.ambiguous,
      key: `out:${line}:${l.from}`
    })
  })
  return out
}

/** The notes that link TO this one, each with the line its link sits on. */
export function incomingLinks(path: string, index: LinkRow[], notes: NoteRef[], spaces: SpaceMark[]): LinkEntry[] {
  return backlinksFor(path, index, notes).map((b: Backlink) => ({
    kind: 'back' as const,
    path: b.path,
    suggestedPath: b.path,
    title: b.title,
    heading: null,
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
