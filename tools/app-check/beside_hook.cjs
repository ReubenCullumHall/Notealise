// Loaded into the SCRATCH app only, by run_file_moves.py. "Edit in …" then runs for real except for
// the three things that would disturb the person at the computer: no real app is opened, the window
// that gets moved is a private stand-in, and the "screen" is a box that keeps both off to the side.
const fs = require('fs')
const cp = require('child_process')
const Module = require('module')

const flagsFile = process.env.BESIDE_FLAGS
const flags = () => JSON.parse(fs.readFileSync(flagsFile, 'utf8'))
const log = (line) => fs.appendFileSync(flagsFile + '.log', JSON.stringify(line) + '\n')

const realExec = cp.execFile
cp.execFile = function (cmd, args, opts, cb) {
  if (String(cmd).endsWith('osascript') && opts && opts.env && opts.env.BESIDE_APP !== undefined) {
    opts = { ...opts, env: { ...opts.env, BESIDE_APP: flags().other } }
  }
  return realExec.call(this, cmd, args, opts, cb)
}

const orig = Module.prototype.require
let done = false
Module.prototype.require = function (id) {
  const m = orig.apply(this, arguments)
  if (!done && id === 'electron' && m && m.app) {
    done = true
    m.shell.openPath = async (p) => {
      log({ opened: p })
      return flags().openFails ? 'no application' : ''
    }
    m.systemPreferences.isTrustedAccessibilityClient = (prompt) => {
      if (prompt) log({ asked: true })
      return !!flags().trusted
    }
    const realBounds = m.BrowserWindow.prototype.setBounds
    m.BrowserWindow.prototype.setBounds = function (b, animate) {
      log({ setBounds: b })
      return realBounds.call(this, b, animate)
    }
    m.app.whenReady().then(() => {
      const real = m.screen.getDisplayMatching.bind(m.screen)
      m.screen.getDisplayMatching = (r) => ({ ...real(r), workArea: flags().work })
    })
  }
  return m
}
