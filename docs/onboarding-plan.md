# First-run onboarding — implementation plan

Status: **planned, not built.** Decided in a planning conversation with Reuben on 2026-08-08.
Target: next release. This doc is the single source of truth for that plan — read it in full
before writing any onboarding code, and update it if a decision changes rather than letting the
code and this doc drift apart.

## 1. Why this exists

Read `notes-app/CLAUDE.md` and `notes-app/PROJECT-CONTEXT-BRIEF.md` first if you haven't. Short
version: this is a local-first Electron Markdown editor whose whole pitch is "the ownership of
plain files, with the polish of a modern editor" — live-preview syntax hiding, no account, no
cloud, notes as real `.md` files. None of that is discoverable today. First launch is one bare
screen (`src/renderer/src/App.tsx:1416-1425`):

```tsx
if (!vault) {
  return (
    <div className="center picker">
      <h1>Notes</h1>
      <p className="muted">Choose a folder to use as your vault. Your notes stay as plain .md files inside it.</p>
      <button className="primary" onClick={() => void pick()}>Choose folder…</button>
    </div>
  )
}
```

A heading, one sentence, one button — a file dialog with a caption, not an onboarding flow. This
plan replaces it with a real first-run sequence that actually shows the product's differentiators
instead of asserting them.

## 2. How the current first-run path actually works (verified in code)

- `vault` state is seeded from `window.api.getVault()` in the boot `useEffect`
  (`App.tsx:787-791`). If a vault path is already saved, the app opens straight into it — this
  bare screen (and therefore the new onboarding) only ever shows on a genuinely first-ever launch,
  or after "no vault saved."
- `pick()` (`App.tsx:1012-1045`) calls `window.api.pickVault()` → main's
  `dialog.showOpenDialog` (`src/main/ipc.ts:106-115`).
- On a successful pick, main (`src/main/ipc.ts:95`) runs, in order: `saveVault(root)` →
  `activateVault(root)` → `void ensureMdnotes(root)`.
- `ensureMdnotes` (`src/main/mdnotes.ts:13-23`) **only** does `fs.mkdir('<vault>/.mdnotes')` (+
  sets the Windows hidden attribute). **No note file, no README, no seeded content of any kind is
  ever written into a fresh vault today** — confirmed by grep across `main/vault.ts`,
  `main/ipc.ts`, `main/settings.ts`, `App.tsx` for `welcome`/`seed`/`starter`/`getting started`:
  no matches. A brand-new vault opens to a genuinely empty sidebar.
- `pickVault` is the same function/button whether it's the first-run screen or "Switch folder" in
  Settings → Source folder later in a live session — there is no separate "no vault" state,
  it's one code path reused. **This matters for scoping**: the trigger for onboarding must be
  "first launch ever," not "vault is currently null," or switching folders later would re-run it.

## 3. Locked decisions

These came out of ~20 explicit questions put to Reuben across several rounds. Treat as settled —
if you think one should change, say so and get confirmation rather than quietly reinterpreting it.

**Shape of the sequence**
- Full sequence, five steps: **trust beat → import offramp → live-preview demo → disk-reveal →
  spaces explanation.**
- **Not skippable.** No skip button anywhere.
- **Full-screen takeover** — not an overlay on the real app UI, not a separate OS window.
- **Progress dots + a back button**, shown throughout.
- **Back is view-only.** It re-shows a prior step's screen but never re-runs or reverses a real
  action — going back to the import-offramp step after an import already ran just re-displays it
  in its "already imported" state; it does not re-trigger or undo the import.

**Triggering and persistence**
- **Triggers once ever, at the app level**, not per-vault. The flag (`hasOnboarded`, plus
  whatever's needed to resume mid-step) belongs in **`userData/config.json`** (main's
  `src/main/config.ts`) — the same file that already holds the vault path and the auto-update
  preference, which CLAUDE.md rule 2 carves out specifically as "properties of *this install*"
  rather than of a vault. It must **not** go in `<vault>/.mdnotes/settings.json` (`AppSettings`),
  which is per-vault and already has no such flag (confirmed: full read of
  `src/shared/settings.ts:190-260`, the `AppSettings` interface and `DEFAULT_SETTINGS` — nothing
  in `startup`/`session` answers "has this vault seen onboarding," and per-vault would be wrong
  anyway since the decision is app-level).
- **Resumes at the same step** if the app closes mid-onboarding, including a bare quit —
  **quitting mid-flow is frictionless, no confirmation dialog.** Cmd+Q / closing the window
  partway through is just another way to pause.
- **Dev-testing hook wanted**: an easy way to re-trigger onboarding without manually deleting
  `userData/config.json` every test pass. Mirror the existing pattern: `dev-app-update.yml` +
  `NOTES_TEST_UPDATER=1 npm run dev` (see `src/main/updater.ts`, `AppUpdater.js:278`) already does
  exactly this shape of thing for update testing — an env var or hidden dev-menu item that clears
  `hasOnboarded`.

**The import offramp (step 2)**
- Explicit screen: "Already have notes elsewhere?" Sits **second**, right after the trust beat,
  **before any seeded demo content is created** — no point seeding a welcome note for someone
  about to import 400 real ones.
- **Yes** → embed the real `ImportPanel` directly inside onboarding's own chrome. Run the import,
  then **resume onboarding adapted to the real imported content** — the remaining steps
  (live-preview demo, disk-reveal, spaces) should reference the user's actual imported note/space,
  not generic seeded content.
- **No** → seed an ordinary welcome note (fully editable/deletable, not pinned or protected — it's
  just a real note like any other) and continue with the generic demo content.
- `ImportPanel` (`src/renderer/src/import/ImportPanel.tsx`) today is only ever reached two ways:
  Settings modal nav (`Settings.tsx:352-353`, nav item at `Settings.tsx:71`), or **File → Import
  notes…** (`main/menu.ts:64` → IPC `'import-notes'` → `Sidebar.tsx:643-651` sets
  `settingsJumpTo('import')`, which pre-jumps the Settings modal straight to that section,
  bypassing the gear — see the comment at `Sidebar.tsx:50`). **Neither path is "standalone" —
  embedding it inside onboarding's full-screen chrome instead of the Settings modal is new
  integration work**, not a reuse-as-is. Check what, if anything, `ImportPanel` assumes about
  being inside that modal shell (sizing, close behavior, focus trap) before reusing it directly.

**Populated-vault detection**
- If the very first folder picked already contains real content, **shorten the sequence** — skip
  the seeded-welcome-note steps rather than dropping demo content into someone's real vault.
- **Build this efficiently**: don't add a second directory walk. The tree is already listed on
  vault activation (`activateVault` → whatever populates the initial `TreeNode` list the sidebar
  renders) — reuse that result to decide "empty or not" rather than writing new fs-scanning code
  in main.
- **Open, not decided**: does the shortened path still show the import offramp? (They already
  have notes in *this* vault, but might still want to pull in more from elsewhere.)
- **Open, not decided**: the exact "already has content" heuristic — any `.md` file anywhere in
  the tree vs. any existing space vs. "folder isn't empty at all" (could hold non-note files).

**Live-preview demo (step 3)**
- **This is THE showcase moment of the whole sequence** — it should get the most design attention
  and the most polish passes; if anything has to be cut under time pressure, cut elsewhere first.
- Must be **interactive**, not a static screenshot or a scripted/faked animation: the user should
  actually type or click and watch Markdown syntax hide/reveal live, per the real engine described
  in `docs/decorations.md` (CM6 `ViewPlugin`, syntax-tree-driven, hidden marks as `atomicRanges`).
- **New technical question, not previously raised**: does this step embed the app's real editor
  chrome (`renderer/src/editor/`, as used by `NotePane.tsx` — full format bar, command registry
  per `docs/commands.md`), or a **stripped-down standalone CM6 instance** carrying just the
  live-preview extension, with no tabs/panes/format-bar chrome around it? A full `NotePane` is the
  most "authentic" (zero drift risk from the real editor), but brings UI (tabs strip, split
  controls) that makes no sense in a single-note onboarding step. A minimal instance is more
  purpose-built but is a second, parallel place the live-preview extension gets wired up, which
  can drift from the real one. Needs a decision before building this step — flagged here rather
  than assumed.

**Disk-reveal (step 4)**
- **Real side effect** — a button that actually opens the OS file window (Finder/Explorer) on the
  welcome note, not descriptive text. Proves the "just a file" claim rather than stating it.
- **This IPC does not exist yet.** Checked `src/main/externalLinks.ts`: it only guards
  `shell.openExternal` by URL **scheme** (http/https/mailto) — a different capability
  (opening a link in the default browser/mail client, not revealing a file in the OS file
  manager). A new `shell.showItemInFolder`-based IPC channel is required.
- **Security note, not a suggestion — apply the existing pattern**: every other fs-adjacent IPC in
  this app resolves paths through the vault-root boundary check in `src/main/vault.ts`
  (`toRel`/`resolveInVault`; `rel = path.relative(root, abs); reject if rel.startsWith('..') ||
  path.isAbsolute(rel)` — see CLAUDE.md's Cross-platform rules and rule 6, "the vault root is a
  hard security boundary"). The renderer must send a **vault-relative path**, never an absolute
  one it constructed itself; main resolves it inside the boundary before calling
  `shell.showItemInFolder`. This keeps the new IPC consistent with the one fs-boundary rule
  everything else in the app already follows — don't add a second, looser path-handling
  convention just for this one button.

**Spaces explanation (step 5)**
- The app already **auto-creates one real folder-backed space** for any vault
  (`reconcileSpaces`/`syncSpaces`, see notes-app/CLAUDE.md's "Spaces" section — this runs on every
  tree load and guarantees at least one bound space). This step is **explanation only** — point at
  the space that already exists, explain "a space is just a top-level folder." **No new
  space-seeding logic needed.**

**Ending**
- **One quiet closing line, then straight into the app.** No separate "you're all set!" screen, no
  celebratory animation — matches the app's no-fanfare, no-telemetry positioning.
- On completion: mark `hasOnboarded: true` in `userData/config.json`, dismiss the takeover.

**Copy and tone**
- Baseline: **spare, plain-spoken**, matching the existing picker sentence
  ("Choose a folder to use as your vault. Your notes stay as plain .md files inside it.") — no
  forced enthusiasm, no onboarding-voice pivot from the rest of the app.
- **Exception, deliberate**: the trust-beat step (step 1) should **state the privacy positioning
  explicitly, once** — "no account, no cloud, no telemetry" or equivalent plain phrasing. This is
  the one moment spelling it out beats understatement, since it's the actual moment someone
  decides whether to trust the app with their files. (This is the app's real positioning per
  `PROJECT-CONTEXT-BRIEF.md` section 7 — "no account, no cloud, no telemetry surface" is listed as
  a structural differentiator versus Notion/Evernote.)
- **Room for exactly one signature/personality touch**, not a general tone shift across every
  step. Candidates floated (pick one, don't scatter it):
  - A specific, memorable line at the exact instant the Markdown syntax hides during the
    live-preview demo (pairs with that step already being the showcase moment).
  - A distinctive one-liner on the disk-reveal button/caption, since that step is already about
    proving a claim rather than explaining a feature.
- ⚠️ **Flagged tension, not resolved — do not silently pick a side.** Two separate answers in the
  planning conversation gave conflicting style references: "spare, plain-spoken, matches the
  picker's one-sentence style" **and**, in a later round, "narrative/guided, Notion/Craft-style"
  (more "here's why this matters" framing between steps). These pull in different directions —
  narrative framing generally means *more* words and more explicit "why" per step, while the
  spare-tone decision was chosen specifically to match the app's existing no-nonsense voice. A
  reasonable synthesis — spare sentences, with a couple of steps (the trust beat, the live-preview
  demo) earning one extra sentence of *why* it matters, rather than a wholesale narrative rewrite —
  is a **proposal**, not a decision. Get this confirmed before final copy is written; don't average
  the two silently.

**No new dependencies.** Build all transitions with existing Tailwind/CSS, consistent with how the
rest of the app already animates (theme system, tab strip) with no animation library. This
project's rule is "ask before adding any dependency beyond the stack list" — don't reach for one
here without asking first.

**Add a static Tutorials entry too**, once the interactive flow ships — a new `Guide` card in
`src/renderer/src/settings/tutorials/index.tsx` covering the same explanation, for anyone who
wants to re-read it later. See section 5 below for exactly how that file works. The interactive
full-screen onboarding itself **never replays** — this static guide is the only way to revisit it.

## 4. Sequence, step by step (consolidated)

1. **Trust beat.** Replaces the bare picker screen. Same "choose a folder, plain `.md` files, no
   account" idea as today's one sentence, but framed as an onboarding beat with the privacy
   positioning stated explicitly, ending in the same "Choose folder…" action that calls the
   existing `pick()` → `pickVault()` path (no changes needed to the picker mechanism itself).
2. **Detect empty vs. populated** (using the tree already fetched on activation, not a new walk).
   - Populated → shortened path (open question: does it still show the offramp?).
   - Empty → step 3.
3. **Import offramp.** "Already have notes elsewhere?"
   - Yes → embed `ImportPanel` in onboarding's own chrome, run the import, adapt remaining steps
     to the real imported space/note.
   - No → seed the welcome note (via the existing `createNote`-style path in `main/vault.ts`, see
     section 5 — not a raw `fs.writeFile`), continue.
4. **Live-preview demo.** Interactive, on the real note (seeded or imported) — the showcase step.
5. **Disk-reveal.** Real OS file-manager window opens on the note, via the new boundary-checked
   IPC.
6. **Spaces explanation.** Points at the already-auto-created default space.
7. **Done.** One closing line, mark `hasOnboarded`, dismiss into the normal app.

## 5. Where things live — concrete architecture notes

**New state (`userData/config.json`, via `src/main/config.ts`)**
- `hasOnboarded: boolean`
- A resume marker (e.g. `onboardingStep: number | null`) for the "resume at the same step" rule.
- This file already holds vault path + auto-update preference per rule 2 — extend the same shape,
  same normalize/default pattern main already uses there.

**Welcome-note seeding (new, main process)**
- `main/mdnotes.ts`'s `ensureMdnotes` (`:13-23`) currently only makes the `.mdnotes/` folder — this
  is new code, not a tweak to existing seeding (there isn't any).
- **Reuse the existing note-creation path**, not a raw fs write: the "Importing notes" section of
  CLAUDE.md explicitly warns "never create-then-rename in the vault" and documents that
  `createFolder(dir, name)` / `createNote(dir, name)` in `main/vault.ts` already create with the
  final name and auto-suffix collisions correctly, and that `syncSpaces` runs on every tree load so
  ad-hoc file writes can get picked up in surprising ways. Route the welcome note through whatever
  the "New note" context-menu action already calls, not a bespoke `fs.writeFile`.
- Renderer never touches `fs` directly (rule 6) — this has to be a main-process function exposed
  through IPC → preload, like every other vault operation.

**Disk-reveal (new IPC)**
- New channel in `src/shared/channels.ts`, handler in `main/ipc.ts` (or a new `main/reveal.ts` /
  folded into `main/vault.ts`), calling `shell.showItemInFolder` on a path resolved through the
  same `resolveInVault` boundary check as everything else (see security note in section 3).
- Exposed to the renderer via `preload/index.ts`'s `contextBridge` → typed on `window.api`
  (`VaultApi` in `src/shared/types.ts`) and `preload/index.d.ts`.

**Import embedding**
- `ImportPanel.tsx` needs to be renderable outside the Settings modal shell it currently assumes.
  Check its props/context assumptions (does it read anything from Settings' own state/layout?)
  before wiring it into the onboarding takeover.

**Populated-vault detection**
- Runs off the tree data already fetched when `activateVault` completes — check what shape that
  data already takes (the same `TreeNode` list the sidebar consumes) rather than adding a second
  fs walk in main.

**Tutorials entry**
- `src/renderer/src/settings/tutorials/index.tsx`: `Tutorials()` holds a `Guide[]` array
  (`{id, title, blurb, icon, body}`) and local `useState<string | null>(openId)` — no router, no
  separate modal. List view (default) renders cards; clicking one sets `openId` and renders that
  guide's `body` component with a "← All tutorials" back button that clears `openId`. Currently one
  entry (`linking` → `LinkingGuide.tsx`) plus a "More on the way" placeholder card. **Adding the
  onboarding-recap guide is: one new body component (mirror `LinkingGuide.tsx`'s structure — plain
  static JSX) + one new entry in the `Guide[]` array.** No new modal/portal/routing work.

**Testing — fits the project's existing pattern**
- This codebase's test philosophy (see notes-app/CLAUDE.md's "Commands" section) is **pure logic
  only**, via `vitest`, no React/Electron harness — e.g. `tabs/model.ts`, `organise/model.ts`,
  `shared/settings.ts` are all plain-function modules with `*.test.ts` beside them, and the UI
  layer is a thin wrapper over them.
- **Follow that shape here**: write the onboarding step sequence/state machine (which step comes
  next given "populated vault" / "did they import" / "back pressed", what `hasOnboarded` should
  become) as a **pure function module** (e.g. `renderer/src/onboarding/model.ts`), independent of
  React, the same way `tabs/model.ts` holds pane/tab arithmetic separately from `NotePane.tsx`.
  That gets you a real, fast, meaningful test suite for the branching logic (populated vs. empty,
  import-taken vs. not, resume-from-step-N) without needing a DOM harness this project doesn't have
  yet. The React shell (full-screen takeover, progress dots, transitions) stays untested per the
  project's existing "no React harness" stance — same division of labor as everywhere else in the
  app.

## 6. Open questions — resolve while building, don't silently pick one

1. **Does the shortened "populated vault" path still show the import offramp?**
2. **Exact "already has content" detection heuristic** — any `.md` anywhere / any existing space /
   any non-empty folder at all.
3. **Live-preview demo: full `NotePane` chrome vs. a minimal standalone CM6 instance?** (New
   question, section 3 above — not raised in the original planning conversation.)
4. **Copy tone: spare vs. narrative/guided — flagged conflict, needs a real decision** (section 3).
5. **Actual step copy** — none drafted yet; only tone constraints are settled.
6. **What happens if the app closes mid-*import*, specifically** — not just mid-onboarding in
   general. Resume-at-step covers the onboarding sequence itself, but a half-finished import
   landing back on the offramp screen with a partially-populated vault hasn't been discussed.

## 7. Suggested build order

1. `userData/config.json` schema + IPC for onboarding state (`hasOnboarded`, resume step).
2. Onboarding step model as a pure function module (`renderer/src/onboarding/model.ts`) + its
   `*.test.ts` — settle the state machine and the two open branching questions (1 and 2 above)
   here, in tests, before touching any UI.
3. Populated-vs-empty vault detection, reusing the existing post-activation tree data.
4. Full-screen shell: step router wired to the model, progress dots, back button (view-only),
   no-skip enforcement.
5. Trust beat step (privacy copy) + import offramp step (decide and build the `ImportPanel`
   embedding).
6. Welcome-note seeding (via `main/vault.ts`'s existing `createNote` path) + the live-preview demo
   step (resolve open question 3 first).
7. Disk-reveal IPC (boundary-checked) + step.
8. Spaces-explanation step.
9. Closing line + wire completion into normal app boot.
10. Dev-only reset hook (mirroring `NOTES_TEST_UPDATER`).
11. Tutorials guide entry (`settings/tutorials/index.tsx`) — can trail behind the rest, once copy
    is settled.

## 8. Related but deliberately separate

The download-site install-guide page (a different first-run touchpoint — explaining Windows/Mac
unsigned-app security warnings *before* the app is even installed) is a **separate concern by
Reuben's explicit call**, made in the same planning conversation. Don't merge messaging or design
work between the two without asking — they're different moments (pre-download marketing site vs.
post-launch in-app) with different constraints.
