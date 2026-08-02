# The editor command registry

Every command the editor can run lives in **one** list:
[`src/renderer/src/editor/commands.tsx`](../src/renderer/src/editor/commands.tsx).

Three surfaces read it, and all three pick up a new entry automatically:

| surface | what it uses |
|---|---|
| the four programmable format-bar buttons | `ACTION_GROUPS`, `findAction` (via `SlotPicker`) |
| Settings → Spaces → Shortcuts | the same `ActionGrid` |
| the `/` menu in the editor | `SLASH_COMMANDS`, `matchesQuery` (via `completions.ts`) |

## Why there is only one list

Until 2026-08-01 there were **two**: `toolbarActions.tsx` (13 commands, the buttons) and a private
`SLASH_COMMANDS` array in `completions.ts` (9 commands, the `/` menu). They reimplemented the same
nine commands with different code and shared no ids, so:

- four commands (inline code, LaTeX, link, table) existed on a button but not under `/`, and
  nothing anywhere said which four;
- `/h1` and the H1 button wrote headings through two different code paths;
- adding a command meant remembering to add it twice, and nothing failed if you didn't.

`commands.test.ts` now asserts `SLASH_COMMANDS` equals `EDITOR_COMMANDS`, so the drift cannot come
back quietly.

## Adding a command

1. Write the editor operation in `editor/formatCommands.ts` (or reuse one). Keep `EditorView` a
   **type-only** import there and in `commands.tsx` — that is what lets the whole registry be
   tested against a bare `EditorState` with no DOM.
2. Add one entry to `EDITOR_COMMANDS`:

   ```ts
   {
     id: 'wikilink',                    // NEVER rename — see below
     label: 'Link to a note',
     hint: 'Insert [[ ]] and pick a note',
     group: 'Insert',                   // keep it adjacent to its group siblings
     glyph: iconFace('noteLink'),
     terms: ['link', 'note', 'wiki'],   // extra words the "/" menu matches on
     run: insert(wikiLink)
   }
   ```
3. New glyph? Add the name to `IconName` and a path to `PATHS` in `icons.tsx`.

Nothing else. Both pickers and the `/` menu update from that one entry.

**Keep group members adjacent.** `ACTION_GROUPS` folds *consecutive* commands, so an entry filed
under a group its neighbours don't share silently produces a second heading with the same name.

**To keep a command out of the `/` menu**, set `slash: false`. Nothing needs it yet; it exists so a
button-only command has somewhere to say so instead of someone starting a parallel list again.

## Ids are a file format

A Space's `toolbarSlots` in `settings.json` stores these ids verbatim
(`shared/settings.ts`). Rename one and every vault that used it silently empties that slot — no
error, no log, just a "?" where a button was. `commands.test.ts` pins the thirteen ids that have
ever been written to a settings file; if you must retire a command, leave the id in that list and
delete the entry, so the test says out loud what happened.

Unknown ids read as *empty* rather than throwing (`findAction` returns `null`), because the
catalogue is renderer-side and `shared/settings.ts` cannot see it to validate against.

## `run(view, slash?)` — the one contract worth knowing

```ts
run: (view: EditorView, slash?: { from: number; to: number }) => void
```

`slash` is present only when the command was summoned by typing its name. It carries the range of
the typed `/query`, and the command **must delete it first** — every command acts on the current
selection, so without that `/h1` on an empty line produces `# /h1`. The `consume()` helper in
`commands.tsx` does it; `block()` and `insert()` both call it, so a new command built from either
gets it for free.

It also decides **set vs toggle**:

- a **button** toggles — press H1 twice and the heading goes away;
- a **`/` command** sets — you typed the command's name, so you get a heading, even on a line that
  already had one.

Pressing a button again is a retraction; typing a name is not. `block()` passes `'set'` when
`slash` is present and `'toggle'` when it isn't, and `formatModel.toggleMarker` takes that as its
third argument. Both modes still *replace* a different marker (`/h2` on an `# ` line gives `## `) —
neither gesture ever means "remove" in that case.

## The `[[` menu

`completions.ts` has a second source that offers note titles when you have typed `[[…`. It reads
the vault from the `linkEnv` StateField (see [`decorations.md`](decorations.md)), not from React,
so it works inside the once-created `EditorView`.

This is why `/link` needs no note picker of its own: the `wikilink` command inserts `[[]]` and puts
the cursor between the brackets, which is exactly the state that source fires on.
