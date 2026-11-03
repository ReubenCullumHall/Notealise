# Go to a note (Cmd/Ctrl+P) — check

`jump_check.py` drives a real Electron build over CDP: opens the pop-up through the real File → "Go to Note…" menu item, types,
moves with the arrows, opens with Enter / Cmd+Enter / a click, closes with Escape / the key again / a click outside, and checks
the key is ignored while another window is over the notes. It also covers the two toggles it shares with the sidebar bar
(titles / contents, this space / every space) and that Enter on a text match selects the words in the note. 38 checks.

CDP keys skip menu accelerators, so a scratch build needs a small hook in ITS OWN `src/main/index.ts` (never the real one): after
`installMenu()`, poll for a file named by `$JUMP_TRIGGER` and, when it appears, delete it and `.click()` the menu item labelled
"Go to Note…". The OS turning Cmd+P into that click is Electron's and is NOT covered here — press the key by hand once.

Vault (any folder; the app's first space varies):
`Study/Physics/Waves.md  Study/Physics/Optics.md  Study/Waves of change.md  Study/Plan A.md  Study/Café ideas.md
Journal/My plan.md  Journal/Plan B.md  Loose note.md`, with "refraction" written in the body of Plan A, Plan B and Loose note (and nowhere in a title), and a profile whose `config.json` is `{"vaultPath": …, "hasOnboarded": true}`.

    Electron out/main/index.js --user-data-dir=<ud> --remote-debugging-port=<port>    # JUMP_TRIGGER=<file> in its env
    python3 tools/jump-check/jump_check.py <port> <file> <screenshots-dir>

Pick your own debug port: other sessions' scratch apps use 9333, and a check that connects to the wrong window types into it.

`frames.py` (same setup) freezes the open / grow / close motion at set times and writes one labelled sheet of stills, for judging the look.

`smooth.py` (same setup, best on a vault of a few hundred notes) times every frame while it opens, while you type and while it closes, with the CPU slowed (default 4x), and repeats with each effect switched off by an injected style — to tell which effect costs what. 2026-11-03, 320 notes, 6x slower: opening and closing held 60 fps; typing dropped a frame or two.
