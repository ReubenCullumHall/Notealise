import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { linkEnv } from './linkEnv'
import { cachedUrl, loadImage, resolveVaultPath } from './imageAssets'
import { type Pass } from './livePreview'
import { insideEmbed, selectionCovers, embedSpanAt } from './attachSelect'
import { attachDragHandle } from './attachMove'
import { isMediaSource, sourceCaption } from './mediaSource'

// Inline images. `![alt](path)` is replaced by the picture itself, and the raw
// markdown comes back when the cursor is inside it — the same reveal-to-edit
// contract every other pass here follows.
//
// The image node structure is `Image > LinkMark ![ , LinkMark ] , LinkMark ( ,
// URL , LinkMark )` — verified against the real @lezer/markdown tree, not
// guessed (the alt text is bare text between the first two LinkMarks, with no
// node of its own).
class ImageWidget extends WidgetType {
  /** Deliberately NOT carrying the embed's document position. It used to, so
   *  that `eq()` would fail whenever the line moved and the widget would be
   *  REBUILT — the only way the drag handle's captured offset could stay
   *  current. The cost was invisible until you typed ABOVE an embed: every
   *  widget below was torn down and remade on each keystroke, and for a
   *  <video> that means a fresh element, a re-decode and a lost playback
   *  position. `attachMove` asks the DOM for its own position now, so nothing
   *  here needs to change when a line merely shifts. */
  constructor(
    readonly src: string,
    readonly alt: string,
    /** vault-relative, or null for a remote/absolute URL used as-is */
    readonly rel: string | null,
    /** the grip has selected this embed as one object — keep showing the
     *  picture/player and ring it, instead of the reveal-to-edit raw markdown
     *  any OTHER overlapping selection would produce. Showing raw source is the
     *  opposite of what "here is what you are about to delete" needs. */
    readonly selected: boolean,
    /** the eye is on: the exact source line, printed under the picture. Null
     *  when it's off. Part of `eq` so toggling actually redraws — the whole
     *  reason widget identity is compared at all. */
    readonly source: string | null
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.rel === this.rel &&
      other.selected === this.selected &&
      other.source === this.source
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = this.selected ? 'cm-image cm-attach-selected' : 'cm-image'
    wrap.appendChild(attachDragHandle(view))
    const img = document.createElement('img')
    img.alt = this.alt
    // An <img> is natively draggable, which is not what should happen here: the
    // grip beside it is the drag affordance (attachMove), and a native drag
    // carries the blob: URL as text, so dropping it back in the note would
    // paste that URL as characters. The video widget has no equivalent because
    // <video> doesn't start a drag of its own.
    img.draggable = false
    // Something is always in the DOM before the bytes arrive, so the line
    // doesn't jump when an async load lands.
    img.className = 'cm-image-img'
    if (this.rel) {
      const ready = cachedUrl(this.rel)
      if (ready) img.src = ready
      else {
        void loadImage(this.rel).then((url) => {
          if (url) img.src = url
          else wrap.classList.add('cm-image-missing')
        })
      }
    } else {
      img.src = this.src // remote URL — let the <img> fetch it
    }
    img.onerror = (): void => wrap.classList.add('cm-image-missing')
    wrap.appendChild(img)
    if (this.source) wrap.appendChild(sourceCaption(this.source))
    return wrap
  }

  /** False, deliberately, where VideoWidget and TableWidget both return true:
   *  those own their own interaction (play/scrub, cell editing) and must keep
   *  the editor out of it. A picture has no interaction of its own, and
   *  `imageClick` below — the ONLY way back to the markdown behind a rendered
   *  image — is an editor DOM handler, which returning true here would stop
   *  from ever firing. The native-drag difference that made these three look
   *  inconsistent is handled where it actually lives, on the <img> above. */
  ignoreEvent(): boolean {
    return false
  }
}

export const imagePass: Pass = (view, _active, push) => {
  const notePath = view.state.field(linkEnv, false)?.path ?? ''
  const tree = syntaxTree(view.state)
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'Image') return
        // An image can sit mid-sentence, so this is a range test, not an
        // active-LINE check: typing on past an image shouldn't leave its source
        // showing just because the cursor is still on that line.
        // An exact cover means "selected" and is handled below. `insideEmbed`
        // rather than `overlapsSelection` because a bare cursor at the edge is
        // adjacent, not inside — see its own note.
        const picked = selectionCovers(view, node.from, node.to)
        if (!picked && insideEmbed(view, node.from, node.to)) return

        let url = ''
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === 'URL') url = view.state.doc.sliceString(c.from, c.to)
        }
        if (!url) return

        // Alt text is everything between "![" and the "]" that closes it.
        const raw = view.state.doc.sliceString(node.from, node.to)
        const alt = raw.slice(2, raw.indexOf(']', 2) === -1 ? 2 : raw.indexOf(']', 2))

        const rel = resolveVaultPath(url, notePath)
        push(
          node.from,
          node.to,
          Decoration.replace({
            widget: new ImageWidget(url, alt, rel, picked, isMediaSource(view.state) ? raw : null)
          }),
          true
        )
      }
    })
  }
}

/** Clicking a rendered image puts the cursor on it, which reveals the markdown
 *  — otherwise a picture is the one thing in the document you can't get back to
 *  in order to edit or delete it. */
export const imageClick = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const target = event.target as HTMLElement
    if (!target.closest('.cm-image')) return false
    const pos = view.posAtDOM(target)
    // Strictly INSIDE the embed, not at its edge. `posAtDOM` lands on the
    // widget's own start, and since `insideEmbed` stopped treating an edge as
    // inside, a cursor there no longer reveals anything — clicking a picture
    // would do nothing at all. One character in is unambiguous, and this is the
    // gesture that says "I want at the markdown", so it should be.
    const span = embedSpanAt(view.state, pos)
    const anchor = span && span.to - span.from > 1 ? span.from + 1 : pos
    view.dispatch({ selection: { anchor } })
    return false
  }
})
