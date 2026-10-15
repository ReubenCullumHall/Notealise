# voice-check — voice notes in the REAL app, with real input

Built 2026-10-15 (docs/plans/voice-notes.md). Drives a real Electron build on its own profile and a
throwaway two-space vault over Playwright, with real clicks, keys and wheel events. Not shipped; not
part of `npm test`. Kept here because the scratchpad is wiped overnight (the third harness lost that
way) — run it again after any change to the voice note block or to the space swipes.

    WORK=/some/scratch/dir ./build.sh     # scratch copy of THIS tree + a spoken test recording (`say`)
    WORK=/some/scratch/dir python3 menu_zoom.py   # skip-button menu (tick, each side, saved) + Cmd-click zoom cycle
    WORK=/some/scratch/dir python3 scroll.py      # sideways scroll over a voice note, and the space swipes around it

Each script's header says what the Mac printed on 2026-10-15; compare against that. `WORK`
defaults to `/tmp/voice-check`. The app runs muted (`--mute-audio`) and quits normally at the end.
Needs Python Playwright and `~/notes-app-mac/node_modules`.

What they do NOT cover: recording (needs a fake microphone — `--use-fake-device-for-media-stream`
plus `--use-file-for-fake-audio-capture=<wav>`; never `--use-fake-ui-for-media-stream`, which skips
the app's permission handler — docs/security.md 2c), the converter, drag-and-drop of a file, and how
a real trackpad FEELS.

Windows: same idea with `electron.exe`, a junction for `node_modules`, Control instead of Meta, and
no `say`/`afconvert` (record a test file in Voice Recorder instead) — see CLAUDE.md's "real main
process on its own profile" gotcha.
