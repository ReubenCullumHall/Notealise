# Transfer data (Settings → Transfer data)

> ## Status: BUILT 2026-08-28, NOT live-verified. Destined for 1.0.1, after Reuben's own check.
>
> Typecheck / oxlint / 557 unit tests green, runs in the Electron dev app with no errors. **Every
> visual render, the export/import round trip, drag-drop, and the onboarding self-heal live flow
> are unverified** — see the tester-checklist memory for the list. No `CHANGELOG.md` line until
> that check happens (the project's live-verification gate).

## The problem

Everything a person tunes about how Notealise *looks* — theme, accent, colour tints, density,
editor width, per-space font choices, toolbar buttons, pins, archive, folder order, the bin —
lives in `<vault>/.mdnotes/settings.json` and `workspace.json` (rule 2). That travels with the
folder: move it, sync it through OneDrive, copy it to a USB stick, and the whole look comes with
it for free.

**A few things don't.** They live in `userData/`, because they are properties of *this install*
rather than of a folder of notes:

| What | Where | Why it's not in the vault |
|---|---|---|
| The saved-preset library | `userData/presets.json` | Its whole purpose is to **outlive** any one vault (see `main/presets.ts`'s header) |
| Custom fonts (the files) | `userData/fonts/custom/` + `custom.json` | A font you imported from your own disk has no catalogue entry to re-fetch from |
| Which catalogue fonts are downloaded | `userData/fonts/downloaded/*.woff2` | A re-fetchable cache, not content |
| The auto-update setting | `userData/config.json` (`autoUpdate`) | Per-vault would mean updates on for one folder, off for another |

An app-cleaner (AppCleaner, AppZapper) that wipes `~/Library/Application Support/Notealise/`, a
new machine, or a switch between Mac and Windows takes all four with it. The notes are never at
risk — they're plain files in the vault folder — but the setup around them is. **Reuben's own
framing was broader than the reality** ("app-cleaners lose your tints/fonts/preferences"); mapping
exactly what lives where is what narrowed this feature to those four rows.

## The bundle

`shared/transfer.ts` — the contract, shared by `main/transfer.ts` (writes it) and
`settings/TransferData.tsx` (reads the result). Plain readable JSON, extension `.notealisedata`.

```
{ kind, version, exportedAt, appVersion,
  presets:          SharedPreset[]   // the library, PLUS the current vault's own spaces folded in
  customFonts:      TransferFont[]   // {displayName, originalName, ext, data(base64), addedAt}
  downloadedFontIds: string[]        // catalogue ids to re-fetch on the destination
  updatePrefs:      {autoUpdate} | null }   // null = the file carried no opinion
```

- **`presets` folds in the open vault's spaces** at export time — "include this vault's full look"
  (Reuben's call). Deduped by `(name, lookKey(look))` against the library so a space already
  mirrored isn't listed twice. This is what lets a *fresh* vault on the other machine be poured
  full.
- **`normalizeBundle` is the trust boundary.** Lenient like `fromPresetFile` — `kind` isn't
  enforced, a bare `.mdpreset` dropped on the page still imports its presets. Returns `null` only
  for "not that kind of file at all" (nothing that looks like presets/fonts/ids/prefs), so the
  page can say so rather than reporting "imported 0". Caps: 40 fonts, ~8.5 MB decoded each, 60
  downloaded ids. `transfer.test.ts` pins the never-throws-on-junk behaviour and the
  null-vs-empty distinction.
- **`updatePrefs: null` when the file has none** — a `.mdpreset` read through this path must not
  offer to "apply" a channel it never carried.

## Import rules

- **Presets and custom fonts ADD, never overwrite** (Reuben's call). `mergeSharedPresets`
  (`main/presets.ts`) is standalone from `importPresets` — it can't call it (both take the same
  write `queue`; a queued call inside a queued callback deadlocks) and it wants a slightly
  different rule: an **identical-look no-op** (a bundle folds in the exporter's vault spaces, and
  if the other device points at the same synced folder those are already there verbatim —
  re-adding them as "Revision (2)" would be noise). A name clash with a *different* look is still
  suffixed via `freeName`, never overwritten. Custom-font dedup is same `originalName` + same byte
  length.
- **Downloaded catalogue fonts re-fetch best-effort, in PARALLEL** — `downloadFont` gives each a
  20s timeout, and a serial loop over a dozen ids with no connection would hang the whole import
  for minutes. Already-cached ids are skipped.
- **The update channel is NOT applied** — a single toggle can't be "added as a copy". It comes
  back in the result and the page offers an explicit *Apply it*.
- **Library full (60):** `mergeSharedPresets` returns `full: true` when a genuinely-new look
  couldn't fit, and the page says so rather than the misleading "nothing new to add".

## Onboarding self-heal (`main/config.ts` `vaultLooksEstablished`)

The onboarding trigger used to be one boolean, `hasOnboarded`, in `userData/config.json`. Lose
that file (app-cleaner, new machine, partial wipe) and a returning user is marched through the
whole first-run flow on top of their real notes.

The durable signal is `<vault>/.mdnotes/settings.json` — it travels **inside** the vault, and its
presence means the app got far enough to write appearance settings, i.e. a real prior setup.
`ensureMdnotes` only makes the empty `.mdnotes/` dir, so the folder alone proves nothing —
`settings.json` specifically is the gate.

Two heal points:

1. **Boot** (`main/index.ts`, before the window is created so the renderer's first
   `getOnboarded()` can't race a stale `false`): if config still points at a vault but has lost
   `hasOnboarded`, **and there's no `onboardingStep`** (a genuine first run that quit after the
   Spaces step also wrote `settings.json` — but it left a resume step behind), **and**
   `vaultLooksEstablished` — set `hasOnboarded: true`.
2. **The onboarding Vault step**: after a folder is picked, `window.api.vaultEstablished()`. If
   it's set up AND `recogniseExistingSetup` (only on a run that hasn't advanced past Vault —
   `Onboarding.tsx`'s `advancedPastVault` ref), the step says "You've set this folder up with
   Notealise before" and Continue becomes **Pick up where you left off** — `StepReadyState`'s
   `skipToFinish`, which ends the flow via `onFinished(null, { established: true })`.
   `finishOnboarding` then skips seeding the welcome notes over the folder's real ones.

New welcome note **"Used Notealise before?"** (`onboarding/welcomeNotes.ts`) points a fresh-run
user at Settings → Transfer data for next time / the other direction (Mac↔Windows).

## Files

- `shared/transfer.ts` (+ `.test.ts`), `shared/channels.ts`, `shared/types.ts`
- `main/transfer.ts` (new), `main/config.ts` (`vaultLooksEstablished`), `main/fonts.ts`
  (`countCustomFonts`, `readCustomFontsForTransfer`, `installCustomFontData`,
  `listDownloadedFontIds`), `main/presets.ts` (`mergeSharedPresets`), `main/index.ts`,
  `main/ipc.ts`
- `preload/index.ts`, `renderer/src/dev/browserApi.ts`
- `renderer/src/settings/TransferData.tsx` (new), `Settings.tsx` (nav entry + Import-page banner),
  `useInstalledFonts.ts` (`reload`)
- `renderer/src/onboarding/Onboarding.tsx`, `steps/VaultStep.tsx`, `welcomeNotes.ts`,
  `renderer/src/App.tsx` (`finishOnboarding` opts), `Sidebar.tsx` (thread `onTransferChanged`)

Settings nav order settled 2026-08-28 (Reuben, iterating live): **… Your collection · Tutorials ·
Source folder · Recovery · Import · Transfer data · Updates …**
