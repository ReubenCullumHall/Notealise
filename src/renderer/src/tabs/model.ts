/** Which notes are open, in what order, and how they are spread across the
 *  side-by-side panes. Pure — no React, no fs, no `window` — so the awkward
 *  parts (what a pane falls back to when its tab closes, where a dropped tab
 *  lands) are decided here and testable without a DOM.
 *
 *  Three invariants hold after every operation, and the UI leans on all of them:
 *
 *  1. every path in `panes` is also in `tabs` — a pane can only show an open note;
 *  2. no path appears in `panes` twice. A note is visible in at most one pane, so
 *     there is never a second CodeMirror writing the same file, and the autosave
 *     buffer can stay keyed by path.
 *  3. the blank tab exists only while a pane is showing it. A placeholder you
 *     can't see is a tab with nothing in it and nothing to go back to, so
 *     anything that takes the blank's pane away also retires the tab (`tidy`).
 *  4. `sizes`, when present, has exactly one entry per pane. It is OPTIONAL and
 *     losable by design (rule 2): absent, malformed, or the wrong length all
 *     read as "equal columns", so nothing here has to defend against a
 *     hand-edited settings.json — `paneSizes` is the only way anything reads it.
 */

/** Side-by-side panes, capped. Three 366px columns in a 1100px window is
 *  already the point where the text column stops being a text column. */
export const MAX_PANES = 3

/** How narrow a column may be dragged. Below this the text column stops reading
 *  as one (see MAX_PANES) — the divider simply refuses to go further rather
 *  than letting a pane be made unusable with no way back but a reset.
 *
 *  Enforced in PIXELS at the drag, not as a CSS `min-width`: a hard CSS minimum
 *  would overflow the row in a window too narrow to give every pane one, and the
 *  fix for an overflow you can't scroll is worse than a cramped column. */
export const MIN_PANE_PX = 320

export interface TabLayout {
  /** open notes in tab-strip order (vault-relative POSIX paths) */
  tabs: string[]
  /** the note each pane shows, left to right; empty only when nothing is open */
  panes: string[]
  /** index into `panes` — the pane the format bar, sidebar and keyboard act on */
  focus: number
  /** what fraction of the width each pane takes, left to right — invariant 4.
   *  Read it through `paneSizes`, never directly; write it only through the
   *  helpers below, which keep it in step with `panes` on every add, remove and
   *  reorder. Absent means equal columns, which is what every split starts as. */
  sizes?: number[]
}

/** A tab with no note in it yet — the "+" button's tab, which shows "Select a
 *  note" until you click one in the sidebar. It is the empty path because a
 *  blank tab IS a pane with no file behind it, and every operation in this file
 *  then treats it like any other tab: it closes, it drags, it takes the focused
 *  pane, and an ordinary click replaces it (`replaceActive` substitutes in
 *  place). Only one can exist at a time, and that falls out of invariant 2
 *  rather than needing a rule of its own.
 *
 *  It is deliberately NOT persisted: `normalizeSession` drops empty strings, so
 *  a blank tab doesn't come back after a quit — there would be nothing in it. */
export const BLANK = ''

export const EMPTY_LAYOUT: TabLayout = { tabs: [], panes: [], focus: 0 }

/** Invariant 3: retire a blank tab that no longer has a pane. Applied by every
 *  operation that can take the blank's pane away from it. */
const tidy = (l: TabLayout): TabLayout =>
  l.tabs.includes(BLANK) && !l.panes.includes(BLANK)
    ? { ...l, tabs: l.tabs.filter((t) => t !== BLANK) }
    : l

/** The note the app as a whole is "on": whatever the focused pane shows. */
export const activePath = (l: TabLayout): string | null => l.panes[l.focus] ?? null

const clampFocus = (panes: string[], i: number): number =>
  panes.length ? Math.max(0, Math.min(i, panes.length - 1)) : 0

const replaceAt = (xs: string[], i: number, x: string): string[] =>
  xs.map((v, j) => (j === i ? x : v))

const withoutAt = (xs: string[], i: number): string[] => xs.filter((_, j) => j !== i)

// --- pane widths (invariant 4) ---------------------------------------------

const equalSizes = (n: number): number[] => Array.from({ length: n }, () => 1 / n)

/** The width fractions to render, always exactly one per pane and always summing
 *  to 1. **The only legitimate reader of `sizes`.** Anything it can't trust — a
 *  missing array, the wrong length, a hand-edited zero or NaN — falls back to
 *  equal columns whole rather than per-entry: half-repairing a broken array
 *  gives a layout nobody chose, and "equal" is the one arrangement that is
 *  always right to fall back to. */
export function paneSizes(l: TabLayout): number[] {
  const n = l.panes.length
  if (n === 0) return []
  const s = l.sizes
  if (!s || s.length !== n || !s.every((v) => Number.isFinite(v) && v > 0)) return equalSizes(n)
  const total = s.reduce((a, b) => a + b, 0)
  return s.map((v) => v / total)
}

/** Even columns carry NO array — see `equalisePanes`. A layout that has never
 *  been dragged, one dragged back to even, and one that became even by a column
 *  closing are the same layout, so they must be the same value: otherwise a
 *  plain split writes `[0.5, 0.5]` into settings.json for a split nobody
 *  touched, and `equalisePanes` has two different "even"s to be a no-op against.
 *  Every writer below ends here, so that holds however the evenness arose. */
const simplify = (sizes: number[]): number[] | undefined => {
  const even = 1 / sizes.length
  return sizes.every((v) => Math.abs(v - even) < 1e-6) ? undefined : sizes
}

/** Make room at `at` for a column that doesn't exist yet: it takes an equal
 *  share of the new total and the columns already on screen keep their
 *  proportions to each other inside what's left. */
function sizesInsert(l: TabLayout, at: number): number[] | undefined {
  const cur = paneSizes(l)
  const share = 1 / (cur.length + 1)
  const rest = cur.map((v) => v * (1 - share))
  return simplify([...rest.slice(0, at), share, ...rest.slice(at)])
}

/** Close the column at `at`: the survivors keep their proportions to each other
 *  and share out what it had. Undefined when nothing is left — a layout with no
 *  panes carries no sizes, so the next split starts even. */
function sizesRemove(l: TabLayout, at: number): number[] | undefined {
  const rest = paneSizes(l).filter((_, i) => i !== at)
  if (!rest.length) return undefined
  const total = rest.reduce((a, b) => a + b, 0)
  return simplify(rest.map((v) => v / total))
}

/** Move the column at `from` to sit at index `to` of the array it leaves behind.
 *  Its width travels with it — dragging a column somewhere else moves that
 *  column, not the slot it used to occupy. */
function sizesReinsert(l: TabLayout, from: number, to: number): number[] | undefined {
  const cur = paneSizes(l)
  const rest = cur.filter((_, i) => i !== from)
  const at = Math.max(0, Math.min(to, rest.length))
  return simplify([...rest.slice(0, at), cur[from], ...rest.slice(at)])
}

/** Drag the divider that sits to the LEFT of pane `at`. The two columns it
 *  separates divide the width they already had between them in the ratio
 *  `left`:`right` — every other column is untouched, which is what makes a drag
 *  predictable in a three-way split.
 *
 *  Takes a ratio rather than fractions of the whole so the caller can hand over
 *  raw pixel widths and let this normalise them; the minimum-width clamp stays
 *  with the caller, which is the only party that knows how wide a pixel is. */
export function resizePanes(l: TabLayout, at: number, left: number, right: number): TabLayout {
  if (at < 1 || at >= l.panes.length) return l
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return l
  const cur = paneSizes(l)
  const pair = cur[at - 1] + cur[at]
  const total = left + right
  const sizes = [...cur]
  sizes[at - 1] = (left / total) * pair
  sizes[at] = (right / total) * pair
  // Dragging a two-way split back to dead centre is a reset, and records as one.
  return { ...l, sizes: simplify(sizes) }
}

/** Put the columns back to equal — double-clicking a divider. Clearing the array
 *  rather than writing an even one keeps "even" represented exactly one way, so
 *  a layout that has never been dragged and one that has been reset are the same
 *  layout and persist identically. */
export function equalisePanes(l: TabLayout): TabLayout {
  return l.sizes === undefined ? l : { ...l, sizes: undefined }
}

/** Everything the *other* panes are showing — the set a pane must not duplicate. */
const takenBy = (panes: string[], except: number): Set<string> =>
  new Set(panes.filter((_, j) => j !== except))

/** What a pane should fall back to when the note it shows goes away: the next
 *  tab to the right, else the nearest to the left, skipping any another pane
 *  already shows. Returns null when there is nothing left for it — the caller
 *  reads that as "this pane has no reason to exist". */
function neighbour(tabs: string[], from: number, taken: Set<string>): string | null {
  for (let i = from; i < tabs.length; i++) if (!taken.has(tabs[i])) return tabs[i]
  for (let i = from - 1; i >= 0; i--) if (!taken.has(tabs[i])) return tabs[i]
  return null
}

/** Open a note, or focus it if it's already on screen. Opening something you can
 *  already see must never rearrange the split — it just moves focus there. */
export function openTab(l: TabLayout, path: string): TabLayout {
  const shown = l.panes.indexOf(path)
  if (shown !== -1) return { ...l, focus: shown }
  const tabs = l.tabs.includes(path) ? l.tabs : [...l.tabs, path]
  const panes = l.panes.length ? replaceAt(l.panes, l.focus, path) : [path]
  // Swapping the note inside a column leaves the columns alone, so the widths
  // carry over; opening the FIRST pane is a fresh layout and starts even.
  return tidy({ tabs, panes, focus: clampFocus(panes, l.focus), sizes: l.panes.length ? l.sizes : undefined })
}

/** Open a note IN PLACE of the focused one — an ordinary click in the sidebar.
 *  The tab strip doesn't grow: the note you were on closes as the new one opens,
 *  which is how clicking a note behaved before tabs existed. Cmd/Ctrl+click is
 *  what adds a tab (`openTab`).
 *
 *  Two cases leave the strip alone: the note is already in a pane (focus moves
 *  to that pane instead), and the note is an open tab that isn't on screen (it
 *  takes the focused pane, and only the outgoing note closes). */
export function replaceActive(l: TabLayout, path: string): TabLayout {
  const shown = l.panes.indexOf(path)
  if (shown !== -1) {
    // A blank tab is a standing request for a note. If the one you pick is
    // already on screen the request is answered by moving there — and the empty
    // placeholder, having nothing left to wait for, closes by the ordinary tab
    // rules rather than sitting there asking a question you just answered.
    if (l.panes[l.focus] === BLANK) return closeTab({ ...l, focus: shown }, BLANK)
    return { ...l, focus: shown }
  }
  if (!l.panes.length) return openTab(l, path)
  const leaving = l.panes[l.focus]
  const panes = replaceAt(l.panes, l.focus, path)
  const tabs = l.tabs.includes(path)
    ? l.tabs.filter((t) => t !== leaving)
    : l.tabs.map((t) => (t === leaving ? path : t)) // substitute, keeping its place in the strip
  return tidy({ tabs, panes, focus: l.focus, sizes: l.sizes }) // same columns, new note in one
}

/** Rebuild a saved session against the vault as it is NOW. Notes that have been
 *  renamed, binned or deleted outside the app simply aren't there any more, and
 *  a settings.json can be hand-edited, so nothing here is trusted: the result is
 *  reduced to something that satisfies both invariants or to nothing at all. */
export function restoreLayout(
  saved: { tabs: string[]; panes: string[]; focus: number; sizes?: number[] },
  exists: (path: string) => boolean
): TabLayout {
  const tabs = saved.tabs.filter((p, i) => saved.tabs.indexOf(p) === i && exists(p))
  if (!tabs.length) return EMPTY_LAYOUT
  const panes = saved.panes
    .filter((p, i) => saved.panes.indexOf(p) === i && tabs.includes(p))
    .slice(0, MAX_PANES)
  if (!panes.length) panes.push(tabs[0]) // every open tab, but no pane: show one
  // Remembered widths only mean anything if the columns they describe all came
  // back. Drop one note (renamed, binned, deleted outside the app) and every
  // index after it refers to a different pane than the one that was measured —
  // so rather than guess which width belonged to which survivor, the split
  // reopens even. A losable sidecar losing gracefully (rule 2).
  const kept = saved.panes.length === panes.length ? saved.sizes : undefined
  return { tabs, panes, focus: clampFocus(panes, saved.focus), sizes: kept }
}

/** Jump to the nth tab in the strip (Cmd/Ctrl+1…9). Out of range is a no-op
 *  rather than a clamp: pressing Cmd+7 with three tabs open means "the seventh
 *  one", and landing on the third instead is a silent lie about what happened. */
export function selectTab(l: TabLayout, index: number): TabLayout {
  const path = l.tabs[index]
  return path == null ? l : openTab(l, path)
}

/** Close a tab. If a pane was showing it, that pane takes the neighbouring tab;
 *  if no tab is left for it, the pane collapses and the split closes. */
export function closeTab(l: TabLayout, path: string): TabLayout {
  const at = l.tabs.indexOf(path)
  if (at === -1) return l
  const tabs = withoutAt(l.tabs, at)
  const pane = l.panes.indexOf(path)
  if (pane === -1) return { ...l, tabs } // open but not on screen
  // A blank column exists only to hold the note you were about to pick, so when
  // it goes the column goes with it. Backfilling it — the right answer for a
  // real note's pane — would drop a note you did not ask for into a space you
  // opened for one you did. Unless it is the LAST pane: closing down to zero
  // panes with tabs still open would leave the strip pointing at nothing.
  const next =
    path === BLANK && l.panes.length > 1 ? null : neighbour(tabs, at, takenBy(l.panes, pane))
  // Backfilled: the column stays, so its width does too.
  if (next) return { tabs, panes: replaceAt(l.panes, pane, next), focus: l.focus, sizes: l.sizes }
  const panes = withoutAt(l.panes, pane)
  return {
    tabs,
    panes,
    focus: clampFocus(panes, l.focus > pane ? l.focus - 1 : l.focus),
    sizes: sizesRemove(l, pane)
  }
}

/** Move the focused pane through the strip. Tabs another pane is showing are
 *  skipped — cycling must never put the same note on screen twice, which would
 *  give one file two editors. */
export function cycle(l: TabLayout, dir: 1 | -1): TabLayout {
  const n = l.tabs.length
  if (!n) return l
  const taken = takenBy(l.panes, l.focus)
  const cur = activePath(l)
  const from = cur ? l.tabs.indexOf(cur) : -1
  for (let step = 1; step <= n; step++) {
    const cand = l.tabs[(((from + dir * step) % n) + n) % n]
    if (cand === cur) break // wrapped all the way round to where we started
    if (!taken.has(cand)) return openTab(l, cand)
  }
  return l // every other tab is already on screen
}

/** Show `path` in an existing pane — a tab dropped onto the middle of a pane.
 *  If it was showing in another pane it *moves*: that pane held one note and
 *  now has none, so it collapses rather than picking an unrelated one. */
export function showInPane(l: TabLayout, path: string, pane: number): TabLayout {
  if (pane < 0 || pane >= l.panes.length) return l
  const tabs = l.tabs.includes(path) ? l.tabs : [...l.tabs, path]
  const from = l.panes.indexOf(path)
  if (from === pane) return { ...l, tabs, focus: pane }
  const swapped = replaceAt(l.panes, pane, path)
  if (from === -1) return tidy({ tabs, panes: swapped, focus: pane, sizes: l.sizes })
  const panes = withoutAt(swapped, from)
  // The note moved OUT of its own column into this one, so that column closes
  // and hands its width to the survivors — the same rule as any other close.
  return tidy({ tabs, panes, focus: from < pane ? pane - 1 : pane, sizes: sizesRemove(l, from) })
}

/** Split: put `path` in a NEW pane at `at` (0…panes.length) — a tab dropped on
 *  a pane's left or right edge. Capped at MAX_PANES, except when the note is
 *  already on screen, which only reorders the panes and can't add one. */
export function splitAt(l: TabLayout, path: string, at: number): TabLayout {
  const from = l.panes.indexOf(path)
  // The one visible note, dropped on its own edge. There are no other panes to
  // reorder, so this is unambiguously the split gesture — and the pane it
  // leaves has to take another open tab, since showing one note in both halves
  // is what invariant 2 forbids.
  if (from !== -1 && l.panes.length === 1) {
    const other = neighbour(l.tabs, 0, new Set(l.panes))
    if (!other) return l
    const left = at <= 0
    return { tabs: l.tabs, panes: left ? [path, other] : [other, path], focus: left ? 0 : 1 }
  }
  if (from === -1 && l.panes.length >= MAX_PANES) return l
  const tabs = l.tabs.includes(path) ? l.tabs : [...l.tabs, path]
  const rest = from === -1 ? l.panes : withoutAt(l.panes, from)
  let index = Math.max(0, Math.min(at, l.panes.length))
  if (from !== -1 && from < index) index -= 1
  index = Math.min(index, rest.length)
  const panes = [...rest.slice(0, index), path, ...rest.slice(index)]
  // A note arriving from the tab strip is a NEW column and takes an even share;
  // one already on screen is the same column moving, and keeps the width it had.
  const sizes = from === -1 ? sizesInsert(l, index) : sizesReinsert(l, from, index)
  return { tabs, panes, focus: index, sizes }
}

/** Open a new EMPTY column beside the focused one — the split button and
 *  `Cmd/Ctrl+\`. It asks which note you want rather than guessing: the earlier
 *  version moved the focused note across and backfilled the pane it left with
 *  whatever else happened to be open, which needed a second note to exist and
 *  rearranged two columns to satisfy a request about one.
 *
 *  A blank already on screen is simply focused — you asked for a column to fill
 *  and one is already waiting. */
export function splitBlank(l: TabLayout): TabLayout {
  const shown = l.panes.indexOf(BLANK)
  if (shown !== -1) return { ...l, focus: shown }
  if (!l.panes.length) return openTab(l, BLANK)
  if (l.panes.length >= MAX_PANES) return l
  const at = l.focus + 1
  const tabs = l.tabs.includes(BLANK) ? l.tabs : [...l.tabs, BLANK]
  return {
    tabs,
    panes: [...l.panes.slice(0, at), BLANK, ...l.panes.slice(at)],
    focus: at,
    sizes: sizesInsert(l, at)
  }
}

/** Close one pane of a split. The tab stays open — this closes a *view* of the
 *  note, not the note. A single pane has no close button: there the tab's own ×
 *  is what closes things, and collapsing to zero panes with tabs still open
 *  would leave the strip pointing at an empty screen. */
export function closePane(l: TabLayout, pane: number): TabLayout {
  if (l.panes.length <= 1 || pane < 0 || pane >= l.panes.length) return l
  const panes = withoutAt(l.panes, pane)
  return {
    ...l,
    panes,
    focus: clampFocus(panes, l.focus > pane ? l.focus - 1 : l.focus),
    sizes: sizesRemove(l, pane)
  }
}

/** Move a whole column to another position — dragging a pane's own row rather
 *  than its tab. Nothing opens or closes; the same notes stay on screen in a
 *  different order. */
export function movePane(l: TabLayout, from: number, to: number): TabLayout {
  const n = l.panes.length
  if (from < 0 || from >= n || to < 0 || to > n) return l
  const rest = withoutAt(l.panes, from)
  const at = Math.min(from < to ? to - 1 : to, rest.length)
  if (at === from) return l // already there
  const panes = [...rest.slice(0, at), l.panes[from], ...rest.slice(at)]
  return { ...l, panes, focus: at, sizes: sizesReinsert(l, from, at) }
}

/** Exchange two columns — a pane dropped on the MIDDLE of another. Chosen over
 *  "insert here and push the rest along" because dropping onto a column reads as
 *  "these two swap places", and it is the one arrangement where nothing else on
 *  screen moves.
 *
 *  The widths deliberately do NOT swap with the notes (`sizes` rides the spread
 *  untouched): a swap is two notes trading columns, so the columns — and the
 *  sizes you dragged them to — stay exactly where they are. That is what keeps
 *  "nothing else on screen moves" literally true. Contrast `movePane`, where the
 *  column itself travels and takes its width along. */
export function swapPanes(l: TabLayout, a: number, b: number): TabLayout {
  const n = l.panes.length
  if (a === b || a < 0 || b < 0 || a >= n || b >= n) return l
  const panes = [...l.panes]
  panes[a] = l.panes[b]
  panes[b] = l.panes[a]
  return { ...l, panes, focus: b }
}

/** Reorder the strip: put `path` immediately before `before` (or last, if null). */
export function moveTab(l: TabLayout, path: string, before: string | null): TabLayout {
  if (path === before || !l.tabs.includes(path)) return l
  const rest = l.tabs.filter((t) => t !== path)
  const at = before === null ? rest.length : rest.indexOf(before)
  if (at === -1) return l
  return { ...l, tabs: [...rest.slice(0, at), path, ...rest.slice(at)] }
}

/** Follow a rename/move on disk, including a renamed folder's descendants, so
 *  an open tab keeps pointing at the file it is editing. */
export function renamePath(l: TabLayout, from: string, to: string): TabLayout {
  const map = (p: string): string =>
    p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p
  return { tabs: l.tabs.map(map), panes: l.panes.map(map), focus: l.focus, sizes: l.sizes }
}

/** Close every tab that lives under one of `roots` — binned, deleted, or gone
 *  from disk. Folded through closeTab so panes collapse by the same rules. */
export function closeUnder(l: TabLayout, roots: string[]): TabLayout {
  const doomed = l.tabs.filter((p) => roots.some((r) => p === r || p.startsWith(r + '/')))
  return doomed.reduce(closeTab, l)
}
