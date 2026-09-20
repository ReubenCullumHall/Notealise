// What a main-process error looks like by the time the renderer catches it, and
// how to get the sentence a person was meant to read back out of it.
//
// `ipcRenderer.invoke` rejects with the handler's message wrapped in its own
// framing:
//
//   Error invoking remote method 'vault:renameEntry': Error: That name is too
//   long — try something shorter, or a shallower folder.
//
// Main's own half of that is written for people (docs/voice.md) and is worth
// keeping in full — "this folder is still syncing (OneDrive, Google Drive or
// iCloud) — wait a moment and try again" tells the user exactly what to do. The
// channel name in front of it does not, and naming an internal IPC channel at
// someone who has just typed a filename is worse than saying nothing.

/** The prefix `ipcRenderer.invoke` puts on a rejected handler's message.
 *
 *  Anchored and channel-shaped (`'…'`) rather than a bare split on "Error: ",
 *  which is what `notifyError` used to do: that took the text after the LAST
 *  occurrence, so a main message legitimately containing the string — a path,
 *  or a quoted inner failure — lost everything before it. Every existing
 *  `notifyError` test passes either way; this one cannot be surprised. */
const IPC_WRAPPER = /^Error invoking remote method '[^']*':\s*/
/** The `Error: ` the wrapper leaves behind once its own half is gone. */
const LEADING_ERROR = /^Error:\s*/

/** The human sentence inside a caught error, whatever it crossed to get here.
 *
 *  An error that never went through IPC (a renderer-side throw, a string) is
 *  returned as it is — there is no wrapper to take off.
 *
 *  Returns **''** when nothing survives the strip, rather than falling back to
 *  the raw text: an error whose whole message was framing has no sentence in it
 *  to show, and each caller has a better answer than the framing. `notifyError`
 *  drops the `— <why>` half and says only what it was doing; `run` has no such
 *  half, so it says so plainly instead. */
export function cleanIpcError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  return raw.replace(IPC_WRAPPER, '').replace(LEADING_ERROR, '').trim()
}
