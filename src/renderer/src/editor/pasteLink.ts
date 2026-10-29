import { EditorSelection, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import {
  closeCompletion,
  completionStatus,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { SyntaxNode } from '@lezer/common'
import { parseVideoUrl, singleWebUrl, type VideoLink } from '../../../shared/embeds'
import { linkEnv, notifyUser } from './linkEnv'

// Pasting a web address, and the list that lets you change what it is.
//
// The address goes in as typed, at once, so a paste always feels like a paste.
// Then the site is asked for its title (main/linkPreview.ts) and the address
// becomes a MENTION — the page's title as a link; for YouTube and Vimeo the title
// with the site's logo in front (webLinkPass.ts / app.css) — and a right-click on
// it opens the same list a right-click on a `[[note link]]` does (relink.ts), with
// the three things it can be:
//
//     Mention      [How waves work](https://…)      the page's own title, a link
//     Full link    https://…                         exactly as pasted
//     Player view  ![How waves work](https://…)      a player card (YouTube, Vimeo)
//
// All three are plain Markdown (CLAUDE.md rule 4): the first is an ordinary
// link, the second a bare address, the third an image whose address is a video
// page — the form Obsidian also draws as a player. Nothing is stored beside the
// note; the choice IS the text, so another editor shows the same note.
//
// The list is CodeMirror's own completion list (completions.ts draws it, so it
// wears the same card, rows and keys as the note-link picker: arrows, Enter, Esc,
// click). A video pasted is a MENTION by default, not a card (Reuben, 2026-10-06).
//
// What this does NOT do: look anything up when a note is opened or when text
// arrives from anywhere but the clipboard — or from picking Mention on an address
// that has no title yet, which is your own ask. The title is fetched ONCE and
// written into the note. See main/linkPreview.ts for why that matters.

export type Form = 'link' | 'title' | 'video'

interface Pending {
  id: number
  /** the note the paste happened in — the view outlives the note in it */
  notePath: string
  url: string
  /** the text written for it so far, always `[from, to)` */
  from: number
  to: number
  form: Form
  title: string | null
  video: VideoLink | null
  /** the look-up has come back, so there is nothing left to wait for */
  ready: boolean
  /** still where it was pasted: the cursor has not moved away and nothing has been typed */
  bar: boolean
  /** the look-up is taking a moment, so say so (see `createHint`) */
  slow: boolean
}

let nextId = 1

const startPaste = StateEffect.define<Pending>()
/** Something rewrote the range on purpose (the look-up finishing) — the new extent. */
const setForm = StateEffect.define<{ id: number; form: Form; to: number; ready: boolean; title: string | null; video: VideoLink | null }>()
const cancelPaste = StateEffect.define<number>()
const markSlow = StateEffect.define<number>()

/** Every paste still waiting on its look-up.
 *
 *  A LIST, not one: paste a second address before the first has come back and the
 *  first must still land (it used to be forgotten, and stayed a bare address
 *  forever). A paste is dropped from here the moment it has nothing left to do, so
 *  nothing stale is left listening (an Escape pressed an hour later was being
 *  swallowed by one that was). */
const pasteField = StateField.define<Pending[]>({
  create: () => [],
  update(list, tr) {
    if (!list.length && !tr.effects.length) return list
    let next = list
    // Effects first, so what the look-up just decided is in place before the
    // change it came with is judged.
    const rewritten = new Set<number>()
    for (const e of tr.effects) {
      if (e.is(startPaste)) next = [...next.map((q) => (q.bar ? { ...q, bar: false } : q)), e.value]
      else if (e.is(cancelPaste)) next = next.filter((q) => q.id !== e.value)
      else if (e.is(markSlow)) next = next.map((q) => (q.id === e.value && !q.ready ? { ...q, slow: true } : q))
      else if (e.is(setForm)) {
        const v = e.value
        rewritten.add(v.id)
        next = next.map((q) => (q.id === v.id ? { ...q, form: v.form, to: v.to, ready: v.ready, title: v.title, video: v.video } : q))
      }
    }
    if (tr.docChanged && next.length) {
      const started = new Set(tr.effects.filter((e) => e.is(startPaste)).map((e) => (e.value as Pending).id))
      next = next.flatMap((q) => {
        if (rewritten.has(q.id) || started.has(q.id)) return [q]
        // Editing the address itself ends it — what is there is the user's now.
        let edited = false
        tr.changes.iterChanges((fromA, toA) => {
          if (toA > q.from && fromA < q.to) edited = true
        })
        if (edited) return []
        // Typing on after it is the answer to "keep it as it is": the look-up
        // carries on and still lands, but nothing is shown for it any more.
        return [{ ...q, from: tr.changes.mapPos(q.from, 1), to: tr.changes.mapPos(q.to, -1), bar: false }]
      })
    }
    if (next.some((q) => q.bar)) {
      const head = tr.state.selection.main.head
      next = next.map((q) => (q.bar && (head < q.from || head > q.to) ? { ...q, bar: false } : q))
    }
    // Done: rewritten.
    next = next.filter((q) => !q.ready)
    return next.length === list.length && next.every((q, i) => q === list[i]) ? list : next
  }
})

// --- what the text says for each form ----------------------------------------

/** Brackets and parentheses in an address would end the link early; their
 *  percent forms are the same address. */
const dest = (url: string): string => url.replace(/\(/g, '%28').replace(/\)/g, '%29')

export function textFor(form: Form, p: { url: string; title: string | null }): string {
  if (form === 'link') return p.url
  if (form === 'title') return `[${p.title ?? p.url}](${dest(p.url)})`
  return `![${p.title ?? ''}](${dest(p.url)})`
}

/** Is `pos` somewhere a pasted address should stay exactly as pasted — code, or
 *  inside a link or image that is already being written? */
const LITERAL = new Set([
  'FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeInfo', 'Link', 'Image', 'Autolink', 'URL',
  'LinkReference', 'HTMLBlock', 'HTMLTag', 'CommentBlock', 'ProcessingInstructionBlock'
])
/** A code block still open at the end of the note, or one whose last line the
 *  cursor is on, ENDS at the cursor — and a node ending at `pos` is only found
 *  looking backwards. Only blocks get that: for a link, ending at `pos` means the
 *  cursor is just after it, which is the ordinary place to paste. */
const BLOCKS = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'ProcessingInstructionBlock'])
function inLiteral(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state)
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 0); n; n = n.parent) {
    if (LITERAL.has(n.name)) return true
  }
  for (let n: SyntaxNode | null = tree.resolveInner(pos, -1); n; n = n.parent) {
    if (BLOCKS.has(n.name)) return true
  }
  return false
}

/** Straight after `](` or `<` that are typed but not yet closed — a link being
 *  written by hand. The parser only sees a link once it's closed, so pasting an
 *  address there was turned into a titled link INSIDE the one being typed:
 *  `[my text]([Example Domain](https://example.com))` (bug scan 2026-10-27). */
function writingLinkByHand(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  return /\]\([^)\s]*$/.test(before) || /<$/.test(before)
}

const notePathOf = (view: EditorView): string => view.state.field(linkEnv, false)?.path ?? ''

/** Rewrite the pasted text as `form`, keeping the cursor where it was in
 *  relation to it. */
function rewrite(view: EditorView, p: Pending, form: Form, info: { title: string | null; video: VideoLink | null; ready: boolean }): void {
  const insert = textFor(form, { url: p.url, title: info.title })
  const to = p.from + insert.length
  const sel = view.state.selection.main
  // A cursor sitting at the end of the address stays at the end of what
  // replaces it; anywhere else it is carried along by the change as usual.
  const atEnd = sel.empty && sel.head === p.to
  view.dispatch({
    changes: { from: p.from, to: p.to, insert },
    ...(atEnd ? { selection: { anchor: to } } : {}),
    effects: [
      setForm.of({ id: p.id, form, to, ready: info.ready, title: info.title, video: info.video }),
      // A player card is tall: one made at the bottom of the window grows it off
      // the screen. Bring the whole card into view — but only for someone still
      // standing there, never yank a note away from a reader who has gone elsewhere.
      ...(atEnd && form === 'video' ? [EditorView.scrollIntoView(EditorSelection.range(p.from, to), { y: 'nearest', yMargin: 56 })] : [])
    ],
    userEvent: 'input.paste'
  })
}

/** Ask the site for `url`'s title and write the result over `[from, to)` as a
 *  mention, with a "Looking up…" if it takes a moment. The shared back half of a
 *  paste and of picking Mention on an address that has no title yet. A look-up
 *  that finds nothing leaves the text alone (`onNone` says why, if anyone asks). */
function lookUpInto(
  view: EditorView,
  at: { from: number; to: number; url: string; form: Form },
  onNone?: () => void
): void {
  const notePath = notePathOf(view)
  const id = nextId++
  view.dispatch({
    effects: startPaste.of({
      id, notePath, url: at.url, from: at.from, to: at.to,
      form: at.form, title: null, video: null, ready: false, bar: true, slow: false
    })
  })
  // A look-up that is taking its time says so; a quick one never flashes it.
  window.setTimeout(() => {
    try {
      const q = view.state.field(pasteField, false)?.find((x) => x.id === id)
      if (q && !q.ready && q.bar) view.dispatch({ effects: markSlow.of(id) })
    } catch {
      // the editor went away in the meantime
    }
  }, SLOW_AFTER)

  void window.api
    .lookUpLink(at.url)
    .then((info) => {
      const p = view.state.field(pasteField, false)?.find((q) => q.id === id)
      if (!p || notePathOf(view) !== notePath) return
      if (!info.title) {
        view.dispatch({ effects: cancelPaste.of(id) })
        onNone?.()
        return
      }
      rewrite(view, p, 'title', { title: info.title, video: info.video, ready: true })
    })
    .catch(() => {
      view.dispatch({ effects: cancelPaste.of(id) })
      onNone?.()
    })
}

/** "Looking up…", for a look-up that is taking its time. Only after a beat
 *  (`SLOW_AFTER`), so a quick one never flashes it. */
function createHint(): TooltipView {
  const dom = document.createElement('div')
  dom.className = 'cm-paste-hint'
  dom.textContent = 'Looking up…'
  return { dom }
}
const SLOW_AFTER = 700

// Not `strictSide`: with the paste at the foot of the window there is no room
// beneath it, and a hint that may not flip is a hint that is not drawn at all —
// which is exactly where people paste, at the end of a note.
const hintTooltip = showTooltip.compute([pasteField], (state): Tooltip | null => {
  const waiting = state.field(pasteField).find((q) => !q.ready && q.bar && q.slow)
  return waiting ? { pos: waiting.from, above: false, create: createHint } : null
})

// --- the list: Mention / Full link / Player view ---------------------------------

/** A web address in the note, as the list sees it. */
export interface LinkRef {
  from: number
  to: number
  url: string
  /** the words it is shown as, or null when it has none (a bare address) */
  title: string | null
  form: Form
}

const openOptions = StateEffect.define<LinkRef>()
const closeOptions = StateEffect.define<null>()

/** The link whose list is open, kept pointing at it as the note changes. It ends
 *  with an edit to the link itself or the cursor leaving it. */
export const optionsField = StateField.define<LinkRef | null>({
  create: () => null,
  update(o, tr) {
    for (const e of tr.effects) {
      if (e.is(openOptions)) return e.value
      if (e.is(closeOptions)) return null
    }
    if (!o) return o
    let next: LinkRef = o
    if (tr.docChanged) {
      let edited = false
      tr.changes.iterChanges((fromA, toA) => {
        if (toA > o.from && fromA < o.to) edited = true
      })
      if (edited) return null
      next = { ...o, from: tr.changes.mapPos(o.from, 1), to: tr.changes.mapPos(o.to, -1) }
    }
    if (tr.docChanged || tr.selection) {
      const head = tr.state.selection.main.head
      if (head < next.from || head > next.to) return null
    }
    return next
  }
})

/** The web link at `pos`, in whichever shape it is written: `[title](address)`, a
 *  `<address>`, a bare address, or a video's `![title](address)` card. Null for
 *  anything else — a file, a note, a photo, an address that isn't http(s). */
export function linkAt(state: EditorState, pos: number): LinkRef | null {
  const doc = state.doc
  const tree = syntaxTree(state)
  let bare: SyntaxNode | null = null
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'Image' || n.name === 'Link' || n.name === 'Autolink') {
      let url = ''
      const marks: { from: number; to: number }[] = []
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.name === 'URL') url = doc.sliceString(c.from, c.to).replace(/^<|>$/g, '')
        else if (c.name === 'LinkMark') marks.push({ from: c.from, to: c.to })
      }
      const addr = singleWebUrl(url)
      if (!addr) return null
      if (n.name === 'Autolink') return { from: n.from, to: n.to, url: addr, title: null, form: 'link' }
      const label = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from).trim() : ''
      const title = label && label !== addr ? label : null
      if (n.name === 'Image') {
        return parseVideoUrl(addr) ? { from: n.from, to: n.to, url: addr, title, form: 'video' } : null
      }
      return { from: n.from, to: n.to, url: addr, title, form: 'title' }
    }
    if (n.name === 'URL' && !bare) bare = n
  }
  if (!bare) return null
  const addr = singleWebUrl(doc.sliceString(bare.from, bare.to))
  return addr ? { from: bare.from, to: bare.to, url: addr, title: null, form: 'link' } : null
}

/** Make `ref` into `form`. A Mention of an address with no title yet asks the site
 *  for one — your own ask, so it respects the Settings switch like a paste does. */
function applyForm(view: EditorView, ref: LinkRef, form: Form): void {
  view.dispatch({ effects: closeOptions.of(null) })
  closeCompletion(view)
  if (form === ref.form) return
  if (form === 'title' && !ref.title) {
    lookUpInto(view, ref, () => notifyUser(view.state, "Couldn't find a title for that address."))
    return
  }
  const insert = textFor(form, { url: ref.url, title: ref.title })
  const to = ref.from + insert.length
  view.dispatch({
    changes: { from: ref.from, to: ref.to, insert },
    selection: { anchor: to },
    effects: form === 'video' ? [EditorView.scrollIntoView(EditorSelection.range(ref.from, to), { y: 'nearest', yMargin: 56 })] : [],
    userEvent: 'input.complete'
  })
}

/** The rows. What the list is called is the thing you'd want it to be: a mention
 *  (the title), the full address, or the video's own player. */
function rowsFor(ref: LinkRef): Completion[] {
  const video = parseVideoUrl(ref.url)
  let host = ref.url
  try {
    host = new URL(ref.url).hostname.replace(/^www\./, '')
  } catch {
    // keep the address as it is
  }
  const rows: { label: string; form: Form; type: string; detail: string }[] = [
    { label: 'Mention', form: 'title', type: 'mention', detail: ref.title ?? 'its title' },
    { label: 'Full link', form: 'link', type: 'link', detail: host },
    ...(video ? [{ label: 'Player view', form: 'video' as Form, type: 'player', detail: video.label }] : [])
  ]
  return rows.map((r, i) => ({
    label: r.label,
    detail: r.detail,
    type: r.type,
    boost: rows.length - i,
    // the one it is now, marked in the list (app.css `.cm-paste-current`)
    current: r.form === ref.form,
    apply: (view: EditorView) => applyForm(view, ref, r.form)
  })) as Completion[]
}

/** The completion source (completions.ts lists it beside the note-link picker's). */
export function pasteOptionsSource(context: CompletionContext): CompletionResult | null {
  const o = context.state.field(optionsField, false)
  if (!o) return null
  return { from: o.from, to: o.to, options: rowsFor(o), filter: false }
}

/** Is the list for a web link open — so the popup can wear its own class. */
export const optionsOpen = (state: EditorState): boolean => !!state.field(optionsField, false)

/** Open the list on the web link at `pos`. The cursor goes to the end of it, like
 *  right-clicking a `[[note link]]` puts it inside. False when there is no web link. */
export function openPasteOptions(view: EditorView, pos: number): boolean {
  const ref = linkAt(view.state, pos)
  if (!ref) return false
  view.dispatch({ selection: { anchor: ref.to }, effects: openOptions.of(ref) })
  view.focus()
  startCompletion(view)
  return true
}

/** The list closed without a choice (Escape, a click elsewhere): forget it. A
 *  choice closes it a beat before it opens again, so look once things settle. */
const watchOptions = EditorView.updateListener.of((u) => {
  if (!u.state.field(optionsField, false) || completionStatus(u.state) !== null) return
  const view = u.view
  setTimeout(() => {
    if (!view.dom.isConnected) return
    if (view.state.field(optionsField, false) && completionStatus(view.state) === null) {
      view.dispatch({ effects: closeOptions.of(null) })
    }
  }, 0)
})

// --- the paste and the right-click -------------------------------------------------

const pasteHandler = EditorView.domEventHandlers({
  paste(event, view) {
    // A file on the clipboard is attachInput's, and it has already claimed it.
    if (event.defaultPrevented) return false
    const cd = event.clipboardData
    if (!cd || Array.from(cd.items).some((i) => i.kind === 'file')) return false
    const url = singleWebUrl(cd.getData('text/plain'))
    if (!url) return false
    const sel = view.state.selection.main
    // Into code, or into a link being written, is a plain paste — the address is
    // wanted as text.
    if (inLiteral(view.state, sel.from) || inLiteral(view.state, sel.to)) return false
    if (writingLinkByHand(view.state, sel.from)) return false
    if (!sel.empty) {
      // Words selected: THEY become the link, at once and with no look-up — the
      // way Notion and Obsidian do it (Reuben, 2026-10-05). Only words on one
      // line with no brackets of their own; anything else is a plain paste.
      const words = view.state.sliceDoc(sel.from, sel.to)
      const label = words.trim()
      if (!label || /[\n[\]]/.test(label)) return false
      event.preventDefault()
      const lead = words.slice(0, words.indexOf(label))
      const trail = words.slice(lead.length + label.length)
      const insert = `${lead}[${label}](${dest(url)})${trail}`
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: { anchor: sel.from + insert.length - trail.length },
        userEvent: 'input.paste',
        scrollIntoView: true
      })
      return true
    }
    event.preventDefault()
    view.dispatch({
      changes: { from: sel.head, insert: url },
      selection: { anchor: sel.head + url.length },
      userEvent: 'input.paste',
      scrollIntoView: true
    })
    lookUpInto(view, { from: sel.head, to: sel.head + url.length, url, form: 'link' })
    return true
  },

  // Right-click a web link — or a video's card — for the list, as right-clicking a
  // `[[note link]]` points it somewhere else (linkGestures.ts). The press itself is
  // kept from selecting a word (webLinkPass.ts), or the colour bar would come up.
  contextmenu(event, view) {
    const el = (event.target as HTMLElement | null)?.closest?.('.cm-weblink:not(.cm-filelink), .cm-video-card')
    if (!el) return false
    if (!openPasteOptions(view, view.posAtDOM(el))) return false
    event.preventDefault()
    return true
  }
})

// Escape means "leave it as it is": the list closes, or a look-up still on its way
// is ignored. Only while one of those is actually up — an Escape meant for
// something else must go through.
const pasteKeys = keymap.of([
  {
    key: 'Escape',
    run(view) {
      if (view.state.field(optionsField, false)) {
        view.dispatch({ effects: closeOptions.of(null) })
        closeCompletion(view)
        return true
      }
      const up = view.state.field(pasteField, false)?.filter((q) => q.bar) ?? []
      if (!up.length) return false
      view.dispatch({ effects: up.map((q) => cancelPaste.of(q.id)) })
      return true
    }
  }
])

export const pasteLink: Extension = [pasteField, optionsField, hintTooltip, watchOptions, pasteHandler, pasteKeys]
