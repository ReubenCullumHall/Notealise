// The JXA sent to `osascript`. Kept as source strings rather than a .scpt so
// there's nothing to build or ship alongside the bundle.
//
// **Addressed by bundle id, never by name.** Apple's own app is also called
// "Notes" in some contexts, so `Application('Notes')` could resolve
// ambiguously — the bundle id is unambiguous regardless of what either app
// is named.
const APP = `Application('com.apple.Notes')`

/** Folder tree + note counts. Cheap: no bodies, so a big library still answers
 *  fast enough to show a preview before anything is written. */
export const LIST_FOLDERS = `
(() => {
  const N = ${APP}
  const out = []
  for (const acct of N.accounts()) {
    // account.folders() returns EVERY folder in the account, flat — subfolders
    // included — so recursing over that list visits a nested folder twice: once
    // as a child and once as a top-level folder. That duplicated the folder in
    // the vault and imported its notes twice (seen for real, 2026-08-05).
    // Anything that is somebody's child is not a root.
    const all = acct.folders()
    const childIds = {}
    for (const f of all) for (const sub of f.folders()) childIds[sub.id()] = true
    const walk = (folder, path) => {
      const here = path.concat([folder.name()])
      out.push({ path: here, count: folder.notes.name().length })
      for (const sub of folder.folders()) walk(sub, here)
    }
    for (const f of all) if (!childIds[f.id()]) walk(f, [acct.name()])
  }
  return JSON.stringify({ folders: out })
})()
`

/** Every note in ONE folder, fetched with BULK accessors: `notes.name()` returns
 *  the whole array in a single Apple Event, where a per-note loop would be one
 *  round trip each. Measured at ~119ms for a folder this way.
 *
 *  `path` is [accountName, folderName, subfolderName...] and is interpolated as
 *  a JSON literal by the caller, so quotes in a folder name can't break out. */
export function fetchFolder(path: string[]): string {
  return `
(() => {
  const N = ${APP}
  const path = ${JSON.stringify(path)}
  let node = null
  for (const acct of N.accounts()) if (acct.name() === path[0]) node = acct
  if (!node) return JSON.stringify({ notes: [] })
  for (let i = 1; i < path.length; i++) {
    let next = null
    for (const f of node.folders()) if (f.name() === path[i]) next = f
    if (!next) return JSON.stringify({ notes: [] })
    node = next
  }
  const names = node.notes.name()
  const bodies = node.notes.body()
  const locked = node.notes.passwordProtected()
  const created = node.notes.creationDate()
  const modified = node.notes.modificationDate()
  const notes = []
  for (let i = 0; i < names.length; i++) {
    notes.push({
      name: String(names[i] === undefined ? '' : names[i]),
      body: String(bodies[i] === undefined ? '' : bodies[i]),
      locked: locked[i] === true,
      created: created[i] ? String(created[i]) : null,
      modified: modified[i] ? String(modified[i]) : null
    })
  }
  return JSON.stringify({ notes: notes })
})()
`
}
