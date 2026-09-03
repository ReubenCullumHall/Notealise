// The pointer-drag behind every track control in the app: the colour picker's
// saturation square and hue slider (Picker.tsx), and the tint fine tuner in
// Settings (settings/Explore.tsx). Its own file rather than an export from
// Picker.tsx — a component file that also exports a hook loses fast refresh
// for everything in it, and what this drags is a number, not a colour.

/** Drag anywhere in a track and it follows the pointer, including outside the
 *  element — `setPointerCapture` is what makes releasing off the edge behave.
 *  Returns 0–1 on each axis.
 *
 */
export function useDragTrack(onMove: (x: number, y: number) => void): {
  onPointerDown: (e: React.PointerEvent) => void
} {
  return {
    onPointerDown: (e: React.PointerEvent): void => {
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      const emit = (ev: { clientX: number; clientY: number }): void => {
        const box = el.getBoundingClientRect()
        onMove(
          Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
          Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height))
        )
      }
      emit(e)
      const move = (ev: PointerEvent): void => emit(ev)
      const up = (): void => {
        el.removeEventListener('pointermove', move)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    }
  }
}
