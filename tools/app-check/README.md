# app-check — measuring the app in a real window (Mac)

Made for the app check of 2026-11-09 (`docs/app-check-2026-11-09.md`) and kept so a speed or
start-up fix can be measured before and after with the same yardstick. Everything runs a scratch
build on its own profile with made-up notes; nothing touches the installed app, `~/notes-app-mac`'s
profile or real notes (`run_copy.py` reads a real vault, works on a copy, and deletes the copy).

    ./build.sh                      # scratch build of THIS tree into $WORK (default /tmp/app-check)
    MINIFY=1 ./build.sh             # also a compressed build in $WORK/out-min  (LAB_OUT=out-min)
    python3 run_<name>.py <port> …  # pick a free port: lsof -nP -iTCP:<port> -sTCP:LISTEN

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
| `run_media.py <port> <copies> [MB each]` | memory held by a note with big videos |
| `run_copy.py <port> "<real vault>"` | typing on a COPY of real notes (timings only, never names or words) |

Traps already paid for: type new words on a fresh line at the END of a note (`Meta+ArrowDown`, Enter)
— typed at the end of a wrapped row they can join the next word and the count is "wrong"; the made-up
notes carry a `[[link]]` in every paragraph, which makes anything link-related look far worse than a
real vault (say so, and re-measure on `run_copy.py`); vary the VAULT as well as the note — the
heading freeze only showed with 2,004 notes.
