import { useEffect, useRef } from 'react'

/** While a drop target is lit, un-light it the moment the pointer is over
 *  anything outside `el`. A drag's dragleave is not enough: it fires for every
 *  child crossed, may carry no position, and a sub-pixel edge can make a real
 *  leave look like staying in — leaving a bar drawn somewhere the drop will
 *  not land (2026-11-19). dragover fires on whatever is under the pointer, so
 *  that is what decides. */
export function useClearWhenPointerLeaves(lit: boolean, el: React.RefObject<HTMLElement | null>, clear: () => void): void {
  const clearRef = useRef(clear)
  clearRef.current = clear
  useEffect(() => {
    if (!lit) return
    const over = (e: DragEvent): void => {
      const box = el.current
      if (box && e.target instanceof Node && !box.contains(e.target)) clearRef.current()
    }
    window.addEventListener('dragover', over, true)
    return () => window.removeEventListener('dragover', over, true)
  }, [lit, el])
}

/* ---- a drop Chromium loses -------------------------------------------------
 * Chromium sometimes sends no `drop` at all when the last dragover redrew the
 * page (CLAUDE.md, "An HTML drag that re-renders on its last dragover can lose
 * its drop") and the thing snaps back to where it was. Every drop target that
 * is lit OFFERS what it would do; every drag source, on dragend, lands a missed
 * drop on whatever was lit — if the pointer was let go over it. One record for
 * the whole window, so it works whichever target and whichever source
 * (2026-11-19). */
let offered: { el: HTMLElement; apply: () => void } | null = null

/** `el` is lit and a drop on it would do `apply`. */
export function offerDrop(el: HTMLElement | null, apply: () => void): void {
  if (el) offered = { el, apply }
}

/** `el` is no longer lit. */
export function withdrawDrop(el: HTMLElement | null): void {
  if (offered && offered.el === el) offered = null
}

/** On a drag source's dragend: if the drop was missed over a lit target, do
 *  what it showed. Returns whether it did. Always forgets the offer. */
export function landMissedDrop(e: { clientX: number; clientY: number; dataTransfer: DataTransfer }): boolean {
  const o = offered
  offered = null
  if (!o || e.dataTransfer.dropEffect !== 'none' || !o.el.isConnected) return false
  const r = o.el.getBoundingClientRect()
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return false
  o.apply()
  return true
}
