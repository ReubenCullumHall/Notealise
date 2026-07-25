import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
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
    {
      label: 'View',
      // Electron's stock `viewMenu` role bundles Reload, Force Reload and Toggle
      // Developer Tools. A shipped build shouldn't hand those to someone who
      // just downloaded a notes app: they read as a developer build, and Reload
      // can throw away an edit that hasn't hit the 400ms autosave yet. Dropping
      // the items also drops their F12 / Ctrl+Shift+I accelerators.
      //
      // This is polish, not a security control — an Electron app can always be
      // inspected by someone determined. `npm run dev` keeps the full set.
      submenu: [
        ...(app.isPackaged
          ? []
          : ([
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
