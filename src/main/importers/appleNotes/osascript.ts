import { spawn } from 'child_process'

/** Raised when macOS refused the Automation prompt. Carries a plain-language
 *  message: the raw AppleEvent error ("Not authorized to send Apple events to
 *  Notes. (-1743)") tells a user nothing about what to do. */
export class AutomationDeniedError extends Error {
  constructor() {
    super(
      'This app isn’t allowed to control Apple Notes yet. Open System Settings → Privacy & ' +
        'Security → Automation, switch on “Notes” underneath this app, then try the import again.'
    )
  }
}

export class NotesNotFoundError extends Error {
  constructor() {
    super('Apple Notes could not be opened on this Mac.')
  }
}

/** -1743 is errAEEventNotPermitted; -600/-609 mean the app couldn't be reached. */
function classify(stderr: string): Error | null {
  if (/-1743|not authori[sz]ed|not allowed to send/i.test(stderr)) return new AutomationDeniedError()
  if (/-600|-609|application isn.t running|can.t find application/i.test(stderr)) {
    return new NotesNotFoundError()
  }
  return null
}

/** Runs a JXA script and parses the JSON it prints.
 *
 *  The child-process discipline here is not optional — see
 *  `notionZip/extractZip.ts`, where an undrained pipe turned a six-second job
 *  into a thirty-minute hang. stdin is `ignore` so nothing can block waiting for
 *  input, BOTH pipes are consumed (a whole Notes library's HTML comes back on
 *  stdout, so the 64KB pipe buffer really does fill), and a timeout is the
 *  backstop.
 *
 *  The script is passed with `-e` rather than on stdin precisely so stdin can
 *  stay closed; arguments are interpolated as JSON literals by the caller. */
export function runJxa<T>(source: string, timeoutMs = 10 * 60_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-l', 'JavaScript', '-e', source], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Apple Notes did not respond within ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(classify(err) ?? new Error(err.trim() || `osascript exited with code ${code}`))
        return
      }
      try {
        resolve(JSON.parse(out) as T)
      } catch {
        reject(new Error('Could not read the reply from Apple Notes'))
      }
    })
  })
}
