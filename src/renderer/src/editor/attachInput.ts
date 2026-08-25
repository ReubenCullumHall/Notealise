import { StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { dirName } from '../../../shared/links'
import {
  encodeTarget,
  extForMime,
  kindForMime,
  type AttachmentKind
} from '../../../shared/attachments'
import { linkEnv, notifyError, notifyUser } from './linkEnv'

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
function embedText(kind: AttachmentKind, name: string): string {
  const target = encodeTarget(name)
  return kind === 'image' ? `![](${target})` : `<video controls src="${target}"></video>`
}

/** A clipboard image paste usually names the file "image.png" itself; a
 *  fallback only matters for the odd source that hands over no name at all. */
function defaultName(kind: AttachmentKind, mime: string): string {
  const ext = extForMime(mime) ?? (kind === 'image' ? 'png' : 'mp4')
  return (kind === 'image' ? 'Pasted image' : 'Pasted video') + '.' + ext
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
  kind: AttachmentKind,
  name: string,
  notePath: string
): boolean {
  if (notePathOf(view) !== notePath) return false // a different note is on screen now
  const t = view.state.field(attachTargets, false)?.get(id)
  if (!t) return false // the editor was torn down or the target was cleared
  const len = view.state.doc.length
  const from = Math.min(t.from, len)
  const to = Math.min(Math.max(t.to, from), len)
  const text = embedText(kind, name) + '\n'
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
  to: number = from
): Promise<void> {
  const notePath = notePathOf(view)
  const dir = dirName(notePath)
  const id = nextTargetId++
  view.dispatch({ effects: setTarget.of({ id, target: { from, to } }) })
  try {
    for (const file of files) {
      const kind = kindForMime(file.type)
      if (!kind) continue
      const filename = file.name || defaultName(kind, file.type)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const relPath = await window.api.writeAsset(dir, filename, bytes)
        const name = relPath.slice(relPath.lastIndexOf('/') + 1)
        // Saved, but the note moved on underneath it (or was swapped for
        // another one) — say both halves, because the file really is there and
        // a silent nothing reads as a broken paste.
        if (!insertAtTarget(view, id, kind, name, notePath)) {
          notifyUser(view.state, `Saved ${name}, but couldn't add it to the note — try again.`)
        }
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
      if (item.kind !== 'file' || !kindForMime(item.type)) continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
    if (!files.length) return false
    event.preventDefault()
    // Replaces the selection, like every other paste path — pasting an image
    // over "COVER IMAGE HERE" used to leave that text sitting there with the
    // embed in front of it.
    const sel = view.state.selection.main
    void insertFiles(view, files, sel.from, sel.to)
    return true
  },
  // The browser refuses to fire `drop` at all unless `dragover` calls
  // preventDefault() first — without this the OS just shows a "not allowed"
  // cursor and drop() below never runs, for any file. Gated on the drag
  // actually carrying files (not, say, a dragged wiki-link or selected text)
  // so CodeMirror's own drag handling is untouched for everything else —
  // `dataTransfer.items`/`.files` aren't readable yet at this stage, only
  // `.types`, so this can't narrow to image/video specifically until drop.
  dragover(event) {
    if (!event.dataTransfer?.types.includes('Files')) return false
    event.preventDefault()
    return true
  },
  // Lands at the drop point, not wherever the cursor happened to be — the
  // same as dropping into any editor. Deliberately does NOT replace the
  // selection: a drop names its own position.
  drop(event, view) {
    const list = event.dataTransfer?.files
    if (!list || list.length === 0) return false
    const files = Array.from(list).filter((f) => kindForMime(f.type))
    if (!files.length) return false
    event.preventDefault()
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from
    void insertFiles(view, files, pos)
    return true
  }
})

export const attachInput = [attachTargets, attachHandlers]

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
