import { shell } from 'electron'

// TODO: replace once the support inbox / branding is decided.
const BUG_REPORT_EMAIL = 'PLACEHOLDER-support-email@example.com'

/** Opens the OS default mail app with a bug report addressed to the support
 *  inbox; the reporter's email goes in the body (mailto can't set "From") so
 *  whoever reads it knows where to reply. Returns false if no mail client
 *  could be opened. */
export async function sendBugReport(fromEmail: string, message: string): Promise<boolean> {
  const subject = 'Notes app — bug report'
  const body = `Reply to: ${fromEmail}\n\n${message}`
  const url = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}
