import type { ImportResult } from "../../shared/notesImport"

/** Keep an imported title or reason to a single line, so an entry cannot forge
 *  the rest of the report.
 *
 *  These strings come out of the archive being imported. A title may legally
 *  contain a newline on macOS, and is entirely free-form in a Google Keep JSON
 *  — so interpolated raw into a bullet, one could close the list and write its
 *  own sections, including a convincing "Nothing was skipped or lossy." This
 *  report is the ONE surface telling the user what did not come across, and
 *  being able to forge it is worth a line to stop. The asterisks are escaped
 *  for the same reason the newlines are collapsed: the entry is data here, not
 *  markup. */
function oneLine(s: string): string {
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/([*_`[\]])/g, '\\$1')
    .trim()
}

/** Renders the skipped/lossy lists as plain markdown — shared by every format
 *  so "what didn't come across cleanly" always reads the same way (rule 9:
 *  surface ambiguity, don't silently resolve it). */
export function buildImportReport(result: Omit<ImportResult, 'reportPath'>): string {
  const lines: string[] = ['# Import Report', '']
  if (result.cancelled) {
    lines.push(
      'You stopped this import early, so this is only part of what was there. The originals are ' +
        'untouched — delete this space and run it again for the whole lot.',
      ''
    )
  }
  lines.push(`${result.createdNotes} note${result.createdNotes === 1 ? '' : 's'} and `
    + `${result.createdFolders} folder${result.createdFolders === 1 ? '' : 's'} created.`, '')


  if (result.skipped.length > 0) {
    lines.push('## Skipped', '')
    for (const s of result.skipped) lines.push(`- **${oneLine(s.title)}** — ${oneLine(s.reason)}`)
    lines.push('')
  }

  if (result.lossy.length > 0) {
    lines.push('## Imported with some loss', '')
    for (const l of result.lossy) lines.push(`- **${oneLine(l.path)}** — ${oneLine(l.note)}`)
    lines.push('')
  }

  if (result.skipped.length === 0 && result.lossy.length === 0) {
    lines.push('Nothing was skipped or lossy.', '')
  }

  return lines.join('\n')
}
