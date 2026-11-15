# voice-check — voice notes in the REAL app, with real input

Built 2026-10-15 (docs/plans/voice-notes.md). Drives a real Electron build on its own profile and a
throwaway two-space vault over Playwright, with real clicks, keys and wheel events. Not shipped; not
part of `npm test`. Kept here because the scratchpad is wiped overnight (the third harness lost that
way) — run it again after any change to the voice note block or to the space swipes.

    WORK=/some/scratch/dir ./build.sh     # scratch copy of THIS tree + a spoken test recording (`say`)
    WORK=/some/scratch/dir python3 menu_zoom.py   # skip-button menu (tick, each side, saved) + Cmd-click zoom cycle
    WORK=/some/scratch/dir python3 scroll.py      # sideways scroll over a voice note, and the space swipes around it
    WORK=/some/scratch/dir python3 tape.py        # the tape: corner button, its card, the sidebar player, row star/bin order
    WORK=/some/scratch/dir python3 grip.py        # the six-dot handle on a paragraph beside a voice note (dark, Lined): seen on hover, drags the whole paragraph
    WORK=/some/scratch/dir python3 name.py        # naming a voice note: right-click / six dots when selected, Enter, Escape, Cmd+Z, "Untitled N"
    WORK=/some/scratch/dir python3 ghost.py       # dragging a block: a greyed copy in a gap at the drop point, steady, lands where shown
    WORK=/some/scratch/dir python3 dragvoice.py   # carrying voice notes: lands exactly where its copy showed, no page jumps, via the edges too

Each script's header says what the Mac printed when it was written; compare against that. A check refuses
to run against a scratch build older than `src/` (`common.py`) — run `build.sh` again, and read its
`build.log` if it failed. `WORK`
defaults to `/tmp/voice-check`. The app runs muted (`--mute-audio`) and quits normally at the end.
Needs Python Playwright and `~/notes-app-mac/node_modules`.

Runs on the Mac's own Python 3.9.6 (`common.py` writes the test notes with `open(..., newline=)`, not
`write_text(newline=)`, which needs 3.10). A check also refuses to start when its debug port is already taken —
that is another session's app, and the check would otherwise drive THAT window. While someone else is editing
`src/`, build a clean copy of the last commit instead (`git archive HEAD | tar -x -C <dir>`, then that copy's
`build.sh`) — the old-build guard otherwise stops every run.

**Mac, 2026-11-14/15 (a build of `deff34f`, then with "Remove name" taken out of the menu):** `tape.py` 28 ok ·
`name.py` 14 ok · `menu_zoom.py` 11 ok · `grip.py` 0 failed · `ghost.py` 14 ok · `dragvoice.py` 25 ok, all with 0
failed. Since 2026-11-07 a voice note with no name opens as "Untitled 1" (the vault's one "Untitled N" count,
`editor/voiceUntitled.ts`), and a moved block lands with a blank line on each side; the scripts now expect both.
`menu_zoom.py` used to print its numbers as JSON and judge nothing; it now says ok/FAIL itself. `dragvoice.py` found
a real fault first (dragged under a paragraph, a voice note landed a line lower than its greyed copy); fixed the
same day — the gap now holds the blank line the drop adds, so `dragvoice.py` and `ghost.py` read the copy's own grey
slot (`.cm-drag-ghost-slot`), not the gap round it. `scroll.py` still prints numbers only, with no ok/FAIL lines.

What they do NOT cover: recording (needs a fake microphone — `--use-fake-device-for-media-stream`
plus `--use-file-for-fake-audio-capture=<wav>`; never `--use-fake-ui-for-media-stream`, which skips
the app's permission handler — docs/security.md 2c), the converter, drag-and-drop of a file, and how
a real trackpad FEELS.

Windows (works, 2026-10-31): `common.py` picks `electron.exe` and `WORK=%TEMP%\notealise-check\build` by itself and
uses Control for Meta (and Ctrl+Y for redo); build with the junction recipe in `../windows-check/README.md`, make
`memo.m4a` with `../windows-check/make_media.ps1` (copy it into WORK), then run the scripts as above. `NOTE_CRLF=1`
writes the test notes with Windows line endings. Recording, the converter and pasting files are in
`../windows-check/voice_windows.py`.
