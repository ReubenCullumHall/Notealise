import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { linkEnv } from './linkEnv'
import { cachedVideoUrl, loadVideo, resolveVaultPath } from './videoAssets'
import { type Pass } from './livePreview'
import { attachDragHandle } from './attachMove'
import { insideEmbed, selectionCovers } from './attachSelect'
import { isMediaSource, sourceCaption } from './mediaSource'

// Inline video. `<video controls src="path"></video>` is not an invented
// dialect — it's the same trade this app already made for colour: markdown
// has no video syntax, so this is valid inline HTML instead (rule 4).
//
// Verified against the real @lezer/markdown tree rather than guessed: a
// single-line open+close pair on one line fails CommonMark's block-HTML rule
// 7 (which requires the WHOLE line to be just the one tag), so it parses as
// an ordinary paragraph containing two adjacent `HTMLTag` nodes — not an
// `HTMLBlock`. That means this needs no StateField (unlike blockMath/
// blockTable, which exist because THEIR content spans a line break): a plain
// ViewPlugin pass, same shape as imagePass, is enough.

const OPEN = /^<video(\s[^>]*)?>$/i
const CLOSE = /^<\/video>$/i

class VideoWidget extends WidgetType {
  /** Deliberately NOT carrying the embed's document position — see
   *  ImageWidget's copy of this note (imagePass.ts). Video is where it hurt
   *  most: a rebuilt widget is a brand-new <video> element every keystroke. */
  constructor(
    readonly src: string,
    /** vault-relative, or null for a remote/absolute URL used as-is */
    readonly rel: string | null,
    /** the grip has selected this embed as one object — keep showing the
     *  picture/player and ring it, instead of the reveal-to-edit raw markdown
     *  any OTHER overlapping selection would produce. Showing raw source is the
     *  opposite of what "here is what you are about to delete" needs. */
    readonly selected: boolean,
    /** the eye is on: the exact source, printed under the player. See
     *  ImageWidget's copy — same field, same reason it is part of `eq`. */
    readonly source: string | null
  ) {
    super()
  }

  eq(other: VideoWidget): boolean {
    return (
      other.src === this.src &&
      other.rel === this.rel &&
      other.selected === this.selected &&
      other.source === this.source
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = this.selected ? 'cm-video cm-attach-selected' : 'cm-video'
    wrap.appendChild(attachDragHandle(view))
    const video = document.createElement('video')
    video.controls = true
    video.className = 'cm-video-el'
    if (this.rel) {
      const ready = cachedVideoUrl(this.rel)
      if (ready) video.src = ready
      else {
        void loadVideo(this.rel).then((url) => {
          if (url) video.src = url
          else wrap.classList.add('cm-video-missing')
        })
      }
    } else {
      video.src = this.src // remote URL — let <video> fetch it directly
    }
    video.onerror = (): void => wrap.classList.add('cm-video-missing')
    wrap.appendChild(video)
    if (this.source) wrap.appendChild(sourceCaption(this.source))
    return wrap
  }

  // The widget owns its own interaction (play, scrub, volume). CodeMirror
  // must not turn a click on it into a cursor placement — the exact reasoning
  // the table widget's cells already use for the same kind of interactive
  // content living inside a decoration.
  ignoreEvent(): boolean {
    return true
  }
}

export const videoPass: Pass = (view, _active, push) => {
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  const tree = syntaxTree(view.state)
  // Only ever holds unmatched `<video>` opens — a tag-specific stack, so
  // there's no need to check tag names on pop the way a shared stack would.
  const stack: { from: number; src: string }[] = []

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'HTMLTag') return
        const text = view.state.doc.sliceString(node.from, node.to)

        if (OPEN.test(text)) {
          const m = /\bsrc=["']([^"']*)["']/i.exec(text)
          // No src, no video — leave it as plain visible text rather than
          // rendering a widget with nothing to play.
          if (m) stack.push({ from: node.from, src: m[1] })
          return
        }
        if (!CLOSE.test(text) || !stack.length) return
        const open = stack.pop()!
        // Same reveal contract as every other widget pass: off the cursor
        // line it's a picture (here: a player); on it, the raw HTML shows.
        // See imagePass's copy: an exact cover is "selected", not reveal-to-edit.
        const picked = selectionCovers(view, open.from, node.to)
        if (!picked && insideEmbed(view, open.from, node.to)) return

        const rel = resolveVaultPath(open.src, notePath)
        push(
          open.from,
          node.to,
          Decoration.replace({
            widget: new VideoWidget(
              open.src,
              rel,
              picked,
              // The whole `<video …></video>` pair, not just the opening tag:
              // what the eye promises is the code that puts this here.
              isMediaSource(view.state) ? view.state.doc.sliceString(open.from, node.to) : null
            )
          }),
          true
        )
      }
    })
  }
}
