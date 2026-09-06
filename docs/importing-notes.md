# Importing notes

Six formats, one pipeline. **Every source is made to produce HTML, and one converter turns that
into Markdown** — which is why a format is ~150 lines rather than the ~1,500 Obsidian's Apple Notes
importer needs:

```
Notion .zip --ditto unzip--> .html --+
Markdown .md ---------- copied verbatim, never converted (it IS the target format)
HTML files/folder -------------------+
Word .docx --mammoth--> HTML --------+--> turndown (html/turndown.ts) --> one NEW space
Google Keep Takeout .json -----------+                                    + Import Report
Apple Notes --AppleScript--> HTML ---+
```

**Adding a format is a module + one `registerImporter` call + one entry in `ImportPanel`'s
`FORMATS`.** Nothing else. The dropdown asks main which formats are *registered* (`import:formats`),
so availability can't drift from reality — that is how Apple Notes is macOS-only without the
renderer knowing what platform it is on.

Rules learned the hard way here; breaking one has cost a rewrite each time:

- **Verify the real export against a real file before writing a parser.** Notion's "Markdown & CSV"
  export contains `.html`, not `.md`, and every source said otherwise. Apple's `account.folders()`
  returns subfolders flat as well as nested, so recursing imports them twice.
- **Child processes:** `stdio: ['ignore','pipe','pipe']`, drain BOTH pipes, always a timeout. An
  undrained stdout hung a 6-second unzip for 30+ minutes with no error. See `notionZip/extractZip.ts`.
- **macOS unzip is `ditto -x -k`, never `unzip`** — Apple's fork mangles non-ASCII filenames into
  invalid UTF-8 and then aborts the whole archive.
- **Never create-then-rename in the vault.** `syncSpaces` runs on every tree load, so a temporary
  "New folder" gets registered as a real space mid-import. `createFolder(dir, name)` /
  `createNote(dir, name)` create with the final name and auto-suffix; `renameEntry` THROWS on
  collision and one throw aborts everything.
- **An importer's writes are echo-guarded** (`markWrite`), so the watcher says nothing about them:
  after a run the renderer must explicitly reload the tree and switch to the new space
  (`SpaceActions.onOpenSpace`), or the notes are on disk and invisible.
- **turndown does not strip `<head>`/`<style>`** — an embedded print stylesheet lands in the note as
  literal CSS. `createConverter()` handles it.
- Everything lands in **one new space, never merged**; re-importing makes another space (warned
  about at preview) rather than merging. Imports preserve the source's modification time
  (`setNoteTimes`); a file's *creation* time can't be set from Node, so that still shows the import.

## What is verified, and what is not (as of 2026-08-05)

**Verified in the running app:** Notion (a real 400MB export), Word (a real .docx with images,
tables, lists), and the editor rendering — tables, inline images, clickable links, tick-boxes,
`<u>`/`<sup>`/`<mark>`, and `[1]` citations keeping their brackets.

**Built and tested only against fixtures, NOT against the user's real data:** Markdown folders,
HTML folders, Google Keep (fixture built from Google's documented Takeout schema — a real Takeout
has never been run through it), and Apple Notes (tested against notes created BY SCRIPT, which
Notes.app rewrites — it turned an injected `<a href>` into `<u>` and dropped an `<img>` — so
script-made notes are NOT representative of typed ones). Treat a first failure in any of these as
"the fixture was wrong", and go and look at the real file before changing code.

## Known limits — decided, not bugs

- **Word text colour is unrecoverable.** mammoth's run model exposes bold/italic/underline/strike/
  vertical-align/font/size/highlight and simply never parses `w:color`. Getting colour means
  parsing the .docx XML alongside mammoth.
- **Apple Notes attachments stay behind** (its scripting dictionary has no attachment-save command;
  only `open note location` and `show` exist) and **password-locked notes cannot be read** at all.
- **A file's creation time can't be set from Node**, so imports restore the *modified* time only —
  which is what the sidebar shows and sorts on. "Created" shows the import date.

## Flagged, not fixed (rule 9 — say so rather than silently leave or silently change)

- **`blockTable` re-scans the WHOLE syntax tree when the document changes**, unlike the
  viewport-scoped passes in `livePreview.ts`. A StateField can't see the viewport, and
  `blockMath.ts` already does the same, so this is inherent to block decorations rather than an
  oversight — but on a very large note it is a real cost, and it contradicts this file's own "only
  the visible viewport is decorated" claim. Narrowed 2026-08-07: it no longer rebuilds on selection
  changes at all (the table renders the same wherever the cursor is), which removed the most
  frequent trigger by a wide margin.
- **`inlineHtmlPass` keeps its tag stack across CodeMirror's disjoint visible ranges**, so an
  unclosed `<u>` could in principle pair with a `</u>` past a scroll gap. `colorPass` beside it has
  exactly the same shape; changing one of the two would be worse than leaving both consistent.
- **`ImportPanel` uses the `format` STATE for its API calls but `current` for display.** They can
  only diverge if the selected format stops being available mid-session, which can't happen today
  (the default, Notion, is always registered) — but it is a trap if a format ever becomes
  conditional.

**Apple Notes is AppleScript, not the SQLite/protobuf route** Obsidian uses. Notes.app's dictionary
gives a note's `body` as HTML, so the whole reverse-engineered-protobuf problem disappears, and it
needs only the ordinary Automation consent rather than Full Disk Access — which matters because this
app is unsigned, and TCC keys Full Disk Access on the code signature. Address Notes by **bundle id**
(`com.apple.Notes`): this app's own productName is "Notealise". macOS-only in two layers — the runtime
guard (never registered off darwin) and `__MAC_BUILD__` in `electron.vite.config.ts`, which lets
rollup drop the module from the Windows bundle. It IS dropped: verified by building with the flag
false and confirming the chunk is not emitted. The dynamic `import()` is load-bearing — a static one
would be hoisted and survive.

---

## Choosing the source: one dialog per mode, decided in main (2026-09-05)

`PICKER` in `ipc.ts` is keyed by an `ImportPickMode` — `'both' | 'file' | 'folder'` — and
`importFormats()` reports, per format, which of them to offer on *this* platform. The renderer draws
one button per mode and never looks at `process.platform`, the same arrangement the format dropdown
already uses (`listImporters`).

It is shaped that way because **only macOS can show a dialog that accepts either a file or a
folder.** On Windows and Linux, `properties: ['openFile', 'openDirectory']` silently becomes a
directory selector — see the cross-platform rule in `CLAUDE.md`. Notion, Markdown and HTML were all
declared that way, so on Windows none of them could take a file: a downloaded Notion `.zip` could
not be selected at all, and the dialog went on advertising `.zip` in its own title. Every Windows
build had shipped like that.

So `both` is offered only where a combined dialog genuinely works, and Windows/Linux get `file` and
`folder` as two buttons. `both`'s options object is kept **verbatim** — it is what macOS still uses,
and the point of splitting was to change nothing there. `word` (file only) and `googleKeep` (folder
only) were never ambiguous and are untouched.

Two consequences worth remembering:

- **Adding a format that accepts either means adding all three modes**, not just `both`, or it
  offers nothing on Windows. `pickModesFor` falls back to `both` rather than dead-ending, but that
  fallback is a safety net, not a design.
- Until this landed, the Notion `.zip` path was **unreachable through the Windows UI**, which is
  why the archive pre-flight below could only be exercised there by handing `importPrepare` a
  dialog-chosen path directly. It is now reachable, and the traversal case was re-verified through
  the real picker.

---

## The pre-flight on an archive (added 2026-09-04)

`importers/notionZip/inspectZip.ts` reads a `.zip`'s central directory **before** anything is
extracted, and `unzipTo` refuses the archive outright if it declares a traversal entry name, a
symlink entry, more than 200,000 entries or more than 4 GiB of expansion. `extractZip` additionally
polls the destination's size every 2s while the extractor runs and kills the child if it exceeds
the cap, because a declared size is a claim and a hostile archive can lie.

**Why it exists.** The original reasoning was that Windows `Expand-Archive` had no containment
check and macOS `ditto` did — **and that turned out to be wrong**, so it is corrected here rather
than quietly dropped.

- macOS `ditto` sanitises hostile entry names. Tested directly with a seven-entry archive carrying
  `../`, deep `../`, absolute, backslash and symlink entries: nothing landed outside the
  destination, `ditto` materialised the symlink as a regular file and refused the write-through.
- Windows `Expand-Archive` **also** refuses them, on current Windows. Tested 2026-09-05 on Windows
  11 26200 / PowerShell 5.1.26100.9278 with seven hostile entry-name forms (backslash,
  forward-slash, deep, mixed separators, drive-absolute, root-absolute, embedded): every one was
  refused or rewritten inside the destination. The `Startup` folder was untouched.

So traversal is not the reason to keep the pre-flight. **Three other reasons are, and they are
better ones:**

1. **`Expand-Archive` exits 0 while refusing an entry**, and `run()` in `extractZip.ts` resolves on
   code 0. So before this landed, a hostile archive imported as a **silent partial success** —
   entries quietly missing, no error, nothing in the Import Report to say so. That is arguably
   worse than a loud refusal, because the user believes the import worked.
2. **Neither extractor checks symlink entries or expansion size.** The zip-bomb and symlink cases
   are entirely the pre-flight's own work.
3. **It is version-dependent.** The containment behaviour above is a property of the PowerShell
   module version on that machine, not a guarantee of the API. Relying on it means the app's safety
   changes when someone else's OS does.

The pre-flight is therefore the app's own answer, applies equally on both platforms, and — unlike
the extractors — **fails loudly**. **It is new code sitting on the happy path**, so any change here needs a real
Notion export imported afterwards, not just the unit tests (`inspectZip.test.ts`, 8 cases, which
build hostile archives byte-by-byte because a zip tool rewrites `../` on the way in).

Zip bombs were unbounded before this: a 204 KB archive of zero-bytes expanded to 200 MiB in 0.13 s
through the exact `ditto` call this guards — a measured ratio of about 1028:1, so ten megabytes of
zip is ten gigabytes on disk, with no progress, no cancel and no error until the volume filled.

## An imported document cannot name a path outside the import folder

`importers/assets.ts`'s `isInsideSource` is the check, and `copyLocalAsset` applies it **before**
`fs.readFile`, not after. Two reasons it has to be before:

1. `path.resolve(sourceDir, target)` **discards `sourceDir` when `target` is absolute** — specified
   behaviour. So `<img src="/Users/you/.ssh/id_rsa">` in an imported `.html` resolved to exactly
   that file, was read, and was copied into the vault beside the user's notes under its basename.
   `isRemoteUrl` did not catch it: it only ever rejected `scheme://`.
2. On Windows the same line accepted a UNC path, and `fs.readFile` on a UNC path **is** the network
   request — an outbound SMB connection to a host the document chose, leaking the user's NTLMv2
   challenge/response. Checking the bytes afterwards would be far too late.

The Google Keep importer resolves its own `attachments[].filePath` and needed the same check
separately.

## The extraction folder is swept, not left

`extractZip` used to remove only the intermediate peel levels; the final extraction was never
cleaned up — not after preview, not after run, not on error. Every Notion import therefore left a
complete second copy of the user's entire workspace in the OS temp directory, indefinitely. For a
product whose promise is that notes are files in one folder you chose, that is a privacy point
before it is a disk-space one. `sweepStaleExtractions()` runs at launch and removes
`notes-import-*` folders older than an hour — swept at launch rather than deleted when an import
ends, because the same extraction is used by `importPreview` and then again by `importRun`, so the
moment it stops being needed is not a moment that module can see.

## Cancel actually cancels

`notionZip/run.ts`'s `createStructure` had **zero** `importCancelled()` checks, and it is the pass
that creates every note and folder — so Stop left the button reading "Stopping…" while the app
carried on building the whole tree. Extraction itself is still not cancellable, and the panel shows
no Stop button during it; that is a known gap, not a fixed one.

## The Import Report is data, not markup

`report.ts` interpolates titles and reasons that came out of the archive. A title may legally
contain a newline on macOS and is entirely free-form in a Google Keep JSON, so a raw interpolation
let an entry close the list and write its own sections — including a convincing "Nothing was
skipped or lossy." The report is the one surface telling the user what did *not* come across, so
`oneLine()` collapses whitespace and escapes markdown emphasis characters.
