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

Unmeasured and worth measuring: the worst-case autosave data-loss window in seconds, two-window
behaviour on one vault, and what happens when a file is edited outside the app while open
(`watcher.ts` has never had its guarantees written down).

## Parity gaps ruled pre-launch

From Reuben's own scoring rubric, chosen over the interview answers: **spell check** (one line —
`EditorView.contentAttributes.of({ spellcheck: 'true' })`), **find & replace**
(`@codemirror/search` — needs asking before adding, per the dependency rule), **export to PDF + HTML**
(`marked` + `dompurify` + `webContents.printToPDF()`, all already owned), **paste/drag images**, and
**the on-disk tag format** — decided before real users have real notes even if no UI ships, because
retrofitting means rewriting their `.md` files.

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
