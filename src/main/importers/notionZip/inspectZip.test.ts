// The pre-flight check on an imported .zip.
//
// The archives here are built byte by byte rather than with a zip tool, for two
// reasons: the hostile ones are exactly what a tool tries to stop you making
// (`zip` rewrites `../` on the way in), and building them by hand keeps the
// test free of anything not already in package.json.
//
// Entries are STORED, not deflated, and their CRCs are zero — neither matters,
// because `assertSafeZip` reads the central directory and never decompresses.

import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { assertSafeZip, readZipEntries, unsafeEntryName } from './inspectZip'

interface Spec {
  name: string
  /** Bytes the entry claims to expand to; the body is not written at that size,
   *  which is the point — a declared size is a claim, and this is how a bomb
   *  looks from the outside. */
  declaredSize?: number
  symlink?: boolean
}

function localHeader(s: Spec): Buffer {
  const name = Buffer.from(s.name, 'utf8')
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt16LE(0, 8) // stored
  h.writeUInt32LE(0, 14) // crc — unread by the parser
  h.writeUInt32LE(0, 18) // compressed
  h.writeUInt32LE(s.declaredSize ?? 0, 22)
  h.writeUInt16LE(name.length, 26)
  return Buffer.concat([h, name])
}

function centralHeader(s: Spec, offset: number): Buffer {
  const name = Buffer.from(s.name, 'utf8')
  const h = Buffer.alloc(46)
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(20, 4)
  h.writeUInt16LE(20, 6)
  h.writeUInt16LE(0, 10) // stored
  h.writeUInt32LE(0, 20) // compressed
  h.writeUInt32LE(s.declaredSize ?? 0, 24)
  h.writeUInt16LE(name.length, 28)
  // High 16 bits are the unix mode. 0xA1FF = symlink, rwxrwxrwx.
  h.writeUInt32LE(s.symlink ? 0xa1ff0000 : 0, 38)
  h.writeUInt32LE(offset, 42)
  return Buffer.concat([h, name])
}

async function makeZip(specs: Spec[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-test-'))
  const file = path.join(dir, 'archive.zip')

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const s of specs) {
    const lh = localHeader(s)
    centrals.push(centralHeader(s, offset))
    locals.push(lh)
    offset += lh.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(specs.length, 8)
  eocd.writeUInt16LE(specs.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)

  await fs.writeFile(file, Buffer.concat([...locals, cd, eocd]))
  return file
}

describe('unsafeEntryName', () => {
  it('accepts the shapes a real export is full of', () => {
    for (const n of [
      'Export/Notes/Physics.md',
      'Export/My Page 1a2b3c.md',
      'Export/images/photo (2).png',
      'Export/..todo.md', // two dots in a NAME is not a traversal
      'Export/a.b/c.md'
    ]) {
      expect(unsafeEntryName(n)).toBe(false)
    }
  })

  it('refuses anything that would write outside the destination', () => {
    for (const n of [
      '../escape.txt',
      'a/../../escape.txt',
      '/etc/passwd',
      // Both separators are checked on BOTH platforms: `a\b` is one filename on
      // macOS and two segments on Windows, and an export travels between them.
      String.raw`..\..\Startup\x.lnk`,
      String.raw`\\server\share\x`,
      'C:/Windows/System32/x',
      String.raw`C:\Windows\x`,
      `bad${String.fromCharCode(0)}name`,
      ''
    ]) {
      expect(unsafeEntryName(n)).toBe(true)
    }
  })
})

describe('assertSafeZip', () => {
  it('accepts an ordinary export', async () => {
    const zip = await makeZip([
      { name: 'Export/', declaredSize: 0 },
      { name: 'Export/Physics.md', declaredSize: 4096 },
      { name: 'Export/diagram.png', declaredSize: 200_000 }
    ])
    await expect(assertSafeZip(zip)).resolves.toBeUndefined()
  })

  it('refuses an archive with a traversal entry, before anything is written', async () => {
    // The Windows case specifically: `ditto` sanitises this on macOS, but
    // Expand-Archive joins the entry name onto the destination as given, so
    // this lands in the Startup folder. Nothing in the app checked it.
    const zip = await makeZip([
      { name: 'Export/Physics.md', declaredSize: 10 },
      { name: String.raw`..\..\..\Startup\evil.lnk`, declaredSize: 10 }
    ])
    await expect(assertSafeZip(zip)).rejects.toThrow(/write outside/)
  })

  it('refuses an archive containing a symlink entry', async () => {
    const zip = await makeZip([{ name: 'Export/link', declaredSize: 20, symlink: true }])
    await expect(assertSafeZip(zip)).rejects.toThrow(/shortcut to somewhere else/)
  })

  it('refuses a bomb by its declared size, without expanding it', async () => {
    // 8 entries of 1 GiB each = 8 GiB, from an archive a few hundred bytes long.
    // That asymmetry IS the attack: a measured 1028:1 ratio means ten megabytes
    // of zip is ten gigabytes on disk.
    const zip = await makeZip(
      Array.from({ length: 8 }, (_, i) => ({
        name: `Export/big-${i}.bin`,
        declaredSize: 1024 * 1024 * 1024
      }))
    )
    const before = (await fs.stat(zip)).size
    expect(before).toBeLessThan(2000) // the archive itself is tiny
    await expect(assertSafeZip(zip)).rejects.toThrow(/more than this can import/)
  })

  it('reads back the entries it was given', async () => {
    const zip = await makeZip([{ name: 'Export/a.md', declaredSize: 7 }])
    const entries = await readZipEntries(zip)
    expect(entries).toEqual([{ name: 'Export/a.md', size: 7, isSymlink: false }])
  })

  it('rejects a file that is not a zip at all rather than guessing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-test-'))
    const notZip = path.join(dir, 'notes.zip')
    await fs.writeFile(notZip, 'this is just some text')
    await expect(assertSafeZip(notZip)).rejects.toThrow(/not a readable .zip/)
  })
})
