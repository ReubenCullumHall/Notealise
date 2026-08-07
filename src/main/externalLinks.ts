import { shell } from 'electron'

// Opening a link from a note in the user's real browser.
//
// Guarded by SCHEME, not by a host allowlist. It started as a host list because
// its only caller was the importer's "Learn more about exporting from Notion"
// link, but notes contain the user's own citations and a list can't enumerate
// the web. The scheme is the part that actually matters: `shell.openExternal`
// will happily hand `file://` to Finder/Explorer, and other schemes can invoke
// registered local handlers, so a note (or an imported document) could
// otherwise reach further than opening a web page.
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

export async function openAllowedExternal(url: string): Promise<boolean> {
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return false
  }
  if (!ALLOWED_SCHEMES.has(protocol)) return false
  await shell.openExternal(url)
  return true
}
