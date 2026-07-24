import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { CH } from '../shared/channels'

function sendMenuCommand(cmd: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send(CH.menuCommand, cmd)
}

// Application menu. On macOS this is the top menu bar (with the standard app
// menu as the first item); on Windows it renders as the window's menu bar. All
// accelerators use CommandOrControl so one definition is correct on both.
// The Edit menu uses the built-in role so undo/redo/cut/copy/paste work in the
// editor with the right per-platform shortcuts.
export function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CommandOrControl+N', click: () => sendMenuCommand('new-note') },
        {
          label: 'New Folder',
          accelerator: 'CommandOrControl+Shift+N',
          click: () => sendMenuCommand('new-folder')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
