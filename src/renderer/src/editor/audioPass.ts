import { Transaction, type ChangeSpec, type EditorState, type Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { kindForFilename, relativeTarget, resolveVaultPath } from '../../../shared/attachments'
import { baseName, dirName } from '../../../shared/links'
import { findTranscript } from '../../../shared/transcript'
import type { ConvertedAudio } from '../../../shared/types'
import {
  VOICE_DEFAULTS,
  VOICE_SKIP_CHOICES,
  VOICE_SKIP_DEFAULT,
  audioTag,
  isDefaultVoice,
  normalizeVoice,
  parseAudioOpenTag,
  skipWords,
  cleanVoiceName,
  withVoiceName,
  withVoiceSettings,
  type VoiceSettings,
  type VoiceSkip
} from '../../../shared/voiceNote'
import { type Pass } from './livePreview'
import { linkEnv, linkHandlersFacet, notifyError, notifyUser } from './linkEnv'
import { insideEmbed, selectionCovers, selectionSwallows } from './attachSelect'
import { isMediaSource } from './mediaSource'
import { VoiceBlock, blockOf, type VoiceBlockProps } from './voicePlayerUi'
import { playerFor } from './voicePlayer'
import { clockOf, copyMomentLink } from './momentLink'
import { openClipEditor, type ClipApplied, type ClipSaveResult } from './clipEdit/open'
import { MAX_EDIT_SECONDS } from './clipEdit/audio'

// Voice notes in the note: the line
//
//   <audio controls src="Voice%20note%202026-10-13%2014.32.m4a" data-speed="1.25"></audio>
//
// (shared/voiceNote.ts — one line of inline HTML, rule 4) drawn as the voice
// note block: play, a waveform to seek on, skip ten seconds either way, and a
// mixer whose settings live on that same line. Off the cursor it is the block;
// with the cursor inside it, the source — the same reveal rule as a photo or a
// video (videoPass.ts, whose shape this follows).
//
// Like `<video>`, a one-line `<audio …></audio>` pair is NOT an HTML block to
// the markdown parser (block rule 7 wants the line to be one tag alone): it is a
// paragraph holding two inline `HTMLTag` nodes, so a plain pass is enough — no
// StateField, which is only needed for something spanning a line break.
//
// Also drawn as the block: a markdown picture pointing at a recording,
// `![](memo.m4a)` — what imported notes carry. imagePass leaves those to this
// pass (`isVoiceTarget`), so the two can never claim one embed.

/** An `<audio …>` open tag, as one syntax node holds it. */
const OPEN = /^<audio\b[^>]*>$/i
const CLOSE = /^<\/audio>$/i

/** A markdown destination's target, `<…>` unwrapped. (A title, if any, is a
 *  node of its own.) */
const unwrap = (raw: string): string => {
  const t = raw.trim()
  return /^<(.*)>$/.exec(t)?.[1] ?? t
}

/** Does this embed target name a recording? By extension, decoded — the only
 *  thing that tells `![](memo.m4a)` from a picture. Exported for imagePass,
 *  which skips exactly what this claims. */
export function isVoiceTarget(rawTarget: string): boolean {
  const target = unwrap(rawTarget)
  let decoded = target
  try {
    decoded = decodeURIComponent(target)
  } catch {
    // a stray % — judge it as written
  }
  return kindForFilename(decoded) === 'audio'
}

/** One voice note in the document. */
export interface VoiceSpan {
  from: number
  to: number
  /** where the open tag ends: its settings live in [from, openTo). For the
   *  markdown form there is no tag, and this is `to`. */
  openTo: number
  form: 'tag' | 'md'
  /** the target exactly as written (unwrapped from `<…>` for markdown) */
  src: string
  settings: VoiceSettings
  /** the name given to it — `data-name` on the tag, the alt text of the
   *  markdown form — '' for none */
  name: string
}

/** Every voice note in [from, to), found in the syntax tree.
 *
 *  The tag form counts only as the app writes it: open and close on ONE line
 *  with nothing but spaces between. That is also what `attachSelect` selects and
 *  deletes as one embed, so the three agree — and a pair split across lines must
 *  not be claimed, because a plugin may not replace a line break (CodeMirror
 *  throws, and the whole live preview goes with it). */
export function voiceNotesIn(state: EditorState, from: number, to: number): VoiceSpan[] {
  const doc = state.doc
  const out: VoiceSpan[] = []
  let open: { from: number; to: number; src: string; settings: VoiceSettings; name: string } | null = null
  syntaxTree(state).iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'Image') {
        // Same rule as imagePass: one that spans a line break stays text.
        if (doc.sliceString(node.from, node.to).includes('\n')) return false
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name !== 'URL') continue
          const target = unwrap(doc.sliceString(c.from, c.to))
          if (target && isVoiceTarget(target)) {
            const alt = /^!\[([^\]\n]*)\]/.exec(doc.sliceString(node.from, node.to))?.[1] ?? ''
            out.push({
              from: node.from,
              to: node.to,
              openTo: node.to,
              form: 'md',
              src: target,
              settings: { ...VOICE_DEFAULTS },
              name: cleanVoiceName(alt)
            })
          }
        }
        return false
      }
      if (node.name !== 'HTMLTag') return
      const text = doc.sliceString(node.from, node.to)
      if (OPEN.test(text)) {
        const parsed = parseAudioOpenTag(text)
        open = parsed ? { from: node.from, to: node.to, ...parsed } : null
        return
      }
      if (!CLOSE.test(text) || !open) return
      const o = open
      open = null
      if (doc.lineAt(o.from).number !== doc.lineAt(node.to).number) return
      if (doc.sliceString(o.to, node.from).trim() !== '') return
      out.push({ from: o.from, to: node.to, openTo: o.to, form: 'tag', src: o.src, settings: o.settings, name: o.name })
    }
  })
  return out
}

/** The voice note at `pos` — preferring one that STARTS there, since a block's
 *  own position is its start and two can sit back to back on one line. */
export function voiceSpanAt(state: EditorState, pos: number): VoiceSpan | null {
  const at = Math.min(Math.max(pos, 0), state.doc.length)
  const line = state.doc.lineAt(at)
  const spans = voiceNotesIn(state, line.from, line.to)
  return spans.find((s) => s.from === at) ?? spans.find((s) => at >= s.from && at <= s.to) ?? null
}

/** The edit that writes `s` onto a voice note's line, or null when the line
 *  already says that.
 *
 *  The tag form: only the open tag changes, through `withVoiceSettings`, so
 *  every other attribute — and anything a person or another app added — stays
 *  exactly as it was. The markdown form has nowhere to keep a setting, so it
 *  becomes the tag, with its target kept character for character (a `"` would
 *  end the attribute early, so that one character is escaped — it decodes back
 *  to the same file). Nothing to write for defaults: `![](memo.m4a)` already
 *  plays with them. */
/** Only the characters that actually differ between `before` and `after`.
 *  A name (in the undo history) and a mixer move (kept out of it) both rewrite
 *  the same open tag; written as whole-tag replacements, undoing the name after
 *  a mixer move put a second, old copy of the tag in front of the block (bug
 *  scan 2026-10-27). Touching only its own attribute, each edit leaves the
 *  other's alone. */
function narrowChange(from: number, before: string, after: string): ChangeSpec {
  let a = 0
  while (a < before.length && a < after.length && before[a] === after[a]) a++
  let b = 0
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++
  return { from: from + a, to: from + before.length - b, insert: after.slice(a, after.length - b) }
}

export function settingsChange(doc: Text, span: VoiceSpan, s: VoiceSettings): ChangeSpec | null {
  if (span.form === 'tag') {
    const open = doc.sliceString(span.from, span.openTo)
    const next = withVoiceSettings(open, s)
    return next === open ? null : narrowChange(span.from, open, next)
  }
  if (isDefaultVoice(normalizeVoice(s))) return null
  return { from: span.from, to: span.to, insert: audioTag(span.src.replace(/"/g, '%22'), s) }
}

/** The edit that writes `name` onto a voice note ('' takes it off), or null when
 *  it already has it. The tag keeps it as `data-name` (shared/voiceNote.ts); the
 *  markdown form as its alt text — which every other editor also shows — with
 *  square brackets left out, since one would end the alt early. */
export function nameChange(doc: Text, span: VoiceSpan, name: string): ChangeSpec | null {
  const clean = cleanVoiceName(name)
  if (clean === span.name) return null
  if (span.form === 'tag') {
    const open = doc.sliceString(span.from, span.openTo)
    const next = withVoiceName(open, clean)
    return next === open ? null : narrowChange(span.from, open, next)
  }
  const text = doc.sliceString(span.from, span.to)
  const next = text.replace(/^!\[[^\]\n]*\]/, `![${clean.replace(/[[\]]/g, '')}]`)
  return next === text ? null : { from: span.from, to: span.to, insert: next }
}

/** The edit that points a voice note at another file, `target` already encoded
 *  and relative to the note. Settings, alt text and everything else stay. */
export function retargetChange(doc: Text, span: VoiceSpan, target: string): ChangeSpec {
  if (span.form === 'tag') {
    const open = doc.sliceString(span.from, span.openTo)
    const next = open.replace(
      /(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i,
      (_m, lead: string) => `${lead}"${target}"`
    )
    return { from: span.from, to: span.openTo, insert: next }
  }
  const text = doc.sliceString(span.from, span.to)
  const next = text.replace(/^(!\[[^\]\n]*\]\(\s*)(<[^>\n]*>|[^\s)]+)/, (_m, lead: string) => `${lead}${target}`)
  return { from: span.from, to: span.to, insert: next }
}

const notePathOf = (view: EditorView): string => view.state.field(linkEnv, false)?.path ?? ''

/** A recording the block may load: a file in the vault that is a sound (or a
 *  video container, which a voice note can be — `.webm`, an audio-only `.mp4`).
 *  Anything else — a note, a picture — is not read as one. */
function recordingPath(src: string, notePath: string): string | null {
  const rel = resolveVaultPath(src, notePath)
  const kind = rel ? kindForFilename(rel) : null
  return kind === 'audio' || kind === 'video' ? rel : null
}

class VoiceNoteWidget extends WidgetType {
  /** Like ImageWidget and VideoWidget, deliberately NOT carrying its document
   *  position: typing above a voice note must not rebuild it. Its position is
   *  asked of the DOM when it is needed (`spanOfBlock`). */
  constructor(readonly props: VoiceBlockProps) {
    super()
  }

  eq(other: VoiceNoteWidget): boolean {
    const a = this.props
    const b = other.props
    return (
      a.src === b.src &&
      a.rel === b.rel &&
      a.selected === b.selected &&
      a.name === b.name &&
      a.source === b.source &&
      a.settings.volume === b.settings.volume &&
      a.settings.tone === b.settings.tone &&
      a.settings.speed === b.settings.speed &&
      a.skip.back === b.skip.back &&
      a.skip.forward === b.skip.forward
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const block: VoiceBlock = new VoiceBlock(view, this.props, {
      commit: (s) => writeSettings(view, block.dom, s),
      makePlayable: () => makePlayableCopy(view, block),
      openElsewhere: () => openElsewhere(view, block.props.rel),
      skipMenu: (side, x, y) => skipMenu(view, side, x, y),
      rename: (name) => writeName(view, block.dom, name),
      menu: (x, y, at) => blockMenu(view, block, x, y, at),
      edit: () => editClip(view, block)
    })
    return block.dom
  }

  /** Same recording, something else changed — most often its own mixer setting,
   *  just written onto the line. Keep the element: rebuilding it would be a new
   *  block mid-gesture (the slider under the pointer replaced) for nothing. The
   *  player would carry on regardless — it isn't the widget's (voicePlayer.ts) —
   *  but the open mixer and the focused slider would not. */
  updateDOM(dom: HTMLElement, _view: EditorView, from: this): boolean {
    const block = blockOf(dom)
    if (!block || from.props.src !== this.props.src || from.props.rel !== this.props.rel) return false
    block.update(this.props)
    return true
  }

  destroy(dom: HTMLElement): void {
    blockOf(dom)?.destroy()
  }

  // The block owns its own interaction — play, seek, skip, sliders. CodeMirror
  // must not turn a click on it into a cursor placement (the video widget's
  // reasoning, and the table's before it).
  ignoreEvent(): boolean {
    return true
  }
}

export const audioPass: Pass = (view, _active, push) => {
  const state = view.state
  const notePath = notePathOf(view)
  const showSource = isMediaSource(state)
  const skip = state.field(linkEnv, false)?.voiceSkip ?? VOICE_SKIP_DEFAULT
  for (const { from, to } of view.visibleRanges) {
    for (const n of voiceNotesIn(state, from, to)) {
      // The reveal contract every embed follows (videoPass.ts): an exact cover
      // is "selected" — keep the block and ring it; a selection running across
      // it keeps it a block; a cursor genuinely inside it shows the source.
      const picked = selectionCovers(view, n.from, n.to)
      const spanned = picked || selectionSwallows(view, n.from, n.to)
      if (!spanned && insideEmbed(view, n.from, n.to)) continue
      push(
        n.from,
        n.to,
        Decoration.replace({
          widget: new VoiceNoteWidget({
            src: n.src,
            rel: recordingPath(n.src, notePath),
            settings: n.settings,
            name: n.name,
            selected: picked,
            source: showSource ? state.doc.sliceString(n.from, n.to) : null,
            skip
          })
        }),
        true
      )
    }
  }
}

// --- writing back ----------------------------------------------------------------

/** The voice note a block stands for, found from its DOM at the moment it is
 *  needed — so typing above it never made it stale. */
function spanOfBlock(view: EditorView, dom: HTMLElement): VoiceSpan | null {
  if (!dom.isConnected) return null
  let pos: number
  try {
    pos = view.posAtDOM(dom)
  } catch {
    return null
  }
  return voiceSpanAt(view.state, pos)
}

/** A slider let go, or Reset: the settings go onto the voice note's own line.
 *
 *  Kept OUT of the undo history (`addToHistory: false`, as copyBlockLink.ts
 *  does for the tag it writes). Undo is for what you wrote: a Cmd+Z after
 *  nudging the volume should take back your last sentence, not the nudge — and
 *  with the mixer shut, an undone volume change is invisible, so it would look
 *  as if Cmd+Z had done nothing. The mixer is its own way back (Reset, or the
 *  slider). CodeMirror still maps the history through this change, so undoing
 *  earlier typing lands where it should. */
function writeSettings(view: EditorView, dom: HTMLElement, s: VoiceSettings): void {
  const span = spanOfBlock(view, dom)
  if (!span) return
  const change = settingsChange(view.state.doc, span, s)
  if (!change) return
  view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) })
}

/** A name typed into the block: onto its line. Unlike the mixer this is in the
 *  undo history — the name is on screen, so Cmd+Z visibly takes it back. */
function writeName(view: EditorView, dom: HTMLElement, name: string): void {
  const span = spanOfBlock(view, dom)
  if (!span) return
  const change = nameChange(view.state.doc, span, name)
  if (change) view.dispatch({ changes: change })
}

/** Right-click on the block, or a click on its six dots once it is selected:
 *  name it (Reuben, 2026-10-16), in the app's own menu. */
function blockMenu(view: EditorView, block: VoiceBlock, x: number, y: number, at?: number): void {
  const handlers = view.state.facet(linkHandlersFacet)?.current
  if (!handlers) return
  const named = block.props.name !== ''
  const items = [{ label: named ? 'Rename voice note…' : 'Name voice note…', run: () => block.startNaming() }]
  // The voice note editor, first (Reuben, 2026-11-04: "right click … edit clip").
  // Only for a recording that plays: there is nothing to edit in one that can't.
  if (block.dom.dataset.state === 'ready') items.unshift({ label: 'Edit clip…', run: () => editClip(view, block) })
  // A link to this moment (momentLink.ts) — the spot right-clicked on the
  // waveform, or where playback is. Only in a note (it is written relative to one).
  const { rel } = block.props
  if (rel && at !== undefined && notePathOf(view)) {
    items.push({
      label: `Copy link to ${clockOf(at)}`,
      run: () => {
        const from = spanOfBlock(view, block.dom)?.from
        copyMomentLink(view, block.props.name, rel, at, from === undefined ? undefined : view.state.doc.lineAt(from).from)
      }
    })
  }
  if (named) items.push({ label: 'Remove name', run: () => writeName(view, block.dom, '') })
  handlers.menu(x, y, items)
}

/** Open the voice note editor for this voice note (clipEdit/ClipEditor.tsx). */
function editClip(view: EditorView, block: VoiceBlock): void {
  const { rel, src } = block.props
  if (!rel) return
  // Too long to edit: said at once, from the length the player already knows,
  // rather than after reading the whole recording in (a 70-minute one took 9 s
  // and ~800 MB just to say no — 2026-11-06).
  const known = playerFor(rel).duration
  if (known !== null && known > MAX_EDIT_SECONDS) {
    notifyUser(view.state, `This recording is too long to edit here (over ${MAX_EDIT_SECONDS / 60} minutes)`)
    return
  }
  const notePath = notePathOf(view)
  const near = spanOfBlock(view, block.dom)?.from ?? 0
  openClipEditor({
    rel,
    notePath,
    name: block.props.name,
    settings: block.props.settings,
    notify: (m) => notifyUser(view.state, m),
    apply: (result) => {
      // Only into the note the editor was opened from: the view outlives the
      // note in it (see makePlayableCopy).
      if (notePathOf(view) !== notePath) return null
      const span = (block.dom.isConnected ? spanOfBlock(view, block.dom) : null) ?? findVoice(view.state, src, near)
      if (!span || span.src !== src) return null
      return applyClip(view, span, result, notePath)
    }
  })
}

/** Write a saved clip in. OUT of the undo history, as the mixer is: Cmd+Z in
 *  the note would bring back a line whose recording Save has just moved to the
 *  bin. The way back is "Put back" on the notice that follows, which restores
 *  both (App.tsx `binReplacedRecording`). */
function applyClip(view: EditorView, span: VoiceSpan, result: ClipSaveResult, notePath: string): ClipApplied {
  const changes = clipChange(span, result, notePath, view.state.doc)
  // What each piece wrote and what it replaced — Put back finds each by its text.
  const pieces = changes.map((c) => ({ written: c.insert, was: c.to === undefined ? '' : view.state.doc.sliceString(c.from, c.to) }))
  view.dispatch({ changes, annotations: Transaction.addToHistory.of(false) })
  return {
    text: view.state.doc.toString(),
    revert: () => {
      if (notePathOf(view) !== notePath) return false
      const doc = view.state.doc.toString()
      const back: { from: number; to: number; insert: string }[] = []
      for (const p of pieces) {
        const at = doc.indexOf(p.written)
        if (at < 0 || doc.indexOf(p.written, at + 1) >= 0) return false
        back.push({ from: at, to: at + p.written.length, insert: p.was })
      }
      view.dispatch({ changes: back, annotations: Transaction.addToHistory.of(false) })
      return true
    }
  }
}

/** The edit that writes a saved clip into the note: Save puts the new voice
 *  notes where the original was, Save as new clip puts them under it. Each keeps
 *  the original's volume and tone; its speed goes back to 1× when the speed was
 *  saved into the file (Reuben, 2026-11-04), so the two never stack. Sections are
 *  each on the line straight below the last, as a new recording is placed
 *  (voiceRecModel.ts `ownLineInsert`; Reuben, 2026-11-04: "on the next block down"). */
export function clipChange(
  span: VoiceSpan,
  result: ClipSaveResult,
  notePath: string,
  doc?: Text
): { from: number; to?: number; insert: string }[] {
  const s: VoiceSettings = result.speedSaved ? { ...span.settings, speed: 1 } : span.settings
  const lines = result.files.map((f) => {
    const tag = audioTag(relativeTarget(f.rel, notePath), s)
    const open = tag.slice(0, tag.indexOf('>') + 1)
    return withVoiceName(open, f.name) + tag.slice(open.length)
  })
  // A transcript folded straight under the voice note (shared/transcript.ts)
  // belongs to it: new lines go after the fold, never between the two. Save
  // leaves the fold under the first section — its old src is what offers
  // "Transcribe again" (the Transcribe session's rule).
  let after = span.to
  if (doc) {
    const found = findTranscript(doc.toString().split('\n'), doc.lineAt(span.to).number - 1)
    if (found) after = doc.line(found.close + 1).to
  }
  if (result.replace) {
    if (after === span.to || lines.length === 1) return [{ from: span.from, to: span.to, insert: lines.join('\n') }]
    return [
      { from: span.from, to: span.to, insert: lines[0] },
      { from: after, insert: `\n${lines.slice(1).join('\n')}` }
    ]
  }
  return [{ from: after, insert: `\n${lines.join('\n')}` }]
}

/** The voice note pointing at `src` nearest `near` — for when its block went off
 *  screen while a copy was being made. */
function findVoice(state: EditorState, src: string, near: number): VoiceSpan | null {
  let best: VoiceSpan | null = null
  for (const s of voiceNotesIn(state, 0, state.doc.length)) {
    if (s.src !== src) continue
    if (!best || Math.abs(s.from - near) < Math.abs(best.from - near)) best = s
  }
  return best
}

function cannotConvert(c: Extract<ConvertedAudio, { ok: false }>): string {
  if (c.reason === 'too-big') return 'This recording is too big to convert here'
  if (c.reason === 'failed') return 'Couldn’t convert this recording — the file may be damaged'
  return 'This computer can’t convert this kind of recording. Try opening it in its own app.'
}

/** "Make a playable copy": the computer's own converter turns the recording into
 *  an .m4a (main, `convertAudio`), the copy is saved beside the note like any
 *  pasted file, and THIS voice note is pointed at it. The original file is left
 *  where it was — it is still the person's recording, and another app may play
 *  it fine. */
async function makePlayableCopy(view: EditorView, block: VoiceBlock): Promise<void> {
  const { rel, src } = block.props
  if (!rel) return
  const notePath = notePathOf(view)
  const near = spanOfBlock(view, block.dom)?.from ?? 0
  let bytes: Uint8Array
  try {
    bytes = await window.api.readAsset(rel)
  } catch {
    // Main's own words here would be an ENOENT and a full path.
    notifyUser(view.state, 'Couldn’t make a playable copy — the recording isn’t where it was')
    return
  }
  try {
    const converted = await window.api.convertAudio(baseName(rel), bytes)
    if (!converted.ok) {
      notifyUser(view.state, cannotConvert(converted))
      return
    }
    const saved = await window.api.writeAsset(dirName(notePath), converted.name, converted.data)
    // The view outlives the note in it (CodeEditor swaps documents in place —
    // see attachInput's insertAtTarget), so after the awaits only the note the
    // copy was made for may be changed.
    const span =
      notePathOf(view) !== notePath
        ? null
        : ((block.dom.isConnected ? spanOfBlock(view, block.dom) : null) ?? findVoice(view.state, src, near))
    if (!span || span.src !== src) {
      notifyUser(view.state, `Saved a playable copy as ${baseName(saved)}. The note changed before it could use it.`)
      return
    }
    view.dispatch({ changes: retargetChange(view.state.doc, span, relativeTarget(saved, notePath)) })
    notifyUser(view.state, `Saved a playable copy as ${baseName(saved)}. The original is still there.`)
  } catch (e) {
    notifyError(view.state, 'Couldn’t make a playable copy', e)
  }
}

/** A skip button right-clicked: its five choices in the app's own menu, the
 *  one in use ticked, at the point it was clicked. Choosing one sets it for
 *  every voice note (App writes the setting; it comes back with the vault's
 *  view and redraws them all). */
function skipMenu(view: EditorView, side: keyof VoiceSkip, x: number, y: number): void {
  const handlers = view.state.facet(linkHandlersFacet)?.current
  if (!handlers) return
  const now = (view.state.field(linkEnv, false)?.voiceSkip ?? VOICE_SKIP_DEFAULT)[side]
  handlers.menu(
    x,
    y,
    VOICE_SKIP_CHOICES.map((s) => ({
      label: skipWords(s),
      checked: s === now,
      run: () => handlers.setVoiceSkip(side, s)
    })),
    side === 'back' ? 'Skip back by' : 'Skip forward by'
  )
}

/** "Open in its own app" — whatever the computer plays this kind of file with.
 *  Main decides what may be opened (`openVaultFile`'s allow-list). */
function openElsewhere(view: EditorView, rel: string | null): void {
  if (!rel) return
  window.api.openVaultFile(rel).then(
    (ok) => {
      if (!ok) notifyUser(view.state, 'Couldn’t open this recording in another app')
    },
    (e: unknown) => notifyError(view.state, 'Couldn’t open this recording', e)
  )
}
