// A folder the app may not read must not take the whole vault with it (app check
// 2026-11-09: one such folder anywhere left the window on "Loading…" for good).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { TreeNode } from '../shared/types'
import { listTree, setVaultRoot } from './vault'

/** Can this process be locked out of a folder at all? Not on Windows (chmod does not
 *  take read access away there) and not when the tests run as root. */
const CAN_LOCK = ((): boolean => {
  if (process.platform === 'win32') return false
  const probe = mkdtempSync(path.join(os.tmpdir(), 'vault-lock-probe-'))
  try {
    chmodSync(probe, 0o000)
    readdirSync(probe)
    return false // still readable: root
  } catch {
    return true
  } finally {
    chmodSync(probe, 0o700)
    rmSync(probe, { recursive: true, force: true })
  }
})()

let root = ''
const locked: string[] = []
const lock = (rel: string): void => {
  const abs = path.join(root, rel)
  chmodSync(abs, 0o000)
  locked.push(abs)
}
const find = (nodes: TreeNode[], p: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.path === p) return n
    const deeper = n.children ? find(n.children, p) : undefined
    if (deeper) return deeper
  }
  return undefined
}

beforeEach(() => {
  root = path.join(realpathSync(mkdtempSync(path.join(os.tmpdir(), 'vault-unreadable-'))), 'vault')
  mkdirSync(path.join(root, 'Biology', 'Private stuff'), { recursive: true })
  mkdirSync(path.join(root, 'Maths'))
  writeFileSync(path.join(root, 'Biology', 'Cells.md'), '# Cells\n')
  writeFileSync(path.join(root, 'Biology', 'Private stuff', 'secret.md'), '# secret\n')
  writeFileSync(path.join(root, 'Maths', 'Sums.md'), '# Sums\n')
  setVaultRoot(root)
})

afterEach(() => {
  for (const abs of locked.splice(0)) chmodSync(abs, 0o700)
  rmSync(path.dirname(root), { recursive: true, force: true })
})

describe.runIf(CAN_LOCK)('a folder the app may not read', () => {
  it('inside a space: every other note is still listed', async () => {
    lock('Biology/Private stuff')
    const tree = await listTree()
    expect(find(tree, 'Biology/Cells.md')?.type).toBe('file')
    expect(find(tree, 'Maths/Sums.md')?.type).toBe('file')
  })

  it('stays in the tree as a folder, shown empty — never left out', async () => {
    // Left out, a space's folder would look deleted, and the spaces sync would drop
    // that space and its look (shared/settings.ts `reconcileSpaces`).
    lock('Biology/Private stuff')
    const node = find(await listTree(), 'Biology/Private stuff')
    expect(node).toMatchObject({ type: 'dir', name: 'Private stuff', children: [] })
  })

  it('at the top level (a space): the space is still there, the other spaces untouched', async () => {
    lock('Maths')
    const tree = await listTree()
    expect(tree.map((n) => n.path).sort()).toEqual(['Biology', 'Maths'])
    expect(find(tree, 'Maths')).toMatchObject({ type: 'dir', children: [] })
    expect(find(tree, 'Biology/Private stuff/secret.md')?.type).toBe('file')
  })

  it('is marked as unreadable, so the sidebar can say so — an empty folder is not', async () => {
    lock('Biology/Private stuff')
    lock('Maths')
    mkdirSync(path.join(root, 'Biology', 'Nothing yet'))
    const tree = await listTree()
    expect(find(tree, 'Biology/Private stuff')?.unreadable).toBe(true)
    expect(find(tree, 'Maths')?.unreadable).toBe(true) // a space's own folder
    const empty = find(tree, 'Biology/Nothing yet')
    expect(empty).toMatchObject({ type: 'dir', children: [] })
    expect(empty && 'unreadable' in empty).toBe(false)
    expect(find(tree, 'Biology') && 'unreadable' in find(tree, 'Biology')!).toBe(false)
  })

  it('the vault folder itself: listing fails, so the window can fall back to the folder picker', async () => {
    lock('.')
    await expect(listTree()).rejects.toThrow(/EACCES|EPERM/)
  })
})

describe('an ordinary vault', () => {
  it('is listed as before', async () => {
    const tree = await listTree()
    expect(find(tree, 'Biology/Private stuff/secret.md')?.type).toBe('file')
    expect(find(tree, 'Biology/Private stuff')?.children?.length).toBe(1)
  })

  it('marks no folder as unreadable', async () => {
    const marked: string[] = []
    const walk = (nodes: TreeNode[]): void => {
      for (const n of nodes) {
        if ('unreadable' in n) marked.push(n.path)
        if (n.children) walk(n.children)
      }
    }
    walk(await listTree())
    expect(marked).toEqual([])
  })
})
