import { expect, it, vi } from 'vitest'

// Reuben, 2026-11-20: "make esc cancel the drag". Chromium ends a drag cancelled
// with Escape exactly like a drop it lost, so the stand-in for a lost drop used to
// do what the lit target showed — Esc over the Bin binned the note.
const win = new EventTarget()
vi.stubGlobal('window', win)
const { landMissedDrop, offerDrop } = await import('./dragLeaveGuard')

const target = { isConnected: true, getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) } as unknown as HTMLElement
const ended = { clientX: 50, clientY: 50, dataTransfer: { dropEffect: 'none' } as DataTransfer }
const key = (k: string): Event => Object.assign(new Event('keydown'), { key: k })

it('a drop lost over a lit target still lands', () => {
  const apply = vi.fn()
  win.dispatchEvent(new Event('dragstart'))
  offerDrop(target, apply)
  expect(landMissedDrop(ended)).toBe(true)
  expect(apply).toHaveBeenCalledOnce()
})

it('Escape during the drag cancels it: nothing lands', () => {
  const apply = vi.fn()
  win.dispatchEvent(new Event('dragstart'))
  offerDrop(target, apply)
  win.dispatchEvent(key('Escape'))
  expect(landMissedDrop(ended)).toBe(false)
  expect(apply).not.toHaveBeenCalled()
})

it('the next drag is not cancelled by the last one’s Escape', () => {
  const apply = vi.fn()
  win.dispatchEvent(key('Escape'))
  win.dispatchEvent(new Event('dragstart'))
  offerDrop(target, apply)
  expect(landMissedDrop(ended)).toBe(true)
})
