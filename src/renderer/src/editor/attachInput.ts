import { StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { dropLead, fileDropSpot } from './blockMove'
import { dirName } from '../../../shared/links'
import { DRAG_NOTE } from '../tabs/island'
import { uniqueName } from '../links/model'
import {
  encodeTarget,
  extForMime,
  isDocFilename,
  kindForFilename,
  kindForMime,
  type AttachmentKind
} from '../../../shared/attachments'
import { audioTag } from '../../../shared/voiceNote'
import { linkEnv, notifyError, notifyUser } from './linkEnv'
import { hasNoPicture, saveRecording } from './voiceImport'
import { mightBeSoundOnly, ownLineInsert, tooBigMessage } from './voiceRecModel'

// Getting a photo or video INTO a note: paste, drag-and-drop, and the explicit
// "Attach…" command all end here. The picture/video is always written as a
// plain sibling file next to the note — same convention `copyLocalAsset`
// already uses for imports — and inserted as ordinary markdown at the cursor
// (or the drop point), so it's real text that moves like any other paragraph.
// Rendering it is imagePass's job already; video's own pass lands separately.
//
// Which MIME types count as an image or a video is NOT decided here — it comes
// from shared/attachments.ts, the same catalogue main filters the native picker
// with. See that file's header.

/** Percent-encode a filename for use as a markdown destination or an HTML
 *  attribute value.
 *
 *  Not optional, and spaces are why: a CommonMark image destination written
 *  bare — `![](He is watching you.jpg)` — is not a destination at all, so the
 *  markdown parser never produces an Image node, no widget is built, and the
 *  raw text just sits in the note looking like a broken link. Video dodged it
 *  only by being HTML with a quoted attribute. Both are encoded now, and
 *  `resolveVaultPath` decodes on the way back in, so it round-trips.
 *
 *  encodeURIComponent leaves `( ) ! ' *` alone; the parens are the ones that
 *  matter, since they close a `![](…)` destination early — `photo (2).jpg` is
 *  a completely ordinary name for a downloaded file. */
/** The markdown/HTML a `kind` embed is written as. `name` is always just the
 *  basename — the asset lands beside the note, so nothing more is needed.
 *  `encodeTarget` is in shared/attachments.ts: App re-writes these on restore
 *  and the two must produce identical text. */
function embedText(kind: AttachmentKind | 'file', name: string): string {
  const target = encodeTarget(name)
  // A document is not an embed but a plain link to the file, labelled with its
  // own name — every other editor shows it as a link, and here a click opens it
  // in its own app (webLinkPass.ts).
  if (kind === 'file') return `[${name.replace(/[[\]]/g, '')}](${target})`
  // A voice note: the one line shared/voiceNote.ts defines, drawn by audioPass.
  if (kind === 'audio') return audioTag(target)
  return kind === 'image' ? `![](${target})` : `<video controls src="${target}"></video>`
}

/** What a pasted or dropped file is to this editor: a photo, a video, a
 *  recording, a document we can open — or nothing it takes. Documents are known
 *  by their name (a File's MIME type is empty for a `.pages` or `.key`), photos
 *  and videos by their type. A recording by either: its type is often empty or
 *  one the catalogue has never heard of (.opus, .qta and .amr have none on many
 *  machines; Windows calls an .aac `audio/vnd.dlna.adts`), and anything typed
 *  `audio/` goes the voice-note way rather than being typed into the note as
 *  text by CodeMirror's own drop. */
function kindOfFile(name: string, mime: string): AttachmentKind | 'file' | null {
  return (
    kindForMime(mime) ??
    (kindForFilename(name) === 'audio' || /^audio\//i.test(mime) ? 'audio' : null) ??
    (isDocFilename(name) ? 'file' : null)
  )
}

/** A clipboard image paste usually names the file "image.png" itself; a
 *  fallback only matters for the odd source that hands over no name at all. */
function defaultName(kind: AttachmentKind, mime: string): string {
  const ext = extForMime(mime) ?? (kind === 'image' ? 'png' : kind === 'audio' ? 'm4a' : 'mp4')
  return (kind === 'image' ? 'Pasted image' : kind === 'audio' ? 'Pasted recording' : 'Pasted video') + '.' + ext
}

/** The note this editor is showing. Read fresh each time on purpose — the view
 *  outlives the note in it (see insertAtTarget). */
function notePathOf(view: EditorView): string {
  return view.state.field(linkEnv, false)?.path ?? ''
}


// --- keeping the insert point alive across a disk write ---------------------
//
// Writing an attachment is an IPC round-trip, and a big video's can take a
// while. A plain number captured before that `await` is a position in a
// document that may no longer exist by the time the write finishes: type a few
// words, or let the file watcher reload the note, and the eventual dispatch
// either inserts in the wrong place or throws a RangeError. So the target is
// held in a StateField instead, and every transaction maps it through its own
// changes — the same thing CodeMirror does for the selection.

interface Target {
  /** where the embed goes; `to` > `from` when it is replacing a selection */
  from: number
  to: number
}

let nextTargetId = 1

const setTarget = StateEffect.define<{ id: number; target: Target }>()
const clearTarget = StateEffect.define<number>()

const attachTargets = StateField.define<Map<number, Target>>({
  create: () => new Map(),
  update(targets, tr) {
    let next = targets
    if (tr.docChanged && targets.size) {
      next = new Map()
      for (const [id, t] of targets) {
        // -1 / 1 so an insertion exactly at the boundary keeps the target's
        // span around it rather than collapsing it away.
        next.set(id, { from: tr.changes.mapPos(t.from, -1), to: tr.changes.mapPos(t.to, 1) })
      }
    }
    for (const e of tr.effects) {
      if (e.is(setTarget)) {
        if (next === targets) next = new Map(targets)
        next.set(e.value.id, e.value.target)
      } else if (e.is(clearTarget)) {
        if (next === targets) next = new Map(targets)
        next.delete(e.value)
      }
    }
    return next
  }
})

/** Insert one embed at the live position of target `id`, replacing whatever
 *  that target still spans, and leave the target collapsed just after it — so a
 *  run of several (a multi-file paste or drop) lands as consecutive lines in
 *  order rather than piling up at the same point.
 *
 *  `notePath` is the note the attach STARTED in, and checking it is not
 *  optional. CodeEditor creates its view once and swaps the document in place
 *  when you switch notes, so the view outlives the note in it — and a target
 *  mapped through that whole-document replacement is a perfectly valid position
 *  in somebody else's text. Positions alone cannot tell the two situations
 *  apart; the note's own path can. Without this, switching notes while a large
 *  video was still being written put its embed in the wrong note, against a
 *  relative path that doesn't resolve from there either.
 *
 *  Returns false when there was no longer anywhere to put it — the file IS on
 *  disk by then, so the caller has to say so rather than leave the user with a
 *  note that looks like nothing happened. */
function insertAtTarget(
  view: EditorView,
  id: number,
  kind: AttachmentKind | 'file',
  name: string,
  notePath: string,
  lead = ''
): boolean {
  if (notePathOf(view) !== notePath) return false // a different note is on screen now
  const t = view.state.field(attachTargets, false)?.get(id)
  if (!t) return false // the editor was torn down or the target was cleared
  const len = view.state.doc.length
  const from = Math.min(t.from, len)
  const to = Math.min(Math.max(t.to, from), len)
  // A voice note's player is a block, so it always gets a line of its own —
  // dropped partway along a sentence, the sentence is split around it. Photos,
  // videos and documents go exactly where they always went.
  // `lead` (a drop's added newline or empty line — blockMove.ts `dropLead`) goes in with the
  // embed, in one change, so one Cmd+Z takes both away. After it the embed starts a fresh line.
  const before = lead ? '' : view.state.doc.sliceString(view.state.doc.lineAt(from).from, from)
  const text = lead + (kind === 'audio' ? ownLineInsert(before, embedText(kind, name)) : embedText(kind, name) + '\n')
  const after = from + text.length
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: after },
    effects: setTarget.of({ id, target: { from: after, to: after } })
  })
  return true
}

/** Write each file to disk and insert its embed, one at a time — sequential
 *  because each insert shifts where the next one belongs, and a `Promise.all`
 *  of dispatches racing would scramble that order. One file failing to write
 *  (a permissions error, a vanished drag source) doesn't lose the rest.
 *
 *  `to` defaults to `from`, i.e. a plain insertion. Paste and the "Attach…"
 *  command pass the real selection, so an embed REPLACES selected text the way
 *  every other paste does; a drop passes only the drop point, since a drop
 *  lands where it was dropped. */
async function insertFiles(
  view: EditorView,
  files: File[],
  from: number,
  to: number = from,
  lead = ''
): Promise<void> {
  const notePath = notePathOf(view)
  const dir = dirName(notePath)
  const id = nextTargetId++
  view.dispatch({ effects: setTarget.of({ id, target: { from, to } }) })
  try {
    for (const file of files) {
      let kind = kindOfFile(file.name, file.type)
      if (!kind) continue
      const filename = file.name || defaultName(kind === 'file' ? 'image' : kind, file.type)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        // A "video" with no picture is a recording (Obsidian's recorder writes
        // .webm, phones write sound-only .mp4). One WITH a picture — or one the
        // check can't be sure about — stays a video, as it always was.
        if (kind === 'video' && mightBeSoundOnly(filename, file.type) && (await hasNoPicture(file, filename, bytes))) {
          kind = 'audio'
        }
        let name: string
        if (kind === 'audio') {
          // Played, converted or kept as it is — voiceImport decides, and says
          // so. Null: nothing to add (too big to convert; already said).
          const saved = await saveRecording(view.state, dir, filename, bytes, file)
          if (!saved) continue
          name = saved
        } else {
          const relPath = await window.api.writeAsset(dir, filename, bytes)
          name = relPath.slice(relPath.lastIndexOf('/') + 1)
        }
        // Saved, but the note moved on underneath it (or was swapped for
        // another one) — say both halves, because the file really is there and
        // a silent nothing reads as a broken paste.
        if (!insertAtTarget(view, id, kind, name, notePath, lead)) {
          notifyUser(view.state, `Saved ${name}, but couldn't add it to the note — try again.`)
        } else lead = '' // only before the first: the rest follow it, one per line
      } catch (e) {
        // One bad file must not lose the ones before or after it, so the loop
        // carries on — but it is reported rather than swallowed, which is what
        // left a failed paste looking exactly like a paste that did nothing.
        console.error(`could not attach ${filename}`, e)
        notifyError(view.state, `Couldn't add ${filename}`, e)
      }
    }
  } finally {
    view.dispatch({ effects: clearTarget.of(id) })
    view.focus()
  }
}

const attachHandlers = EditorView.domEventHandlers({
  // Only claims the paste when the clipboard actually carries file data of a
  // kind we handle — plain text and everything else fall through to
  // CodeMirror's default paste.
  paste(event, view) {
    const items = event.clipboardData?.items
    if (!items) return false
    const files: File[] = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file && kindOfFile(file.name, file.type)) files.push(file)
    }
    if (!files.length) return false
    event.preventDefault()
    // Replaces the selection, like every other paste path — pasting an image
    // over "COVER IMAGE HERE" used to leave that text sitting there with the
    // embed in front of it.
    const sel = view.state.selection.main
    void insertFiles(view, files, sel.from, sel.to)
    return true
  }
})

// --- a file dragged in from outside: the line, and the drop ---------------------
//
// A dropped picture, video, voice note or document lands on a new line under the block the
// pointer is over (blockMove.ts `fileDropSpot`), and while it is held a line is drawn at that
// edge — the same ink as the sidebar's drop line. The line and the drop come from the same
// spot, so where the line is is where it lands (Reuben, 2026-11-19).
//
// Listened for on the editor's own box, in the capture phase, rather than through CodeMirror's
// handlers: those never see a drag over a table, picture or voice note (a widget's events are
// its own), so a drop there used to do nothing at all. Taking the event here and stopping it
// also keeps CodeMirror's text caret (extensions.ts `dropCursor`) and its own file drop — which
// would paste a file's text in — out of it. Only drags that carry files; a dragged wiki-link or
// selected text goes on to CodeMirror as before. The browser refuses to fire `drop` at all
// unless `dragover` calls preventDefault() first.

type Spot = ReturnType<typeof fileDropSpot>

const carriesFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')

/** A note dragged from the sidebar with Option (Alt) held: a LINK to it goes in at the drop line,
 *  on a line of its own like a dropped file (Reuben, 2026-11-19). Without Option the drag does
 *  what it always has — the pane's drop boxes open the note beside or in place. */
const carriesNoteLink = (e: DragEvent): boolean => e.altKey && !!e.dataTransfer?.types.includes(DRAG_NOTE)

/** The `[[link]]` lines for the notes in a sidebar drag's payload, as the `[[` picker writes
 *  them — a title, or the path when another note shares the title. Folders and this note itself
 *  are left out (nothing to open, and a link to here goes nowhere). */
export function noteLinkLines(view: EditorView, payload: string): string[] {
  const env = view.state.field(linkEnv, false)
  if (!env) return []
  return payload
    .split('\n')
    .filter((p) => /\.md$/i.test(p) && p !== env.path)
    .map((p) => {
      const ref = env.notes.find((n) => n.path === p)
      return `[[${ref ? uniqueName(env.notes, ref) : p.replace(/\.md$/i, '')}]]`
    })
}

const fileDrop = ViewPlugin.fromClass(
  class {
    spot: Spot | null = null
    readonly bar: HTMLElement
    /** a faint wash over the whole block the drop goes under, so which block is plain from across
     *  the screen — the line alone is thin (Reuben, 2026-11-19) */
    readonly band: HTMLElement
    constructor(readonly view: EditorView) {
      this.band = document.createElement('div')
      this.band.className = 'cm-fileDropBand'
      this.band.style.display = 'none'
      view.scrollDOM.appendChild(this.band)
      this.bar = document.createElement('div')
      this.bar.className = 'cm-fileDropLine'
      this.bar.style.display = 'none'
      view.scrollDOM.appendChild(this.bar)
      view.dom.addEventListener('dragover', this.over, true)
      view.dom.addEventListener('dragleave', this.leave, true)
      view.dom.addEventListener('drop', this.drop, true)
      window.addEventListener('dragover', this.away, true)
      window.addEventListener('drop', this.clearSoon, true)
    }
    spotAt(e: DragEvent): Spot {
      return fileDropSpot(this.view.state, this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false))
    }
    over = (e: DragEvent): void => {
      const link = carriesNoteLink(e)
      if (!carriesFiles(e) && !link) {
        // A note drag that let go of Option: its line goes, the pane's boxes take over.
        if (this.spot) this.set(null)
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      this.set(this.spotAt(e))
    }
    /** The same line, shown from outside — NotePane's drop layer covers the note during a
     *  one-note sidebar drag and passes an Option drag here. */
    showLinkDrop(x: number, y: number): void {
      this.set(fileDropSpot(this.view.state, this.view.posAtCoords({ x, y }, false)))
    }
    hideLinkDrop(): void {
      this.set(null)
    }
    /** Links to the dragged notes at the line: one change, so one Cmd+Z takes them out. */
    dropLinks(payload: string, x: number, y: number): boolean {
      const spot = this.spot ?? fileDropSpot(this.view.state, this.view.posAtCoords({ x, y }, false))
      this.set(null)
      const lines = noteLinkLines(this.view, payload)
      if (!lines.length) return false
      const insert = dropLead(spot) + lines.join('\n') + '\n'
      const end = spot.at + insert.length - 1
      this.view.dispatch({ changes: { from: spot.at, insert }, selection: { anchor: end }, scrollIntoView: true, userEvent: 'input.drop' })
      this.view.focus()
      return true
    }
    /** Off the note, judged by where the pointer is: a leave also fires on every hop inside it. */
    leave = (e: DragEvent): void => {
      if (!this.spot || (e.clientX === 0 && e.clientY === 0)) return
      const r = this.view.dom.getBoundingClientRect()
      const { clientX: x, clientY: y } = e
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) this.set(null)
    }
    /** Lands where the line was. A drop never replaces the selection: it names its own place. */
    drop = (e: DragEvent): void => {
      if (carriesNoteLink(e)) {
        e.preventDefault()
        e.stopPropagation()
        this.dropLinks(e.dataTransfer?.getData(DRAG_NOTE) ?? '', e.clientX, e.clientY)
        return
      }
      if (!carriesFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      const spot = this.spot ?? this.spotAt(e)
      this.set(null)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => kindOfFile(f.name, f.type))
      if (!files.length) return
      // A newline first if the note has none at its end; an empty line first under a table,
      // quote or list, so the picture doesn't become part of it — in the same change as the
      // picture, once it is saved.
      void insertFiles(this.view, files, spot.at, spot.at, dropLead(spot))
    }
    /** Over anything outside this note, the line goes (a dragleave alone misses fast exits). */
    away = (e: DragEvent): void => {
      if (this.spot && !(e.target instanceof Node && this.view.dom.contains(e.target))) this.set(null)
    }
    clearSoon = (): void => void setTimeout(() => this.set(null), 0)
    set(spot: Spot | null): void {
      if (spot?.at === this.spot?.at && spot?.lead === this.spot?.lead && spot?.gap === this.spot?.gap && spot?.block === this.spot?.block) return
      this.spot = spot
      if (!spot) {
        this.bar.style.display = 'none'
        this.band.style.display = 'none'
        return
      }
      this.view.requestMeasure({ read: () => this.measure(spot), write: (pos) => this.place(pos) })
    }
    /** The edge just above `at` — between the block and what follows it. */
    measure(spot: Spot): { top: number; left: number; width: number; bandTop: number | null } | null {
      const { view } = this
      const doc = view.state.doc
      if (spot.at > doc.length) return null
      const above = spot.lead ? doc.lineAt(spot.at) : spot.at > 0 ? doc.lineAt(spot.at - 1) : null
      const y = above ? view.lineBlockAt(above.from).bottom : view.lineBlockAt(spot.at).top
      const outer = view.scrollDOM.getBoundingClientRect()
      const content = view.contentDOM.getBoundingClientRect()
      const pad = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0
      const padR = parseFloat(getComputedStyle(view.contentDOM).paddingRight) || 0
      const toScroll = view.documentTop - outer.top + view.scrollDOM.scrollTop
      const blockTop = spot.block !== null && spot.block <= doc.length ? view.lineBlockAt(spot.block).top : null
      return {
        top: toScroll + y,
        left: content.left + pad - outer.left + view.scrollDOM.scrollLeft,
        width: Math.max(0, content.width - pad - padR),
        bandTop: blockTop !== null && blockTop < y ? toScroll + blockTop : null
      }
    }
    place(pos: { top: number; left: number; width: number; bandTop: number | null } | null): void {
      if (!pos || !this.spot) {
        this.bar.style.display = 'none'
        this.band.style.display = 'none'
        return
      }
      Object.assign(this.bar.style, { display: '', top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` })
      if (pos.bandTop === null) this.band.style.display = 'none'
      else
        Object.assign(this.band.style, {
          display: '',
          top: `${pos.bandTop}px`,
          left: `${pos.left}px`,
          width: `${pos.width}px`,
          height: `${pos.top - pos.bandTop}px`
        })
    }
    destroy(): void {
      this.band.remove()
      this.bar.remove()
      this.view.dom.removeEventListener('dragover', this.over, true)
      this.view.dom.removeEventListener('dragleave', this.leave, true)
      this.view.dom.removeEventListener('drop', this.drop, true)
      window.removeEventListener('dragover', this.away, true)
      window.removeEventListener('drop', this.clearSoon, true)
    }
  }
)

export const attachInput = [attachTargets, attachHandlers, fileDrop]

/** NotePane's way in for an Option drag of a sidebar note (its drop layer covers the note, so
 *  the editor's own listeners never hear it). `drop` returns whether links went in. */
export const linkDrop = {
  show: (view: EditorView, x: number, y: number): void => view.plugin(fileDrop)?.showLinkDrop(x, y),
  hide: (view: EditorView): void => view.plugin(fileDrop)?.hideLinkDrop(),
  drop: (view: EditorView, payload: string, x: number, y: number): boolean => view.plugin(fileDrop)?.dropLinks(payload, x, y) ?? false
}

/** The explicit "Attach…" command: a native file picker, filtered to images
 *  and video, for when there's nothing to paste or drag — the third of the
 *  three ways in. Replaces the selection, same as paste. */
export function attachFiles(view: EditorView): void {
  const notePath = notePathOf(view)
  const dir = dirName(notePath)
  void (async () => {
    const sel = view.state.selection.main
    const id = nextTargetId++
    view.dispatch({ effects: setTarget.of({ id, target: { from: sel.from, to: sel.to } }) })
    try {
      const picked = await window.api.pickAttachment(dir)
      if (!picked || !picked.length) return // cancelled the dialog — not a failure
      for (const { path: relPath, kind } of picked) {
        const name = relPath.slice(relPath.lastIndexOf('/') + 1)
        if (!insertAtTarget(view, id, kind, name, notePath)) {
          notifyUser(view.state, `Saved ${name}, but couldn't add it to the note — try again.`)
        }
      }
    } catch (e) {
      // The picker or the write failed for some reason outside the user's
      // control (IPC down, a vanished drive). Nothing is left half-written —
      // insertAtTarget only ever runs after a successful pick — but it is
      // reported rather than swallowed, same reasoning as insertFiles above.
      console.error('could not attach the picked files', e)
      notifyError(view.state, "Couldn't add that photo or video", e)
    } finally {
      view.dispatch({ effects: clearTarget.of(id) })
      view.focus()
    }
  })()
}

/** "Voice note from a file": a native picker filtered to recordings — Voice
 *  Memos, Voice Recorder, WhatsApp and the rest — for the recordings that are
 *  already on the computer. Each one goes through the same voice-note path a
 *  dropped recording does (voiceImport.ts: played as it is, or converted, or
 *  kept as it is with a word about why), and lands where a photo from the
 *  "Photo or video" picker would: at the cursor, in order, one per line.
 *  Main reads the files and writes nothing; the originals stay where they are. */
export function pickVoiceFiles(view: EditorView): void {
  const notePath = notePathOf(view)
  const dir = dirName(notePath)
  void (async () => {
    const sel = view.state.selection.main
    const id = nextTargetId++
    view.dispatch({ effects: setTarget.of({ id, target: { from: sel.from, to: sel.to } }) })
    try {
      const picked = await window.api.pickAudioFiles()
      if (!picked) return // cancelled the dialog — not a failure
      const tooBig = tooBigMessage(picked.tooBig)
      if (tooBig) notifyUser(view.state, tooBig)
      for (const { name: filename, data } of picked.files) {
        try {
          const name = await saveRecording(view.state, dir, filename, data)
          if (!name) continue
          if (!insertAtTarget(view, id, 'audio', name, notePath)) {
            notifyUser(view.state, `Saved ${name}, but couldn't add it to the note — try again.`)
          }
        } catch (e) {
          // One recording that won't save must not lose the others picked with it.
          console.error(`could not add ${filename}`, e)
          notifyError(view.state, `Couldn't add ${filename}`, e)
        }
      }
    } catch (e) {
      console.error('could not add the picked recordings', e)
      notifyError(view.state, "Couldn't add that recording", e)
    } finally {
      view.dispatch({ effects: clearTarget.of(id) })
      view.focus()
    }
  })()
}
