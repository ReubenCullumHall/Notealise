// Wiki links: `[[Note name]]` and its three richer forms. Pure text arithmetic —
// no fs, no DOM, no CodeMirror — because BOTH processes parse links and they must
// agree exactly: main scans the whole vault to build the backlink index, the
// renderer scans the buffer you are typing into. Two parsers would drift, and the
// symptom would be a backlink that appears only after you save.
//
// `[[…]]` is not an invented dialect (rule 4): it is what Obsidian, Logseq, Foam
// and every other Markdown linker already write, so a vault with links in it still
// opens sensibly everywhere else. In an editor that doesn't understand them they
// read as plain text, which is the graceful degradation the rule asks for.
//
// The four forms, all of which resolve to the same three fields:
//
//   [[Waves]]                    target "Waves"
//   [[Physics/Waves]]            target "Physics/Waves"      — an explicit path
//   [[Waves|the waves chapter]]  target "Waves", alias set   — reads in a sentence
//   [[Waves#Interference]]       target "Waves", heading set — lands mid-note
//   [[#Interference]]            target "",     heading set — a jump within this note

/** One `[[…]]` occurrence in a document. */
export interface WikiLink {
  /** offsets of the whole `[[…]]`, including both pairs of brackets */
  from: number
  to: number
  /** the note being pointed at, before any `|` or `#`. "" means "this note". */
  target: string
  /** the part after `#`, or null. Never "" — a bare trailing `#` is not a heading. */
  heading: string | null
  /** the part after `|`, or null. Never "" — `[[Waves|]]` has no display text. */
  alias: string | null
  /** what a reader should see: the alias if there is one, else the target's last
   *  segment, with the heading appended. Never "". */
  text: string
}

/** Something a link may point at. `title` is the name without `.md`.
 *
 *  Folders are in here too: `[[Term 3]]` is a perfectly good thing to want to
 *  write, and a link that can only reach notes makes the folder you filed them
 *  under unreferenceable. A folder link doesn't OPEN anything — there is no
 *  document — it shows the folder in the sidebar. */
export interface NoteRef {
  path: string
  title: string
  kind: 'note' | 'dir'
}

/** What a link points at, once the vault is known. */
export type Resolution =
  | {
      kind: 'note'
      path: string
      /** true when the target is a folder, which is shown rather than opened */
      isDir: boolean
      heading: string | null
      /** more than one note answered to this target — the link works, but which
       *  note it landed on depends on the tie-break below. The UI marks it. */
      ambiguous: boolean
    }
  /** `[[#Heading]]` — a jump inside the note the link is written in. */
  | { kind: 'self'; heading: string }
  /** nothing in the vault answers to this target. `suggestedPath` is where
   *  clicking it should create the note. */
  | { kind: 'missing'; suggestedPath: string }

/** One note's outgoing links, as stored in the vault-wide index. Deliberately
 *  NOT the document itself: the index crosses the IPC bridge, and a vault of a
 *  thousand notes must not mean a thousand documents in a message. */
export interface LinkRow {
  path: string
  links: IndexedLink[]
}

/** A link as the index remembers it: enough to resolve it later, plus the line it
 *  sits on so a backlink can show you *why* that note points here. */
export interface IndexedLink {
  target: string
  heading: string | null
  alias: string | null
  /** 1-based, as an editor counts them */
  line: number
  /** the whole line, trimmed and clipped — the "context" in the links block */
  context: string
}

/** A note that links to the one you're reading. */
export interface Backlink {
  path: string
  title: string
  line: number
  context: string
}

/** How much of a line a backlink row carries. Long enough for a sentence, short
 *  enough that one wordy note can't push the rest of the block off screen. */
const CONTEXT_MAX = 160

export const stripMd = (name: string): string =>
  name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name

/** The last segment of a vault-relative path (or of a `Folder/Note` target). */
export const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

/** The folder a path sits in — "" for the vault root. */
export const dirName = (p: string): string => {
  const at = p.lastIndexOf('/')
  return at === -1 ? '' : p.slice(0, at)
}

/** A note's display title: its filename without the extension. */
export const titleOf = (path: string): string => stripMd(baseName(path))

/** Trim and clip a line for display beside a backlink. */
export function toContext(line: string): string {
  const t = line.trim()
  return t.length <= CONTEXT_MAX ? t : t.slice(0, CONTEXT_MAX - 1) + '…'
}

/**
 * Every `[[…]]` in `text`, in document order, with offsets shifted by `base`.
 *
 * Deliberately a hand scan rather than a regex: the closing `]]` must be found
 * without crossing a newline OR another `[`, and a regex that gets both right is
 * less readable than the loop. `@lezer/markdown` is no help here — `[[Waves]]`
 * has no `(destination)`, so the parser sees an ordinary bracketed span of text
 * and produces no node to walk (which is exactly why `mathPass` scans too).
 *
 * A link with an empty target AND no heading (`[[]]`, `[[|x]]`) is not a link —
 * there is nothing to point at, and while you are mid-way through typing one it
 * would otherwise flicker into a rendered widget under the cursor.
 */
export function scanLinks(text: string, base = 0): WikiLink[] {
  const out: WikiLink[] = []
  let i = 0
  while (i < text.length - 1) {
    // `[[Waves]]` inside `code` is a person writing ABOUT a link, not writing
    // one. The editor knows this from the syntax tree; here there is no tree —
    // main has no CodeMirror — so the backticks are matched directly. Without
    // this the index and the links block would both count a link the editor
    // pointedly refuses to render, which is the kind of disagreement that makes
    // a backlink appear from nowhere.
    if (text[i] === '\\') {
      i += 2
      continue
    }
    if (text[i] === '`') {
      let n = 0
      while (text[i + n] === '`') n++
      const fence = '`'.repeat(n)
      // An unmatched run is just a stray backtick; step over it and carry on
      // rather than swallowing the rest of the line.
      const close = text.indexOf(fence, i + n)
      i = close === -1 ? i + n : close + n
      continue
    }
    if (text[i] !== '[' || text[i + 1] !== '[') {
      i++
      continue
    }
    // Find "]]" without crossing a line break or a fresh "[[" — an unclosed link
    // is the normal state while typing one, and must never swallow the rest of
    // the note looking for a close that isn't there yet.
    let j = i + 2
    let close = -1
    while (j < text.length - 1) {
      const c = text[j]
      if (c === '\n') break
      if (c === '[' && text[j + 1] === '[') break
      if (c === ']' && text[j + 1] === ']') {
        close = j
        break
      }
      j++
    }
    if (close === -1) {
      i += 2
      continue
    }
    const link = parseInner(text.slice(i + 2, close), base + i, base + close + 2)
    if (link) out.push(link)
    i = close + 2
  }
  return out
}

/** Split the inside of a `[[…]]` into target / heading / alias. Order matters:
 *  the alias comes off first, so `[[Waves#Top|see here]]` puts "see here" in the
 *  alias and "Top" in the heading rather than the other way round. */
function parseInner(inner: string, from: number, to: number): WikiLink | null {
  const bar = inner.indexOf('|')
  const head = bar === -1 ? inner : inner.slice(0, bar)
  // Everything after the FIRST bar is the alias, bars and all: a display string
  // is prose, and prose is allowed to contain a "|".
  const aliasRaw = bar === -1 ? '' : inner.slice(bar + 1)

  const hash = head.indexOf('#')
  const target = (hash === -1 ? head : head.slice(0, hash)).trim()
  const headingRaw = hash === -1 ? '' : head.slice(hash + 1)

  const heading = headingRaw.trim() || null
  const alias = aliasRaw.trim() || null

  if (!target && !heading) return null

  const text = alias ?? (target ? baseName(target) + (heading ? ' › ' + heading : '') : '#' + heading)
  return { from, to, target, heading, alias, text }
}

/** Case-insensitive comparison of two vault paths. Both platforms this app ships
 *  on are case-insensitive filesystems, so `[[waves]]` must find `Waves.md`. */
const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** How many leading path segments `a` and `b` share. Used to prefer the nearest
 *  note when several answer to the same title. */
function sharedDepth(a: string, b: string): number {
  const x = a.split('/')
  const y = b.split('/')
  let n = 0
  while (n < x.length && n < y.length && eq(x[n], y[n])) n++
  return n
}

/**
 * Which note (if any) a link points at.
 *
 * A bare `[[Waves]]` can legitimately match several files. Rather than refusing
 * to resolve — which would make the common case (one note, one title) pay for the
 * rare one — it picks deterministically and says it was ambiguous, so the UI can
 * mark it and the fix (`[[Physics/Waves]]`) is one keystroke away.
 *
 * The order is: the note beside you, then the note nearest you, then alphabetical.
 * The last rung matters more than it looks: without it the answer would depend on
 * `listTree` ordering, so the same link could resolve differently in the index
 * (built from a directory walk) and in the editor (built from the sidebar tree).
 */
export function resolveLink(link: WikiLink, notes: NoteRef[], fromPath: string): Resolution {
  if (!link.target) {
    return { kind: 'self', heading: link.heading ?? '' }
  }

  const target = link.target
  const withMd = target.toLowerCase().endsWith('.md') ? target : target + '.md'
  let candidates: NoteRef[]

  if (target.includes('/')) {
    // An explicit path is a promise about where the thing is: honour it exactly
    // rather than falling back to a title match, or `[[Maths/Waves]]` would
    // quietly open `Physics/Waves.md` when the maths one hasn't been written yet.
    // Either spelling may be meant — `[[Physics/Term 3]]` is a folder and
    // `[[Physics/Waves]]` is a note — so both are tried.
    candidates = notes.filter((n) => (n.kind === 'dir' ? eq(n.path, target) : eq(n.path, withMd)))
  } else {
    candidates = notes.filter((n) => eq(n.title, target))
  }

  if (candidates.length === 0) {
    // Where clicking this link should create the note. A path target says where
    // it wants to live; a bare title lands beside the note that mentioned it.
    // NOT sanitised here — `sanitizeFilename` belongs to main, and main's
    // create/rename is the only thing that gets to decide a real filename anyway
    // (it returns the name it actually used). This is a proposal, not a path.
    const dir = dirName(fromPath)
    return {
      kind: 'missing',
      suggestedPath: target.includes('/') ? withMd : (dir ? dir + '/' : '') + target + '.md'
    }
  }

  const here = dirName(fromPath)
  const best = candidates.reduce((a, b) => (better(b, a, here) ? b : a))
  return {
    kind: 'note',
    path: best.path,
    isDir: best.kind === 'dir',
    heading: link.heading,
    ambiguous: candidates.length > 1
  }
}

/** Is `x` a better answer than `y` for a link written in folder `here`? */
function better(x: NoteRef, y: NoteRef, here: string): boolean {
  // A note beats a folder of the same name. Writing `[[Waves]]` when both exist
  // almost always means the note — the folder is where you keep things, the note
  // is the thing you wrote — and the folder is still reachable as `[[Waves/]]`
  // or by its path.
  if (x.kind !== y.kind) return x.kind === 'note'
  const sameX = eq(dirName(x.path), here)
  const sameY = eq(dirName(y.path), here)
  if (sameX !== sameY) return sameX
  const dx = sharedDepth(x.path, here)
  const dy = sharedDepth(y.path, here)
  if (dx !== dy) return dx > dy
  return x.path.toLowerCase() < y.path.toLowerCase()
}

/** Opens or closes a ``` / ~~~ block. The info string after the fence is not
 *  our business — only whether the line is a fence at all. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/**
 * Walk a document line by line, skipping fenced code blocks, and hand each line's
 * links to `emit` with its 1-based line number and byte offset.
 *
 * The fence state is why this exists rather than every caller splitting lines
 * itself: a ``` block spans lines, so it cannot be judged one line at a time, and
 * two callers tracking it separately would eventually disagree.
 */
export function eachLinkLine(
  text: string,
  emit: (link: WikiLink, line: number, lineText: string) => void
): void {
  const lines = text.split('\n')
  let offset = 0
  let fence: string | null = null
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    const m = FENCE.exec(line)
    if (fence) {
      // Only a fence of the same character (and at least as long) closes it.
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      offset += line.length + 1
      continue
    }
    if (m) {
      fence = m[1]
      offset += line.length + 1
      continue
    }
    for (const l of scanLinks(line, offset)) emit(l, n + 1, line)
    offset += line.length + 1
  }
}

/** Turn a document into the index's view of it. */
export function indexLinks(text: string): IndexedLink[] {
  const out: IndexedLink[] = []
  eachLinkLine(text, (l, line, lineText) => {
    out.push({
      target: l.target,
      heading: l.heading,
      alias: l.alias,
      line,
      context: toContext(lineText)
    })
  })
  return out
}

/**
 * Every note that links to `path`, with the line each link sits on.
 *
 * Resolution runs from the *linking* note's point of view — `resolveLink` prefers
 * a note in the same folder, so whether A's `[[Waves]]` reaches this Waves.md is
 * a question about where A is, not where we are. Doing it the other way round is
 * the obvious shortcut (match on title) and it is wrong: it would claim backlinks
 * from notes that actually point at a different, nearer Waves.
 */
export function backlinksFor(path: string, index: LinkRow[], notes: NoteRef[]): Backlink[] {
  const out: Backlink[] = []
  for (const row of index) {
    if (eq(row.path, path)) continue // a note linking to itself is not a backlink
    for (const l of row.links) {
      const link: WikiLink = { from: 0, to: 0, target: l.target, heading: l.heading, alias: l.alias, text: '' }
      const r = resolveLink(link, notes, row.path)
      if (r.kind !== 'note' || !eq(r.path, path)) continue
      out.push({ path: row.path, title: titleOf(row.path), line: l.line, context: l.context })
    }
  }
  // Alphabetical by note, then in document order within a note, so the block
  // doesn't reshuffle itself every time the index is rebuilt.
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.line - b.line)
}

/** Replace every link that resolves to `from` so it points at `to` instead.
 *  Returns null when nothing changed, so a caller can skip the write entirely.
 *
 *  Only *resolved* links are touched — never a bare text replace. A note called
 *  "Notes" would otherwise have its own name rewritten inside every unrelated
 *  `[[Notes on X]]`, and inside ordinary prose that merely looks like a link. */
export function rewriteLinks(text: string, docPath: string, from: string, to: string, notes: NoteRef[]): string | null {
  const links = scanLinks(text)
  if (!links.length) return null

  const nextTitle = titleOf(to)
  const edits: { from: number; to: number; insert: string }[] = []

  for (const l of links) {
    const r = resolveLink(l, notes, docPath)
    if (r.kind !== 'note' || !eq(r.path, from)) continue
    // Keep the shape the user wrote: a path link stays a path link, an alias
    // survives untouched (it's their words, not the note's name), and a heading
    // rides along.
    const target = l.target.includes('/') ? stripMd(to) : nextTitle
    const inner = target + (l.heading ? '#' + l.heading : '') + (l.alias ? '|' + l.alias : '')
    const insert = '[[' + inner + ']]'
    if (insert !== text.slice(l.from, l.to)) edits.push({ from: l.from, to: l.to, insert })
  }
  if (!edits.length) return null

  let out = ''
  let at = 0
  for (const e of edits) {
    out += text.slice(at, e.from) + e.insert
    at = e.to
  }
  return out + text.slice(at)
}
