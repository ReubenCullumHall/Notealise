// Names that ordinary people really give their notes and files, and that broke
// the app in the 2026-10-27 bug scan: an apostrophe cut a video's name short, a
// `#` read as a heading, brackets ended a link early, two spellings of "é" let a
// rename overwrite a note, `%` stopped an import, `$` turned prices into maths.
//
// Use this list in a test for anything new that writes, reads, links to,
// renames or moves a file or a note — `docs/feature-done-checklist.md` step 2.
// Imported by tests only; nothing in the app ships it.
export const AWKWARD_NAMES = [
  "Reuben's holiday",
  'C# basics',
  'Episode #3',
  'photo (1)',
  'report (final) v2',
  'Café', // é written as e + a combining accent (Finder, zips, iCloud)
  'Café', // é as one character (the keyboard)
  '50% done',
  'Prices $5-$10',
  'Q&A – notes',
  'Notes [draft]',
  'emoji 🎉 note',
  'Ünïcödé ñame',
  'dots.in.name',
  '  spaces  around  '
] as const
