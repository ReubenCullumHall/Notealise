// "Edit in Excel": opens a document in the real app and lines that app's window up
// beside Notealise (docs/plans/file-tabs.md). Notealise never edits the file here. The
// real app saves it, and the tab reloads through the ordinary outside-change route.
//
// macOS needs the Accessibility permission to move another app's window; nothing here
// asks for it until the button is pressed. Windows needs none. Linux has no one way to
// do this, so it keeps the plain "Open in its own app".

import { execFile } from 'node:child_process'
import path from 'node:path'
import { screen, shell, systemPreferences, type BrowserWindow } from 'electron'
import { outerBox, oursBeside, shortAppName, splitScreen, type Box, type EditBeside, type Insets } from '../shared/sideBySide'
import { docViewOf } from '../shared/docs'
import { MAC_LOOKUP, MAC_PLACE, WIN_LOOKUP, WIN_PLACE } from './sideBySideScripts'
import { openableFile } from './vault'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

/** PDF, Word and Excel. Text and CSV are edited in their own tab already. */
export function canEditBeside(name: string): boolean {
  const view = docViewOf(name)
  return view === 'pdf' || view === 'word' || view === 'sheet'
}

function run(cmd: string, args: string[], env: Record<string, string>, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout, windowsHide: true, maxBuffer: 64 * 1024 }, (err, out) =>
      err ? reject(err) : resolve(String(out).trim())
    )
  })
}

const macScript = (script: string, env: Record<string, string>, timeout: number): Promise<string> =>
  run('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], env, timeout)

const winScript = (script: string, env: Record<string, string>, timeout: number): Promise<string> =>
  run(
    // By full path: a bare name would be looked up through PATH.
    path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    env,
    timeout
  )

interface DocApp {
  name: string
  /** macOS: the app's bundle id */
  id?: string
}

/** Each tab asks when it opens; a short memory keeps that from starting a script per
 *  tab, while a newly installed app is still noticed. */
const known = new Map<string, { at: number; app: DocApp | null }>()
const KNOWN_MS = 30_000

async function appFor(abs: string): Promise<DocApp | null> {
  if (!isMac && !isWin) return null
  const ext = path.extname(abs).toLowerCase()
  const held = known.get(ext)
  if (held && Date.now() - held.at < KNOWN_MS) return held.app
  let app: DocApp | null = null
  try {
    if (isMac) {
      const out = await macScript(MAC_LOOKUP, { BESIDE_FILE: abs }, 5000)
      app = out ? (JSON.parse(out) as DocApp) : null
    } else {
      const name = await winScript(WIN_LOOKUP, { BESIDE_EXT: ext }, 8000)
      app = name ? { name } : null
    }
  } catch {
    app = null
  }
  known.set(ext, { at: Date.now(), app })
  return app
}

/** The name for the button ("Excel"), or null when the button can't offer it. */
export async function docAppName(relPath: string): Promise<string | null> {
  if (typeof relPath !== 'string' || !canEditBeside(relPath)) return null
  const abs = await openableFile(relPath)
  if (!abs) return null
  const app = await appFor(abs)
  return app ? shortAppName(app.name) : null
}

/** How the window was before it was lined up, for Undo. */
let before: { bounds: Box; full: boolean; maximised: boolean; placed: Box } | null = null

function leaveFullScreen(win: BrowserWindow): Promise<void> {
  if (!win.isFullScreen()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      win.removeListener('leave-full-screen', done)
      resolve()
    }
    const timer = setTimeout(done, 1500)
    win.once('leave-full-screen', done)
    win.setFullScreen(false)
  })
}

function putBack(win: BrowserWindow, was: NonNullable<typeof before>): void {
  win.setBounds(was.bounds)
  if (was.maximised) win.maximize()
  if (was.full) win.setFullScreen(true)
}

/** Put the other app's window in `box`; where it really ended up, or null. On Windows
 *  also our own window's invisible border, so the two visibly meet. */
async function placeWindow(
  win: BrowserWindow,
  app: DocApp,
  abs: string,
  box: Box
): Promise<{ box: Box; inset?: Insets } | null> {
  const stem = path.basename(abs, path.extname(abs))
  try {
    if (isMac) {
      const out = await macScript(
        MAC_PLACE,
        {
          BESIDE_APP: app.id ?? '',
          BESIDE_STEM: stem,
          BESIDE_X: String(box.x),
          BESIDE_Y: String(box.y),
          BESIDE_W: String(box.width),
          BESIDE_H: String(box.height)
        },
        20_000
      )
      return out ? { box: JSON.parse(out) as Box } : null
    }
    const px = screen.dipToScreenRect(win, box)
    const handle = win.getNativeWindowHandle()
    const ours = handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
    const out = await winScript(
      WIN_PLACE,
      {
        BESIDE_STEM: stem,
        BESIDE_EXT: path.extname(abs).toLowerCase(),
        BESIDE_OURS: String(ours),
        BESIDE_X: String(px.x),
        BESIDE_Y: String(px.y),
        BESIDE_W: String(px.width),
        BESIDE_H: String(px.height)
      },
      // The script waits up to a minute for an app that is starting from cold.
      75_000
    )
    if (!out) return null
    const { inset, ...seen } = JSON.parse(out) as Box & { inset: Insets }
    return { box: screen.screenToDipRect(win, seen), inset }
  } catch {
    return null
  }
}

export async function editBeside(win: BrowserWindow, relPath: string): Promise<EditBeside> {
  if (typeof relPath !== 'string' || !canEditBeside(relPath)) return { ok: false, why: 'failed' }
  const abs = await openableFile(relPath)
  if (!abs || !canEditBeside(abs)) return { ok: false, why: 'failed' }
  const app = await appFor(abs)
  if (!app) return { ok: false, why: 'no-app' }
  const name = shortAppName(app.name)
  // Asked before the file opens, so the Mac's box isn't buried under the other app.
  if (isMac && !systemPreferences.isTrustedAccessibilityClient(false)) {
    systemPreferences.isTrustedAccessibilityClient(true)
    return { ok: false, why: 'permission', app: name }
  }
  const was = {
    bounds: win.getNormalBounds(),
    full: win.isFullScreen(),
    maximised: win.isMaximized()
  }
  if ((await shell.openPath(abs)) !== '') return { ok: false, why: 'failed', app: name }
  await leaveFullScreen(win)
  if (was.maximised) win.unmaximize()
  const work = screen.getDisplayMatching(win.getBounds()).workArea
  const split = splitScreen(work)
  if (!split) {
    putBack(win, { ...was, placed: was.bounds })
    return { ok: false, why: 'narrow', app: name }
  }
  const placed = await placeWindow(win, app, abs, split.theirs)
  if (win.isDestroyed()) return { ok: true, app: name }
  if (!placed) {
    putBack(win, { ...was, placed: was.bounds })
    return { ok: false, why: 'not-placed', app: name }
  }
  const seen = oursBeside(work, placed.box)
  const ours = placed.inset
    ? screen.screenToDipRect(win, outerBox(screen.dipToScreenRect(win, seen), placed.inset))
    : seen
  // A second file lined up while already beside one keeps the size to go back to.
  const already = before && before.placed.x === was.bounds.x && before.placed.width === was.bounds.width
  if (!already) before = { ...was, placed: ours }
  else if (before) before.placed = ours
  win.setBounds(ours, isMac)
  return { ok: true, app: name }
}

/** The message's Undo: Notealise goes back to the size it was. */
export function undoEditBeside(win: BrowserWindow): void {
  if (!before) return
  const was = before
  before = null
  putBack(win, was)
}
