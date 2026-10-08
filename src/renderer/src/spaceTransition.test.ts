import { describe, expect, it } from 'vitest'
import { createSpaceSlide, spaceSlideAvailable, type SlideEnv } from './spaceTransition'

// A stand-in for the page. `startViewTransition` behaves like the real one in the ways that
// matter here: the update runs LATER (after the old picture is taken), `ready` comes after
// that, and `finished` comes last — and starting a new one ends the one still running.
function fakePage(withTransitions = true) {
  const classes = new Set<string>()
  const log: string[] = []
  const transitions: { ready(): void; finish(): void }[] = []
  const env: SlideEnv = {
    root: {
      classList: {
        add: (...n: string[]) => n.forEach((x) => classes.add(x)),
        remove: (...n: string[]) => n.forEach((x) => classes.delete(x))
      }
    }
  }
  if (withTransitions) {
    env.startViewTransition = (update) => {
      let readyOk!: () => void
      let finishOk!: () => void
      const ready = new Promise<void>((r) => (readyOk = r))
      const finished = new Promise<void>((r) => (finishOk = r))
      let updated!: Promise<void>
      updated = Promise.resolve().then(() => update())
      // the one still running is ended by this one
      transitions[transitions.length - 1]?.finish()
      transitions.push({ ready: readyOk, finish: finishOk })
      return { ready, finished, updateCallbackDone: updated }
    }
  }
  return { env: () => env, classes, log, transitions }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createSpaceSlide', () => {
  it('can tell whether the page can do transitions at all', () => {
    expect(spaceSlideAvailable(fakePage(true).env)).toBe(true)
    expect(spaceSlideAvailable(fakePage(false).env)).toBe(false)
  })

  it('just makes the switch when the page cannot slide', async () => {
    const p = fakePage(false)
    const slide = createSpaceSlide(p.env)
    await slide(1, () => p.log.push('switched'))
    expect(p.log).toEqual(['switched'])
    expect(p.classes.size).toBe(0)
  })

  it('names the two regions for the browser only while a slide runs, and the right way round', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    const done = slide(1, () => p.log.push('switched'))
    expect([...p.classes].sort()).toEqual(['space-vt', 'space-vt-next'])
    await done
    expect(p.log).toEqual(['switched'])
    p.transitions[0].ready()
    await settle()
    expect(p.classes.size).toBe(2) // still sliding
    p.transitions[0].finish()
    await settle()
    expect(p.classes.size).toBe(0) // gone: nothing is left named for another transition to find

    await slide(-1, () => undefined)
    expect([...p.classes].sort()).toEqual(['space-vt', 'space-vt-prev'])
  })

  it('a swipe the same way while a slide is running does not start another: it changes what comes in', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    await slide(1, () => p.log.push('A'))
    p.transitions[0].ready()
    await settle()
    await slide(1, () => p.log.push('B'))
    await slide(1, () => p.log.push('C'))
    expect(p.log).toEqual(['A', 'B', 'C'])
    expect(p.transitions.length).toBe(1)
  })

  it('...but not before the pictures exist: the old one is still being taken then', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    await slide(1, () => p.log.push('A'))
    // `ready` has not come yet
    await slide(1, () => p.log.push('B'))
    expect(p.transitions.length).toBe(2)
  })

  it('a swipe the other way starts a fresh slide the other way', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    await slide(1, () => undefined)
    p.transitions[0].ready()
    await settle()
    await slide(-1, () => undefined)
    expect(p.transitions.length).toBe(2)
    expect([...p.classes].sort()).toEqual(['space-vt', 'space-vt-prev'])
  })

  it('a slide that was ended by a newer one does not take the newer one off the page', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    await slide(1, () => undefined)
    p.transitions[0].ready()
    await settle()
    await slide(-1, () => undefined) // ends the first; its `finished` comes in
    await settle()
    expect([...p.classes].sort()).toEqual(['space-vt', 'space-vt-prev'])
    p.transitions[1].finish()
    await settle()
    expect(p.classes.size).toBe(0)
  })

  it('after one has finished, the next swipe starts a new slide', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    await slide(1, () => undefined)
    p.transitions[0].ready()
    p.transitions[0].finish()
    await settle()
    await slide(1, () => undefined)
    expect(p.transitions.length).toBe(2)
  })

  it('tells the caller if the switch itself failed, and leaves nothing named', async () => {
    const p = fakePage()
    const slide = createSpaceSlide(p.env)
    await expect(
      slide(1, () => {
        throw new Error('no such space')
      })
    ).rejects.toThrow('no such space')
    p.transitions[0].finish()
    await settle()
    expect(p.classes.size).toBe(0)
  })
})
