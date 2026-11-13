// Serving a vault's pictures, videos and recordings a piece at a time
// (mediaProtocol.ts) — against a REAL temporary folder with real symlinks, for
// the reasons vault.test.ts gives: whether a link is followed out of the vault is
// a property of the filesystem, not of the code.
//
// The address is the first way to reach a vault file that is not an IPC call, so
// what is pinned here is that it reaches nothing the IPC read could not, that it
// is useless without the launch's token, and that a player asking for part of a
// file gets exactly those bytes.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AWKWARD_NAMES } from '../shared/awkwardNames'
import { MEDIA_SCHEME, mediaUrl } from '../shared/mediaUrl'
import { mediaAddress, serveMedia } from './mediaProtocol'
import { setVaultRoot } from './vault'

let root = ''
let outside = ''

// Same probe as vault.test.ts: Windows needs Developer Mode to make a link.
const CAN_SYMLINK = ((): boolean => {
  const probe = mkdtempSync(path.join(os.tmpdir(), 'media-symlink-probe-'))
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

/** 3 MB and a bit — three pieces and a short one — where byte i is i mod 251,
 *  so any slice can be checked without keeping a second copy. */
const BIG = 3 * 1024 * 1024 + 4321
const bigBytes = (): Uint8Array => {
  const b = new Uint8Array(BIG)
  for (let i = 0; i < BIG; i++) b[i] = i % 251
  return b
}

beforeEach(async () => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'media-test-')))
  root = path.join(base, 'vault')
  outside = path.join(base, 'outside')
  await fs.mkdir(path.join(root, 'Biology'), { recursive: true })
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'secret.txt'), 'PRIVATE KEY', 'utf8')
  await fs.writeFile(path.join(root, 'Biology', 'cell.png'), 'PNGDATA-0123456789', 'utf8')
  setVaultRoot(root)
})

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true }).catch(() => {})
})

const get = (url: string, headers: Record<string, string> = {}): Promise<Response> =>
  serveMedia(new Request(url, { headers }))
const bodyOf = async (res: Response): Promise<Uint8Array> => new Uint8Array(await res.arrayBuffer())
/** A real address with its path swapped for another — the launch's token kept. */
const retarget = (url: string, rel: string): string => {
  const u = new URL(url)
  u.searchParams.set('p', rel)
  return u.toString()
}

describe('the media address, served', () => {
  it('serves a vault file whole', async () => {
    const res = await get(await mediaAddress('Biology/cell.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('18')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(await res.text()).toBe('PNGDATA-0123456789')
  })

  it('serves exactly the part a player asks for', async () => {
    const url = await mediaAddress('Biology/cell.png')
    const res = await get(url, { Range: 'bytes=8-12' })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 8-12/18')
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('01234')
    const tail = await get(url, { Range: 'bytes=-4' })
    expect(tail.headers.get('content-range')).toBe('bytes 14-17/18')
    expect(await tail.text()).toBe('6789')
  })

  it('serves a big file in pieces, byte for byte', async () => {
    await fs.writeFile(path.join(root, 'Biology', 'film.mov'), bigBytes())
    const url = await mediaAddress('Biology/film.mov')
    const whole = await bodyOf(await get(url))
    expect(whole.byteLength).toBe(BIG)
    expect(Buffer.compare(whole, bigBytes())).toBe(0)
    // across a piece boundary, and the short last piece
    const start = 1024 * 1024 - 7
    const part = await bodyOf(await get(url, { Range: `bytes=${start}-${start + 99}` }))
    expect([...part]).toEqual(Array.from({ length: 100 }, (_, i) => (start + i) % 251))
    const end = await get(url, { Range: `bytes=${BIG - 10}-` })
    expect(end.headers.get('content-range')).toBe(`bytes ${BIG - 10}-${BIG - 1}/${BIG}`)
    expect((await bodyOf(end)).byteLength).toBe(10)
  })

  it('stops cleanly when the player goes away mid-file', async () => {
    await fs.writeFile(path.join(root, 'Biology', 'film.mov'), bigBytes())
    const res = await get(await mediaAddress('Biology/film.mov'))
    const reader = res.body!.getReader()
    const first = await reader.read()
    expect(first.value!.byteLength).toBeGreaterThan(0)
    await reader.cancel() // a seek, or the note closing
    // Nothing is left open: the file can be renamed and deleted at once.
    await fs.rename(path.join(root, 'Biology', 'film.mov'), path.join(root, 'Biology', 'moved.mov'))
    await fs.rm(path.join(root, 'Biology', 'moved.mov'))
  })

  it('says so when the range starts past the end', async () => {
    const res = await get(await mediaAddress('Biology/cell.png'), { Range: 'bytes=500-' })
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */18')
  })

  it('serves an empty file as empty', async () => {
    await fs.writeFile(path.join(root, 'Biology', 'empty.png'), '')
    const res = await get(await mediaAddress('Biology/empty.png'))
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).byteLength).toBe(0)
  })

  it('finds a file under every awkward name', async () => {
    for (const name of AWKWARD_NAMES) {
      await fs.mkdir(path.join(root, name), { recursive: true })
      await fs.writeFile(path.join(root, name, `${name}.png`), `bytes of ${name}`, 'utf8')
      const res = await get(await mediaAddress(`${name}/${name}.png`))
      expect(res.status, name).toBe(200)
      expect(await res.text()).toBe(`bytes of ${name}`)
    }
  })

  // Sniffing cannot tell an SVG from its contents, so without a type it showed as
  // "not found" (Reuben's yes to fixing it, 2026-11-13). Every other kind is
  // still sent with no type, exactly as the blob it replaced.
  it('sends a type for an .svg, with a policy that forbids script — and for nothing else', async () => {
    await fs.writeFile(path.join(root, 'Biology', 'Diagram.SVG'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8')
    for (const rel of ['Biology/Diagram.SVG']) {
      for (const range of [{}, { Range: 'bytes=0-9' }] as Record<string, string>[]) {
        const res = await get(await mediaAddress(rel), range)
        expect(res.headers.get('content-type')).toBe('image/svg+xml')
        expect(res.headers.get('content-security-policy')).toMatch(/default-src 'none'/)
        expect(res.headers.get('content-security-policy')).not.toMatch(/script/)
      }
    }
    await fs.writeFile(path.join(root, 'Biology', 'svg.png'), 'PNG', 'utf8') // "svg" in the name is not the extension
    for (const rel of ['Biology/cell.png', 'Biology/svg.png']) {
      const res = await get(await mediaAddress(rel))
      expect(res.headers.get('content-type'), rel).toBeNull()
      expect(res.headers.get('content-security-policy'), rel).toBeNull()
    }
  })

  it('changes its address when the file changes', async () => {
    const before = await mediaAddress('Biology/cell.png')
    await fs.writeFile(path.join(root, 'Biology', 'cell.png'), 'A NEW PICTURE, LONGER THAN THE OLD', 'utf8')
    expect(await mediaAddress('Biology/cell.png')).not.toBe(before)
  })
})

describe('the media address, refused', () => {
  it('without this launch’s token', async () => {
    const real = await mediaAddress('Biology/cell.png')
    const guess = mediaUrl('0'.repeat(32), 'Biology/cell.png', '1-2')
    expect((await get(guess)).status).toBe(403)
    expect((await get(`${MEDIA_SCHEME}:///?p=Biology%2Fcell.png`)).status).toBe(403)
    expect((await get(real)).status).toBe(200) // the control: the same file, with the token
  })

  it.each([
    ['a parent-directory climb', '../outside/secret.txt'],
    ['a climb that dips into a subfolder first', 'Biology/../../outside/secret.txt'],
    ['an absolute path', '/etc/passwd'],
    ['a file that is not there', 'Biology/gone.png'],
    ['a folder', 'Biology'],
    ['the vault itself', '.']
  ])('for %s', async (_label, rel) => {
    const real = await mediaAddress('Biology/cell.png')
    const res = await get(retarget(real, rel))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })

  it('for a link that points out of the vault', async (ctx) => {
    ctx.skip(!CAN_SYMLINK, 'this process cannot create symlinks — not verified here')
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'Biology', 'innocent.png'))
    const real = await mediaAddress('Biology/cell.png')
    const res = await get(retarget(real, 'Biology/innocent.png'))
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('PRIVATE')
    await expect(mediaAddress('Biology/innocent.png')).rejects.toThrow()
  })

  it('for anything but a plain read', async () => {
    const real = await mediaAddress('Biology/cell.png')
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) {
      expect((await serveMedia(new Request(real, { method }))).status, method).toBe(405)
    }
    expect(await fs.readFile(path.join(root, 'Biology', 'cell.png'), 'utf8')).toBe('PNGDATA-0123456789')
  })

  it('and gives no address for a file that is not there, or not in the vault', async () => {
    await expect(mediaAddress('Biology/gone.png')).rejects.toThrow()
    await expect(mediaAddress('../outside/secret.txt')).rejects.toThrow()
    await expect(mediaAddress('Biology')).rejects.toThrow()
    // structured clone delivers anything, whatever the type says
    await expect(mediaAddress(['Biology', 'cell.png'] as unknown as string)).rejects.toThrow()
  })
})
