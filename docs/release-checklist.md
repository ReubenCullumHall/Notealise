# Release checklist

**Installed apps update themselves.** A bad stable release doesn't sit on a server waiting to be
noticed — it installs itself on every user's machine within about ten seconds of them opening the
app. There is no "revert the deploy" for that. This checklist is what stands in the way.

There is **no staging server**, because there's no server at all. The artifact *is* the product.
So "staging" here means: run the exact thing users would get, somewhere it can't hurt anyone.

---

## Gate −1 — the release-review sign-off (do this FIRST)

A release ships **everything** on `main` since the last tag, not just the thing you have in
mind — `[Unreleased]` is a whole queue. Before touching the version number:

```
tools/release-review.sh          # or --full for the complete diff
```

Go down the output **item by item**. For each: verified in the real app → *ship it*; otherwise
→ *hold*. **Read the diff, not the commit messages** — `205d4c6` was titled "Add cross-session
status file convention" and carried the entire update-notification feature into `v1.0.0` unseen.

Holding an item: either the release waits until it's verified, or `git revert <sha>` on a
release-prep commit so the release goes out without it (revert the revert afterwards to keep the
work on `main`). Only tag once every item in the range is "ship it". Full model: `docs/workflow.md`.

---

## The four gates

Work down the list. Later gates are slower, so failing early is cheaper.

### Gate 0 — dev

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
npm run dev
```

The real app, hot reload. **This is where features are built** — not in `legacy/`, which is a
separate browser program and would mean writing everything twice (see CLAUDE.md rule 8).

Catches: logic, layout, interaction.
**Cannot** catch: anything about packaging.

### Gate 1 — packaged build *(the important one)*

```powershell
npm run typecheck; npm run lint; npm test
npm run package:dir
.\release\win-unpacked\Notealise.exe
```

`npm run dev` serves unbundled source through a dev server. Users run minified code out of an
`app.asar`. Bugs living in that gap reach users without ever showing up in dev:

- **Files missing from the ship list.** `electron-builder.yml`'s `files:` is a *whitelist*
  (`out/**` + `package.json`). Anything a new feature needs at runtime that lands outside `out/`
  silently doesn't ship.
- **`app.isPackaged`-gated code** paths, which dev never executes.
- **Production React** — no StrictMode double-render, no dev warnings.
- **A runtime import that's only in `devDependencies`.**
- **`__dirname`/path assumptions** that break inside an asar.

It does **not** test updates: electron-builder writes `resources/app-update.yml` only when it builds
an *installer* target, so a `--dir` build has no feed. Settings will say
"unpackaged test build" — that's expected here, not a fault. Use the env var below, or gate 2.

Smoke test in the packaged window: open a vault · create and edit a note (confirm it's on disk) ·
colour a selection · Settings opens centred and scrolls · archive and restore something.
Also confirm **Settings shows no "Receive test builds"** and **View has no Developer Tools** — both
are supposed to be absent from stable builds.

**Two traps when the installed app is also running:**

- They share `userData`, so you get "Unable to move the cache" errors and can corrupt each other's
  config. Launch the test build with its own profile:
  `.\release\win-unpacked\Notealise.exe --user-data-dir=$env:TEMP\notes-test`
- **Don't check whether it booted with `Start-Process -PassThru` + `$p.HasExited`.** That reports on
  a launcher stub, not Electron's process tree, and gives both false failures *and* false passes.
  Check by path instead:
  `Get-Process Notealise | Where-Object { $_.Path -like "*win-unpacked*" }`

### Gate 2 — installed

```powershell
npm run package
.\release\Notealise-Setup.exe
```

Installs over your current copy, exactly as a user experiences it. **Quit Notealise first** or NSIS
can't replace the running binary.

Only gate that can test: the NSIS install, upgrade-over-existing, desktop shortcut, and
`quitAndInstall` — including the handshake between `main/index.ts`'s `before-quit` flush and the
installer quitting the app. **Type into a note and hit "Restart now" before the 400 ms autosave
fires; the edit must be on disk after relaunch.**

Testing the update *check* doesn't need any of this:

```powershell
$env:NOTES_TEST_UPDATER = "1"; npm run dev
```

reads `dev-app-update.yml` and talks to the live GitHub feed. To make it actually find something,
temporarily lower `version` in `package.json`.

### Gate 3 — beta *(removed 2026-08-29)*

**There is no beta channel any more.** Reuben's call: testers get the same public download link
as everyone else, so a separate opted-in channel was upkeep with no user. The "Receive test
builds" toggle, the `betaChannel` pref, and `shouldFollowBeta` are gone from the app.

What's left as a **safety net, not a supported flow:** CI still marks any tag containing `-`
(`v1.1.0-rc.1`) as a GitHub *prerelease*, which GitHub keeps out of `releases/latest` and which
stable installs ignore (`allowPrerelease` is `false` by default). So a stray `-` tag can't reach
users — but there is no mechanism to deliberately get a build to a subset of people. If that need
comes back, it's a new feature, not a revert.

To dry-run the update *check* against the live feed without any of this:

```powershell
$env:NOTES_TEST_UPDATER = "1"; npm run dev    # + temporarily lower "version" in package.json
```

---

## Shipping to everyone

```powershell
# bump "version" in package.json (no -beta suffix)
git commit -am "vX.Y.Z: <what changed>"
git tag vX.Y.Z
git push; git push --tags
```

CI runs `verify` (typecheck, lint, tests) **before** packaging, so a broken tag never becomes an
installer.

### Then verify the release actually landed — don't assume

This has bitten us: the release object appears within ~30 s, but the 98 MB installer is still
uploading, and during that window `releases/latest` still points at the **previous** version.
Anyone downloading gets the old app.

```powershell
$l = Invoke-RestMethod "https://api.github.com/repos/ReubenCullumHall/Notealise/releases/latest" -Headers @{'User-Agent'='ps'}
"latest = $($l.tag_name)"
$l.assets | ForEach-Object { "{0} {1:N1} MB {2}" -f $_.name, ($_.size/1MB), $_.state }
```

All four assets (`Notealise-Setup.exe`, `Notealise-Setup.exe.blockmap`, `latest.yml`, `Notealise.dmg`) must read
`uploaded` **and** `latest` must be the new tag. Only then tell anyone to download.

**CI now checks this for you** (`verify-release` job in `release.yml`, added 2026-08-27) — it fails
the workflow loudly if any expected asset isn't `uploaded`. The manual check above is still worth
running yourself before telling anyone to download, but a red `verify-release` job is the thing to
trust over a green `build` job.

### Never re-run a release workflow long after the tag was pushed — bump a version instead

**electron-builder's GitHub publisher silently skips uploading — exit 0, no error — if the release
it's publishing to was created more than 2 hours ago.** It's a guard against a stale/delayed CI run
clobbering a release that's moved on since, but it can't tell that apart from an OS's build job
having failed and being re-run hours later while diagnosing why. Hit this 2026-08-27: `v0.10.0`'s
Windows job failed outright on the first run; by the time the failure was diagnosed and "re-run
failed jobs" was clicked, over 2 hours had passed since the release was first created (by the
macOS job, which succeeded first). The re-run built `Setup.exe`/`.blockmap`/`latest.yml` correctly,
then logged `skipped publishing ... reason=existing release published more than 2 hours ago` for
all three and exited 0 — a fully green job that shipped nothing. (The `verify-release` job above
exists because of this: this exact failure mode leaves every build job green.)

**If more than ~2 hours have passed since a release tag was pushed and a build job needs
re-running, don't re-run the workflow — bump to a new patch version and tag that instead**
(`v0.10.0` → `v0.10.1`, no code changes required). That gets a release object with a fresh
timestamp, so the guard never engages. Nobody has "downloaded a bad version" from an incomplete
release — there was nothing to download for the missing platform — so this is exactly the safe,
low-stakes case the "ship the fix as a higher version" rule above already covers.

### The two build jobs used to race to CREATE the release — fixed, but know the symptom

**Second failure mode, found the same day trying to fix the first one.** `v0.10.1` was a genuinely
fresh tag — the 2-hour guard above can't have been the cause — and it still shipped with only
*one* of the four expected assets. Cause: `build`'s Windows and macOS jobs both run
`electron-builder --publish always` against the same tag, in parallel (that's what the matrix is
for). If the release doesn't exist yet, **each job tries to create it**, and two parallel creates
against the same tag is a race — only one asset survived.

**Fixed by adding a `create-release` job that runs once, before the matrix, and creates the
release if it's missing.** Both OS jobs now only ever *upload* to a release that's guaranteed to
already exist, so there's nothing left to race over. If `verify-release` ever fails again on a
tag that was created moments ago (ruling out the 2-hour guard), suspect this job didn't run, was
skipped, or `build`'s `needs:` stopped pointing at it — not a new mystery.

---

## When a bad version ships

**You cannot un-ship.** Apps that already took the update have it; there is no recall.

What you *can* do, in order:

1. **Stop the spread.** On the GitHub release, tick *"Set as a pre-release"* (or delete it).
   `releases/latest` falls back to the previous release, so the download page and every app that
   hasn't checked yet go back to the last good version.
2. **Ship the fix as a higher version.** `0.2.1` reverting `0.2.0` is the only thing installed apps
   will act on — they only ever move *up*. Never re-tag or re-upload the same version: apps cache
   by version and the sha512 won't match.
3. **Tell testers**, if the damage touches their notes. The vault is plain `.md` files on disk
   (rule 1), so their notes survive a bad app — that's the whole point of the format.

**Prevention beats all of it:** gate 3 exists so a bad build reaches testers, not customers.

---

## Renaming the product breaks auto-update, and it is not a code bug

**Renaming `productName` and/or `appId` in `electron-builder.yml` breaks auto-update for
already-installed copies.** Confirmed on v0.8.0's Notes→Notealise rename (2026-08-09):
electron-builder derives the Windows NSIS per-user registry GUID from `appId`, so a build with a
new `appId` is NOT recognized as an upgrade of the old install — it silently adds a **second**
Add/Remove Programs entry alongside the old one, and both entries' uninstallers point at the SAME
shared install folder (the folder name tracked the npm `name` field, not `productName`, so it
didn't change). Left alone, uninstalling the stale old entry deletes that shared folder and takes
the new install down with it.

After any rename release: check `HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` for
a stale entry with the old `DisplayName`, delete that key and its `Uninstall <old name>.exe` stub,
and leave the new entry alone. Also: installs on OTHER machines will not silently update
themselves across a rename — they need a manual reinstall of the new installer. Auto-update
resumes normally on the release after that, once `appId` is stable again.

## Known gaps

- **macOS cannot auto-*apply* an update — but as of 2026-08-25 it does tell you and fetch it.**
  `electron-builder.yml` sets `identity: null`, and Squirrel.Mac *refuses to apply an unsigned
  update* — a signature check, not a dismissible warning. There is also no `latest-mac.yml` and no
  `.zip` (mac updates need a zip; `dmg: writeUpdateInfo: false`). Fixing that properly needs an
  Apple Developer ID (**$99/yr ≈ £80**, not the £220 that gets quoted) + notarization — deferred by
  decision, revisit at marketing time.

  **What was wrong until 2026-08-25, and is worth understanding before touching this again:** the
  macOS guard fired *before* the feed was ever read (`updater.ts`'s `unsupportedReason()` returned
  early inside both `initUpdater` and `checkNow`). So a Mac user was not merely unable to
  auto-update — they were never told an update existed at all. The sidebar showed nothing, and
  "Check for updates" answered "needs a signed macOS build" rather than "0.9.1 is out". They sat on
  a stale build believing they were current, which is the silent version of the problem and the
  one nobody reports.

  `main/macUpdate.ts` now does everything up to the part macOS forbids: reads the public releases
  API through Electron's own `net` (no new dependency, and it inherits the system proxy), picks the
  newest release that actually carries a `.dmg`, downloads it to `~/Downloads` via a `.part` file,
  and reveals it in Finder. The user drags it across themselves. The parse and the version
  comparison live in `shared/update.ts` because they are pure, and are tested against a **real
  captured payload** (`shared/releases.fixture.json`) — the response shape is what would break this
  quietly, and a hand-written fixture would only prove the parser agrees with whoever wrote it.

  Two rules that release process must now keep: **every release needs its `.dmg` asset**, or Mac
  users are silently skipped (a release with no dmg is deliberately not offered, rather than
  offered and broken); and the **asset host allow-list** in `shared/update.ts` is closed — if
  GitHub ever serves assets from a new hostname, downloads fail closed and that list is where to
  look.
- **Windows is unsigned**, so SmartScreen warns on first install ("More info" → "Run anyway").
- **No automated UI tests.** Everything in gate 1's smoke list is manual.
