# In-app update notifications

> **Status: BUILT 2026-08-27.** Verified headlessly (renderer preview + Playwright); the
> main-process half and the whole macOS flow still need a **packaged build** to be honestly
> called done — see "What is verified, and what isn't" at the end.

## Why

macOS users could sit on a months-old build without knowing. Three causes, all now addressed:

1. **"Update automatically" off = zero checking.** `initUpdater()` returned early when the pref
   was off, on both platforms — so the app never asked GitHub anything, and nothing was ever
   surfaced. An install months behind looked identical to a current one. A preference about
   *installing* was never a reasonable place to also switch off *knowing*.
2. **The only notification was a small strip in the sidebar footer** (`UpdateBanner`),
   deliberately subtle. Easy to never notice.
3. On macOS the app *can* fetch the `.dmg` itself (`macUpdate.ts`, 2026-08-25) but only after the
   user clicks a button they had to notice first.

## What it does now

| | Windows | macOS (unsigned) |
|---|---|---|
| **Check** | Every launch (10s in) + every 6h. Not gated on any pref. | Same. |
| **Announce** | `UpdateToast`, bottom-right corner card. | Same. |
| **Toast action** | `available` → Download · `downloading` → progress bar · `ready` → Restart now | → **Settings → Updates** (`setSettingsJumpTo('updates')`) |
| **After download** | staged; installs on quit | in `~/Downloads`; a dialog offers the Gatekeeper walkthrough |
| **"Install updates automatically"** | shown; gates background download+stage only | **hidden** — nothing left for it to control |
| **Sidebar strip** | `downloading` + `ready` only | same |

### The pieces

- **`main/updater.ts`** — `initUpdater()` always schedules the check on both platforms. The
  `autoUpdate` pref now sets exactly one thing: `au.autoDownload`. New export `canSelfInstall()`
  (false on macOS), surfaced through `getUpdateState()` as `selfInstall`, because the renderer
  needs the answer *before* the first check has run and `UpdateStatus.manual` does not exist
  until one has.
- **`renderer/src/update/UpdateToast.tsx`** — new. Fixed bottom-right at the App root (beside
  `.notice`, which proves that position works there; the portal rule in CLAUDE.md is about
  escaping the *sidebar*'s `backdrop-filter`). Shows for `available` / `downloading` / `ready`.
  **Not `available` alone** — with auto-download on, `updater.ts` reports `downloading` from the
  first event, so a toast keyed only on `available` would never appear for the majority of
  Windows users, the ones who changed no settings at all.
- **Dismissal is session-only** and **keyed by version** (`updateDismissed` in `App.tsx`). "Later"
  must not become "never tell me again": the next launch re-checks and re-shows. A newer release
  arriving mid-session gets its own announcement rather than inheriting the previous dismissal.
- **`renderer/src/update/UpdateBanner.tsx`** — the `available` branch is gone (the toast has it);
  `downloading` and `ready` stay. That is deliberately the half a toast cannot do: the toast is
  dismissible, so without this a download in flight would have nowhere to show. Its
  `canSelfUpdate` prop was only ever read by the removed branch and went with it (rule 9).
- **`App.tsx`** — mounts the toast; fires the macOS post-download dialog.
- **`settings/Settings.tsx`** — hides the auto toggle when `!selfInstall`; names the version on
  the macOS Download button (this is where the toast lands, and a bare "Download" says nothing);
  adds a permanent "How to open a new version on a Mac" link; `ready`+`manual` now offers "Show
  it in Finder" rather than "Restart & install", which would have restarted into the same version.
- **`shared/update.ts`** — `MAC_INSTALL_GUIDE_URL` (`https://notealise.com/install/mac.html`;
  notealise.com is the Vercel deployment of `site/`, confirmed by Reuben 2026-08-27). Nothing in
  the repo records the domain, so if the site moves this constant is the one place to change and
  nothing fails loudly to say so.

### The macOS post-download dialog

Fires on the **transition** into a `ready` + `manual` status, tracked by version in a ref
(`promptedFor`) rather than off the rendered value: `status` is re-pushed to every subscriber and
re-read by `getUpdateState()` whenever Settings mounts, so keying off the value alone would
re-open the dialog on a replay that reported nothing new. Deliberately **not** persisted to
`config.json` — a genuine second download of the same version (file deleted, or clicked again) is
a real event that deserves the offer again.

It also retires the toast for that version as it opens, so the two do not say the same thing at
once. Nothing is lost: `ready` is exactly what the sidebar strip still carries.

## Everything here is temporary — remove when the app is signed

Reuben's instruction. Once the Apple Developer ID (and Windows cert) are bought, macOS
auto-updates like Windows and this whole layer is dead weight. **Every block that exists only for
the unsigned build is tagged `MAC_UNSIGNED_WORKAROUND`**, so removal is `grep -rn
MAC_UNSIGNED_WORKAROUND src/`, not archaeology. `canSelfInstall()` is the seam: make it return
`true` unconditionally and every consumer collapses to its Windows branch.

What goes: the `site/install/` guide pages, the toast's macOS branch, the post-download dialog,
the Settings guide link and hidden-toggle branch, most of `macUpdate.ts`, and the `manual: true`
status branches throughout. See `notesapp-signing-deferred` (memory) and
`docs/release-checklist.md`'s "Known gaps".

## What is verified, and what isn't

**Verified** — headless Chromium against the renderer preview (`localhost:5173`, `window.api`
wrapped via the documented `Object.defineProperty` set-trap):

- All five toast states render, anchored bottom-right, no console errors.
- Dismiss hides it; a re-push of the **same** version does not bring it back; a **newer** version
  does.
- Windows "Download it" → `downloadUpdate()`, "Restart now" → `installUpdate()`.
- macOS dialog's "Show me the steps" → `openExternal(MAC_INSTALL_GUIDE_URL)`, dialog closes, and
  the sidebar strip still reads "0.11.0 downloaded · Show me" afterwards.
- Settings → Updates: toggle **hidden** on macOS, **shown** on Windows; "Download 0.11.0" and the
  guide link present on macOS; "Show it in Finder" on a manual `ready`.
- Sidebar strip no longer says "is out" in any state.
- `typecheck` (both projects) and `oxlint src/` clean; **550 tests pass**.

**Not verified — needs a packaged build or a real feed:**

- **The always-check change itself.** `initUpdater()` no longer returns early when `autoUpdate`
  is off — read, not run. A dev build reports `unsupported` on Windows and needs
  `NOTES_TEST_UPDATER=1` to do anything at all. **The honest test is: turn the toggle off, quit,
  reopen, and confirm the toast still appears.**
- **The real macOS flow end to end** — toast → Settings → Download → `.dmg` in `~/Downloads` →
  Finder → the post-download dialog. `isMac()` requires `app.isPackaged || devTest`.
- **The live releases feed's shape** — the API was rate-limited when checked. `parseFeed` /
  `pickRelease` are covered by `shared/update.test.ts` against a real captured payload, which is
  the test that matters, but nothing re-confirmed the live response today.
- No new unit tests: nothing pure changed (`shared/update.ts` gained a constant, no logic).

## Open

- **Toast copy names the version but not what changed.** A line of "what's new" would need a
  source — the GitHub release body is the obvious one, and `parseRelease` already has the payload
  in hand. Not built; decide if it is wanted.
- The 6h interval re-checks but the toast only appears when the version *changes*, since
  dismissal is keyed by version. That is intended; worth revisiting if someone dismisses at 09:00
  and wants reminding by 17:00.
