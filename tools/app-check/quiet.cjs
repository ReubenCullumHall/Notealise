// Loaded into the SCRATCH app's main process by lab.launch (NODE_OPTIONS=--require) so a robot
// check never takes Reuben's focus: windows open off-screen and never activate the app.
// Set LAB_SHOW=1 to watch the window normally. Never part of the real app.
// Electron's own module isn't ready this early, so patch it the first time the app asks for it.
const Module = require('module')
const orig = Module.prototype.require
let done = false
Module.prototype.require = function (id) {
  const m = orig.apply(this, arguments)
  if (!done && id === 'electron' && m && m.app) { done = true; quiet(m) }
  return m
}
function quiet({ app }) {
  app.on('browser-window-created', (_e, win) => {
    win.show = () => win.showInactive()
    win.focus = () => {}
    win.setPosition(-4000, 40)
    // LAB_SIZE=1280x900: a bigger window, so a long sidebar list fits without scrolling.
    const size = /^(\d+)x(\d+)$/.exec(process.env.LAB_SIZE || '')
    if (size) win.setSize(Number(size[1]), Number(size[2]))
  })
  app.focus = () => {}
  if (process.platform === 'darwin' && app.dock) app.dock.hide()
}
