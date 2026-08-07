import { shell } from 'electron'

const BUG_REPORT_EMAIL = 'bugs@notealise.com'
const FEATURE_REQUEST_EMAIL = 'features@notealise.com'

/** Opens the OS default mail app with a bug report addressed to the support
 *  inbox; the reporter's email goes in the body (mailto can't set "From") so
 *  whoever reads it knows where to reply. The subject is fixed to "bug
 *  report" so the user's inbox forwarder can sort on it. Returns false if no
 *  mail client could be opened. */
export async function sendBugReport(fromEmail: string, message: string): Promise<boolean> {
  const subject = 'bug report'
  const body = `Reply to: ${fromEmail}\n\n${message}`
  const url = `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}

/** Same shape as sendBugReport, addressed to the feature-request inbox with a
 *  fixed "feature request" subject. */
export async function sendFeatureRequest(fromEmail: string, message: string): Promise<boolean> {
  const subject = 'feature request'
  const body = `Reply to: ${fromEmail}\n\n${message}`
  const url = `mailto:${FEATURE_REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  try {
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}
