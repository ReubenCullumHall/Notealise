// The vault path boundary — the check `vault.ts`'s own header calls the one that
// "LIVES ONLY HERE, IN MAIN". It had no tests until 2026-09-04, and the two most
// serious findings in the security audit that day were both inside it.
//
// This runs against a REAL temporary directory rather than a mocked fs, because
// two of the things being asserted are properties of the filesystem and not of
// the code: that a symlink is followed unless something stops it, and that
// macOS resolves /var and /tmp through links of its own (which is exactly why
// the root has to be realpath'd too — resolving one side and not the other
// rejects every path in an ordinary vault).
//
// `vault.ts` is importable here because it only reaches Electron through
// `await import('electron')` inside the two functions that need `shell`. Keep it
// that way: a top-level electron import would take this whole file out.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createFolder,
  createNote,
  listTree,
  purgeRecoveryItem,
  readNote,
  setVaultRoot,
  trashEntry,
  writeNote
} from './vault'
import { RECOVERY_DIR, heldPath, isSafeHeldSegment } from '../shared/workspace'

let root = ''
let outside = ''

/** Can this process create a symlink at all?
 *
 *  On Windows `fs.symlink` needs Developer Mode or an elevated process. Without
 *  one it fails with `EPERM: operation not permitted, symlink` while BUILDING
 *  THE FIXTURE — so the two tests below went red on a stock Windows 11 box
 *  (confirmed 2026-09-05) reporting a broken vault boundary when what actually
 *  broke was the setup. A red test that means "your OS would not let me try" is
 *  worse than useless: it is the same colour as a real escape.
 *
 *  Probed rather than inferred from `process.platform`, because a Windows box
 *  WITH Developer Mode on can create links — and that is the configuration
 *  where this half of the boundary genuinely does get covered.
 *
 *  This is a gap, not a pass. Where it skips, the symlink half of the boundary
 *  is UNVERIFIED on that machine; the tests carry the reason so nobody reads a
 *  green run as proof. CI is `ubuntu-latest`, so the case is always covered
 *  somewhere. */
const CAN_SYMLINK = ((): boolean => {
  const probe = mkdtempSync(path.join(os.tmpdir(), 'vault-symlink-probe-'))
  try {
    writeFileSync(path.join(probe, 'target'), 'x')
    symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'))
    return true
  } catch {
    return false
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

const NO_SYMLINK_REASON =
  'this process cannot create symlinks (on Windows that needs Developer Mode or ' +
  'elevation) — the vault boundary is NOT verified against symlinks here'

beforeEach(async () => {
  // realpath the base once: on macOS os.tmpdir() is /var/folders/..., and /var
  // is a symlink to /private/var. Tests that compare paths have to compare the
  // resolved form or they fail for a reason that has nothing to do with them.
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vault-test-')))
  root = path.join(base, 'vault')
  outside = path.join(base, 'outside')
  await fs.mkdir(root)
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'secret.txt'), 'PRIVATE KEY', 'utf8')
  setVaultRoot(root)
})

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true }).catch(() => {})
})

const read = (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8')
const exists = async (abs: string): Promise<boolean> =>
  fs
    .stat(abs)
    .then(() => true)
    .catch(() => false)

describe('the vault boundary', () => {
  it('reads and writes an ordinary note', async () => {
    await writeNote('note.md', 'hello')
    expect(await read('note.md')).toBe('hello')
    expect(await readNote('note.md')).toBe('hello')
  })

  it.each([
    ['a parent-directory climb', '../escape.md'],
    ['a climb that dips into a subfolder first', 'sub/../../escape.md'],
    ['an absolute path', '/etc/passwd'],
    ['the parent itself', '..']
  ])('refuses %s', async (_label, rel) => {
    await expect(writeNote(rel, 'x')).rejects.toThrow(/escapes the vault/)
  })

  it('refuses a sibling directory whose name merely starts with the vault path', async () => {
    // The prefix-collision case: /…/vault vs /…/vault-evil. A `startsWith(root)`
    // check passes this and writes outside the vault; `path.relative` does not.
    // Rule 7 in CLAUDE.md exists because of exactly this shape.
    const evil = `${root}-evil`
    await fs.mkdir(evil)
    await expect(writeNote('../vault-evil/secret.md', 'x')).rejects.toThrow(/escapes the vault/)
    expect(await exists(path.join(evil, 'secret.md'))).toBe(false)
  })

  it('ALLOWS a note whose name begins with two dots', async () => {
    // Not a traversal — `..todo.md` is a perfectly ordinary filename, and
    // `path.relative` returns it unchanged. The old check tested the string's
    // prefix rather than its first segment, so a file made in Finder or synced
    // in from another tool was unopenable, reporting that it escaped the vault.
    // It failed closed, so it was never a hole; it was a note the user could
    // see in the sidebar and could not read.
    await writeNote('..todo.md', 'still mine')
    expect(await read('..todo.md')).toBe('still mine')
    expect(await readNote('..todo.md')).toBe('still mine')
  })
})

describe('symlinks', () => {
  it('refuses to read through a link that points out of the vault', async (ctx) => {
    ctx.skip(!CAN_SYMLINK, NO_SYMLINK_REASON)
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'innocent.md'))
    // The lexical check sees an ordinary in-vault path here — `innocent.md` has
    // no `..` in it and resolves inside the root. Only resolving the link first
    // tells the two apart, which is why the boundary realpaths before checking.
    await expect(readNote('innocent.md')).rejects.toThrow(/escapes the vault/)
  })

  it('refuses to write through a linked FOLDER, not just a linked file', async (ctx) => {
    ctx.skip(!CAN_SYMLINK, NO_SYMLINK_REASON)
    // The subtler half: the link is a directory component partway along the
    // path, and the file at the end does not exist yet — so `realpath` on the
    // whole path throws ENOENT and the check has to resolve the deepest
    // existing ancestor instead of giving up.
    await fs.symlink(outside, path.join(root, 'Attachments'))
    await expect(writeNote('Attachments/planted.md', 'x')).rejects.toThrow(/escapes the vault/)
    expect(await exists(path.join(outside, 'planted.md'))).toBe(false)
  })

  it('still writes a note that does not exist yet inside a real folder', async () => {
    // The control for the two above: resolving the deepest existing ancestor
    // must not break the ordinary case of creating a file in a real directory.
    await fs.mkdir(path.join(root, 'Space'))
    await writeNote('Space/new.md', 'fresh')
    expect(await read('Space/new.md')).toBe('fresh')
  })
})

describe('the in-vault config folder', () => {
  it('refuses a note write into .mdnotes', async () => {
    // `.mdnotes/` holds settings.json, the organisation sidecar and the bin's
    // index — each written by its own module through its own validated shape.
    // `writeNote` is a general "put this text here" primitive the renderer
    // drives, and `.mdnotes/` is skipped by both `ignored()` and the watcher, so
    // a write into it is invisible in the tree and raises no change event.
    await expect(writeNote('.mdnotes/workspace.json', '{}')).rejects.toThrow(/belongs to the app/)
  })

  it('still allows an ordinary dotfile elsewhere in the vault', async () => {
    await writeNote('.hidden.md', 'fine')
    expect(await read('.hidden.md')).toBe('fine')
  })
})

describe('createFolder and createNote', () => {
  it('keeps a folder inside the vault when the name is an ARRAY, not a string', async () => {
    // Reachable over IPC: structured clone carries an array across the bridge
    // intact, and `for (const ch of raw)` over one yields whole ELEMENTS, so
    // `FORBIDDEN.has('../../evil')` was false and every separator survived
    // `sanitizeFilename`. The mkdir then landed outside the vault. The type
    // annotation was the only thing saying this couldn't happen.
    const rel = await createFolder('', ['../../pwned'] as unknown as string)
    // The dots are not the problem and must not be "fixed" — `..-..-pwned` is a
    // perfectly legal folder name. What matters is that no SEPARATOR survived,
    // so the result is one segment inside the vault rather than a path out of it.
    expect(path.isAbsolute(rel)).toBe(false)
    expect(rel).toBe('..-..-pwned')
    expect(rel.split(/[/\\]/)).toHaveLength(1)
    expect(await exists(path.join(path.dirname(root), 'pwned'))).toBe(false)
    expect(await exists(path.join(root, rel))).toBe(true)
  })

  it('sanitises a separator in a note name rather than treating it as a folder', async () => {
    const rel = await createNote('', 'a/b')
    expect(rel).toBe('a-b.md')
  })
})

describe('the recovery net', () => {
  it('refuses a held-item name that resolves to the vault root', async () => {
    // The critical one. `heldPath` interpolates `name` into a path, the boundary
    // lets the vault root through by design (listTree needs it), and
    // `purgeRecoveryItem` is the app's only hard `fs.rm` — recursive, force, and
    // NOT to the OS trash. It ran unattended from the launch sweep, so a
    // recovery record named "/../../.." deleted every note the user had.
    await writeNote('keepme.md', 'precious')
    await expect(purgeRecoveryItem('x', '/../../..')).rejects.toThrow()
    expect(await read('keepme.md')).toBe('precious')
    expect(await exists(root)).toBe(true)
  })

  it('refuses a held-item name aimed at an ordinary note', async () => {
    await fs.mkdir(path.join(root, 'Notes'), { recursive: true })
    await writeNote('Notes/essay.md', 'months of work')
    await expect(purgeRecoveryItem('x', '/../../../Notes')).rejects.toThrow()
    expect(await read('Notes/essay.md')).toBe('months of work')
  })

  it('still purges a genuine recovery file', async () => {
    // The control: the guard must not break the feature it protects.
    const held = path.join(root, RECOVERY_DIR, 'abc123-old.md')
    await fs.mkdir(path.dirname(held), { recursive: true })
    await fs.writeFile(held, 'expired', 'utf8')
    await purgeRecoveryItem('abc123', 'old.md')
    expect(await exists(held)).toBe(false)
  })
})

describe('isSafeHeldSegment', () => {
  it('accepts the filenames people actually have', () => {
    for (const name of ['note.md', 'My Essay (2).md', 'Ünïcödé.md', '..todo.md', 'a.b.c.md']) {
      expect(isSafeHeldSegment(name)).toBe(true)
    }
  })

  it('rejects anything that would leave the holding folder', () => {
    for (const name of ['/../../..', '..', '.', 'a/b', `a${String.fromCharCode(92)}b`, '']) {
      expect(isSafeHeldSegment(name)).toBe(false)
    }
  })

  it('throws from heldPath rather than building the path anyway', () => {
    expect(() => heldPath(RECOVERY_DIR, 'x', '/../../..')).toThrow(/Unsafe held-item path/)
    expect(heldPath(RECOVERY_DIR, 'x', 'note.md')).toBe(`${RECOVERY_DIR}/x-note.md`)
  })
})

describe('the ordinary paths still work', () => {
  it('lists a tree and bins an entry without tripping any of the new guards', async () => {
    await writeNote('one.md', 'a')
    await createFolder('', 'Folder')
    await writeNote('Folder/two.md', 'b')
    const tree = await listTree()
    expect(tree.map((n) => n.name).sort()).toEqual(['Folder', 'one.md'])
    const { id, type } = await trashEntry('one.md')
    expect(type).toBe('file')
    expect(await exists(path.join(root, 'one.md'))).toBe(false)
    expect(await exists(path.join(root, '.mdnotes/trash', `${id}-one.md`))).toBe(true)
  })
})
