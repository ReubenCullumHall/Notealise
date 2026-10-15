import type { EditorState } from '@codemirror/state'
import type { ConvertedAudio } from '../../../shared/types'
import { notifyUser } from './linkEnv'
import {
  baseNameOf,
  convertingMessage,
  isIsoMedia,
  isPlayable,
  isSoundOnly,
  isoDeclaresVideo,
  notConvertedMessage,
  tooBigToConvert,
  type PictureProbe,
  type PlayProbe
} from './voiceRecModel'

// Getting a recording that already exists INTO a note — a Voice Memos .m4a, a
// Windows Voice Recorder file, a WhatsApp .opus, Obsidian's .webm. Drop, paste
// and the "Voice note from a file" picker all come through here, so a file is
// treated the same whichever way it arrived; attachInput.ts owns WHERE in the
// note it goes (the same insert points a photo uses), this file owns what is
// saved.
//
// One rule above the rest: a voice note in a note must PLAY in the note. So each
// recording is tried in a hidden player first, and one the player can't play is
// converted to .m4a by the computer's own converter (main's `convertAudio`)
// before it is saved. The original file is never touched — only its bytes come
// here. When the computer has no converter for it, the original is saved and
// added anyway (the player block offers "Open in its own app"), and the person
// is told why it won't play here. Nothing is ever quietly dropped.

/** How long a hidden player gets to make up its mind. A local file loads in
 *  well under a second; this is only the ceiling for a stuck one. */
const PROBE_MS = 5000

/** Load `blob` into a hidden, muted media element and settle once it has decided.
 *  Never plays, never joins the page; the object URL is revoked on the way out
 *  however it ends. */
function probe<T>(
  tag: 'audio' | 'video',
  blob: Blob,
  settleOn: string,
  read: (el: HTMLMediaElement, ended: 'ok' | 'error' | 'timeout') => T
): Promise<T> {
  return new Promise<T>((resolve) => {
    const el = document.createElement(tag)
    el.muted = true
    el.preload = 'auto'
    const url = URL.createObjectURL(blob)
    let done = false
    const finish = (ended: 'ok' | 'error' | 'timeout'): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      el.removeEventListener(settleOn, onOk)
      el.removeEventListener('error', onError)
      const result = read(el, ended)
      // Let go of the file: no src, then load() to drop the decoder, then the URL.
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const onOk = (): void => finish('ok')
    const onError = (): void => finish('error')
    const timer = setTimeout(() => finish('timeout'), PROBE_MS)
    el.addEventListener(settleOn, onOk)
    el.addEventListener('error', onError)
    el.src = url
  })
}

/** Can the app's own player play this file? Tried as an UNTYPED blob, so the
 *  answer comes from what is in the file rather than from what its name claims —
 *  the same way the player block will meet it. */
export async function canPlayHere(blob: Blob): Promise<boolean> {
  const untyped = blob.type ? blob.slice(0, blob.size, '') : blob
  const p: PlayProbe = await probe('audio', untyped, 'canplay', (el, ended) => ({
    canPlay: ended === 'ok',
    error: ended === 'error',
    timedOut: ended === 'timeout',
    duration: el.duration
  }))
  return isPlayable(p)
}

/** Is a file that arrived looking like a video really a recording — sound and
 *  no picture? `bytes` is only read for an MP4-family file, to make sure a
 *  picture the player couldn't decode isn't mistaken for no picture at all. */
export async function hasNoPicture(blob: Blob, name: string, bytes: Uint8Array): Promise<boolean> {
  const p: PictureProbe = await probe('video', blob, 'loadedmetadata', (el, ended) => {
    const v = el as HTMLVideoElement
    return { metadata: ended === 'ok', error: ended === 'error', videoWidth: v.videoWidth, videoHeight: v.videoHeight }
  })
  if (!p.metadata || p.videoWidth || p.videoHeight) return false
  return isSoundOnly(p, isIsoMedia(name) && isoDeclaresVideo(bytes))
}

/** Save one recording beside the note and return the name it was saved under —
 *  what the voice note's line points at — or null when nothing should be added
 *  (it was too big to convert; the person has been told).
 *
 *  Playable here → saved exactly as it is. Not playable → converted to .m4a;
 *  if this computer can't convert it, the ORIGINAL is saved and added anyway,
 *  with a sentence saying why it won't play inside Notealise. A write that
 *  fails throws, so the caller's own "Couldn't add …" handling reports it. */
export async function saveRecording(
  state: EditorState,
  dir: string,
  name: string,
  bytes: Uint8Array,
  blob: Blob = new Blob([bytes as BlobPart])
): Promise<string | null> {
  if (await canPlayHere(blob)) return baseNameOf(await window.api.writeAsset(dir, name, bytes))

  notifyUser(state, convertingMessage(name))
  let res: ConvertedAudio
  try {
    res = await window.api.convertAudio(name, bytes)
  } catch (e) {
    // The converter itself broke (not "can't read this" — that comes back as an
    // answer). Treated like a failed conversion: the original still goes in.
    console.error(`could not convert ${name}`, e)
    res = { ok: false, reason: 'failed', platform: 'other' }
  }
  if (res.ok) {
    const saved = baseNameOf(await window.api.writeAsset(dir, res.name, res.data))
    notifyUser(state, `Converted ${name} to play in Notealise.`)
    return saved
  }
  if (res.reason === 'too-big') {
    notifyUser(state, tooBigToConvert(name))
    return null
  }
  const saved = baseNameOf(await window.api.writeAsset(dir, name, bytes))
  notifyUser(state, notConvertedMessage(saved, res.reason))
  return saved
}
