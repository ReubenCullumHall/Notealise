// What the editor's saved voice notes and files are called (docs/plans/voice-editor.md).
// Sections are "<name> · Section 2"; split again, a section's own sections are
// "Section 2.1", "2.2" — not "Section 2 · Section 1", which is what editing an
// edit used to give. An edit kept as a new clip is "(edited)" once, not twice.

const SECTION = /^(.*) · Section (\d+(?:\.\d+)*)$/
const SECTION_FILE = /^(.*) section (\d+(?:\.\d+)*)$/
const EDITED = / \(edited\)$/

/** The voice note's name for section `k`. */
export function sectionName(name: string, k: number): string {
  const m = SECTION.exec(name)
  if (m) return `${m[1]} · Section ${m[2]}.${k}`
  const only = /^Section (\d+(?:\.\d+)*)$/.exec(name)
  if (only) return `Section ${only[1]}.${k}`
  return name ? `${name} · Section ${k}` : `Section ${k}`
}

/** The name of an edit kept beside the original ('' stays ''). */
export function editedName(name: string): string {
  return name ? `${name.replace(EDITED, '')} (edited)` : ''
}

/** The file name (no extension) a saved clip starts from: the original's,
 *  marked once — the app adds a number if it's taken. */
export function editedStem(originalStem: string, section: number | null): string {
  if (section === null) return `${originalStem.replace(EDITED, '')} (edited)`
  const m = SECTION_FILE.exec(originalStem)
  return m ? `${m[1]} section ${m[2]}.${section}` : `${originalStem} section ${section}`
}
