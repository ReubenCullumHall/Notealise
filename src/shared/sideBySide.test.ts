import { describe, expect, it } from 'vitest'
import { OUR_MIN_WIDTH, oursBeside, shortAppName, splitScreen } from './sideBySide'

const laptop = { x: 0, y: 25, width: 1440, height: 875 }

describe('splitScreen', () => {
  it('gives each app half, filling the screen with no gap or overlap', () => {
    const s = splitScreen(laptop)!
    expect(s.ours).toEqual({ x: 0, y: 25, width: 720, height: 875 })
    expect(s.theirs).toEqual({ x: 720, y: 25, width: 720, height: 875 })
  })

  it('keeps every pixel of an odd width', () => {
    const s = splitScreen({ ...laptop, width: 1441 })!
    expect(s.ours.width + s.theirs.width).toBe(1441)
  })

  it('works on a second screen to the left of the main one', () => {
    const s = splitScreen({ x: -1920, y: 0, width: 1920, height: 1080 })!
    expect(s.theirs.x).toBe(-960)
    expect(s.theirs.x + s.theirs.width).toBe(0)
  })

  it('keeps Notealise at its minimum on a narrow screen', () => {
    const s = splitScreen({ ...laptop, width: 1120 })!
    expect(s.ours.width).toBe(OUR_MIN_WIDTH)
    expect(s.theirs.width).toBe(480)
  })

  it('declines a screen too small for both, rather than covering one with the other', () => {
    expect(splitScreen({ ...laptop, width: 1119 })).toBeNull()
  })
})

describe('oursBeside', () => {
  it('fills what the other app left when it took more than its half', () => {
    expect(oursBeside(laptop, { x: 640, y: 25, width: 800, height: 875 }).width).toBe(640)
  })

  it('never goes under Notealise’s own minimum', () => {
    expect(oursBeside(laptop, { x: 300, y: 25, width: 1140, height: 875 }).width).toBe(OUR_MIN_WIDTH)
  })
})

describe('shortAppName', () => {
  it('fits the button', () => {
    expect(shortAppName('Microsoft Excel.app')).toBe('Excel')
    expect(shortAppName('Microsoft Word')).toBe('Word')
    expect(shortAppName('Preview')).toBe('Preview')
    expect(shortAppName('Adobe Acrobat Reader')).toBe('Adobe Acrobat Reader')
  })
})
