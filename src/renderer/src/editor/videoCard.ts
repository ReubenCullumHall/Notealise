import { EditorView, WidgetType } from '@codemirror/view'
import type { VideoLink } from '../../../shared/embeds'
import { attachDragHandle } from './attachMove'
import { sourceCaption } from './mediaSource'
import { openPasteOptions } from './pasteLink'

// A YouTube or Vimeo video in a note: `![Title](https://youtu.be/…)`.
//
// It is a CARD until it is clicked — the video's own picture, its title and a
// play button — and only then does the player load. That order is the point:
// drawing a card asks the network for nothing (the picture was saved when the
// link was pasted, and lives in this machine's cache), so opening a note that
// somebody sent you cannot tell its author — or YouTube — that you did. The
// `frame-src` in the CSP lists exactly the player hosts and nothing else.
//
// If the picture isn't in the cache (the note came from another machine) the
// card is still a card, just a plain one. If the player can't load (offline,
// a video that's been taken down) the site's own message shows in its place,
// and the "Open in YouTube" link is still there.

/** One picture per video for the life of the window. Only a picture that was
 *  FOUND is remembered: "none yet" must be asked again, because pasting the same
 *  video elsewhere saves one, and a card drawn before that would otherwise stay
 *  pictureless until the window is reloaded. */
const thumbs = new Map<string, string>()

async function thumbUrl(watchUrl: string): Promise<string | null> {
  const hit = thumbs.get(watchUrl)
  if (hit) return hit
  try {
    const bytes = await window.api.linkThumb(watchUrl)
    if (bytes && bytes.length) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]))
      thumbs.set(watchUrl, url)
      return url
    }
  } catch {
    // no picture — the card stands without one
  }
  return null
}

const PLAY = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor"/></svg>`

export class VideoCardWidget extends WidgetType {
  constructor(
    readonly video: VideoLink,
    /** the title written between the brackets; empty when none could be read */
    readonly title: string,
    /** the grip selected this embed as one object — see ImageWidget */
    readonly selected: boolean,
    /** the eye is on: the exact source line, printed under the card */
    readonly source: string | null
  ) {
    super()
  }

  eq(other: VideoCardWidget): boolean {
    return (
      other.video.provider === this.video.provider &&
      other.video.id === this.video.id &&
      other.video.embedUrl === this.video.embedUrl &&
      other.title === this.title &&
      other.selected === this.selected &&
      other.source === this.source
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const v = this.video
    const label = this.title || `${v.label} video`
    const wrap = document.createElement('span')
    wrap.className = this.selected ? 'cm-video-card cm-attach-selected' : 'cm-video-card'
    wrap.appendChild(attachDragHandle(view))

    const stage = document.createElement('span')
    stage.className = 'cm-vc-stage'
    const img = document.createElement('img')
    img.className = 'cm-vc-thumb'
    img.alt = ''
    img.draggable = false
    img.hidden = true
    void thumbUrl(v.watchUrl).then((url) => {
      if (!url) return
      img.src = url
      img.hidden = false
    })
    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'cm-vc-play'
    play.setAttribute('aria-label', `Play: ${label}`)
    play.innerHTML = PLAY
    stage.append(img, play)

    const start = (): void => {
      const frame = document.createElement('iframe')
      frame.className = 'cm-vc-frame'
      frame.src = v.embedUrl
      frame.title = label
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media'
      frame.allowFullscreen = true
      frame.referrerPolicy = 'strict-origin-when-cross-origin'
      stage.classList.add('cm-vc-playing')
      stage.replaceChildren(frame)
    }
    stage.addEventListener('click', (e) => {
      e.preventDefault()
      if (!stage.classList.contains('cm-vc-playing')) start()
    })

    const caption = document.createElement('span')
    caption.className = 'cm-vc-caption'
    const name = document.createElement('span')
    name.className = 'cm-vc-title'
    name.textContent = label
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'cm-vc-open'
    open.textContent = `Open in ${v.label}`
    open.addEventListener('click', (e) => {
      e.preventDefault()
      void window.api.openExternal(v.watchUrl)
    })
    caption.append(name, open)

    wrap.append(stage, caption)
    // Right-click the card for the same list a right-click on the mention opens —
    // Mention / Full link / Player view — as the card's own events never reach
    // the editor's (`ignoreEvent` below).
    wrap.addEventListener('contextmenu', (e) => {
      if (openPasteOptions(view, view.posAtDOM(wrap))) e.preventDefault()
    })
    if (this.source) wrap.appendChild(sourceCaption(this.source, view))
    return wrap
  }

  // The card owns its clicks — the play button, the link, the player itself.
  // CodeMirror must not turn them into a cursor, which would swap the card for
  // its markdown the moment you pressed play. Same reasoning as VideoWidget.
  ignoreEvent(): boolean {
    return true
  }
}
