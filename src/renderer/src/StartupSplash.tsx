import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ThemeId } from '../../shared/settings'
import inkSrc from './assets/promo/notealise-ink.webm'
import whiteSrc from './assets/promo/notealise-white.webm'

// Canvas is 2206x524 (notes-app/promo/README.md) — pinning the aspect ratio
// keeps the video's box stable before its metadata has loaded.
const ASPECT = '2206 / 524'
// Beat between the clip's last frame and the fade starting, so the finished
// wordmark holds for a moment rather than fading the instant it lands.
const HOLD_MS = 100
const FADE_MS = 500
// Belt-and-braces: clip is ~4s, so if playback never fires `ended` (or errors)
// for some unforeseen reason, this still lets the user into their notes.
// Skips the hold and fades immediately — this is already the fallback path.
const MAX_MS = 6000

/** Plays once while a vault opens, then fades into the app underneath (already
 *  mounting/loading behind it — see App.tsx's `splashActive`). `theme` is the
 *  active space's REAL theme (App only mounts this once settings have actually
 *  loaded — see the boot effect and `pick()`), not the pre-paint snapshot,
 *  which can be stale on a vault's first open on a given machine: light -> ink
 *  (dark ink on a light ground), dark AND black -> white. */
export function StartupSplash({ theme, onFinished }: { theme: ThemeId; onFinished: () => void }): React.JSX.Element {
  const [ended, setEnded] = useState(false)
  const [fading, setFading] = useState(false)
  const src = theme === 'light' ? inkSrc : whiteSrc

  // A ref, not a dependency: `onFinished` is a fresh closure every App render,
  // and App keeps re-rendering while the boot chain resolves. Depending on it
  // directly would cancel and reschedule this timer on each one, starving the
  // fade if boot is still settling when the clip ends.
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    const t = setTimeout(() => setFading(true), MAX_MS)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!ended) return
    const t = setTimeout(() => setFading(true), HOLD_MS)
    return () => clearTimeout(t)
  }, [ended])

  useEffect(() => {
    if (!fading) return
    const t = setTimeout(() => onFinishedRef.current(), FADE_MS)
    return () => clearTimeout(t)
  }, [fading])

  return createPortal(
    <div
      className={
        'fixed inset-0 z-[9999] flex items-center justify-center bg-paper transition-opacity duration-500 ' +
        (fading ? 'pointer-events-none opacity-0' : 'opacity-100')
      }
    >
      <video
        src={src}
        autoPlay
        muted
        playsInline
        onEnded={() => setEnded(true)}
        onError={() => setFading(true)}
        style={{ width: '50vw', aspectRatio: ASPECT }}
      />
    </div>,
    document.body
  )
}
