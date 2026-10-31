# archive-check — the archive's round 2 in the REAL app

Built 2026-10-26 (docs/plans/archive.md, "Round 2"). Drives a real Electron build on its own profile
and a throwaway three-space vault over Playwright, with real clicks. Not shipped; not part of
`npm test`. Kept here because the scratchpad is wiped overnight — run it again after any change to
the archive, the tab strip's right-click menu, Put back, or a sidebar row's six-dot handle.

    WORK=/some/scratch/dir ./build.sh          # scratch copy of THIS tree, built
    WORK=/some/scratch/dir python3 check.py    # 59 checks, screenshots in $WORK/shots

What it covers: a tab's right-click (Move to archive, Close, Escape) and Undo reopening the tab;
File → Move to Archive and its Cmd/Ctrl+Shift+A (clicked through the main process's inspector by
`menu.mjs` — CDP keys skip menu shortcuts, and real OS keys could land in another window called
"Electron"); a link to an archived note opening where you are, with "In the archive · Put back";
Put back into this space and into another; the links strip not showing a moved note twice; the
archive's sort surviving a restart; "Archive this space" and Put back "As its own space" (look kept),
and its Undo; the "?" on a note not edited in 3+ months, its pop-up, "Never ask me this again" + Undo,
selecting instead of asking during a selection, and Yes. It fails on any error in the window's console.

On 2026-10-26 the Mac printed `46/46 passed`. A control run with the links fix switched off failed
exactly the "shows Index once" check.

What it does NOT cover: pressing the real Cmd+Shift+A keys (the menu item is clicked, and its shortcut
is read back), the packaged app, Windows, a large vault.

Windows (2026-10-31, 59/59): `check.py` picks `electron.exe`, `node` and `WORK=%TEMP%\notealise-check\build` by itself —
build with the junction recipe in `../windows-check/README.md` and run `python -X utf8 check.py`. The real Ctrl+Shift+A key
and odd file names are in `../windows-check/archive_windows.py`.
