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
    WORK=/some/scratch/dir python3 name.py        # naming a voice note: right-click / six dots when selected, Enter, Escape, Cmd+Z, Remove name
    WORK=/some/scratch/dir python3 ghost.py       # dragging a block: a greyed copy in a gap at the drop point, steady, lands where shown
    WORK=/some/scratch/dir python3 dragvoice.py   # carrying voice notes: lands exactly where its copy showed, no page jumps, via the edges too

Each script's header says what the Mac printed when it was written; compare against that. A check refuses
to run against a scratch build older than `src/` (`common.py`) — run `build.sh` again, and read its
`build.log` if it failed. `WORK`
defaults to `/tmp/voice-check`. The app runs muted (`--mute-audio`) and quits normally at the end.
Needs Python Playwright and `~/notes-app-mac/node_modules`.

What they do NOT cover: recording (needs a fake microphone — `--use-fake-device-for-media-stream`
plus `--use-file-for-fake-audio-capture=<wav>`; never `--use-fake-ui-for-media-stream`, which skips
the app's permission handler — docs/security.md 2c), the converter, drag-and-drop of a file, and how
a real trackpad FEELS.

Windows (works, 2026-10-31): `common.py` picks `electron.exe` and `WORK=%TEMP%\notealise-check\build` by itself and
uses Control for Meta (and Ctrl+Y for redo); build with the junction recipe in `../windows-check/README.md`, make
`memo.m4a` with `../windows-check/make_media.ps1` (copy it into WORK), then run the scripts as above. `NOTE_CRLF=1`
writes the test notes with Windows line endings. Recording, the converter and pasting files are in
`../windows-check/voice_windows.py`.
