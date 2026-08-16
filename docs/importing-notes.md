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
