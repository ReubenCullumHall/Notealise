import { afterAll, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Bug scan 2026-11-19, item 21 (Windows / Linux): once an update had downloaded,
// the next check — the every-6-hours one, offline — turned 'ready' into
// 'checking' and then 'error', and "Restart to update" went with it.
const au = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn(async () => undefined) })
vi.mock('electron-updater', () => ({ default: { autoUpdater: au } }))
vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: { getAllWindows: () => [] }, shell: {} }))
vi.mock('./config', () => ({ getUpdatePrefs: async () => ({ autoUpdate: true }), saveUpdatePrefs: async () => {} }))
vi.mock('./macUpdate', () => ({ checkMacUpdate: async () => null, downloadMacDmg: async () => null }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
Object.defineProperty(process, 'platform', { value: 'win32' })
const res = mkdtempSync(path.join(os.tmpdir(), 'upd-'))
writeFileSync(path.join(res, 'app-update.yml'), 'provider: github\n')
Object.defineProperty(process, 'resourcesPath', { value: res, configurable: true })
afterAll(() => Object.defineProperty(process, 'platform', platform))

const { checkNow, currentStatus } = await import('./updater')

it('a finished download stays ready through a later check that fails', async () => {
  await checkNow() // wires the events
  au.emit('update-downloaded', { version: '9.9.9' })
  expect(currentStatus().state).toBe('ready')
  au.checkForUpdates.mockImplementationOnce(async () => {
    au.emit('checking-for-update')
    au.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    throw new Error('net::ERR_INTERNET_DISCONNECTED')
  })
  await checkNow()
  expect(currentStatus()).toMatchObject({ state: 'ready', version: '9.9.9' })
})

it('…and through a check that finds the same release again', async () => {
  au.emit('checking-for-update')
  au.emit('update-available', { version: '9.9.9' })
  expect(currentStatus()).toMatchObject({ state: 'ready', version: '9.9.9' })
})

it('a NEWER release still moves it on', async () => {
  au.emit('update-available', { version: '10.0.0' })
  expect(currentStatus().state).not.toBe('ready')
  expect(currentStatus().version).toBe('10.0.0')
})
