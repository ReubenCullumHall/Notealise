// The link matcher's look-up against the walk it replaced (2026-11-12,
// docs/app-check-2026-11-09.md item 8).
//
// `resolveLink` used to walk the whole list of notes for every question it asked.
// It now asks an index built once per list (`lookupFor`, links.ts). The rules have
// many edges — a note beside you beats a nearer one beats alphabetical, a note
// beats a folder, a `#` in a NAME, a title that had to be changed to be a
// filename, a path meant inside this space — and every one of them has to come
// out exactly as before. So the walk is kept HERE, word for word as it stood at
// commit a5edb8f, and the two are run side by side over every combination below.
//
// If a rule is ever changed on purpose, change it in both, or delete the case.

import { describe, expect, it } from 'vitest'
import { AWKWARD_NAMES } from './awkwardNames'
import { sanitizeFilename } from './filenames'
import { backlinksFor, dirName, resolveLink, type LinkRow, type NoteRef, type Resolution, type WikiLink } from './links'

// ---------------------------------------------------------------------------
// The old matcher, frozen. Do not tidy.
// ---------------------------------------------------------------------------
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
function resolveByWalk(link: WikiLink, notes: NoteRef[], fromPath: string): Resolution {
  if (!link.target) {
    return { kind: 'self', heading: link.heading ?? '' }
  }
  // A note whose NAME has a `#` in it — "C# basics", "Episode #3". `#` is also
  // how a link names a heading, so `[[C# basics]]` read as heading "basics" in a
  // note called "C", found nothing, and a click made an empty "C" (bug scan
  // 2026-10-27). When the whole thing is a note's name, that note wins; heading
  // links (`[[Waves#Speed]]`) are untouched, since no note is called that.
  // (The parser trims both halves, so "C# basics" arrives as "C" + "basics" and
  // the name is matched half by half, not glued back together.)
  if (link.heading !== null && !link.heading.startsWith('^')) {
    const heading = link.heading
    const want = link.target.slice(link.target.lastIndexOf('/') + 1)
    const named = notes.find((n) => {
      if (n.kind === 'dir') return false
      const i = n.title.indexOf('#')
      return i !== -1 && eq(n.title.slice(0, i).trim(), want) && eq(n.title.slice(i + 1).trim(), heading)
    })
    if (named) {
      const dir = link.target.includes('/') ? link.target.slice(0, link.target.lastIndexOf('/') + 1) : ''
      const whole = resolveByWalk({ ...link, target: dir + named.title, heading: null }, notes, fromPath)
      if (whole.kind === 'note') return whole
    }
  }

  const target = link.target
  const withMd = target.toLowerCase().endsWith('.md') ? target : target + '.md'
  let candidates: NoteRef[]

  /** The same target as a FILENAME — what `createNote` would really have called
   *  it. `?` `:` `/` `*` and friends cannot go in a filename on Windows, so
   *  `[[Q3: Review]]` makes a note called "Q3- Review" — and until 2026-09-20
   *  the link then matched nothing, so clicking it again made "Q3- Review (2)",
   *  and again, and again (Reuben). Tried only after the exact match fails, so
   *  a note genuinely called something else is never hijacked, and the user's
   *  own words stay in their note. */
  const asFilename = (s: string): string =>
    s
      .split('/')
      .map((seg) => sanitizeFilename(seg).name)
      .join('/')

  /** The space `fromPath` lives in — the top-level folder, "" for a note loose
   *  at the vault root. A path target is tried inside it as well as from the
   *  vault root: `[[Ideas/Big idea]]` written in a Revision note means the Ideas
   *  folder in Revision, not a new top-level one beside the spaces — which is
   *  where it landed until 2026-09-20, so the note opened and then could not be
   *  found in the sidebar at all (Reuben). */
  const homeSpace = fromPath.includes('/') ? fromPath.slice(0, fromPath.indexOf('/')) : ''
  const inSpace = (p: string): string => (homeSpace ? `${homeSpace}/${p}` : p)

  if (target.includes('/')) {
    // An explicit path is a promise about where the thing is: honour it exactly
    // rather than falling back to a title match, or `[[Maths/Waves]]` would
    // quietly open `Physics/Waves.md` when the maths one hasn't been written yet.
    // Either spelling may be meant — `[[Physics/Term 3]]` is a folder and
    // `[[Physics/Waves]]` is a note — so both are tried.
    //
    // Four passes, in the order a person means them: exactly as written (which
    // is what the `[[` completion inserts for another space, so it must stay
    // first and win), then inside this note's own space, then each of those as
    // a real FILENAME (see `asFilename`).
    const byPath = (dirPath: string, notePath: string): NoteRef[] =>
      notes.filter((n) => (n.kind === 'dir' ? eq(n.path, dirPath) : eq(n.path, notePath)))
    candidates = byPath(target, withMd)
    if (candidates.length === 0 && homeSpace) candidates = byPath(inSpace(target), inSpace(withMd))
    if (candidates.length === 0) candidates = byPath(asFilename(target), asFilename(withMd))
    if (candidates.length === 0 && homeSpace) {
      candidates = byPath(asFilename(inSpace(target)), asFilename(inSpace(withMd)))
    }
  } else {
    candidates = notes.filter((n) => eq(n.title, target))
    if (candidates.length === 0) {
      const safe = asFilename(target)
      candidates = notes.filter((n) => eq(n.title, safe))
    }
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
      // A path target is made INSIDE this note's space (see `homeSpace`); a bare
      // title lands beside the note that mentioned it.
      suggestedPath: target.includes('/') ? inSpace(withMd) : (dir ? dir + '/' : '') + target + '.md'
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

// ---------------------------------------------------------------------------

const note = (path: string): NoteRef => ({ path, title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, ''), kind: 'note' })
const folder = (path: string): NoteRef => ({ path, title: path.slice(path.lastIndexOf('/') + 1), kind: 'dir' })
const link = (target: string, heading: string | null = null): WikiLink => ({ from: 0, to: 0, target, heading, alias: null, text: '' })

const FOLDERS = ['', 'Physics', 'Physics/Term 3', 'Maths', 'Maths/Sub', 'Revision', 'Revision/Ideas', 'Revision/Physics']
const TITLES = [
  ...AWKWARD_NAMES,
  'Waves',
  'waves', // differs from the one above only in case — a Linux disk allows both
  'Optics',
  'C# basics',
  'C',
  'Episode #3',
  'Episode',
  'Q3- Review', // what "Q3: Review" becomes as a filename
  'Term 3', // also a folder's name
  'Ideas',
  'Big idea',
  'Physics' // a note called what a space is called
]

/** Every title in a spread of folders (not all in all, so some are unique, some
 *  shared, some missing), and every folder as a folder. */
function vault(): NoteRef[] {
  const out: NoteRef[] = []
  TITLES.forEach((t, i) => {
    FOLDERS.forEach((f, j) => {
      if ((i * 7 + j * 3) % 4 === 0 || (t === 'Waves' && j < 5) || (t === 'waves' && j === 1)) {
        out.push(note((f ? f + '/' : '') + t + '.md'))
      }
    })
  })
  for (const f of FOLDERS) if (f) out.push(folder(f))
  out.push(folder('Physics/Waves')) // a folder with a note's name beside it
  out.push(note('physics/WAVES.md')) // the same path as another, in other letters
  return out
}

/** A fixed shuffle: the answers may not depend on the list's order beyond what the walk's did. */
function shuffled<T>(list: T[], seed: number): T[] {
  const a = list.slice()
  let s = seed
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const TARGETS = [
  ...TITLES,
  ...TITLES.map((t) => t.toUpperCase()),
  'Waves.md',
  'WAVES.MD',
  'Physics/Waves',
  'physics/waves',
  'Physics/Term 3/Waves',
  'Physics/Term 3',
  'Maths', // a folder no note shares a name with
  'Sub',
  'Maths/Sub',
  'Maths/Waves',
  'Maths/Waves.md',
  'Ideas/Big idea',
  'Ideas',
  'Revision/Ideas/Big idea',
  'Physics/Waves/',
  'Q3: Review',
  'Physics/Q3: Review',
  'What? Why*',
  'Nothing called this',
  'Nowhere/Nothing',
  ' spaces  around ',
  '',
  '..',
  '../Waves',
  'Physics//Waves'
]
const HEADINGS = [null, '', 'Speed', '^k3x9', 'basics', ' basics ', 'BASICS', '3', 'a#b']
const FROM = ['Loose.md', 'Physics/Note.md', 'Physics/Term 3/Deep.md', 'Maths/Sub/x.md', 'Revision/a.md', 'Revision/Ideas/b.md', 'physics/other.md']

describe('the link matcher: look-up against the walk', () => {
  it('gives the same answer as the walk for every link, from everywhere, in any order', () => {
    let compared = 0
    const kinds = new Set<string>()
    for (const seed of [0, 1, 2, 3]) {
      const notes = seed === 0 ? vault() : shuffled(vault(), seed)
      for (const from of FROM) {
        for (const target of TARGETS) {
          for (const heading of HEADINGS) {
            const l = link(target, heading)
            const want: Resolution = resolveByWalk(l, notes, from)
            expect(resolveLink(l, notes, from), `[[${target}${heading === null ? '' : '#' + heading}]] from ${from}, order ${seed}`).toEqual(want)
            kinds.add(want.kind + (want.kind === 'note' ? (want.isDir ? ':dir' : '') + (want.ambiguous ? ':ambiguous' : '') : ''))
            compared++
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(15000)
    // ...and the cases really did reach every kind of answer, or the comparison proves little.
    for (const k of ['missing', 'note', 'note:ambiguous', 'note:dir', 'self']) expect(kinds.has(k), k).toBe(true)
  })

  it('gives the same backlinks as the walk', () => {
    const notes = vault()
    const index: LinkRow[] = notes
      .filter((n) => n.kind === 'note')
      .map((n, i) => ({
        path: n.path,
        links: TARGETS.filter((_, j) => (i + j) % 5 === 0).map((t, j) => ({ target: t, heading: HEADINGS[(i + j) % HEADINGS.length], alias: null, line: j + 1, context: t }))
      }))
    const walkBacklinks = (path: string): string[] => {
      const out: string[] = []
      for (const row of index) {
        if (row.path.toLowerCase() === path.toLowerCase()) continue
        for (const l of row.links) {
          const r = resolveByWalk(link(l.target, l.heading), notes, row.path)
          if (r.kind === 'note' && r.path.toLowerCase() === path.toLowerCase()) out.push(row.path + ':' + l.line)
        }
      }
      return out.sort()
    }
    let found = 0
    for (const n of notes) {
      const got = backlinksFor(n.path, index, notes).map((b) => b.path + ':' + b.line).sort()
      expect(got, n.path).toEqual(walkBacklinks(n.path))
      found += got.length
    }
    expect(found).toBeGreaterThan(200)
  })

  // The point of the look-up. A note's backlinks ask about every link in the
  // vault; the walk read the whole list of notes for each one — links × notes,
  // which was 4.9 seconds a key with 2,004 link-heavy notes.
  it('reads the list of notes once, not once per link', () => {
    const plain = Array.from({ length: 400 }, (_, i) => note(`Space ${i % 8}/Topic ${i % 40}/Note ${i}.md`))
    let reads = 0
    const notes = new Proxy(plain, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++
        return Reflect.get(target, key, receiver)
      }
    })
    const index: LinkRow[] = plain.map((n, i) => ({
      path: n.path,
      links: Array.from({ length: 12 }, (_, j) => ({ target: `Note ${(i * 13 + j * 7) % 400}`, heading: null, alias: null, line: j + 1, context: '' }))
    }))
    const back = backlinksFor(plain[7].path, index, notes)
    expect(back.length).toBeGreaterThan(0)
    // 4,800 links: the walk made about 1.9 million reads here.
    expect(reads).toBeLessThanOrEqual(plain.length * 2)
  })

  it('sees a note added to a list it has already answered from', () => {
    const notes = [note('Physics/Optics.md')]
    expect(resolveLink(link('Waves'), notes, 'Physics/Optics.md').kind).toBe('missing')
    notes.push(note('Physics/Waves.md'))
    expect(resolveLink(link('Waves'), notes, 'Physics/Optics.md')).toMatchObject({ kind: 'note', path: 'Physics/Waves.md' })
  })
})
