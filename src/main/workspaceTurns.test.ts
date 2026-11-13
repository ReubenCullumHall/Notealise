// Changes to the bin, the recovery net, pins and order take turns, and the 7-day
// tidy-up carries on past a file it cannot delete (2026-11-12,
// docs/app-check-2026-11-09.md "Smaller, behind the scenes").
//
// A real temporary vault, like workspace.test.ts — what is checked is the record
// that reaches `.mdnotes/workspace.json`. The ONE thing stood in for is time: the
// moves into and out of the bin are the real ones, held at a gate, because the
// fault only shows while a move is slow (OneDrive holding a file, a rename
// retrying) and a real disk cannot be made slow on demand.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, promises as fs, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RECOVERY_DIR, RECOVERY_TTL_MS, type Workspace } from '../shared/workspace'

/** While set, the real move waits for it. */
let gate: Promise<void> | null = null
/** How many moves are waiting at the gate right now. */
let waiting = 0

vi.mock('./vault', async (importOriginal) => {
  const real = await importOriginal<typeof import('./vault')>()
  const held =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      if (gate) {
        waiting++
        await gate
        waiting--
      }
      return fn(...a)
    }
  return {
    ...real,
    trashEntry: held(real.trashEntry),
    restoreEntry: held(real.restoreEntry),
    purgeTrashItem: held(real.purgeTrashItem)
  }
})

import { setVaultRoot } from './vault'
import {
  getWorkspace,
  migrateKey,
  purgeEntries,
  reorderEntries,
  restoreEntries,
  sweepExpiredRecovery,
  trashEntries,
  updateEntries
} from './workspace'

let root = ''
const onDisk = async (): Promise<Workspace> =>
  JSON.parse(await fs.readFile(path.join(root, '.mdnotes/workspace.json'), 'utf8')) as Workspace
/** The file once it says what memory says — a pin or a new order is written a
 *  moment after it is made (the debounce), so the file is waited for, not read at once. */
async function saved(): Promise<Workspace> {
  const want = JSON.stringify(await getWorkspace())
  await vi.waitFor(async () => expect(JSON.stringify(await onDisk())).toBe(want), { timeout: 3000, interval: 25 })
  return onDisk()
}
const exists = async (rel: string): Promise<boolean> => fs.access(path.join(root, rel)).then(() => true, () => false)

/** Hold every move from now on; the function it returns lets them go. */
function holdMoves(): () => void {
  let open: () => void = () => {}
  gate = new Promise<void>((r) => (open = r))
  return () => {
    gate = null
    open()
  }
}
/** Wait until a move really is stuck at the gate — the slow one has started. */
const untilHeld = (): Promise<void> => vi.waitFor(() => expect(waiting).toBeGreaterThan(0))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdnotes-turns-'))
  await fs.mkdir(path.join(root, 'Space'), { recursive: true })
  for (const name of ['Keep.md', 'Other.md', 'Gone.md', 'Gone too.md']) {
    await fs.writeFile(path.join(root, 'Space', name), `# ${name}\n`)
  }
  setVaultRoot(root)
  gate = null
  waiting = 0
})

afterEach(async () => {
  gate = null
  await fs.rm(root, { recursive: true, force: true })
})

describe('a change made while a slow move is in flight', () => {
  it('a pin made while a note is being binned is kept', async () => {
    const release = holdMoves()
    const binning = trashEntries(['Space/Gone.md'])
    await untilHeld()
    const pinning = updateEntries(['Space/Keep.md'], { pinned: true })
    release()
    await Promise.all([binning, pinning])

    const ws = await getWorkspace()
    expect(ws.entries['Space/Keep.md']?.pinned).toBe(true)
    expect(ws.trash.map((t) => t.from)).toEqual(['Space/Gone.md'])
    // ...and it is what reached the file, not only what is in memory.
    const file = await saved()
    expect(file.entries['Space/Keep.md']?.pinned).toBe(true)
    expect(file.trash).toHaveLength(1)
    expect(await exists('Space/Gone.md')).toBe(false)
  })

  it('a new order and a rename’s re-keying made meanwhile are kept too', async () => {
    await updateEntries(['Space/Other.md'], { pinned: true })
    const release = holdMoves()
    const binning = trashEntries(['Space/Gone.md'])
    await untilHeld()
    const ordering = reorderEntries(['Space/Keep.md', 'Space/Other.md'])
    const moving = migrateKey('Space/Other.md', 'Space/Renamed.md')
    release()
    await Promise.all([binning, ordering, moving])

    const file = await saved()
    expect(file.entries['Space/Keep.md']?.order).toBe(0)
    expect(file.entries['Space/Renamed.md']).toMatchObject({ pinned: true, order: 1 })
    expect(file.entries['Space/Other.md']).toBeUndefined()
    expect(file.trash).toHaveLength(1)
  })

  it('two deletes asked for at once both keep their bin row', async () => {
    const release = holdMoves()
    const first = trashEntries(['Space/Gone.md'])
    const second = trashEntries(['Space/Gone too.md'])
    await untilHeld()
    release()
    await Promise.all([first, second])

    const file = await saved()
    expect(file.trash.map((t) => t.from).sort()).toEqual(['Space/Gone too.md', 'Space/Gone.md'])
    expect(await exists('Space/Gone.md')).toBe(false)
    expect(await exists('Space/Gone too.md')).toBe(false)
  })

  it('a delete made while another note is being put back is kept', async () => {
    const binned = await trashEntries(['Space/Gone.md'])
    const release = holdMoves()
    const restoring = restoreEntries([binned.trash[0].id])
    await untilHeld()
    release() // the second delete is asked for while the first move is still out
    const binning = trashEntries(['Space/Gone too.md'])
    await Promise.all([restoring, binning])

    const file = await saved()
    expect(file.trash.map((t) => t.from)).toEqual(['Space/Gone too.md'])
    expect(await exists('Space/Gone.md')).toBe(true)
  })

  it('a pin made while the bin is being emptied is kept', async () => {
    await trashEntries(['Space/Gone.md'])
    const release = holdMoves()
    const emptying = purgeEntries()
    await untilHeld()
    const pinning = updateEntries(['Space/Keep.md'], { pinned: true })
    release()
    await Promise.all([emptying, pinning])

    const file = await saved()
    expect(file.entries['Space/Keep.md']?.pinned).toBe(true)
    expect(file.trash).toEqual([])
    expect(file.recovery.map((r) => r.from)).toEqual(['Space/Gone.md'])
  })

  it('a change that fails does not stop the ones behind it', async () => {
    const failing = updateEntries(null as unknown as string[], { pinned: true }) // structured clone delivers anything
    const pinning = updateEntries(['Space/Keep.md'], { pinned: true })
    await expect(failing).rejects.toThrow()
    expect((await pinning).entries['Space/Keep.md']?.pinned).toBe(true)
  })
})

// Can this process be locked out of deleting something at all? Not on Windows
// (chmod does not restrict there), and not as root.
const CAN_LOCK = ((): boolean => {
  if (process.platform === 'win32') return false
  const probe = mkdtempSync(path.join(os.tmpdir(), 'lock-probe-'))
  try {
    writeFileSync(path.join(probe, 'x'), 'x')
    chmodSync(probe, 0o500)
    try {
      rmSync(path.join(probe, 'x'))
      return false
    } catch {
      return true
    }
  } finally {
    chmodSync(probe, 0o700)
    rmSync(probe, { recursive: true, force: true })
  }
})()

describe('the 7-day tidy-up', () => {
  const OLD = Date.now() - RECOVERY_TTL_MS - 60_000
  const locked: string[] = []

  /** Three expired items and one that still has days left, on disk and on the list. The
   *  middle expired one is a folder this process may not delete from. */
  async function seed(lockMiddle: boolean): Promise<void> {
    const dir = path.join(root, RECOVERY_DIR)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'aaaaaa-First.md'), 'one')
    await fs.mkdir(path.join(dir, 'bbbbbb-Stuck'))
    await fs.writeFile(path.join(dir, 'bbbbbb-Stuck', 'inside.md'), 'two')
    await fs.writeFile(path.join(dir, 'cccccc-Third.md'), 'three')
    await fs.writeFile(path.join(dir, 'dddddd-Recent.md'), 'four')
    if (lockMiddle) {
      chmodSync(path.join(dir, 'bbbbbb-Stuck'), 0o500)
      locked.push(path.join(dir, 'bbbbbb-Stuck'))
    }
    const ws: Workspace = {
      entries: {},
      trash: [],
      recovery: [
        { id: 'aaaaaa', from: 'Space/First.md', name: 'First.md', type: 'file', purgedAt: OLD },
        { id: 'bbbbbb', from: 'Space/Stuck', name: 'Stuck', type: 'dir', purgedAt: OLD },
        { id: 'cccccc', from: 'Space/Third.md', name: 'Third.md', type: 'file', purgedAt: OLD },
        { id: 'dddddd', from: 'Space/Recent.md', name: 'Recent.md', type: 'file', purgedAt: Date.now() }
      ]
    }
    await fs.writeFile(path.join(root, '.mdnotes/workspace.json'), JSON.stringify(ws))
    // a different folder each test, so nothing is remembered from the last one
    setVaultRoot(root)
  }

  afterEach(() => {
    for (const abs of locked.splice(0)) chmodSync(abs, 0o700)
  })

  it('deletes what has expired and leaves what has not', async () => {
    await seed(false)
    await sweepExpiredRecovery()
    expect((await getWorkspace()).recovery.map((r) => r.id)).toEqual(['dddddd'])
    expect(await exists(`${RECOVERY_DIR}/aaaaaa-First.md`)).toBe(false)
    expect(await exists(`${RECOVERY_DIR}/bbbbbb-Stuck`)).toBe(false)
    expect(await exists(`${RECOVERY_DIR}/dddddd-Recent.md`)).toBe(true)
  })

  // The fault: the first file that could not be deleted ended the sweep before
  // the list was brought up to date — so items ALREADY deleted stayed listed as
  // recoverable, and everything after the stuck one was never tried.
  it('carries on past one it cannot delete, and lists only what is still there', async (ctx) => {
    ctx.skip(!CAN_LOCK, 'this process cannot be locked out of a folder (Windows, or root) — not verified here')
    await seed(true)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    await sweepExpiredRecovery()
    quiet.mockRestore()

    // on disk: the first and third are gone, the stuck one and the recent one remain
    expect(await exists(`${RECOVERY_DIR}/aaaaaa-First.md`)).toBe(false)
    expect(await exists(`${RECOVERY_DIR}/cccccc-Third.md`)).toBe(false)
    expect(await exists(`${RECOVERY_DIR}/bbbbbb-Stuck/inside.md`)).toBe(true)
    // the list says exactly that
    expect((await getWorkspace()).recovery.map((r) => r.id)).toEqual(['bbbbbb', 'dddddd'])

    // ...and once it can be deleted, the next sweep takes it.
    for (const abs of locked.splice(0)) chmodSync(abs, 0o700)
    await sweepExpiredRecovery()
    expect((await getWorkspace()).recovery.map((r) => r.id)).toEqual(['dddddd'])
    expect(await exists(`${RECOVERY_DIR}/bbbbbb-Stuck`)).toBe(false)
  })
})
