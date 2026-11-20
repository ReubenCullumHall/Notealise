# app-check — measuring the app in a real window (Mac)

Made for the app check of 2026-11-09 (`docs/app-check-2026-11-09.md`) and kept so a speed or
start-up fix can be measured before and after with the same yardstick. Everything runs a scratch
build on its own profile with made-up notes; nothing touches the installed app, `~/notes-app-mac`'s
profile or real notes (`run_copy.py` reads a real vault, works on a copy, and deletes the copy).

    ./build.sh                      # scratch build of THIS tree into $WORK (default /tmp/app-check)
    MINIFY=1 ./build.sh             # also a compressed build in $WORK/out-min  (LAB_OUT=out-min)
    python3 run_<name>.py <port> …  # pick a free port: lsof -nP -iTCP:<port> -sTCP:LISTEN

**Every launch is hidden** (since 2026-11-19): `lab.launch` loads `quiet.cjs` into the scratch app, so its window opens
off-screen and never takes focus — Reuben works while checks run. `LAB_SHOW=1` shows it; `LAB_SIZE=1280x900` makes the window bigger. Write new checks to open ONE
window and reset between cases inside it; a launch per case flashed a window up every ~10 s.

For a "before", build HEAD somewhere else (`git stash` is not safe in the shared tree — copy
`git show HEAD:<file>` over a scratch copy of `src/`) and point `WORK` at it.

| script | what it answers |
| --- | --- |
| `run_startup.py <port> small\|big\|both` | how long from starting the program to the note list (244 / 2,004 notes) |
| `run_typing.py <port> small\|big` | freezes and slow frames while typing in a 150 / 2,000 / 10,000-line note; does the sidebar line follow |
| `run_profile.py <port> Long\|Huge [keys]` | which functions the time goes to while typing |
| `run_mutations.py <port> Typical` | what the window rebuilds and re-measures while typing |
| `run_wordcount.py <port>` | the word count: on open, while typing, after a rename, after an outside change (10 checks) |
| `run_firstkey.py <port> small\|big` | which kind of typing freezes in a big vault (first key, a heading, a link) |
| `run_locked.py <port> inside\|top\|root` | a folder the app may not read — does it still open |
| `run_dot.py <port>` | a notes folder whose name starts with a dot — are outside changes noticed |
| `run_media.py <port> <copies> [MB each] [a real clip]` | memory held by a note with big videos (made-up bytes, or copies of a real clip — each is then played for 2 s) |
| `run_copy.py <port> "<real vault>"` | typing on a COPY of real notes (timings only, never names or words) |

Added 2026-11-12 with the memory fix, the heading freeze and the small fixes. `./make_media.sh` first (real
films, recordings, pictures, a .docx — into `$WORK/fix`; `LONG=1` for the hour-long recording). The first group
takes `WORK=<build dir>` like the ones above; the second takes the build dir as an argument and `APP_BIN=<binary>`
to run against a PACKAGED app instead. Run each on a build of HEAD and on the change, and compare.

| script | what it answers |
| --- | --- |
| `run_media_real.py <port>` | do real pictures (odd names, no extension, .svg, missing), films and voice notes show, play, seek — and SOUND (the mixer's output level) |
| `run_media_leave.py <port> <copies> <clip\|none>` | after films were played and the note left: what each part of the app still holds, and is any `<video>` alive |
| `run_voice_memory.py <port> <copies> [play]` | recordings: memory with their note open, after leaving it, and with one left on the tape (`LONG=1` media) |
| `run_voice_peak.py <port> <copies>` | long recordings' waveforms: FOOTPRINT at its highest with their note open, time until every waveform is drawn, what is left after leaving (`EARLY=3` leaves after 3 s) — the 2026-11-14 waveform fix |
| `run_voice_rename.py <port>` | an hour-long recording still plays to the end after its folder is renamed outside the app |
| `run_pictures_scroll.py <port>` | a note of 24 pictures scrolled down and up: how long each takes to reappear |
| `run_firstkey_frames.py <port> small\|big [note]` | like `run_firstkey.py`, but the longest gap between frames (catches what is under 50 ms) |
| `run_links_same.py <port> <out.json>` | every link chip and backlink on a set of awkward notes — `cmp` the two builds' files |
| `run_search_outside.py <port>` | Search notes after a note changed outside: time to find its new word; nothing stale |
| `run_media_guard.py <port> <build> [dev]` | the media address can be SHOWN, never read: fetch, canvas, a guessed address, a path outside the vault (`dev` = served by `vite.dev` like `npm run dev`) |
| `run_media_svg.py <port>` | an `.svg` picture shows, and one holding a script, an onload and a remote picture runs and fetches nothing |
| `run_media_frame.py <port> <build> [dev]` | …nor framed, embedded or run as a script (a vault `.html` named as a picture) |
| `run_import.py <port> <build>` | a real Word import and web-page import (the file box is answered by `patch_dialog.mjs` through `--inspect`) |
| `run_transcribe_quit.py <port> <build>` | quit part-way through a real transcription: what is left in the temp folder (`main_eval.mjs` asks the app to quit) |
| `run_temp_sweep.py <port> <build>` | the launch clean-up of old temp folders — and what it leaves alone |
| `run_recovery_sweep.py <port> <build>` | the 7-day tidy-up at launch with one expired item that can't be deleted |
| `run_drag_sweep.py <port> <row> [release [y,y…]]` | (takes `WORK`) the drag line pixel by pixel down a seeded list (Moved group, open folder, empty folder), then — with `release` — lets go 1px each side of every edge and checks it lands where the line was. Needs a build with `;(window as any).__hint = h` added at the top of TreeView's `setHint`. A robot drag only updates on a move: wiggle sideways, never up/down, or an edge pixel reads the next row |
| `run_drag_targets.py <port> [case,…]` | (takes `WORK`) the sidebar's other drop targets — pinned folder / pinned note, this space's and another space's button, Bin, Archive, Pinned→list: what is lit at release vs what moved |
| `run_drag_tabs.py <port> <tab> [release [x,…]]` | (takes `WORK`) the tab strip: bar / split / swap / island at every x, then releases each side of every edge (2026-11-19: 50/50) |
| `run_drag_panes.py <port> [release [x,…]]` | (takes `WORK`) a sidebar note over an open note: split-left / replace / split-right box at every x, then releases at each edge |
| `run_drag_files.py <port>` | (takes `WORK`) a picture dragged in from outside over a line, a table, the heading, the last line: the drop line vs where it lands (a new line under that block, an empty line first under a table), no text caret, the line gone off the note — one window for the whole run |
| `run_drag_extras.py <port>` | (takes `WORK`) the 2026-11-19 drag extras in ONE window: a closed folder opens while held over, Pinned takes a drop and pins it, "Moved · Undo", "2 notes" beside the pointer, Finder files onto a folder (a note at the line, a picture copied, a program left out), a file held over a tab, the band over a table + one Cmd+Z, Option-drag a link (and plain drag unchanged), a block onto a sidebar note + its Undo (26 checks). Grab rows with `scroll_into_view_if_needed` first — a row below the list's bottom edge can't be pressed |
| `run_drag_top.py <port>` | (takes `WORK`) two notes dragged to the very top of a mixed notes-and-folders list land at the top, folders stay put (`FREE=0`: setting off) — the 2026-11-18 drag fix |
| `run_bin_and_pin.py <port> <build>` | bin one note and pin another at the same moment, 40 times (kept everything on both builds on this Mac — the fault needs a slow disk; `main/workspaceTurns.test.ts` shows it) |

Drag traps (2026-11-19): a robot drag is NOT cancelled by Escape — carry it back to where it started before letting go, or
it drops (a "plain drag" check opened a second column that way); grab a row only after `scroll_into_view_if_needed`.
More traps paid for: this Mac's `python3` is 3.9 — no backslash inside an f-string's braces, no
`write_text(newline=…)`; a packaged app only takes `--inspect` if the scratch copy's `electron-builder.yml` has
`enableNodeCliInspectArguments: true` (never the real one); opening a second note costs ~130 MB by itself, so take
the "after leaving" memory against a floor with that note already open; made-up bytes are not a film — measure
playing with real clips too; a 59-minute recording takes the window up ~3 GB for a few seconds while its waveform is
drawn — the browser's decoder, one at a time since 2026-11-14 (use recordings just over an hour to measure anything else).
**Judge memory by the footprint (`footprint -p <pid>`, what Activity Monitor shows), not `ps`'s RSS**: after a big decode RSS
kept ~2 GB the system had already been handed back, and read as a leak that wasn't (`run_voice_peak.py` prints both).

Traps already paid for: type new words on a fresh line at the END of a note (`Meta+ArrowDown`, Enter)
— typed at the end of a wrapped row they can join the next word and the count is "wrong"; the made-up
notes carry a `[[link]]` in every paragraph, which makes anything link-related look far worse than a
real vault (say so, and re-measure on `run_copy.py`); vary the VAULT as well as the note — the
heading freeze only showed with 2,004 notes.
