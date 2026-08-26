# Product rulings from the 2026-08-09 interview (logged 2026-08-14)

Decisions made outside the code that the code has to honour. Source:
`<vault>/Note taking app/CAR RIDE ACTION PLAN/`, question numbers in brackets. The ranked build
order lives in `<vault>/Note taking app/2026-08-14-action-plan/00-ACTION-PLAN.md`.

See also `docs/onboarding-plan.md` (the full build plan, now the current spec — resolved 2026-08-16)
and `docs/voice.md` (the copy rules from this same interview).

**Launch is 15 September 2026** — the public announcement. The app is already live and unpublicised.

## Rulings that contradict current code

- **The bounce easing stays, but needs an off switch** (4B.33, 4B.34). `cubic-bezier(0.34,1.56,0.64,1)`
  is deliberate now, not an accident — Reuben's call is that it adds character. The setting is for
  speed and hardware acceleration, and belongs with the other per-space appearance settings unless
  it's judged a device property rather than a look.
- **Nine durations should collapse to three** — fast (~140ms) state change, standard (260ms, already
  the de facto house value with 8 uses) appearing/disappearing, slow (~420ms) full-surface.

## Rulings that are new build work

- **Imports land in their own space, always**, and trigger a post-import organise popup that differs
  by source format (4B.53, 2.30). The one-new-space-per-import behaviour already exists; the popup
  doesn't.
- **A curated welcome sequence** seeds the *main/first* space after onboarding — a specific set of
  notes Reuben writes, showing how to delete notes and folders and how to customise spaces (4B.51,
  4B.52, 4B.43). Not a single note. Full copy is in `docs/onboarding-plan.md`, which now carries
  the complete current spec.
- **Notes and folders must be draggable into spaces from the sidebar** (2.30).
- **Settings search needs a keyword alias layer** — typing "accessibility" must find the **Reading**
  section (3.49). The aliases are the feature; the search box is not.
- **Every `/` command carries a tutorial tier** — beginner / intermediate / advanced (2.43). The
  first time a user invokes an intermediate or advanced command, a popup offers the tutorial. This
  is the tutorial system's only discovery mechanism, so the tier is a property of the command
  registry (`editor/commands.tsx`, see `docs/commands.md`) and is a file-format-level id decision.
- **Backup / snapshot history** and a **7-day recovery area for notes emptied from the bin** (1.26).
  See the correction below for why this is high priority.

## Correction to a stated belief

Reuben has said three times (1.19, 1.26, 3.97) that the app cannot lose notes "because it's just a
skin and editor." **That is not true of this codebase** and any work in `main/vault.ts` should
proceed on the opposite assumption. `renameWithRetry` exists precisely because a OneDrive-held file
handle made the atomic write's final rename fail with `EPERM` and lose the edit; the app also
renames, moves and bins real files, writes `.mdnotes/` into the vault, and **rewrites `[[links]]`
inside notes the user does not have open**. Rule 1 of `CLAUDE.md` protects the user's data; it does
not make data loss impossible.

**Resolved 2026-08-26, from the write path rather than a live measurement — see the ruling below.**
The worst-case crash-loss window, two-window behaviour on one vault, and what happens when a file
is edited outside the app while open are no longer unmeasured: `watcher.ts`'s guarantees are now
written down in `CLAUDE.md`'s Gotchas.

## Parity gaps ruled pre-launch

From Reuben's own scoring rubric, chosen over the interview answers: **spell check** (built
2026-08-25, and narrowed on the way in — see the ruling below), **find & replace**
(`@codemirror/search` — needs asking before adding, per the dependency rule), **export to PDF + HTML**
(`marked` + `dompurify` + `webContents.printToPDF()`, all already owned), **paste/drag images**, and
**the on-disk tag format** — decided before real users have real notes even if no UI ships, because
retrofitting means rewriting their `.md` files.

### Spell check is the machine's job, not the app's (2026-08-25)

**Ruled by Reuben: this app ships no dictionary, no bundled spell checker, and no spell-check
setting.** If someone wants their writing checked, their operating system already does that, and a
second checker that disagrees with the first is worse than none — it argues with the user about
their own machine's dictionary, and it is one more thing to keep, ship and support.

What was actually built is the opposite of a feature: the **removal of a block**. CodeMirror
hardcodes `spellcheck: "false"` onto its editable element, so the app had been switching the OS
checker *off* for every note — a user with spell check on everywhere else got nothing here and had
no way to change that. `editor/extensions.ts` now adds
`EditorView.contentAttributes.of({ spellcheck: 'true' })`, which merges into CodeMirror's own
defaults and lets the system's dictionary through. Chromium supplies the underline and the
right-click suggestions from the OS.

**`autocorrect` and `autocapitalize` stay off, deliberately.** Underlining a word is advice;
rewriting it is damage — and in Markdown the damage is specific: straight quotes turned curly
inside a fenced code block, a lowercase list item capitalised. Do not "finish the job" by turning
those on too.

There is no settings row for this, on purpose. The control lives in System Settings (macOS) or
Windows' typing settings, which is where a user already looks for it.

**Measured on macOS, and it does NOT yet mark words — do not assume this shipped working
(2026-08-25).** The attribute change is verified: `.cm-content` carried `spellcheck="false"` before
and carries `"true"` after, checked by reading the live DOM either side of the edit. What could not
be produced is a single red underline inside the editor. The control experiment is what makes that
a real finding rather than a bad harness: a bare `contenteditable` with `spellcheck="true"`, in the
same Electron build on the same machine, **does** underline `teh misspeled wrd` — so the machine,
the dictionary (`en-GB`, initialised) and the capture method all work. The editor was then driven
three ways — bulk `execCommand`, per-character `execCommand`, and real `sendInputEvent` key events
at ~70ms/char, in a focused on-screen window — and stayed clean every time.

Two things learned on the way, both of which will waste an hour if forgotten:

- **macOS only paints the underline in the field that currently has focus, and only on text typed
  into it.** Pre-existing text in an unfocused box is never marked. A four-box comparison on one
  page is therefore worthless — only the last box focused can show anything. One box per window.
- **`params.misspelledWord` on the `context-menu` event is always empty here**, even on the bare
  control box that visibly underlines. That is the Hunspell path (Windows/Linux); macOS goes
  through the native checker. Do not use it as the oracle on a Mac — use pixels.

The likely cause is CodeMirror rewriting the line DOM out from under Chromium's spelling markers,
which is presumably why CodeMirror ships `spellcheck: "false"` in the first place. **Chasing that is
out of scope by this same ruling** — engineering around CodeMirror's DOM to deliver spell checking
is exactly the app-native effort Reuben ruled out. The line stays because it can only help: without
it there is no possibility of a check at all. Windows uses a different engine (Hunspell, not
NSSpellChecker) and is untested — it may simply work there. Both platforms are on the tester
checklist.

### Autosave races: last-write-wins is fine, corruption isn't (2026-08-26)

**Ruled by Reuben: the known crash-loss window is acceptable as-is, and the real bar for two
things editing a note at once is "does not corrupt," not "merges correctly."** Raised while
deciding whether to move "measure the autosave data-loss window" into a future-features list —
Reuben's own framing was "as long as you know what you're doing with the crash in 400ms then
it's fine, and as long as notes don't corrupt if two things are editing them at the same time,
it's good."

Both halves check out, verified by reading the write path rather than by building a live
measurement:

- **The crash-loss window is the known, already-built bound.** 400ms after typing stops
  (`App.tsx:423`), closed further by an immediate flush on window blur and just before quit
  (`App.tsx:2089`, `2095`). Nothing new was built for this — the number was already true of the
  shipped code.
- **Corruption cannot happen, because every write is atomic.** `writeNote` (`vault.ts:333–356`)
  writes to a temp file, `fsync`s it, then renames over the real path — so the file on disk is
  always one complete version or the other, never a torn or half-written mix, no matter how many
  processes (two windows, or two whole app instances on the shared Mac sandbox) race on the same
  note.
- **What two-way editing actually costs is last-write-wins, not merging — and that's accepted.**
  Each side keeps its own in-memory dirty buffer; whichever side's flush lands last silently
  overwrites the other's edit. `App.tsx:1503` skips reloading a tab that's still dirty when an
  external change comes in, which stops a mid-keystroke edit from being clobbered live — but it
  does not reconcile the two versions, it just changes who loses and when.

**No dedicated test was written, and none is planned** — this was closed by reading
`vault.ts`/`watcher.ts`/`App.tsx` against Reuben's stated bar, not by a repro. The full trace is
logged in `CLAUDE.md`'s Gotchas (2026-08-26 entry) for anyone touching autosave or the watcher
next.

## Unchanged and confirmed

Type stack stays (Inter / Fraunces / JetBrains Mono); font switching is post-launch. Density names
stay. Backdrop blur stays. Off-white `--paper` is a deliberate softening, not drift from the site's
`#ffffff`. Default app state shows no colour except highlighted text.

## Superseded by later builds (this doc's own claims, corrected)

Two lines above were true as of the 2026-08-09 interview and are **no longer true of the code** —
caught 2026-08-17 while building onboarding, which reuses both:

- ~~"Wordmark doesn't change and never appears inside the app (website header only)."~~ It does now:
  `StartupSplash.tsx` plays the wordmark clip (`playStartupAnimation` setting) every time a vault
  opens, and onboarding's Welcome screen reuses the same clip. Not tracked as a separate build —
  it shipped between the interview and now with nothing here updated to say so.
- ~~"Default theme must follow the OS, not `dark` — needs a third state..."~~ Already built:
  `ThemeId = ResolvedThemeId | 'system'` (`shared/settings.ts`), `DEFAULT_SPACE.theme = 'system'`,
  and `index.html`'s pre-paint script resolves it before React mounts. This was ruling 4A.34/4B.17/
  4B.20; treat it as done, not outstanding.

**Lesson for next time this file is read for planning**: a "contradicts current code" or "unchanged"
claim here can go stale the moment the code it describes changes, and nothing forces a revisit.
Spot-check against the actual source before relying on this doc for what's built vs. not.
