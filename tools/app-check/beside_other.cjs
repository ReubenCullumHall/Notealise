// The stand-in for "the other app" in run_file_moves.py: one window, off to the side, never focused.
// It writes where it is to a file, so the check can read where it was really put.
const fs = require('fs')
const { app, BrowserWindow } = require('electron')

app.dock?.hide()
app.whenReady().then(() => {
  const w = new BrowserWindow({ x: -900, y: 100, width: 700, height: 500, show: false, focusable: false, title: process.env.OTHER_TITLE })
  w.on('page-title-updated', (e) => e.preventDefault())
  w.loadURL('data:text/html,<p>stand-in</p>')
  w.showInactive()
  setInterval(() => fs.writeFileSync(process.env.OTHER_OUT, JSON.stringify(w.getBounds())), 80)
})
