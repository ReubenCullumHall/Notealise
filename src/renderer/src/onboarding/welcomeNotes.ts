// The curated notes a first run lands on, seeded once by App.tsx's
// finishOnboarding — into whatever space was active at that point (the
// "main" space Spaces created), never the imported one (imports always get
// their own space, so the two can't clash — docs/onboarding-plan.md).
//
// The copy is Reuben's own (2026-08-31 pass, transcribed from his test vault).
// These notes are deliberately warmer than docs/voice.md's UI rules: they are
// the founder speaking, so "I", "us", "our" and a single closing "!" are kept
// on purpose — do not "correct" them to the interface voice. What is load-
// bearing and must not be reflowed: the long blank run in START_HERE between
// the Settings list and "# Our final word". It is the demo — the link
// [[Start here#Our final word]] in "Things you can delete" jumps the reader
// past that gap to the heading, which only reads as a jump if the gap is big.
//
// Routed through createFolder/createNote/writeNote — the same IPC every other
// onboarding artefact uses, never a bespoke fs write. Safe to call only once:
// finishOnboarding is itself a once-ever trigger, and createNote auto-suffixes
// on a name collision rather than overwriting, so even a repeat call (a dev
// replaying onboarding into the same vault) just adds a second set rather than
// clobbering the first.
//
// seedWelcomeNotes writes an explicit sidebar order at the end (demo folder
// first, then Start here, then the rest) — a fresh space is otherwise
// alphabetical and "Start here" would land third.

const START_HERE = `# Start here

Everything in this space right now is a real, ordinary file - this note, the ones linked below, and the one you wrote a moment ago. Delete any of them. Nothing breaks.

You can create a note and a subfolder to house different subtopics at the top of the sidebar.
But for now, let's finish exploring...

Below is what's called a linked note. There's a full guide in Settings → Tutorials; the basics are just below.

- [[How this app is organised]]
- [[Make it yours]]
- [[Things you can delete]]

A few places worth knowing about, whenever you want them - all in Settings:

- **Tutorials** - short guides for what isn't obvious from looking.
- **Report a bug** - tell us what broke.
- **Request a feature** - suggest something the app doesn't do yet.



























# Our final word

Thanks for making it this far.

As you can see from the [[Things you can delete]] note, this redirected you to exactly this heading - just one of many features for you to explore.

Take your time and explore when you're ready.

The main idea of this app was to give you the options if you want them - not confuse you with choice or restrict you with limitations.

I hope you enjoy this app, make it your own, and use it for years to come.

Thank you for being here!

- Reuben Cullum-Hall (founder)`

const HOW_ORGANISED = `# How this app is organised

Notes live in spaces - folders on disk that the sidebar shows as sections of the app. Each one can look and work however you want: its own theme, its own font, its own accent.

Each one has its own purpose.

Drag a note into a different space, or make a new one from the sidebar. Moving something here moves the actual file underneath it.
`

const MAKE_IT_YOURS = `# Make it yours

The font and colour you picked a moment ago aren't fixed - every space can have its own, and there's more choice than what onboarding offered.

Settings → Customisation changes the whole app at once. Settings → Spaces changes just one.

There are lots of features to choose from. Keep it simple and keep with the basics - the app can grow with you, not make you feel like you have to catch up.
`

const THINGS_YOU_CAN_DELETE = `# Things you can delete

A small folder, kept around to prove a point.

You can find it at the top of the page, with one note inside.

To delete it, either select it with the dot grid next to the expand toggle, then hit 'move to bin' at the bottom of the sidebar.

Or you can drag it into the bin with the dot grid as well.

Return to [[Start here#Our final word]] to view our final word to you - before you are unleashed to make this app your own.`

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

  const demoFolder = await window.api.createFolder(spaceFolder, 'Things you can delete')
  const thingsIndex = await window.api.createNote(spaceFolder, 'Things you can delete')
  await window.api.writeNote(thingsIndex, THINGS_YOU_CAN_DELETE)
  const safeToBin = await window.api.createNote(demoFolder, "This one's safe to bin")
  await window.api.writeNote(safeToBin, SAFE_TO_BIN)

  // Fix the sidebar order onboarding wants: the demo folder sits at the very
  // top (its own note tells the reader "you can find it at the top of the
  // page"), then the three linked notes in reading order. A fresh space is
  // otherwise alphabetical - "How this app is organised" would come first and
  // "Start here" third. The note written at the Write step keeps no order of
  // its own, so it settles below everything seeded here.
  await window.api.reorderEntries([demoFolder, startHere, howOrganised, makeItYours, thingsIndex])

  return startHere
}
