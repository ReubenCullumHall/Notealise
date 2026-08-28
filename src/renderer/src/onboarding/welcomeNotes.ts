// The curated notes a first run lands on, seeded once by App.tsx's
// finishOnboarding — into whatever space was active at that point (the
// "main" space Spaces created), never the imported one (imports always get
// their own space, so the two can't clash — docs/onboarding-plan.md).
//
// Placeholder copy throughout: structurally what the plan calls for, but the
// actual wording is Reuben's to rewrite (the plan's "Still yours to write"
// section) — this file makes the SEQUENCE and the [[links]] between the notes
// real, same "build the mechanism now, content later" split as the import
// step's organise note.
//
// Routed through createFolder/createNote/writeNote — the same IPC every other
// onboarding artefact uses, never a bespoke fs write. Safe to call only once:
// finishOnboarding is itself a once-ever trigger, and createNote auto-suffixes
// on a name collision rather than overwriting, so even a repeat call (a dev
// replaying onboarding into the same vault) just adds a second set rather than
// clobbering the first.

const START_HERE = `# Start here

Everything in this space right now is a real, ordinary file — this note, the two linked below, and the one you wrote a moment ago. Delete any of them. Nothing breaks.

- [[How this app is organised]]
- [[Make it yours]]
- [[Things you can delete]]
- [[Used Notealise before?]]

A few places worth knowing about, whenever you want them — all in Settings:

- **Tutorials** — short guides for what isn't obvious from looking.
- **Report a bug** — tell us what broke.
- **Request a feature** — suggest something the app doesn't do yet.
`

const HOW_ORGANISED = `# How this app is organised

Notes live in spaces — folders on disk that the sidebar shows as sections of the app. Each one can look and work however you want: its own theme, its own font, its own accent.

Drag a note into a different space, or make a new one from the sidebar. Moving something here moves the actual file underneath it.
`

const MAKE_IT_YOURS = `# Make it yours

The font and colour you picked a moment ago aren't fixed — every space can have its own, and there's more choice than what onboarding offered.

Settings → Customisation changes the whole app at once. Settings → Spaces changes just one.
`

const USED_BEFORE = `# Used Notealise before?

If you've run Notealise on another computer — or on this one before a reinstall — most of your setup is already here. Theme, colours, fonts, spaces and arranging all live inside your notes folder, so they came across with it.

A few things don't travel with the folder: your saved space presets, any fonts you added from a file, and the update channel. Those live with the app on each computer.

To bring them over, open the other computer's copy, go to Settings → Transfer data, and save a transfer file. Move it here however you like, then open it from the same page. This works between Mac and Windows in both directions.

Nothing you already have is overwritten — presets and fonts are added alongside.
`

const THINGS_YOU_CAN_DELETE = `# Things you can delete

A small folder, kept around to prove a point.

- [[Things you can delete/This one's safe to bin]]
`

const SAFE_TO_BIN = `# This one's safe to bin

Right-click this note, or the folder it's in, and delete it. Nothing else in the app depends on it.
`

/** Seeds the curated welcome notes + demo folder into `spaceFolder`, and returns
 *  the path of "Start here" — the one App.tsx opens the workspace on. */
export async function seedWelcomeNotes(spaceFolder: string): Promise<string> {
  const startHere = await window.api.createNote(spaceFolder, 'Start here')
  await window.api.writeNote(startHere, START_HERE)

  const howOrganised = await window.api.createNote(spaceFolder, 'How this app is organised')
  await window.api.writeNote(howOrganised, HOW_ORGANISED)

  const makeItYours = await window.api.createNote(spaceFolder, 'Make it yours')
  await window.api.writeNote(makeItYours, MAKE_IT_YOURS)

  const usedBefore = await window.api.createNote(spaceFolder, 'Used Notealise before?')
  await window.api.writeNote(usedBefore, USED_BEFORE)

  const demoFolder = await window.api.createFolder(spaceFolder, 'Things you can delete')
  const thingsIndex = await window.api.createNote(spaceFolder, 'Things you can delete')
  await window.api.writeNote(thingsIndex, THINGS_YOU_CAN_DELETE)
  const safeToBin = await window.api.createNote(demoFolder, "This one's safe to bin")
  await window.api.writeNote(safeToBin, SAFE_TO_BIN)

  return startHere
}
