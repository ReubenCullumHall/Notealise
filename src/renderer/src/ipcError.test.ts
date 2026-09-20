import { describe, expect, it } from 'vitest'
import { cleanIpcError } from './ipcError'

describe('cleanIpcError', () => {
  it("takes off Electron's IPC wrapper", () => {
    // What ipcRenderer.invoke actually rejects with when a main handler throws.
    // Both of these reached a user on the Windows verification pass (2026-09-20)
    // inside a window.alert, wrapper and all.
    expect(
      cleanIpcError(
        new Error(
          "Error invoking remote method 'vault:renameEntry': Error: That name is too long — " +
            'try something shorter, or a shallower folder.'
        )
      )
    ).toBe('That name is too long — try something shorter, or a shallower folder.')

    expect(
      cleanIpcError(
        new Error(
          "Error invoking remote method 'vault:renameEntry': Error: A note or folder with " +
            'that name already exists'
        )
      )
    ).toBe('A note or folder with that name already exists')
  })

  it("keeps main's own wording, which is written for people", () => {
    // renameWithRetry raises this on a synced vault and it says what to do —
    // losing any of it would make the message worse, not tidier.
    const e = new Error(
      "Error invoking remote method 'asset:write': Error: This folder is still syncing " +
        '(OneDrive, Google Drive or iCloud) — wait a moment and try again.'
    )
    expect(cleanIpcError(e)).toBe(
      'This folder is still syncing (OneDrive, Google Drive or iCloud) — wait a moment and ' +
        'try again.'
    )
  })

  it('leaves an error that never crossed the bridge alone', () => {
    expect(cleanIpcError(new Error('Disk full'))).toBe('Disk full')
  })

  it('keeps a message that contains "Error: " of its own', () => {
    // The reason this is anchored to the wrapper rather than splitting on
    // "Error: ": a naive split takes the text after the LAST occurrence, which
    // would throw away everything before an inner quoted failure.
    const e = new Error(
      "Error invoking remote method 'import:run': Error: Couldn't read page 4 (Error: bad zip)"
    )
    expect(cleanIpcError(e)).toBe("Couldn't read page 4 (Error: bad zip)")
  })

  it('accepts something that is not an Error at all', () => {
    expect(cleanIpcError('just a string')).toBe('just a string')
  })

  it('returns nothing when the message was all framing', () => {
    // Callers each have a better answer than showing the framing back: see the
    // 'no usable why' case in linkEnv.test.ts, and `run`'s own fallback line.
    expect(cleanIpcError(new Error("Error invoking remote method 'vault:x': Error: "))).toBe('')
    expect(cleanIpcError(new Error('Error: '))).toBe('')
    expect(cleanIpcError(new Error(''))).toBe('')
  })
})
