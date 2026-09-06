// Look inside a .zip BEFORE handing it to the OS's extractor.
//
// Why this exists at all. Extraction is delegated to `ditto` on macOS and
// PowerShell's `Expand-Archive` on Windows (see extractZip.ts for why), and the
// two do not agree about safety. `ditto` sanitises hostile entry names — tested
// directly with an archive carrying `../`, absolute, backslash and symlink
// entries, and nothing landed outside the destination. `Expand-Archive`'s in-box
// module joins each entry's name onto the destination without a containment
// check, so `..\..\..\Users\<you>\AppData\Roaming\Microsoft\Windows\Start Menu\
// Programs\Startup\x.lnk` is a write outside the extraction folder — i.e.
// persistence, from a file the user was told to download from Notion.
//
// The app added nothing of its own on either platform. So this reads the
// archive's central directory and answers two questions the extractor won't:
// does any entry name try to leave, and how much does this claim to expand to.
//
// No new dependency (CLAUDE.md's dependency rule). The central directory is a
// short, well-specified structure at the end of the file, and reading it costs
// one open and two reads regardless of how big the archive is.

import { promises as fs } from 'fs'
import path from 'path'

/** Ceilings. Generous enough that no real export comes near them, low enough
 *  that a bomb is refused before it starts: a 204 KB zip of zero-bytes expanded
 *  to 200 MiB in 0.13s through the exact `ditto` call this guards, a measured
 *  compression ratio of about 1028:1. Ten megabytes of such a file is ten
 *  gigabytes on disk, and nothing reported it or could stop it. */
const MAX_ENTRIES = 200_000
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024 // 4 GiB

const EOCD_SIG = 0x06054b50
const EOCD64_LOCATOR_SIG = 0x07064b50
const EOCD64_SIG = 0x06064b50
const CENTRAL_SIG = 0x02014b50

export interface ZipEntry {
  name: string
  /** Bytes this entry claims it will expand to. */
  size: number
  /** The high 16 bits of "external file attributes" are the unix mode when the
   *  archive was made on a unix-like system, and 0xA000 there means symlink. An
   *  extracted symlink is a way to make a later write land outside the folder
   *  even when the entry NAMES stay innocent. */
  isSymlink: boolean
}

/** Would extracting `name` write outside the destination folder?
 *
 *  Checked as a path on BOTH platforms, not just the current one: a vault and
 *  an export both travel between Windows and macOS (rule 7), and `a\b` is one
 *  filename on macOS and two path segments on Windows. Refusing on either
 *  reading is the only answer that is right in both places.
 *
 *  Exported so it can be tested directly — it is the whole of the defence. */
export function unsafeEntryName(name: string): boolean {
  if (!name) return true
  if (name.includes('\0')) return true
  // An absolute path, on either platform's reading, ignores the destination.
  if (name.startsWith('/') || name.startsWith('\\')) return true
  if (/^[a-zA-Z]:/.test(name)) return true // a drive letter
  // Every segment, splitting on BOTH separators.
  return name.split(/[/\\]/).some((seg) => seg === '..')
}

/** Read `len` bytes at `pos`. */
async function readAt(fh: fs.FileHandle, pos: number, len: number): Promise<Buffer> {
  const buf = Buffer.alloc(len)
  await fh.read(buf, 0, len, pos)
  return buf
}

/** Locate the end-of-central-directory record, which sits at the very end of
 *  the file apart from an optional trailing comment of up to 65535 bytes. */
function findEocd(tail: Buffer): number {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

/** Where the central directory is, and how many entries it holds. Handles the
 *  zip64 form, which a genuinely large export can legitimately be in — refusing
 *  those outright would break the very imports this is meant to protect. */
async function locateCentralDirectory(
  fh: fs.FileHandle,
  fileSize: number
): Promise<{ offset: number; size: number; count: number }> {
  const tailLen = Math.min(fileSize, 65535 + 22)
  const tail = await readAt(fh, fileSize - tailLen, tailLen)
  const at = findEocd(tail)
  if (at === -1) throw new Error('That file is not a readable .zip archive.')

  let count = tail.readUInt16LE(at + 10)
  let size = tail.readUInt32LE(at + 12)
  let offset = tail.readUInt32LE(at + 16)

  // 0xFFFF/0xFFFFFFFF are "look in the zip64 record instead" markers.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locAt = at - 20
    if (locAt < 0 || tail.readUInt32LE(locAt) !== EOCD64_LOCATOR_SIG) {
      throw new Error('That archive uses a zip format this importer cannot check.')
    }
    const eocd64Offset = Number(tail.readBigUInt64LE(locAt + 8))
    const rec = await readAt(fh, eocd64Offset, 56)
    if (rec.readUInt32LE(0) !== EOCD64_SIG) {
      throw new Error('That archive uses a zip format this importer cannot check.')
    }
    count = Number(rec.readBigUInt64LE(32))
    size = Number(rec.readBigUInt64LE(40))
    offset = Number(rec.readBigUInt64LE(48))
  }
  return { offset, size, count }
}

/** The real uncompressed size when the 32-bit field is the 0xFFFFFFFF marker:
 *  it lives in the zip64 extra field, header id 0x0001, as the first 8 bytes. */
function zip64Size(extra: Buffer): number | null {
  let i = 0
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i)
    const len = extra.readUInt16LE(i + 2)
    if (id === 0x0001 && len >= 8) return Number(extra.readBigUInt64LE(i + 4))
    i += 4 + len
  }
  return null
}

/** Every entry the archive declares. */
export async function readZipEntries(zipPath: string): Promise<ZipEntry[]> {
  const fh = await fs.open(zipPath, 'r')
  try {
    const { size: fileSize } = await fh.stat()
    const cd = await locateCentralDirectory(fh, fileSize)
    if (cd.count > MAX_ENTRIES) {
      throw new Error(`That archive holds ${cd.count.toLocaleString()} items, which is too many to import safely.`)
    }
    const buf = await readAt(fh, cd.offset, cd.size)

    const out: ZipEntry[] = []
    let i = 0
    while (i + 46 <= buf.length && out.length < cd.count) {
      if (buf.readUInt32LE(i) !== CENTRAL_SIG) break
      const declared = buf.readUInt32LE(i + 24)
      const nameLen = buf.readUInt16LE(i + 28)
      const extraLen = buf.readUInt16LE(i + 30)
      const commentLen = buf.readUInt16LE(i + 32)
      const externalAttrs = buf.readUInt32LE(i + 38)
      const name = buf.subarray(i + 46, i + 46 + nameLen).toString('utf8')
      const extra = buf.subarray(i + 46 + nameLen, i + 46 + nameLen + extraLen)
      const size = declared === 0xffffffff ? (zip64Size(extra) ?? declared) : declared
      out.push({
        name,
        size,
        isSymlink: ((externalAttrs >>> 16) & 0xf000) === 0xa000
      })
      i += 46 + nameLen + extraLen + commentLen
    }
    return out
  } finally {
    await fh.close()
  }
}

/** Throw unless this archive is safe to hand to the OS extractor.
 *
 *  Deliberately a hard refusal rather than "skip the bad entries": the extractor
 *  is a separate process being given the whole file, so there is no way to
 *  extract some of it and not the rest. An archive containing a traversal entry
 *  is not a Notion export that happens to have a flaw — it is a file built to
 *  do something else, and the honest answer is to decline it.
 *
 *  The declared sizes are a claim, not a fact, so they are not the only defence
 *  — `extractZip` watches the destination grow as well. This is the cheap check
 *  that stops the obvious case before a single byte is written. */
export async function assertSafeZip(zipPath: string): Promise<void> {
  const entries = await readZipEntries(zipPath)

  const bad = entries.find((e) => unsafeEntryName(e.name))
  if (bad) {
    throw new Error(
      `That archive tries to write outside the folder it is being unpacked into ("${path.basename(bad.name)}"), so it was not imported.`
    )
  }
  const link = entries.find((e) => e.isSymlink)
  if (link) {
    throw new Error(
      `That archive contains a shortcut to somewhere else on this computer ("${path.basename(link.name)}"), so it was not imported.`
    )
  }
  let total = 0
  for (const e of entries) total += e.size
  if (total > MAX_TOTAL_BYTES) {
    const gb = (total / 1024 / 1024 / 1024).toFixed(1)
    throw new Error(`That archive unpacks to about ${gb} GB, which is more than this can import.`)
  }
}

export const ZIP_LIMITS = { MAX_ENTRIES, MAX_TOTAL_BYTES }
