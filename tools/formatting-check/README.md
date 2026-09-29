# formatting-check — "does any Markdown code show?" in the REAL app

Built 2026-09-25 for the "formatting code never shows" work (docs/feature-editor.md). Drives a real
Electron build with real mouse and keyboard over Playwright, and flags any line whose on-screen
text contains Markdown/HTML syntax. Not shipped; not part of `npm test`.

    ./run.sh                      # builds a scratch copy of THIS tree and opens it (debug port 9333)
    python3 realtest.py           # every format at rest, drag-selected, in Markdown pro, link click
    python3 realtype.py           # every format typed by hand, key by key; the style shortcuts
    python3 realedge.py           # click-at-end / End / Home / Enter-mid-word on each kind of line

**2026-09-27:** marks you type now SHOW where you type (a heading's `#` on the cursor's line; `**`,
`*`, `~~`, `` ` `` while the cursor is in that span) — Reuben reversed part of the "never show" rule.
Checks here that place the cursor on a heading or inside bold and expect no marks will now flag
those lines; that is the new expected behaviour, not a bug.

Results land as JSON beside the work dir (`$WORK`, default `/tmp/formatting-check`), screenshots in
`$WORK/shots`. Needs Python Playwright and `~/notes-app-mac/node_modules` (the Mac tree's install).
It opens a second app window on its own profile and a throwaway vault — close it with
`pkill -f remote-debugging-port=9333` when done.

Gotcha: an open note with unsaved edits ignores changes to its file on disk, so the scripts reset a
note by replacing the editor's text directly, never by rewriting the file.

Windows: same idea, but see CLAUDE.md's "real main process on its own profile" gotcha (junction, not
symlink; electron.exe).
