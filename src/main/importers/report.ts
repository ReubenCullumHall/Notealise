import type { ImportResult } from '../../shared/notesImport'

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
    for (const s of result.skipped) lines.push(`- **${s.title}** — ${s.reason}`)
    lines.push('')
  }

  if (result.lossy.length > 0) {
    lines.push('## Imported with some loss', '')
    for (const l of result.lossy) lines.push(`- **${l.path}** — ${l.note}`)
    lines.push('')
  }

  if (result.skipped.length === 0 && result.lossy.length === 0) {
    lines.push('Nothing was skipped or lossy.', '')
  }

  return lines.join('\n')
}
