# Release checklist

**Installed apps update themselves.** A bad stable release doesn't sit on a server waiting to be
noticed — it installs itself on every user's machine within about ten seconds of them opening the
app. There is no "revert the deploy" for that. This checklist is what stands in the way.

There is **no staging server**, because there's no server at all. The artifact *is* the product.
So "staging" here means: run the exact thing users would get, somewhere it can't hurt anyone.

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

### Gate 3 — beta

For putting a build in front of real people without risking everyone else.

```powershell
# set "version" in package.json to 0.2.0-beta.1
git commit -am "v0.2.0-beta.1: <what testers should hammer on>"
git tag v0.2.0-beta.1
git push; git push --tags
```

Any tag containing `-` is published as a **GitHub prerelease**, and CI names the channel from the
tag's prerelease part (`-beta.1` → `beta`). Three consequences:

1. `beta.yml` is published instead of `latest.yml`, so only installs on the beta channel see it.
2. GitHub excludes prereleases from `releases/latest`, so **the download page keeps serving
   stable** with no change needed.
3. Stable installs have `allowPrerelease === false` and never look at it.

**After the build, check the release carries `beta.yml` and NOT `latest.yml`.** A beta that ships
`latest.yml` still works — electron-updater falls back to it — so this fails silently. It caught us
once already: electron-builder does not infer the channel from the version for GitHub releases, and
CI has to pass `--config.publish.channel` explicitly.

**Making a tester:** they install a beta build once, *or* turn on **Settings → Updates → Receive
test builds**. Both routes stick. Turning it off returns them to stable (that step down in version
is why the code sets `allowDowngrade`).

Iterate `-beta.2`, `-beta.3`… When it holds up, release the plain version.

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
$l = Invoke-RestMethod "https://api.github.com/repos/ReubenCullumHall/Notes-app/releases/latest" -Headers @{'User-Agent'='ps'}
"latest = $($l.tag_name)"
$l.assets | ForEach-Object { "{0} {1:N1} MB {2}" -f $_.name, ($_.size/1MB), $_.state }
```

All four assets (`Notealise-Setup.exe`, `Notealise-Setup.exe.blockmap`, `latest.yml`, `Notealise.dmg`) must read
`uploaded` **and** `latest` must be the new tag. Only then tell anyone to download.

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

- **macOS cannot auto-update.** `electron-builder.yml` sets `identity: null`, and Squirrel.Mac
  *refuses to apply an unsigned update* — a signature check, not a dismissible warning. There is
  also no `latest-mac.yml` and no `.zip` (mac updates need a zip; `dmg: writeUpdateInfo: false`).
  Mac users always download manually. Fixing it needs an Apple Developer ID (~$99/yr) +
  notarization — deferred by decision, revisit at marketing time. Until then the Mac build shows
  the same UI, but the update button opens the releases page and Settings says why.
- **Windows is unsigned**, so SmartScreen warns on first install ("More info" → "Run anyway").
- **No automated UI tests.** Everything in gate 1's smoke list is manual.
