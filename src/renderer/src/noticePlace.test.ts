import { describe, expect, it } from 'vitest'
import { noticeLift, type Box } from './noticePlace'

const box = (left: number, top: number, w: number, h: number): Box => ({ left, top, right: left + w, bottom: top + h })
// A message 250 wide and 46 tall, 20px above the bottom of an 800-tall window.
const notice = box(300, 734, 250, 46)

describe('noticeLift', () => {
  it('stays where it is when no control is near', () => {
    expect(noticeLift(notice, [box(700, 756, 32, 32)])).toBe(0)
  })

  it('rises clear of a corner button it would cover', () => {
    const eye = box(520, 756, 32, 32)
    const lift = noticeLift(notice, [eye])
    expect(lift).toBe(notice.bottom - eye.top + 8)
    expect(notice.bottom - lift).toBeLessThanOrEqual(eye.top - 8)
  })

  it('rises past a whole stack, not just the lowest button', () => {
    const stack = [box(520, 756, 32, 32), box(520, 716, 32, 32), box(520, 676, 32, 32)]
    const lift = noticeLift(notice, stack)
    expect(notice.bottom - lift).toBeLessThanOrEqual(676 - 8)
  })

  it('does not rise for a button higher up that it already clears', () => {
    expect(noticeLift(notice, [box(520, 100, 32, 32)])).toBe(0)
  })

  it('never leaves the top of the window', () => {
    const tall = box(400, 4, 40, 790)
    expect(notice.top - noticeLift(notice, [tall])).toBeGreaterThanOrEqual(8)
  })
})
