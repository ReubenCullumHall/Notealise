# Organise, and the theme/token system

Pins, archive, the bin, and the appearance system's current build state.

## Organise (built)

Pins, archive, a recoverable bin, custom drag-reorder, multi-select and Organize mode — ported
from the legacy Sidebar. State lives in `<vault>/.mdnotes/workspace.json` keyed by vault-relative
POSIX path (`main/workspace.ts` — debounced + atomic writes, root captured at schedule time, key
re-mapping on rename). **Archive is a flag; the `.md` file never moves**, and a folder carries its
subtree by inheritance. **The bin is real:** deleting moves the entry to
`<vault>/.mdnotes/trash/<id>-<name>` and records it in `workspace.trash`; Restore puts it back
(collision-suffixed if the name was retaken). This one flat folder holds everything regardless of
which space (if any) an item came from — the random `id` prefix is what lets same-named notes from
different spaces sit in the bin at once — and `TrashItem.from` remembers the item's original
space-qualified path, so Restore recreates that folder if it's gone (which then reappears as an
ordinary new space on the next reconcile, per `docs/feature-tabs-spaces.md` — self-healing, not
orphaned). Emptying the bin has no confirmation prompt: the bin view itself is one click away, and
every item in it already passed its own delete confirmation on the way in. `.mdnotes/` is already
skipped by the tree walk and the watcher, so binned entries leave the tree for free.

**The recovery safety net (2026-08-17).** Deleting something forever from the bin — one item, or
"Empty recycle bin" — used to hand off straight to the OS trash (`shell.trashItem`). It no longer
does: `purgeTrashItem` (main/vault.ts) now moves the entry into `<vault>/.mdnotes/recovery/`
instead, and `main/workspace.ts`'s `purgeEntries` records a `RecoveryItem` (mirrors `TrashItem`,
`purgedAt` instead of `deletedAt`) in the new `workspace.recovery` array. An hourly sweep
(`startRecoverySweep`, started once from `main/index.ts`'s `whenReady`) permanently deletes
(`fs.rm`, the only hard-unlink in the module) anything past `RECOVERY_TTL_MS` (7 days,
`shared/workspace.ts`). Restore or force-delete-now are both exposed, but **only from Settings ->
Recovery** (`settings/Recovery.tsx`) — deliberately absent from the sidebar's bin view, since
reaching this list means delete was already confirmed twice. Force-delete uses the same two-step
"click again" armed-button idiom as `Spaces.tsx`'s `DeleteSpace`, because it's now the genuine,
unrecoverable delete. **`deleteSpace` deliberately still bypasses all of this**, straight to the OS
trash same as before — a product decision, not an oversight, so don't fold it in without asking
first. Still pending: the 7-day expiry itself is implemented and unit-tested (`RECOVERY_TTL_MS`
math) but not yet observed end-to-end in the live app — that needs an actual week to pass.

Still pending:

- **`.mdnotes/` config (partial).** Holds `settings.json` (appearance) and `workspace.json`
  (organisation). Window state and per-note placement still move in later.
- **Theme/token system — done.** `theme.css` holds the `R G B` ramps (dark default + light and
  **black ("Extra dark")** via `[data-theme]`), density vars (`[data-density]`, legacy's values verbatim, including
  `--row-sub` / `--row-sub-display`), and bundled `@font-face`; Tailwind and the editor read only
  tokens. Appearance is set in the Settings panel (gear in the sidebar header), persisted to
  `<vault>/.mdnotes/settings.json` (source of truth) with a paint-value mirror in userData for
  pre-paint. Accent generator ported from `legacy/src/settings.js` into
  `src/renderer/src/settings/model.ts`.
  Three appearance knobs past legacy's theme+density, all per-space, all `data-*` on `<html>`:
  - **`black` — "Extra dark"** is a *variant* of dark, not a third palette. `:root` in the dark rule
    still matches a `[data-theme='black']` root, so its block overrides only the surfaces
    (`--surface`, the low `--brand-*`, `--code-bg`) and everything else — the ink ramp, `--wash`,
    the `hl`/`tc` palette, `--ed-*` — inherits. Add a token to dark and black gets it for free.
    `--surface` stays a hair above `--paper` on purpose: shadows are invisible black-on-black, so
    that 4% and the border are all that separate a popover from the page.
  - **`textTone` (`data-text-tone`)** — grey (the long-standing ramp) or white, on the dark themes
    only; the light theme has no white to give, and its buttons say so rather than no-op silently.
    A **Text-mode accent writes `--ink-*` inline, which beats any selector**, so `model.ts` folds
    the tone into the accent ramp (`WHITE_LIFT`) rather than letting one silently cancel the other.
  - **`buttonDefinition` (`data-button-def`)** — opt-in stronger button edges, every theme, painted
    from `--btn-edge` (per theme: lighter on dark, light grey on black, darker on light). Buttons
    **opt in** — `.btn-edge`, or by class name for the settings window's own controls — because a
    blanket `button` rule outranks `hover:border-*` and would kill every hover state, and would
    repaint the accent borders that mark active states. It only strengthens edges that already
    exist: `border-none` buttons (the Note / Folder nav) are deliberately left alone.
- **Visual match to legacy — chrome and structure done.** Sidebar chrome, search pill, two-line
  tree rows (`TreeNode.preview` is filled from the head of each file in `vault.ts`), nav bar,
  Pinned/Notes headers, archive and bin views, editor header, format bar, reading column and empty
  states all use legacy's own class strings. **Remaining gap:** the editor header's
  "· Edited &lt;date&gt; · &lt;save status&gt;", which needs `updatedAt` and a save-state string
  surfaced to the renderer.
  *When comparing against localhost, open the same folder there* — in browser-storage mode legacy
  says "Local notes" / "Saved in this browser", which are its storage-mode strings, not a mismatch.
- **Settings (partial).** The **shell is now legacy's genie window** — centred 720×600, faded
  `bg-paper/50 backdrop-blur-[5px]` backdrop, left section nav, scrollable content pane, and the
  scale-from-the-gear animation (`.genie` in `app.css`, ported verbatim). The nav is **General**
  (startup) · **Spaces** · **Formatting** (date/number/timezone, `legacy/src/intl.js`) · **Your
  collection** · **Updates** · **Report a bug** (a `mailto:` link opened by main,
  `src/main/support.ts` — no account or API key needed, but the destination address is a
  placeholder pending branding/support-inbox decisions).
  **Legacy's Appearance and Arranging sections no longer exist at the top level** — they belong to
  a space and live inside collapsible sections on the Spaces page, along with Shortcuts. Don't
  "restore" them to the nav; per-space is the point.
  **Your collection** is a shell: three empty states for page looks / fonts / tints, the future
  features whose `pageLook` / `font` / `tint` fields a `Space` already persists (so they land
  without a second migration). It invents **no** storage format — no `collection.json` — on purpose.
  **"Paper", "page look", "font" and "tint" are reserved words in this UI** — they name those
  planned features, so no other control may borrow them. The Light theme's card was briefly
  subtitled "Warm paper"; it is neither (`--paper` is `247 247 246`, a neutral white) and it stole a
  term the collection needs. Describe what the tokens actually are — "Plain white" — and don't coin
  product vocabulary that collides with the roadmap.
  Accent *scope*, and persisting `archiveSort` (Sidebar-local state, lost on relaunch), are still
  to come.

See `CLAUDE.md`'s "the settings rule" and "the theme layer's precedence chain" for the rules that
govern where a new appearance setting goes and why a working control can still silently do nothing.

## Cross-space drag-and-drop, and the "Moved" group (built 2026-08-17)

Drag a note or folder onto a *different* space's tab in the sidebar footer switcher to move it
there in one gesture — including a multi-select, which drags as one unit like everywhere else in
the tree. Hold over an **inactive** tab while dragging (600ms, `SPACE_HOVER_OPEN_MS` in
`Sidebar.tsx`) and it opens on its own, the same "hover a folder to open it" gesture an OS file
manager uses, so a subfolder inside that space can be the actual drop target instead of the
space's root. The active tab never arms a timer (nothing to open); it still accepts a direct drop.

**Cross-space detection is pure path arithmetic, not UI state — on purpose.** `App.tsx`'s
`spaceFolderOf(path, spaces)` walks the same top-level-folder-is-a-space rule
`docs/feature-tabs-spaces.md` describes, and `move()` compares the dragged paths' space against the
*destination* folder's space. It deliberately does **not** ask "which space was active when the
drag started" — hover-to-open changes the active space **mid-drag**, so that question has no
stable answer by the time the drop lands. Comparing the actual paths sidesteps it entirely and
handles a drop on the tab itself, a drop after hover-opening, and a drop into a nested subfolder
with one rule.

**A cross-space arrival always lands at the very front, `anchor` ignored.** The destination wasn't
the list the user was looking at when they let go (they were looking at the tab, or the space they
dragged from) — so alphabetical order, free-arrange mixing, or a precise anchor position would
bury it. It's stamped `EntryMeta.movedAt` (`shared/workspace.ts`) at the same time.

**The "Moved" grouping is per-level, not a global hoist like Pinned.** `organise/model.ts`'s
`splitMoved` partitions one list of siblings into moved (most-recent first) and everything else
(ordinary `sortSiblings`); `TreeView.tsx` calls it once for the top-level tree and again inside
each expanded folder, gated on `mode === 'tree'` (the same flag that already gates drag-reorder,
`reorders`). That's what lets the divider show up wherever the drop actually landed — the space's
root, or a subfolder several levels deep — rather than only ever at the top of the sidebar.

**Clearing `movedAt` is "the user decided what to do with it," not just "moved again."** Three
places clear it, all in `App.tsx`: an ordinary same-space `move()` (a reorder, or dragging a moved
item into its final spot — that action **is** the sorting this feature is prompting for), pinning
it, and archiving it. The last two matter because both hoist the row out of the main tree
(`pinnedRoots`/`withoutArchived`) — without clearing the flag there, unpinning or restoring from
the archive later would drop it back into the main tree still flagged, resurfacing under "Moved"
with a stale timestamp for a decision the user already made. Trashing needs no special case: it
deletes the whole `EntryMeta` (`main/workspace.ts`'s `trashEntries`), and a restore creates a fresh
one, so nothing survives a bin round-trip either way.
