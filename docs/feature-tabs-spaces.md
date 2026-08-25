# Tabs, panes, and Spaces

How the tab strip / split panes and the Spaces hierarchy are built, and the decisions behind the
gestures. Read this before changing either — both have been rebuilt once already after a gesture
or a hierarchy choice turned out wrong in practice.

## Tabs and split panes (built 2026-07-31)

Several notes are open at once: a strip of tabs across the top of the editor area, and **1–3 panes
side by side** below it. Drag a tab onto a pane's left/right edge to split, onto its middle to
replace what that pane shows.

**The gestures, and why they are what they are** (revised 2026-07-31 after first use):
- **A plain sidebar click replaces what's open** (`replaceActive`), exactly as it did before tabs
  existed. Tabs do not accumulate behind your back, and **the strip only appears at the second
  tab** — one open note is not a set of tabs, and a permanent one-tab strip would just repeat the
  title already in the pane header.
- **Cmd/Ctrl+click opens a note in another tab.** That gesture used to add a row to the sidebar
  *selection*. It no longer clears the selection either — see the mode below.
- **Selecting (for drag, archive, bin) is a MODE, entered by the six-dot grip** (revised
  2026-08-03). The grip click is the only one that has to hit the dots: **once anything is
  selected, a plain click anywhere on any row toggles that row in or out of the set** — rows and
  folders alike. Before this, every subsequent pick meant hitting a 16px target, which is the
  friction that made multi-select not worth reaching for.
  Two things fall out of it and both are deliberate:
  - **The folder chevron still expands** (it stops propagation) — you frequently have to open a
    folder to reach the subnotes you are selecting. The folder's *name* selects, like the rest of
    the row.
  - **The mode ends on Escape or the Clear button only.** Clicking the sidebar background does
    NOT clear any more: in this mode a click on a row selects, so the background is one slip away
    from every row, and losing a set built over a dozen clicks to a near-miss is the exact failure
    this mode exists to remove. Completing an action (a drag-move, bin, archive) still ends it —
    finishing the job is not the same as backing out of it.
  The selection bar (`Sidebar.tsx`) therefore appears at **one** item, not two: it is what tells you
  the sidebar has changed mode, and it carries the only exit besides Escape.
`tabs/model.ts` holds all of it as pure functions over `{ tabs, panes, focus }` and enforces two
invariants the UI leans on: every pane shows an open tab, and **no note is in two panes at once**
— one file must never have two CodeMirrors and two autosave buffers. Everything else follows from
that (cycling skips notes already on screen; dropping a visible tab onto another pane *moves* it
and collapses the pane it left; `MAX_PANES = 3`).
**The chrome is two fixed rows, and they never appear or disappear** (2026-07-31, by the user's
call): the tab strip — shown even with one tab, or none, held open by an invisible tab so an empty
strip is exactly as tall as a full one — and below it ONE row per pane carrying the note's name,
the format commands and, at the right, the word count and the **split button**. Splitting is a
control now, not only `Cmd/Ctrl+\` and the drag (**all three work** — dragging a tab to an edge
puts *that* note in a new column; the button and the shortcut open an empty one and ask). With nothing open, App renders the same
row shell inert (`ROW_CLASS`, shared with `NotePane` precisely so the two can't drift in height).
The rule to keep: **nothing in the editor chrome may be conditional on state in a way that changes
its height** — reserve the space, fill it later. That is why the focused-pane accent line is a
transparent `border-t-2` in every state, and why the row's layout flips which element is elastic
instead of dropping one: wide, the title grows and the commands centre; narrow, the title is fixed
at 5.5rem and the commands take the rest and scroll (`compact`). What a narrow column *does* drop
is anything that can't act: empty "?" slots, the word count, and a split button with no second
note to split to.

**Two ways to rearrange, and they are different things.** Dragging a **tab** out of the strip
opens/moves a note (edge = split, middle = replace). Dragging a **column by its own row** only
rearranges what is already on screen: onto an edge it moves there (`movePane`), onto the middle of
another column the two swap (`swapPanes`) — nothing opens, nothing closes, the strip doesn't
change. `Drag` (kind `'tab' | 'pane'`) is what tells the drop handler which of the two it is; the
row guards its `dragStart` against the title input and the buttons so a drag that starts there
stays theirs.

**The blank column, and why "+" and split are the same thing.** `BLANK` is the empty path, and a
blank tab is genuinely just a tab whose path is `''` — it closes, drags, takes the focused pane and
is *replaced in place* by the next note you click, all through the same functions as any other tab,
with no parallel "pending" state to keep in step. **"+" opens one in the focused column**
(`openTab`, so the note that was there stays as a tab); **the split button and `Cmd/Ctrl+\` open
one in a NEW column** (`splitBlank`). Either way it says "Select a note", and any sidebar row, any
tab, a new note, `Ctrl+Tab` — every route that opens a note — fills it, because they all end in
`openTab`/`replaceActive` and the blank is what those replace.

Three rules make it behave, and each was a bug first:
- **Invariant 3** (`tidy`): a blank exists only while a pane shows it. Cycling or jumping away from
  an unfilled blank leaves no orphan placeholder in the strip.
- **A blank's column collapses when the blank goes** — it does NOT take the next open tab the way a
  real note's pane does (`closeTab`). Backfilling would drop a note you didn't ask for into a space
  you opened for one you did. The exception is the last pane, where collapsing would leave the
  strip pointing at an empty screen.
- **`replaceActive`**: pick a note that is *already on screen* and focus moves to that column while
  the blank closes — it was a standing request, and the request has been answered.

It never survives a quit (`normalizeSession` drops empty strings), only one can exist at a time
(invariant 2 gives that free), and `loadDoc`/`dropDoc` skip it; nothing else in App knows it exists.

**There is no Edit/Read toggle** — removed 2026-07-31. Live preview already renders as you type and
reveals the source on the line the cursor is on, so a reading *mode* was a second way to look at
the same thing. `reader/ReadingView.tsx` (marked + dompurify) is therefore **unimported**: left in
place, not deleted, because it is the app's only sanitised-HTML path and deleting it would also
strand `marked`/`dompurify` — say so before removing either. Nothing imports it, so it is not in
the bundle.

**The layout survives a quit.** `AppSettings.session` (`{ tabs, panes, focus }`, in
`.mdnotes/settings.json`) is written 400ms after any layout change and put back at boot — and on
"Switch folder" too, so each vault reopens its own tabs. **`session` replaced `lastNotePath`**,
which a pre-tabs settings.json is migrated from *inside `normalizeSettings`* (a remembered note is
a one-tab session), the same one-code-path rule the Spaces migration follows. Validation is split
deliberately: `shared/settings.ts` checks the **shape** (strings, an integer), and
`restoreLayout` checks the **meaning** against the tree — dropping notes renamed or binned since,
de-duplicating, capping panes — because only the renderer can see whether a path still exists.
Two things follow from that: an empty session must boot to the blank screen, and the persist
effect must not run until the restore has (`sessionReady`), or the first render would overwrite
the session it is restoring.
`startup` still governs it, and its default is now **`'last'`** ("Reopen your tabs"): with tabs,
"start empty" throws away an arrangement rather than one note.
Each pane owns its own title, format bar and CodeMirror (`NotePane.tsx`);
App owns the documents (`docsRef` keyed by path) and one autosave map keyed by path. **Every
layout change goes through `applyLayout`** — that is where a note that just left the strip gets
its unsaved buffer written and its loaded copy dropped, so "which notes are loaded" can't drift
from "which notes are open"; it also keeps `layoutRef` correct for the handler that runs next,
before React has re-rendered. **The
keyboard is the renderer's**, not the menu's — `Ctrl+Tab` cycles (Cmd+Tab is the macOS app
switcher), `Cmd/Ctrl+1…9` jumps, `Cmd/Ctrl+\` opens an empty column, `Cmd/Ctrl+W` closes a tab. That last one
cost a change in `main/menu.ts`: a menu accelerator is consumed before the renderer sees the key,
so macOS's stock Cmd+W ("Close Window", in both File and the Window menu) had to move to
Shift+Cmd+W. If a tab shortcut ever stops firing, suspect a menu item took the key.

**In-app updates (built).** Windows installs update themselves: a new version downloads quietly,
a strip appears above "Switch folder", and it applies on quit. Settings → Updates has the version,
an auto-update toggle, and a manual check; there's also File → Check for Updates…. See
`docs/release-checklist.md` for the release ritual and the macOS caveat.

## Spaces (rebuilt 2026-07-29) — read this before "removing Spaces" again

Spaces are **the layer of the hierarchy between the vault and the sidebar**:

```
<vault>/          the folder picked at onboarding
  Revision/       a SPACE — a top-level folder
    Physics/      an ordinary folder, a row in the sidebar
      waves.md
  Journal/        another space
```

**The folders on disk ARE the spaces** (CLAUDE.md rule 1). `settings.json` only decorates them —
emoji, theme, accent, density, arranging, the four format-bar buttons — so a maths-revision space
can carry the formula shortcut while a journal space doesn't. Make a folder in Explorer and it
becomes a space; delete one there and it stops being one (`reconcileSpaces`, run on every tree
load). Switching space re-scopes the sidebar to that folder's subtree, and **new notes and folders
land inside the active space, not at the vault root** (`inSpace()` in `App.tsx`). Cap is **10**, so
the switcher stays glanceable rather than a crowded strip. It wraps like ordinary text — same-size
emoji buttons, however many fit the sidebar's current width per row — rather than a fixed count
per row; a wider sidebar fits more on one line, a narrower one wraps sooner. The switcher itself is
a horizontal strip in the sidebar footer, above "Switch folder".

**History, and what is actually banned.** An earlier version (removed 2026-07-25) hoisted top-level
folders into an **Arc-style vertical rail beside the tree**. That was pulled because the surrounding
pieces — organise, pins, the bin, the theme system — didn't exist yet, so it read as chrome that
broke the sidebar's match with `legacy/` for no gain. It was rebuilt on 2026-07-29 once those
landed, by the user's explicit decision. **The banned thing is the rail, not the hierarchy**: legacy
governs how *rows look*, not how many levels the vault has — `legacy/` is a browser app with no
vault and no spaces, so it has nothing to say about this layer. Don't "restore" top-level folders to
the tree; they're spaces, and showing them as rows too would double them up.

The old `renderer/src/spaces/` and its `spaces.json` are gone and are *not* read — a stale
`spaces.json` in an old vault stays inert, and this feature deliberately does not reuse that
filename (its shape was a map keyed by folder name, which a lax loader would misread).

*The model* (`shared/settings.ts`): `AppSettings = { spaces: Space[], activeSpaceFolder, …globals }`.
Per-space: `folder` (the identity **and** the display name), emoji, theme, textTone,
buttonDefinition, density, accent, accentMode, freeArrange, compactNav, toolbarSlots, and the inert
`pageLook`/`font`/`tint`.
**Global on purpose:** startup, `lastNotePath`, dateFormat, numberFormat, timezone — `lastNotePath`
especially, because it's written on *every* note open, and nesting it would make each one rewrite
the whole spaces array. Things to know before editing it:

- **A vault always settles on at least one REAL, folder-backed space** (2026-07-29, reversing
  earlier guidance here that said the opposite — read this before "fixing" it back). `spaces` can be
  momentarily empty inside `reconcileSpaces`'s own arithmetic, and `AppSettings.spaces` can hold a
  lone *unbound* placeholder (`folder: ''`, standing for "the whole vault") for one reconcile pass —
  but `App.tsx`'s `syncSpaces` auto-creates a folder (the same "New folder" convention as everywhere
  else) and binds it the moment reconcile would otherwise leave zero bound spaces. This runs on every
  tree load, so it covers a brand-new/flat vault, switching to one, and deleting your last space back
  down to none — one mechanism, not three. `withNewSpace` already special-cases "the only space is
  the unbound placeholder" by *rebinding* it rather than appending, so the created folder inherits
  whatever theme/density the placeholder was carrying rather than resetting to defaults. The reason
  this matters: a hidden switcher with no real space meant every new note/folder silently landed at
  the vault root ("Not in a space") — this is a bug fix, not a preference.
- **`pick()` ("Switch folder") must call `syncSpaces` too**, not just the boot `useEffect` — the file
  watcher is started with `ignoreInitial: true` (`main/watcher.ts`), so an existing vault's
  pre-existing top-level folders never self-announce as spaces; nothing reconciles them otherwise
  until some later fs event happens to fire.
- **Notes loose at the vault root are never moved.** They render in a "Not in a space" group, in
  every space. Moving a user's files to tidy the hierarchy is exactly what rule 1 forbids.
- **Migration is inside `normalizeSettings`, not a separate pass.** A flat pre-Spaces file *is* a
  valid raw space (the keys have the same names at top level), so `[wholeRawFile]` goes through the
  same `normalizeSpace` the new shape does. One code path, so the two can't drift. It is idempotent,
  and that's tested — the test that catches a migration which re-migrates its own output.
- **A space with `folder: ''` is "unbound", and that's load-bearing.** `reconcileSpaces` binds
  unbound spaces to unclaimed folders in order, which is what (a) carries a migrated pre-Spaces
  user's theme and density onto their first real folder instead of resetting it, and (b) keeps a
  space's look when its folder is renamed *outside* the app.
- **Create / rename are real fs operations** going through the existing `createFolder` /
  `renameEntry` IPC. Settings is only updated with the path **main actually used**, because names
  get sanitised and de-duplicated.
- **Deleting a space goes straight to the OS trash** (`main/vault.ts:trashEntryToOS`, IPC
  `deleteSpace`) — deliberately **not** `trashEntries`, the app's own recoverable bin. A space is a
  different level of the hierarchy from the notes and folders trashed individually inside one;
  putting a deleted space in the same bin list as an individually-trashed note conflated the two.
  Still recoverable, just from the OS's own Recycle Bin/Trash rather than in-app — the two-step
  "click again to delete" button is the confirmation, and is trusted as sufficient on its own.
- **The pre-paint cache mirrors the ACTIVE space**, flat, and holds exactly **the values
  `renderer/index.html` writes onto `<html>` before React exists** — now `{theme, density, textTone,
  buttonDefinition}`. That rule is the whole reason it's a separate shape from `AppSettings`: adding
  a *paint* value means adding a key here (plus the mapping in `index.html` and the type in
  `preload/index.ts`); adding any other setting must not. Old cache files still work — every key is
  independently defaulted. It has its own validator (`normalizeThemeCache`) — running it through
  `normalizeSettings` reads keys that don't exist there and silently paints the default theme on
  every launch.
- **Edits go through the pure helpers** `withSpacePatch` / `withNewSpace` / `withoutSpace`, which
  return a `Partial<AppSettings>` for the existing `setSettings`. No `setSpace` IPC channel — main
  stays unaware that spaces exist beyond resolving the active one for the cache.

## Space presets — the saved-preset library (built 2026-08-06)

`spaces` lives in `<vault>/.mdnotes/settings.json`, per vault. That is right by rule 2 and it had
one bad consequence: **changing source folder wiped every space you had set up**, because the new
folder's settings.json has no spaces and `reconcileSpaces` adopts its top-level folders as fresh
defaults. The library is the fix. `shared/presets.ts` · `main/presets.ts` · `settings/Presets.tsx`.

- **It is stored IN THE APP — `userData/presets.json` — never in a vault**, and that is the whole
  design, not a storage detail. Rule 2's userData exceptions are the things that are properties of
  *this install*; a library whose entire purpose is to outlive the open vault is the sharpest case
  there is. A library kept in a vault is lost the moment you point the app elsewhere, which is the
  bug it exists to fix.
- **Do not reinstate the "master vault" version.** For a few hours the library was
  `<master>/.mdnotes/presets/*.json` with the master nominated in `config.json`, plus a "bring these
  with you?" prompt on switching folders. It failed on its first real folder switch, and the reason
  is worth keeping: **with no master pinned yet, the master defaulted to whichever vault was open**,
  so switching folders silently moved it too — `here` was always true, the prompt never fired, and
  nothing followed the user anywhere. The feature was inert until an explicit action that nothing
  ever prompted for. There is no such state now: one library, one place, always. Gone with it:
  `presetsVault`, `presetsDeclined`, `adoptPresets`, `leavePresets`, `PresetsInfo`, `PresetMovePrompt`.
- **The trade, accepted deliberately:** the library no longer travels with a vault, so it does not
  sync between two machines through OneDrive the way the vault does. "Survives a folder switch" is
  what was asked for, and a library that can be left behind survives nothing. An export/import is
  the answer if cross-machine ever matters — not a second storage location.
- **There is no "save preset" button, by decision.** Every space mirrors itself into the library —
  written when the space is created, rewritten (debounced 800ms) whenever anything about it changes.
  So a preset is never stale and there is nothing to remember to press. The mirror **only ever
  writes**: a preset whose space is gone is the feature working, not litter. Deleting one is
  explicit.
- **A preset is a MIRROR, not a source of truth** — the same relationship `theme-cache.json` has
  with the theme. settings.json remains the answer for the open vault.
- **Identity is (name, origin), never name alone.** Two vaults can each hold a "Revision" space and
  those are different looks. `origin` is the vault's **folder name**, never its path — the same
  OneDrive vault is `D:\Notes` on Windows and `/Users/…/Notes` on the Mac. `id` is a random handle
  for the UI and is deliberately NOT the identity: matching on it would make each sync append a
  second row for a space that already has one.
- **Where it sits in the UI, and why:** a `Disclosure` labelled **Saved presets**, directly under
  that space's Name and Representational-emoji rows in Settings → Spaces. It was briefly a section
  at the top of the page; that put a list of looks above the settings you actually opened the page
  to change. Folded under the identity rows it is one click away and out of the way. It is the one
  SHARED thing in a per-space section, so that section's intro says so out loud — a heading reading
  "everything below belongs to this space alone" directly above a shared library is the kind of
  small lie that gets reported as a bug later.
- **The list is grouped by folder**: the open folder's spaces first, then "From other folders". The
  library gains a row per space per vault ever opened, so a flat list buries what is relevant now.
- **Pouring a look onto a space never touches the folder:** drag a preset row onto a space tab, or
  use its "Use on…" menu — which is not a nicety, since drag-only is unusable from a keyboard, and
  it carries the two things a drag can't express ("All N spaces", and "new space called X").
  `withSpacePatch` re-pins `folder` last, which is what makes "only the look moves" true rather than
  merely intended. **Apply-to-all is ONE settings write**, not a loop: each `setSettings` is a full
  read-modify-write of settings.json, so a loop would rewrite the file once per space and repaint
  between each.
- **Applying is selective** (`pickLook`): tick boxes for Appearance / Colour / Arranging / Note
  chrome / Format buttons, remembered for the session in a module-scope `lastParts` — deliberately
  not persisted, because it is the shape of the action you are about to take, like a selection, and
  the settings rule has no home for it. **A DRAG copies the whole look** regardless: there are no
  tick boxes on a drag, so it must mean one predictable thing rather than inheriting whatever was
  last ticked in a menu the user may never have opened.
  `presets.test.ts` pins that the five groups cover `SpaceLook` **exactly once each** — a field in
  no group could never be copied by any combination of ticks, and a field in two couldn't be
  excluded. Adding a key to `Space` fails that test rather than silently going missing.
- **Deleting a space takes its preset with it, by default** (reversed 2026-08-21; was the opposite
  — see below). A prompt appears only once the two-step delete is armed, and only when there is
  one: **"Save the preset before deleting?"**, one click to opt OUT of the default and keep it in
  the library. The preset is removed only after the folder actually went.
  **Why reversed:** the original design (tick a box to ALSO delete the preset, unticked by default)
  read as "the library outliving a folder is the point of it" — true in the abstract, wrong in
  practice. Ten test spaces created and deleted for onboarding cap-testing (2026-08-21) left ten
  stranded, never-reused presets cluttering the library, because deleting without remembering to
  tick a box is the path of least resistance. Orphaned-by-default was the actual bug; the tick box
  just made it opt-in-to-avoid instead of opt-in-to-cause.
- **The "Use on…" menu is portalled to `document.body`**, positioned from the row's own
  `getBoundingClientRect()` rather than CSS-anchored inside the row (fixed 2026-08-21). The
  "Saved presets" `Disclosure`'s own content wrapper carries `.fade-in`, whose
  `animation-fill-mode: both` leaves a permanent (invisible) `transform` on it even after the
  animation ends — and any `transform` makes its element a stacking context. That trapped the
  popover's z-index inside the Disclosure's own layer, so it lost to the Theme cards section
  below regardless of how high the z-index was set from inside. See the general version of this
  trap in `CLAUDE.md`'s Gotchas — it can recur anywhere an absolutely-positioned dropdown sits
  behind a `.fade-in` ancestor and needs to cover a LATER sibling outside it.
- **Presets are shareable files** (`.mdpreset`, JSON inside, `{kind, version, presets: []}`): export
  one from its row, or the whole library, and import by picker **or by dropping the file on the
  library**. One file shape covers both, because it always holds a list — so import never has to
  know which button wrote it.
  **Export strips `origin`, `id` and `savedAt`**: `origin` is a folder name off the exporter's own
  disk and must not travel to whoever they send it to. An import lands with `origin: ''` and reads
  as "Imported", which also makes it **frozen** — the mirror matches on (name, origin) with origin
  always a real folder name, so a space that happens to share its name can never overwrite it.
  **Imports always ADD, never overwrite**, and same-named arrivals are suffixed: a look someone sent
  you must not be able to silently replace one of yours.
  The drop reads the file in the RENDERER (`File.text()`) and passes the text to main — Electron
  removed `File.path`, and `webUtils` is a whole extra bridge surface for something the drop event
  already hands over.
  `PresetImportResult.cancelled` is separate from `added: 0` on purpose: "nothing in that file" and
  "you closed the picker" are different messages.
- **`SpaceLook = Omit<Space, 'folder'>`**, and `normalizeLook` runs it through the same
  `normalizeSpace` settings.json uses — a new key on `Space` must not validate in one place and not
  the other. A preset can never fail to load: unknown keys dropped, missing ones defaulted.
- Two traps already paid for, both invisible to a typecheck: the mirror must **wait for `vault` and
  `settings` to agree** (`settingsVault`), since `vault` is set at the start of a switch and the
  settings land several awaits later — mirroring in that window files the old vault's spaces under
  the new vault's name; and both sides of "has this look changed?" must compare with **`lookKey`**,
  not a raw `JSON.stringify`, or a key-order difference between a look rebuilt on read and one built
  in the renderer rewrites the whole library on every sync.

## Resizing the columns (built 2026-08-24)

Drag the seam between two panes; double-click resets to even; the divider is a real
`role="separator"` so Tab reaches it and the arrow keys nudge it 24px.

**Widths live in `TabLayout.sizes`, and that placement is the whole design.** Because they sit on
the layout rather than beside it, they ride `spaceTabs` per space for free and persist through
`settings.session` with the tabs — no second store to keep in step. It is `sizes?: number[]`,
optional and **losable** (rule 2): absent, the wrong length, or carrying a hand-edited `NaN` all
read as equal columns. `paneSizes` is the ONLY legitimate reader, and it falls back **whole**
rather than per-entry, because a half-repaired array is a layout nobody chose.

Invariant 4 joins the three in `tabs/model.ts`: `sizes`, when present, has exactly one entry per
pane. It is asserted in the test file's shared `invariants` helper, so all ~490 existing cases
check it too — an operation that changes the pane count and forgets `sizes` fails whichever test
already exercises it, rather than waiting for someone to write a width test for that path.

**Even columns carry NO array.** `simplify` drops one that has become even however it got there, so
"never dragged", "dragged back to even" and "became even when a column closed" are the same value.
Without it a plain split writes `[0.5, 0.5]` into settings.json for a layout nobody touched, and
`equalisePanes` has two different evens to be a no-op against. Caught by its own test, not by
review.

**`movePane` carries a width with its column; `swapPanes` does not.** A swap is two notes trading
columns, so the columns — and the sizes you dragged them to — stay put. That is what keeps
"nothing else on screen moves" literally true.

**The drag writes `flex-grow` straight to the DOM and commits to React once, on release.** Going
through state on every `pointermove` would re-render App and every open CodeMirror sixty times a
second to move a line two pixels. `PaneDivider` finds the two elements it resizes as its own DOM
siblings, which is also why no ref list has to be threaded down and kept in step with the pane array.

**`MIN_PANE_PX` is enforced in pixels at the drag, never as a CSS `min-width`.** A hard CSS minimum
overflows the row in a window too narrow to give every pane one, and an overflow you cannot scroll
is worse than a cramped column.

**The divider takes no net width** — an 11px box with -5.5px margins either side — so the panes'
fractions still describe the whole row while the element keeps a real hit area and bounding box. It
was genuinely 0-wide first; everything worked by hand, but a 0x0 `role="separator"` is invisible to
anything that measures before it acts, which is how the automation caught it.

**The motion is deliberately split three ways.** The drag itself is NOT animated — a seam that eases
toward the pointer reads as lag. `body.pane-resizing` suppresses the column transition for its
duration. Everything else glides: hover, reset, and columns rebalancing when one opens or closes. A
keyboard nudge deliberately keeps its glide, because 24px arriving instantly reads as a glitch.

## Tabs belong to a space

Each space keeps its own tab strip and split. Switching space stashes the current layout under the
space you're leaving and applies the one you're going to (`spaceTabs` in App) — the notes stay
open, they're just not on screen, because **a strip showing notes the sidebar beside it doesn't
have is the confusing part**. Two consequences worth knowing:

- The swap is **explicit**, in `switchSpace`, not an effect keyed on the active folder. Following a
  cross-space link both switches space and opens a note, and an effect-driven swap would race that
  — the note would land in the layout of the space it just left.
- **A restored session is filtered by space too** (`restoreSession`). A saved session can carry
  tabs from a space you left, and reopening them into whichever space is active reproduces exactly
  the confusion this avoids. Notes loose at the vault root belong to no space and come back in all
  of them.

`spaceTabs` is in memory only. `settings.session` remembers the space you were in, which is the one
you return to; the other spaces open empty and fill as you use them.

## Fonts (built 2026-08-17)

Three of a Space's long-reserved-but-unused fields are now real: `font`, `uiFont`, `dyslexiaFont`
(`pageLook` and `tint` are still the inert shell described in `appearance-research-brief.md`,
which this section supersedes for fonts specifically — that brief's research questions are
answered below).

**Why three fields, not one.** The app already had two separate CSS variable pairs before this —
`--font-sans`/`--font-serif` for the interface, nothing for notes — because a note's headings
(Fraunces) and its body (Inter) were never independently swappable to begin with. Adding a font
*picker* on top of that naively would have let one choice restyle both the note you're writing
**and** the Settings window you're picking it from, which reads as a bug the first time someone
tries it. So notes got their own pair (`--note-font-sans` / `--note-font-serif`), `font` drives
that pair, `uiFont` drives the original one, and `dyslexiaFont` sits on top of `font` overriding
only `--note-font-sans` — a note's body text, never its headings, never the interface. `--font-mono`
is untouched by all three: code is always JetBrains Mono, in every space, because a font *skin* is
about prose, not about the editor's own code-fence rendering. See `settings/model.ts`'s
`applyFont` — it's the one function that resolves all three fields into all four variables, in
that precedence order, every time.

**Why three SOURCES of font, not one bundle.** Originally all 20 researched fonts were bundled
(one `@font-face` each, ~450KB total — trivial for a desktop app). Reuben asked for a real
"collection" model instead: a handful installed from the start, the rest **previewable, then
downloaded on demand**. That's `shared/fonts.ts`'s `source: 'bundled' | 'downloadable'` split —
bundled ships in `assets/fonts/` and theme.css like always; downloadable fonts have a `cdnUrl`
(Fontsource's package mirror on jsdelivr) and no local file until `main/fonts.ts`'s `downloadFont`
fetches and caches one in `userData/fonts/downloaded/`. **This is the app's first-ever runtime
network dependency** — a deliberate, scoped exception to the "no CDN, offline-first" rule
(CLAUDE.md's folder-structure note on `assets/fonts/`), not a quiet erosion of it: the app and
every *other* feature still work with zero network access, and a font once downloaded stays
usable offline too. A third source, `custom`, has no catalogue entry at all — `importCustomFont`
opens a native picker, copies the file into `userData/fonts/custom/`, and names it from the
filename; it's tracked in `userData/fonts/custom.json` (the only one of the three that needs a
manifest, since there's no catalogue to read a name back out of).

**Why the picker only ever shows what's installed, never the full catalogue.** You can't select a
font you don't have. `useInstalledFonts.ts`'s `FontLibrary` is one hook instance, created once in
`Settings.tsx` and threaded down to `Customisation`/`Spaces` (via `SpaceForm` → `SpaceFonts`) and
to `Collection.tsx` alike — so a download made from *any* of those three surfaces shows up in all
of them without a refresh, the same "one state, several scopes" shape `presets`/`presetActions`
already use one level up.

**Preview without downloading.** `Collection.tsx`'s "download more" shelf shows a small
pre-rendered PNG (`assets/font-previews/*.png`, ~1KB each, generated once from the same font
files) for anything not yet installed — a live `@font-face` render is impossible for a font that
isn't on disk yet, and the whole point of "preview first" was seeing the shape before spending a
download on it. `fontLoader.ts`'s `FontFace`/`document.fonts.add` swap-in (not a `<style>` tag)
is what makes a just-downloaded font render immediately, no reload, the instant its bytes land.
