import { Decoration } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { dirName, resolveLink, scanLinks, type WikiLink } from '../../../shared/links'
import { hideDeco, overlapsSelection, type Pass } from './livePreview'
import { inCode } from './mathPass'
import { linkEnv, type LinkEnv } from './linkEnv'

// `[[Note name]]` — the link between two notes.
//
// A hand scan over the visible text, like mathPass, because @lezer/markdown does
// not model this: `[[Waves]]` has no `(destination)`, so the parser sees an
// ordinary bracketed span and produces no node to walk.
//
// **Marks, not a widget.** Every other replaced construct here (bullets, KaTeX)
// swaps text for something that isn't text. A link's label IS text — it is the
// note's name — and replacing it would take selection, copy, in-note search and
// undo down with it. So the brackets (and the parts of the target that aren't
// displayed) are hidden exactly like a `**`, and what remains is marked. The
// cursor entering the link reveals the whole thing for editing, the same
// per-construct reveal `overlapsSelection` gives inline code and emphasis.
//
// What ends up visible, by form:
//
//   [[Waves]]                     Waves
//   [[Physics/Waves]]             Waves            — the folder is hidden
//   [[Waves|the waves chapter]]   the waves chapter — the target is hidden
//   [[Waves#Interference]]        Waves#Interference — the # is dimmed, not hidden
//   [[#Interference]]             #Interference
//
// The cross-space emoji is a CSS `::before` off a data attribute, not a widget:
// `push()` drops zero-length ranges (livePreview.ts), so a point decoration would
// be silently thrown away — and a pseudo-element is not in the file, not
// selectable, and not a range the builder has to order.

/** Which space a vault-relative path belongs to: the top-level folder it sits
 *  under, or "" for a note loose at the vault root. */
const spaceOf = (p: string): string => {
  const at = p.indexOf('/')
  return at === -1 ? '' : p.slice(0, at)
}

const markCache = new Map<string, Decoration>()
function linkMark(cls: string, target: string, title: string, open: boolean): Decoration {
  const key = [cls, target, title, open].join(' ')
  let d = markCache.get(key)
  if (!d) {
    // No `title`: the app raises its own card on hover (linkGestures), which
    // lands right under the link instead of wherever the OS decides to put a
    // native tooltip after a delay it picks.
    const attributes: Record<string, string> = { 'data-wiki': target }
    // Only a link that goes somewhere is draggable — creating a file mid-drag to
    // satisfy a drop that may never land is worse than not offering the gesture.
    if (open) attributes.draggable = 'true'
    d = Decoration.mark({ class: cls, attributes })
    markCache.set(key, d)
  }
  return d
}

/** The `#` of `[[Waves#Interference]]`. Replaced rather than dimmed: shown, it
 *  reads as punctuation someone typed by accident and splits the link into two
 *  boxes (which is exactly how it looked before). Hidden, the heading half wears
 *  a `›` from CSS instead and the two halves close up into one pill. */
const hashHide = Decoration.replace({})

/** What a link resolves to, plus the bits the DOM needs. Exported so the click
 *  handler in `extensions.ts` answers the same question the same way. */
export interface ResolvedLink {
  link: WikiLink
  /** the note it opens, or null when nothing answers to it */
  path: string | null
  /** where clicking an unresolved link should create the note */
  suggestedPath: string
  heading: string | null
  /** true for `[[#Heading]]` — a jump inside this note */
  self: boolean
  /** the target is a folder: shown in the sidebar rather than opened */
  isDir: boolean
  /** the target's space, when that isn't this note's */
  space: string
  ambiguous: boolean
  /** true when the target lives in a different space from the note the link is
   *  written in — the thing worth noticing */
  cross: boolean
  /** the target space's emoji, when it has one. A space is not obliged to, so
   *  this can be "" for a link that still crosses; the class carries the fact
   *  and the emoji only says WHICH space. */
  emoji: string
}

/** Resolve one link against the editor's view of the vault. */
export function resolveInEnv(env: LinkEnv, link: WikiLink): ResolvedLink {
  const r = resolveLink(link, env.notes, env.path)
  if (r.kind === 'self') {
    return {
      link,
      path: env.path,
      suggestedPath: env.path,
      heading: r.heading,
      self: true,
      isDir: false,
      space: '',
      ambiguous: false,
      cross: false,
      emoji: ''
    }
  }
  if (r.kind === 'missing') {
    return {
      link,
      path: null,
      suggestedPath: r.suggestedPath,
      heading: link.heading,
      self: false,
      isDir: false,
      space: '',
      ambiguous: false,
      cross: false,
      emoji: ''
    }
  }
  // Only when the link actually leaves the space you're reading in. Marking a
  // link inside its own space would put an emoji on nearly every link and say
  // nothing; the point is to notice the ones that cross.
  const from = spaceOf(env.path)
  const to = spaceOf(r.path)
  const cross = to !== from
  return {
    link,
    path: r.path,
    suggestedPath: r.path,
    heading: r.heading,
    self: false,
    isDir: r.isDir,
    space: cross ? to : '',
    ambiguous: r.ambiguous,
    cross,
    emoji: cross ? (env.spaces.find((s) => s.folder === to)?.emoji ?? '') : ''
  }
}

/** Every link in the document, resolved. Used by the click handler, which knows
 *  a position and needs the link under it. */
export function linksAt(env: LinkEnv, text: string): ResolvedLink[] {
  return scanLinks(text).map((l) => resolveInEnv(env, l))
}

export const wikiPass: Pass = (view, _active, push) => {
  const env = view.state.field(linkEnv, false)
  const tree = syntaxTree(view.state)
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    for (const link of scanLinks(doc.sliceString(from, to), from)) {
      // The link itself, not its line: finishing "[[Waves]]" and typing on past
      // it should re-render it even though the cursor is still on that line.
      if (overlapsSelection(view, link.from, link.to)) continue
      if (inCode(tree.resolveInner(link.from, 1))) continue

      const r = env ? resolveInEnv(env, link) : null
      const cls =
        'cm-wikilink' +
        (r && !r.path ? ' cm-wikilink-new' : r?.isDir ? ' cm-wikilink-folder' : ' cm-wikilink-note') +
        (r?.cross ? ' cm-wikilink-cross' : '') +
        (r?.ambiguous ? ' cm-wikilink-ambiguous' : '')
      const target = r?.path ?? link.target
      const tip = !r
        ? link.target
        : r.self
          ? 'Jump to ' + (r.heading ?? 'this note')
          : !r.path
            ? `Not written yet — click to make ${r.suggestedPath}`
            : (r.isDir ? 'Folder: ' : '') +
              r.path +
              (r.cross ? `  (in ${r.emoji ? r.emoji + ' ' : ''}${r.space})` : '') +
              (r.ambiguous ? '  · several notes share this name' : '')

      // Hide the opening "[[" and the closing "]]".
      push(link.from, link.from + 2, hideDeco, true)
      push(link.to - 2, link.to, hideDeco, true)

      const innerFrom = link.from + 2
      const innerTo = link.to - 2
      // The icon is a ::before on the mark, so it must go on the FIRST visible
      // mark only — a link split around its "#" would otherwise wear it twice.
      let lead = true
      const text = (a: number, b: number, extra = ''): void => {
        if (b <= a) return
        const c = cls + (lead ? ' cm-wikilink-lead' : '') + extra
        push(a, b, linkMark(c, target, tip, !!r?.path && !r.self), false)
        lead = false
      }

      if (link.alias !== null) {
        // "Waves|" — the target is machinery, the alias is what the sentence says.
        const bar = doc.sliceString(innerFrom, innerTo).indexOf('|')
        push(innerFrom, innerFrom + bar + 1, hideDeco, true)
        text(innerFrom + bar + 1, innerTo, ' cm-wikilink-tail')
      } else {
        const inner = doc.sliceString(innerFrom, innerTo)
        const hash = inner.indexOf('#')
        // "Physics/" — a path is precision for the app, noise for the reader.
        // Search only the target half, so a "/" inside a heading isn't a folder.
        const slash = inner.lastIndexOf('/', hash === -1 ? inner.length : hash)
        const textFrom = slash === -1 ? innerFrom : innerFrom + slash + 1
        if (textFrom > innerFrom) push(innerFrom, textFrom, hideDeco, true)

        if (hash === -1 || innerFrom + hash < textFrom) {
          text(textFrom, innerTo, ' cm-wikilink-tail')
        } else {
          // Hide the "#" and let the heading half wear a "›" from CSS, so the
          // two halves read as one pill rather than two boxes with punctuation
          // between them. Three disjoint ranges, as the builder requires.
          const at = innerFrom + hash
          text(textFrom, at)
          push(at, at + 1, hashHide, true)
          text(at + 1, innerTo, ' cm-wikilink-heading cm-wikilink-tail')
        }
      }
    }
  }
}

/** The folder a new note should be created in when an unresolved link is
 *  clicked: beside the note that mentioned it. */
export const folderForNew = (suggestedPath: string): string => dirName(suggestedPath)
