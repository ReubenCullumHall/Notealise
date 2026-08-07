import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { linkEnv } from './linkEnv'
import { cachedUrl, loadImage, resolveVaultPath } from './imageAssets'
import { overlapsSelection, type Pass } from './livePreview'

// Inline images. `![alt](path)` is replaced by the picture itself, and the raw
// markdown comes back when the cursor is inside it — the same reveal-to-edit
// contract every other pass here follows.
//
// The image node structure is `Image > LinkMark ![ , LinkMark ] , LinkMark ( ,
// URL , LinkMark )` — verified against the real @lezer/markdown tree, not
// guessed (the alt text is bare text between the first two LinkMarks, with no
// node of its own).
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    /** vault-relative, or null for a remote/absolute URL used as-is */
    readonly rel: string | null
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.rel === this.rel
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-image'
    const img = document.createElement('img')
    img.alt = this.alt
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
    return wrap
  }

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
        // An image can sit mid-sentence, so this is `overlapsSelection`, not an
        // active-LINE check: typing on past an image shouldn't leave its source
        // showing just because the cursor is still on that line.
        if (overlapsSelection(view, node.from, node.to)) return

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
          Decoration.replace({ widget: new ImageWidget(url, alt, rel) }),
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
    view.dispatch({ selection: { anchor: pos } })
    return false
  }
})
