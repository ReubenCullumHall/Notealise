# Security model

Written 2026-09-04, after a full audit of the app, the importers, the update channel, the Electron
shell and the site. 52 findings; 35 fixed the same day. This file is what to read before touching
anything on the list below, so the reasoning doesn't have to be rediscovered.

**Read this before:** changing `vault.ts`'s path handling, adding an importer, adding anything that
renders note content as DOM, touching `electron-builder.yml` or the workflows, or adding a
`window.api` method.

---

## What this app is actually exposed to

There is no server, no account, no sync and no telemetry. Nobody attacks Notealise over a network.
The whole threat model is **content the user chose to open**, and it has three doors:

1. **A note.** `.md` files are the product, so they get shared, synced through OneDrive/Dropbox,
   and handed over in folders. A note is attacker-controlled text that the app renders.
2. **An import.** A Notion `.zip`, a `.docx`, a folder of `.html`. Wholly attacker-controlled, and
   processed by the main process, which can touch the filesystem.
3. **An update.** The build is unsigned on both platforms, so the update channel is the one path
   that ends in code execution if it is subverted. See `docs/feature-updates.md`.

Everything else — the renderer being compromised, `window.api` being driven by hostile script — is
*downstream* of door 1 or 2. That ordering matters when judging severity: a finding reachable with
no compromise at all outranks a more dramatic one that needs a foothold first.

---

## The boundaries, and which one does what

### 1. The vault path boundary (`src/main/vault.ts`)

The only code that touches `fs` (rule 6). Every renderer-supplied path goes through
**`resolveReal`**, which is two checks in order:

- `resolveInVault` — lexical. Resolves against the root and rejects `../`, absolute paths, drive
  hops and UNC. Compares **the first path segment** against `..`, never the string's prefix.
- `realInVault` — resolves symlinks first, then re-checks. A lexical check cannot see a link, and a
  link at `<vault>/Attachments/x` pointing at `~/.ssh/id_rsa` reads as an ordinary in-vault path.
  For a path being *created*, it resolves the deepest **existing** ancestor and re-attaches the
  tail — plain `realpath` throws on a path that isn't there yet.

`setVaultRoot` realpaths the root too. Both halves or neither: on macOS the root is routinely
behind a link (`/tmp` is really `/private/tmp`), so resolving only the incoming path rejects every
path in a perfectly ordinary vault.

**The boundary deliberately lets the vault ROOT through** — `listTree` and `scanLinks` need it — so
every operation that writes or deletes excludes it separately (`isVaultRoot`). That is not
belt-and-braces. `purgeRecoveryItem` was the one destructive function without such a guard, and
because `heldPath` interpolates a bin record's `id`/`name` straight into a path, a record named
`/../../..` aimed the app's only hard `fs.rm` at the entire vault — unattended, from the launch
sweep, with no click and no undo.

Two further rules that fell out of that:

- **`writeNote` refuses `.mdnotes/`.** It is a general "put this text here" primitive the renderer
  drives, and `.mdnotes/` is skipped by both `ignored()` and the watcher — so a write into it is
  invisible in the tree and raises no change event. It was the delivery vehicle for the above.
- **A type annotation is not a check.** `sanitizeFilename(raw: string)` was reached over IPC with
  an **array**: structured clone carries one across intact, `for (const ch of raw)` then yields
  whole elements, and `FORBIDDEN.has('../../evil')` is false — so every separator survived and
  `createFolder` made a directory outside the vault. It coerces now, and `createNote`/`createFolder`
  re-assert the boundary after their `path.join`, the way `renameEntry` always did.

Tested in `src/main/vault.test.ts` against a real temp directory with real symlinks — the two
criticals are in there as regressions, and so is the `..todo.md` case in the opposite direction.

### 2. The renderer has no path to `fs`, and no path to the network

`contextIsolation: true`, `nodeIntegration: false`, a fixed enumerated preload API with no generic
`invoke(channel, …)` passthrough. `sandbox: false` is the one weak setting, and its reason is
recorded in `index.ts`.

The **CSP** is built in `electron.vite.config.ts` and injected into the renderer's HTML. It is a
`<meta>` tag rather than a header from main, because a packaged build loads the renderer over
`file://`, which Chromium serves from its protocol handler rather than its network stack — so
`session.webRequest.onHeadersReceived` is not a reliable place to attach one. A control that fires
in dev over `http://localhost` and silently does nothing in the shipped app is the worst shape this
could take.

Directives worth knowing before you change one:

| Directive | Why it is what it is |
|---|---|
| `script-src` | `'self'` + a SHA-256 of index.html's inline pre-paint script, computed from the real built HTML. Dev uses `'unsafe-inline'` instead, or Vite's bootstrap and the react-refresh preamble are blocked and HMR dies. |
| `img-src` / `media-src` | `'self' blob: data:` — **no remote scheme at all.** Embeds resolve from note text, and a note holding `![](https://…)` fetched on scroll: a working read receipt telling its author when you opened it. Vault pictures are unaffected; they come over IPC as `blob:`. **But see the `file:` correction below — omitting `file:` here does not exclude it.** |
| `font-src` | needs `data:` — `settings/fontLoader.ts` injects downloaded fonts as `FontFace` objects from base64. Drop it and all 16 downloadable typefaces silently stop rendering, looking exactly like a font that never downloaded. |
| `style-src` | needs `'unsafe-inline'`; CodeMirror decorations and the theme layer both set inline styles from JS. |

`imagePass.ts`/`videoPass.ts` refuse a non-vault, non-`data:` target themselves as well, so the app
does not even *ask* — the CSP is the control, that is the manners.

**Correction, 2026-09-05 (measured on Windows, packaged build): that has the two backwards for
`file:`.** The renderer's own origin *is* `file://`, and `'self'` matches the page's origin — so
`img-src 'self'` **admits `file:` URLs**, and leaving `file:` out of the list excludes nothing.
Measured, not reasoned: an `<img src="file://10.255.255.1/share/leak.png">` injected into the
packaged renderer took **21,023 ms** and raised **no `securitypolicyviolation` at all** — a real
outbound SMB connection to a host of the document's choosing, which is the same NTLM leak the
importer's `isInsideSource` was written to close. `file:///C:/Windows/win.ini` was likewise admitted
and merely failed to decode as an image. The remote schemes behave as documented: `https://` and
`http://` were both blocked *with* an `img-src` violation, and `data:` still loads.

So for local and UNC paths the ordering above is inverted — **`imagePass.ts` is the control and the
CSP is the manners.** Nothing is exploitable today only because that code never sets `img.src` for a
target that is neither a vault file nor a `data:` URL, and because `reader/ReadingView.tsx` — the
one component that would emit raw `<img>` straight from note content — is imported by nothing. A
single future line that assigns `img.src` from note text reopens it, with no violation raised and
nothing visible in the UI. **Wire up `ReadingView`, or add any other path from note text to a real
`src`, and this has to be fixed first** — `img-src` would need an explicit allow-list that does not
lean on `'self'`, since on a `file://` origin `'self'` is the whole filesystem and every reachable
UNC host.

`main/index.ts` also carries `will-navigate` and `setWindowOpenHandler` guards. **Neither has a
live route into it today** — the renderer contains no `<a href>` at all, the editor routes link
clicks through `openAllowedExternal`, and `main.tsx` blocks drop-to-navigate. They exist because
the preload bridge re-attaches on navigation, so the day any anchor becomes clickable, one link in
a note would hand an attacker's page the whole `window.api` surface.

### 3. Imports are the widest door

`assertSafeZip` (`importers/notionZip/inspectZip.ts`) reads the archive's central directory
**before** extraction and refuses traversal entry names, symlink entries, >200k entries and >4 GiB
declared expansion; `extractZip` also watches the destination grow and kills the extractor if the
declared sizes were a lie.

**Corrected 2026-09-05.** The audit's stated premise — that PowerShell's `Expand-Archive` joins
entry names onto the destination without a containment check — **does not hold on current Windows**.
Tested on Windows 11 26200 / PowerShell 5.1.26100.9278 with seven hostile entry-name forms: every
one refused or rewritten inside the destination, `Startup` untouched. macOS's `ditto` refuses them
too. So neither extractor is the hole the finding claimed.

The pre-flight is still worth having, for three better reasons: **`Expand-Archive` exits 0 while
refusing an entry** and `run()` resolves on code 0, so a hostile archive used to import as a silent
partial success with entries missing and nothing reported; neither extractor checks symlink entries
or expansion size at all; and the containment behaviour is a property of one OS component's version
rather than a guarantee, so relying on it means this app's safety changes when someone else's
machine updates. `docs/importing-notes.md` carries the detail.

`copyLocalAsset` requires the resolved source to sit under the import folder (`isInsideSource`).
`path.resolve` discards its first argument when the second is absolute, so an `<img src="/Users/
you/.ssh/id_rsa">` in an imported document resolved to exactly that file and copied it into the
vault. On Windows the same line accepted a UNC path, and reading one *is* the network request —
an outbound SMB connection leaking the user's NTLM challenge/response.

The import channels also validate their `paths` against what the file dialog actually returned.
Nothing tied them before, so the renderer could name `~/Documents` and have main walk it.

### 4. The update channel

See `docs/feature-updates.md`. The security-relevant parts: the macOS download no longer reuses a
file already sitting at its target name (the path is predictable and `~/Downloads` is writable by
anything running as the user, so planting one was enough to make the app vouch for it); and
`electronFuses` now closes the living-off-the-land vectors.

---

## Deliberately open, and why

Do not "fix" these without asking. Each is a decision.

| What | Why it stands |
|---|---|
| `allowDowngrade: true` | It is the rollback mechanism in `docs/release-checklist.md`. The cost — anyone who can serve a chosen `latest.yml` can push installs backwards onto a version with a since-fixed bug — was stated once and Reuben's call is to keep it. |
| The build is unsigned | Deliberate and pre-revenue; see the signing memory. It is why the Windows updater's `verifySignature` returns `null` and passes: no `publisherName` exists to check against. Trust is TLS to github.com plus a hash served from the same origin. |
| `sandbox: false` | The preload needs `require()` for the contextBridge setup. Revisit only if that can be made to work sandboxed. |
| The .dmg lands in `~/Downloads` | The *trust* bug is fixed. The location is not, because moving it changes UI copy in two components and the website's install guide. |
| `enableEmbeddedAsarIntegrityValidation` | Off. On macOS it needs a signed bundle to have anything to validate against. Turn it on **with** the signing work, not before. |
| Update checks cannot be turned off | Deliberate — a silently stale install is the bug the feature exists to fix. But it means a 6-hourly heartbeat to GitHub with no opt-out, which is worth a line of privacy copy for a product sold on staying on your disk. |
| Redirect chains aren't re-validated | `isAllowedReleaseUrl` checks the first URL only. The fix is `redirect: 'manual'` plus a per-hop check — but GitHub asset URLs genuinely redirect to `objects.githubusercontent.com`, so getting it wrong breaks downloads outright. |

---

## Traps that cost real time here

- **A fuse flip invalidates the ad-hoc signature.** `electronFuses` rewrites bytes inside the
  Electron binary *after* electron-builder has ad-hoc signed it, and Apple Silicon refuses to exec
  a binary whose signature does not verify. The packaged app died instantly — **no window, no crash
  dialog, empty stdout.** `resetAdHocDarwinSignature: true` fixes it. The only tell was
  `spctl -a -vvv` reporting "code has no resources but signature indicates they must be present".
- **A CSP silently breaks the thing it is protecting.** `script-src 'self'` blocks index.html's
  inline pre-paint theme script, and the symptom is not an error — the app just opens on the dark
  fallback, every launch, for everyone. Hash it, and compute the hash from the *built* HTML at
  `order: 'post'` rather than the source.
- **Typecheck, lint and 638 tests all passed on both of those.** Neither is visible without
  packaging the app and launching it. If a change touches `electron-builder.yml`, the CSP, or the
  fuses, `npm run package:dir` and open the result — that is the only check that can see it.
- **`path.resolve(dir, target)` discards `dir` when `target` is absolute.** This is specified
  behaviour and it is the mechanism behind two separate findings here.
- **`ipcMain.handle` throws on a second registration** for the same channel, and handlers are
  process-wide rather than per-window. Registering them again for a second window is an uncaught
  exception in main, which Electron turns into a JavaScript-error dialog.

---

## What is still owed

Six items need a Windows machine and are listed with reproduction steps in the handoff artifact:
<https://claude.ai/code/artifact/4ec20856-c37f-4568-91a8-782ef55b2f37>. The full finding register,
including the ones judged not worth fixing, is at
<https://claude.ai/code/artifact/558446b5-425d-4296-a6f0-c0782f96debd>.

Dependency bumps (Electron 43.2.0 → 43.5.1, `js-yaml` 4.3.0 under `electron-updater`) need an
`npm install` and a lockfile change, which could not be done from the OneDrive tree.
