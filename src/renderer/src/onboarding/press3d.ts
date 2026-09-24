// The one piece of JS behind `.press-3d` (app.css): where the pointer went
// down on a control, as the tilt its press takes — pressing near an edge tips
// that edge into the page. Shared by onboarding's Import cards and its
// Continue button, which press the same way (Reuben, 2026-09-23/24).
// Keyboard presses never call this, so they sink straight.
export function tiltFromPointer(e: React.PointerEvent<HTMLElement>, maxDeg: number): void {
  const r = e.currentTarget.getBoundingClientRect()
  const x = (e.clientX - r.left) / r.width - 0.5
  const y = (e.clientY - r.top) / r.height - 0.5
  e.currentTarget.style.setProperty('--tilt-x', `${(-y * 2 * maxDeg).toFixed(2)}deg`)
  e.currentTarget.style.setProperty('--tilt-y', `${(x * 2 * maxDeg).toFixed(2)}deg`)
}
