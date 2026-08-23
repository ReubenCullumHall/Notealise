// Is this window talking to a main process that understands it?
//
// `npm run dev` hot-reloads the RENDERER and leaves the main process running.
// So a change to an IPC contract lands in the window immediately and in main
// not at all, and the window then talks to a process that answers the old
// shape. That has now cost two rounds of debugging: `restoreEntries` started
// returning `{ workspace, landed }`, the stale main kept returning a bare
// Workspace, `setWorkspace(undefined)` reached React state, and the next render
// threw and took the whole interface down to a blank window. From the outside
// it looked exactly like a bug in the restore feature.
//
// `bootInfo` is a NEW channel, which is the whole trick: a main process from
// before this fix does not handle it, so the invoke REJECTS. There is nothing
// to compare and no version numbering to keep in step — the failure to answer
// is itself the answer.

/** Warn, loudly and visibly, when the window is newer than the process behind
 *  it. Dev only: in a packaged build the two ship together and cannot skew.
 *  `say` is App's notice strip — a console line alone is no use to someone who
 *  has no reason to have the console open. */
export async function checkMainIsCurrent(say: (msg: string) => void): Promise<void> {
  if (!import.meta.env.DEV || !window.api?.bootInfo) return
  try {
    const info = await window.api.bootInfo()
    console.info(
      `[notealise] renderer loaded ${new Date().toLocaleTimeString()} · main started ${new Date(info.startedAt).toLocaleTimeString()} (v${info.version})`
    )
  } catch {
    console.warn(
      '[notealise] This window is newer than the app’s background process. ' +
        'Quit the app completely and start it again — a reload is not enough.'
    )
    say('This window is newer than the app’s background process — quit and reopen')
  }
}
