import { createFolder } from '../vault'

/** The single top-level space an import lands in. A vault-root folder IS a
 *  space (see `reconcileSpaces`), so there is nothing else to register.
 *
 *  Thin on purpose: `createFolder` creates with the final name in one `mkdir`
 *  and suffixes " (2)" itself, so the collision retry that used to live here —
 *  create "New folder", rename, catch the throw, try the next suffix — is gone.
 *  That dance is what let the watcher bind "New folder" as a real space
 *  mid-import, and its rename could throw and abort everything. */
export function createImportSpace(spaceName: string): Promise<string> {
  return createFolder('', spaceName)
}
