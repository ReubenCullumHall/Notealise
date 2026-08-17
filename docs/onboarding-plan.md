# First-run onboarding

> ## Status: BUILT (2026-08-17) — and the spec below is no longer what shipped
>
> **The running code is `src/renderer/src/onboarding/` — read that, not the screen-by-screen
> section here, for what the flow actually does.** The spec is kept in full because its
> *reasoning* is still the best record of why each screen exists; four of its rulings were
> deliberately overturned during the build, and it has not been rewritten to match:
>
> | The spec says | What shipped | Why |
> |---|---|---|
> | Five screens | **Eight**: Welcome → Vault → Import → Spaces → Write → Disk proof → Fonts → Walkthrough (Welcome and Walkthrough are orientation-only, the two deliberate exceptions to "every step leaves an artefact") | 2026-08-17 blueprint round with Reuben |
> | **Not skippable** | Import's Continue is live from the moment it mounts | Starting fresh with nothing to import is a normal first run, not a step to force someone through |
> | **No theme picker** (4B.20) — final screen points at Settings | A real **font** picker (the Fonts screen), offering the four bundled faces + App default | Ruling reversed 2026-08-17. Its other half — an accent-colour picker — is **still not built** |
> | "Start writing" ends the flow on Disk proof | Moved to Walkthrough, now the last screen | Disk proof stopped being the end when two screens were added after it |
>
> Also still outstanding from the spec: the **five curated welcome notes** (nothing is seeded yet),
> the **per-format organise popup** (one generic message is used for every import format), and
> **resuming at the exact step** after a quit (relaunch restarts at Welcome; Vault auto-skips if a
> folder was already chosen).

Status of the spec text below: **as written 2026-08-14, superseded in the four rows above.** It is
copied verbatim from
`<vault>/Note taking app/Onboarding/2026-08-14-onboarding-spec.md` (2026-08-16, so a coding
session without that vault mounted still has it) — its own frontmatter says it **supersedes** the
2026-08-08 draft that used to be the whole of this file. Confirmed current by Reuben 2026-08-16.
Implementation notes from that older draft that still hold up follow the spec; anything the two
disagreed on (chip-created spaces, the curated five-note welcome sequence vs. one welcome note) is
settled in the spec's favour — build from the spec, not from memory of the old plan.

---

**The single biggest launch blocker.** Your own words (5.61): *"I can spin a website up but
onboarding I've got no idea about sequences yet."* This is the sequence.

Build it from this document. Every screen, every line of copy, every artefact is specified — you
should be transcribing, not deciding.

## The rules it obeys

| | Ruling | Source |
|---|---|---|
| Five steps, full-screen, **not skippable** | Forces interaction so people get used to the app | 2.7 |
| **Every step leaves a real artefact behind** | Primary job is "leave them set up," not "explain" | this session |
| Ends in a **curated set of notes**, not an empty app | A particular set you curate, showing delete + customise | 4B.51, 4B.52, 4B.43 |
| **Imports get their own space, always** | Plus a post-import organise popup, per source format | 4B.53, 2.30 |
| **No theme picker** — the app already follows their OS | Final screen points at Settings instead | 4B.20, this session |
| Voice is **calm, plain, unhurried**. Product never says "I" | Except the trust beat | 3.91, this session |
| **No exclamation marks. No "we."** | One-person business | 3.90 |
| Looks like the app's default, with the site's restraint | The handshake between the two surfaces | 4B.40, 4B.41 |

**Why it matters more than anything else on the list:** your most-heard objection from people who
already have the app is *"I don't know how to use it"* — and you identified the cause yourself
(3.74): no onboarding, they're just thrown in.

## The shared skeleton

Every one of the five screens uses the same layout. Build this once.

```
┌──────────────────────────────────────────────┐
│  ←                                           │   back arrow, top-left, hidden on step 1
│                                              │
│              [Fraunces, one line]            │   the step's headline
│         [Inter, one short paragraph]         │   never more than two sentences
│                                              │
│        ┌────────────────────────┐            │
│        │                        │            │   the live piece — different per step,
│        │   THE INTERACTION      │            │   same box, same size, every time
│        │                        │            │
│        └────────────────────────┘            │
│                                              │
│                [  Continue  ]                │   disabled until the step is done
│                  ● ● ○ ○ ○                   │   progress dots, bottom-centre
└──────────────────────────────────────────────┘
```

- Centred column, **max 520px** for the text; the interaction box may be wider.
- Background is the app's own paper colour — **not white, not a gradient.** It should feel like the
  app has cleared its desk, not like a different program.
- Transition between steps: horizontal slide, matching the dots' direction. This is the one place
  motion carries meaning. Standard duration (260ms).
- **Nothing in the chrome changes height between steps.** Reserve the space, fill it later.
- Quitting mid-flow is frictionless and resumes where you left off. That's the exit valve for
  someone who hates it — there's no skip button.

## Step 1 — Your notes are files

**Artefact left behind:** the vault folder is chosen and created.

**Headline:** `Everything here is a file on your computer`

**Body:**
> Not a database. Not an account. Pick a folder and that's where your notes live — you can open
> them in anything, and if you delete this app tomorrow they're exactly where you left them.

**Interaction:** a single button — `Choose a folder` — opening the OS folder picker. Once chosen,
the path appears below it in mono, with a quiet `Change` link beside it.

**Copy after a folder is picked:**
> `~/Documents/Notes` — this is yours. Nothing else goes in it.

*(Show their real path, not this example.)*

**Continue is disabled until a folder exists.**

### Notes for building

- This is the one screen where the founder is allowed to be present (3.91) — but keep it in the
  product voice, not yours. No "I built this so that…".
- If the folder they pick already contains `.md` files, say so plainly and continue: *"There are
  already 34 notes in here. They'll show up as they are."*
- If it's inside OneDrive, iCloud or Dropbox, say nothing here — but log it, because
  `renameWithRetry` exists for a reason and Ops #4 is about to test it.

## Step 2 — Bring your notes across

**Artefact left behind:** either an import has run into its own space, or the step is explicitly
declined.

**Headline:** `Already have notes somewhere?`

**Body:**
> Bring them in now, or do it later from Settings. Everything you import lands in its own space so
> it can't get mixed up with anything else.

**Interaction:** the six format buttons you already have registered — Notion, Markdown, HTML, Word,
Google Keep, Apple Notes (macOS only, and it must not appear at all on Windows). Plus a plain text
link underneath: `Skip — I'm starting fresh`.

**During an import:** a determinate progress bar, never a spinner. Local work is fast; the only
slow paths are a large import and a font-pack download, and both are measurable.

**After an import completes:**
> `412 notes brought in. They're in a space called "Notion import."`

**Then the organise popup fires** — the one you asked for (2.30, 4B.53). It differs by source
format:

| Source | What the popup says |
|---|---|
| Notion | "Notion databases came in as folders. You can drag any of them into their own space." |
| Google Keep | "Keep has no folders, so everything came in flat. Labels became tags in the note text." |
| Apple Notes | "Attachments couldn't come across — Apple doesn't allow it. Locked notes were skipped." |
| Word | "Text colour didn't survive the conversion. Everything else did." |
| Markdown / HTML | "Folder structure came across as-is." |

Each popup ends with the same line and one button:
> You can reorganise any of this later — nothing's locked in place.
> `[ Got it ]`

### Notes for building

- **The importer's writes are echo-guarded**, so after a run the renderer must explicitly reload
  the tree and switch to the new space, or the notes are on disk and invisible.
- Skipping is a real answer and must not be made to feel like a mistake. No "Are you sure?".

## Step 3 — What do you take notes for?

**Artefact left behind:** their spaces exist, named and created on disk.

**Headline:** `What do you take notes for?`

**Body:**
> Pick as many as you like. Each one becomes a space — its own section of the app, which you can
> make look and work however you want.

**Interaction:** a grid of selectable chips. Multi-select, minimum one, plus a free-text field for
their own.

```
   School      Work       Journal     Projects
   Ideas       Revision   Personal    Reading
                [ + something else ]
```

Selected chips get the accent border. Below the grid, live-updating:
> `You'll start with three spaces: School, Ideas, Journal.`

**This step runs even if they imported** (your call this session). The imported space and their new
spaces coexist — the copy just acknowledges it:
> Your imported notes already have their own space. These are for everything new.

### Notes for building

- Each chip creates a real folder via the existing `createFolder` IPC — **create with the final
  name, never create-then-rename**, because `syncSpaces` runs on every tree load and would register
  a temporary "New folder" as a real space mid-flow.
- Cap is 10 spaces. If they somehow select more, take the first 10 and say so.
- Sanitised names come back from main — use the path main actually used, not the one you sent.

## Step 4 — Try writing something

**Artefact left behind:** their first real note, saved in their first space.

**Headline:** `Try writing something`

**Body:**
> Type a `#` and a space before a line to make it a heading. Watch what happens to the `#`.

**Interaction:** a **real CodeMirror instance**, not a mockup, not a video. Same extensions as the
app, same live preview, same fonts. Pre-filled with nothing; placeholder text reads
`Start typing…`.

**Continue stays disabled until they've typed at least one character.** The whole feature is the
feeling of it happening to your own typing — a video of live preview is worthless.

**When they type a heading, a quiet line appears below the box:**
> That's Markdown. The app hides the symbols while you're not on that line, so it stays readable.

### Notes for building

- Whatever they type here **is saved as a real note** in their first space, titled from the first
  line. This is the artefact — and it's also what step 5 needs.
- If they type only whitespace, treat it as nothing typed.
- Keep the demo box to a fixed height; it must not grow as they type and shift the button.

## Step 5 — There it is on your disk

**Artefact left behind:** proof. And the file explorer open on their actual note.

**This is the emotional peak of the whole product.** Give it more room than the other four.

**Headline:** `That note is already a file`

**Body:**
> No saving, no exporting, no account. It's sitting in the folder you picked, and it'll open in any
> app that reads text.

**Interaction:** two panes side by side — what they wrote, and the file as text on disk at its real
path.

Below it, one button: `Show me the file` — which calls `shell.showItemInFolder` and opens their
real file explorer with the real `.md` selected. **Showing the OS's own window is the proof. A
mockup isn't.**

**Final line on the screen, above the button that ends onboarding:**
> Nearly everything about how this looks and works can be changed — themes, colours, spacing,
> what's in the toolbar. It's all in Settings when you want it.

**The button says `Start writing`. Not "Finish", not "Done", not "Get started".**

## After onboarding — the curated welcome notes

**They land in the main/first space.** Imports always go to their own space, so these can't clash
(4B.53, MacBook Air copy — the authoritative one).

Five notes and one folder. Each demonstrates something by *being* it, not by describing it:
`Start here.md`, `How this app is organised.md`, `Make it yours.md`, `Things you can delete.md`
(the demo folder's index) and `Things you can delete/This one's safe to bin.md`. Full copy for all
five lives in the source spec (`<vault>/Note taking app/Onboarding/2026-08-14-onboarding-spec.md`)
— transcribe from there rather than redrafting, except for the two pieces Reuben is rewriting
himself (see "Still yours to write" below).

### Notes for building

- **Written in the product voice** — calm, plain, unhurried. No exclamation marks, no "we", no "I".
- The `[[wiki links]]` between them are deliberate: they demonstrate linking by working, and they
  populate the links strip on first open so it isn't empty.
- They must be created with `createNote(dir, name)` at their final names, auto-suffixed on
  collision. Never create-then-rename.
- **They are ordinary notes.** No flag, no special handling, no "welcome note" type. Deleting them
  leaves no trace and breaks nothing.

## Definition of done

- [ ] A fresh install with no vault runs all five steps and cannot be skipped
- [ ] Quitting at step 3 and relaunching resumes at step 3
- [ ] Choosing a folder that already has notes in it works and says so
- [ ] An import lands in its own space and the correct per-format popup fires
- [ ] Skipping the import still produces spaces at step 3
- [ ] Step 4's editor is the real CodeMirror with live preview working
- [ ] Continue is disabled at step 4 until a character is typed
- [ ] The note typed at step 4 exists on disk afterwards
- [ ] `Show me the file` opens the real file explorer with the real file selected
- [ ] The five welcome notes and the demo folder exist in the first space
- [ ] The `[[links]]` between the welcome notes resolve
- [ ] Deleting every welcome note leaves a working, empty app
- [ ] Nothing in the five screens changes height between steps
- [ ] macOS: Apple Notes appears in step 2. Windows: it does not appear at all

## Still yours to write

Two things Reuben drafted and should rewrite in his own words before it ships: **the step 1 trust
beat** (the most important sentence in the product), and **the five welcome notes** (structurally
right, voice close, but a user's first impression of the app's personality is these five files).

## Deliberately not in scope

The cheat sheet referenced in the pre-2026-08-14 plan belongs to the tutorial system (October
half-term), not onboarding. Onboarding gets people set up; the tutorials teach. Don't merge them.

---

## Implementation notes carried over from the 2026-08-08 draft

The spec above is UX/copy, not IPC-level architecture — these notes from the earlier draft fill
that gap and are **not** contradicted by the spec, except where marked.

**New state (`userData/config.json`, via `src/main/config.ts`)**
- `hasOnboarded: boolean`, plus a resume marker (e.g. `onboardingStep: number | null`) for
  "resume at the same step." Same file that already holds vault path + auto-update preference per
  CLAUDE.md rule 2 — extend the same shape, same normalize/default pattern main already uses there.
- **Triggers once ever, at the app level, not per-vault** — `pickVault()` is the same
  function/button whether it's first-run or "Switch folder" later, so the trigger has to be
  "first launch ever," not "vault is currently null," or switching folders later would re-run it.
- **Dev-testing hook wanted**: mirror `dev-app-update.yml` + `NOTES_TEST_UPDATER=1 npm run dev`
  (`src/main/updater.ts`) — an env var or hidden dev-menu item that clears `hasOnboarded`.

**Welcome-note / space seeding (new, main process) — corrected from the old draft**
- The 2026-08-08 draft said "no new space-seeding logic needed" for the spaces step and assumed
  one welcome note. **Both are now wrong per the spec**: step 3's chips create real spaces, and the
  after-onboarding sequence seeds five notes plus a demo folder. This IS new seeding logic.
- **Reuse the existing note/folder-creation path**, not a raw fs write: `createFolder(dir, name)` /
  `createNote(dir, name)` in `main/vault.ts` already create with the final name and auto-suffix
  collisions, and `syncSpaces` runs on every tree load so ad-hoc file writes can get picked up in
  surprising ways. Route every welcome note and the demo folder through whatever "New note"/"New
  folder" already call, not a bespoke `fs.writeFile`.
- Renderer never touches `fs` directly (rule 6) — main-process function exposed through IPC.

**Disk-reveal (new IPC)**
- **Does not exist yet.** `src/main/externalLinks.ts` only guards `shell.openExternal` by URL
  scheme — a different capability. New channel in `shared/channels.ts`, handler in `main/ipc.ts`,
  resolving the path through the same `resolveInVault` boundary check as everything else (rule 6)
  before calling `shell.showItemInFolder`. The renderer sends a vault-relative path, never one it
  constructed itself.

**Import embedding**
- `ImportPanel.tsx` currently assumes it's inside the Settings modal shell. Check its
  props/context assumptions (sizing, close behavior, focus trap) before wiring it into onboarding's
  full-screen chrome — this is new integration work, not reuse-as-is.

**Live-preview demo**
- Decided 2026-08-08: a stripped-down standalone CM6 instance, carrying just the live-preview
  extension, not the full `NotePane` chrome. Accepted trade-off: a second, parallel place the
  live-preview extension gets wired up — it can drift from `NotePane.tsx`'s real usage. When
  touching `livePreview.ts`, check this instance still matches.

**Populated-vault detection**
- Runs off the tree data already fetched when `activateVault` completes — reuse that `TreeNode`
  list rather than adding a second fs walk in main. **Still an open question** (not addressed by
  the spec): does a populated first vault still show the import offramp, and what exactly counts
  as "already has content" — any `.md` anywhere, any existing space, or any non-empty folder at
  all?

**Testing**
- This codebase's test philosophy is pure logic only (`vitest`, no React/Electron harness). Write
  the onboarding step sequence/state machine as a pure function module (e.g.
  `renderer/src/onboarding/model.ts`), independent of React, the same way `tabs/model.ts` holds
  pane/tab arithmetic separately from `NotePane.tsx`. The React shell stays untested per the
  project's existing "no React harness" stance.

**Tutorials entry**
- Add a static Tutorials guide once the interactive flow ships:
  `src/renderer/src/settings/tutorials/index.tsx`'s `Tutorials()` holds a `Guide[]` array; mirror
  `LinkingGuide.tsx`'s structure (plain static JSX) + one new `Guide[]` entry. No new
  modal/routing work. The interactive onboarding itself never replays — this static guide is the
  only way to revisit it.

## Related but deliberately separate

The download-site install-guide page (explaining Windows/Mac unsigned-app security warnings
*before* the app is even installed) is a separate concern by Reuben's explicit call — different
moments (pre-download marketing site vs. post-launch in-app) with different constraints. Don't
merge messaging or design work between the two without asking.
