// Which microphone records (Reuben, 2026-11-06: "all" to the ideas — "pick the
// microphone in the recorder"). The choice is the computer's, not the vault's:
// a device id means nothing on another machine, so it is kept with this
// install (the window's own storage), never in .mdnotes. Absent, or the chosen
// one unplugged, the system's default microphone records — as it always did.

const KEY = 'notealise.voice.mic'

export function chosenMic(): string | null {
  try {
    return localStorage.getItem(KEY) || null
  } catch {
    return null
  }
}

export function setChosenMic(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  } catch {
    // storage unavailable: the default microphone, as before
  }
}

export interface Mic {
  id: string
  label: string
}

/** The microphones this computer has. Their names are only told once the app
 *  has been allowed the microphone; before that they are numbered. */
export async function listMics(): Promise<Mic[]> {
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  if (!devices?.enumerateDevices) return []
  try {
    const all = await devices.enumerateDevices()
    const mics = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    return mics.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
  } catch {
    return []
  }
}

/** Open the chosen microphone — or the default one, when none is chosen or the
 *  chosen one has gone (then the choice is forgotten). Throws as getUserMedia
 *  does, for the caller's own messages. */
export async function openMic(): Promise<MediaStream> {
  const devices = navigator.mediaDevices
  const id = chosenMic()
  if (id) {
    try {
      return await devices.getUserMedia({ audio: { deviceId: { exact: id } } })
    } catch (e) {
      const name = (e as { name?: unknown } | null)?.name
      // Unplugged or renamed: fall back. Anything else (blocked) is the same
      // answer the default would give, so it is passed on.
      if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw e
      setChosenMic(null)
    }
  }
  return devices.getUserMedia({ audio: true })
}
