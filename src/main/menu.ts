import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import { CH } from '../shared/channels'
import { checkNow } from './updater'

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
  const checkForUpdates: MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => void checkNow()
  }
  const template: MenuItemConstructorOptions[] = [
    // macOS convention puts "Check for Updates" in the app menu, right under
    // "About"; on Windows there is no app menu, so it goes in File.
    ...(isMac
      ? [
          {
            label: 'Notes',
            submenu: [
              { role: 'about' },
              checkForUpdates,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
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
        ...(isMac ? [] : [checkForUpdates, { type: 'separator' } as MenuItemConstructorOptions]),
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
