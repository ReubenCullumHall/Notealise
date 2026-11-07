# Block checks — the shared block rules, with real input (2026-11-07)

Run against a scratch build with a debug port (CLAUDE.md "A real main process on its own profile"),
port 9471 in these scripts. Notes they expect in the scratch vault: `Drag`, `Every`, `Select`, `Guard`
(the texts are in the session that wrote them; each script's top says what it opens).

- `heights.py <note> <looks…>` — every line and block is drawn where the editor thinks it is
  (`lineBlockAt(pos).top` vs the drawn top), in each page look. Run with `WAIT=300` too: drift right
  after opening a note is what made the six dots grab the wrong block. 0 misplaced = pass.
- `drag.py <vault> <seed> <count>` — random real drags of every block kind by its six dots: picked on
  the press, moved where aimed, nothing lost, no doubled gaps. 100 drags over seeds 1–5.
- `pick.py <vault>` — drag-select rings blocks, Cmd-click picks several, copy/delete/undo.
- `guard.py <vault>` — no cursor on a block's line, Enter above a block, group drag.

The rules themselves: `docs/feature-done-checklist.md` section 9.

Added 2026-11-07 (the vault also needs `pic.png`, `clip.mp4` and the Drag note; `bintest.py <vault>` makes nothing itself —
put `binv1.m4a`, `binv2.m4a` (copies of any recording) and a `BinTest` note using both in the vault first):
- `mathkeys.py` — a click between a formula and a table lands on the blank line; Backspace/arrows/typing round a formula.
- `endtype.py` — typing at the very end of a note that ends on a voice note / table / picture goes onto a new line.
- `pickmedia.py` — Cmd-click on a picture and a video adds them to a pick; no bold/italic bar over a pick, bar for words.
- `piccode.py` — a click picks a picture; arrows and drag-select never show a picture's or video's code.
- `bintest.py <vault>` — deleting two picked voice notes bins both files; Undo brings back the blocks and the files.
- `split2.py` — a voice note and two picked paragraphs dragged into the other side of a split land spaced.
- `down.py <dir with drag-original.md>` — fast drags downward and to the end of the note.
Ports and the note's starting text are written at the top of each; on Windows use `python -X utf8` and the
modifier is Control, not Meta (search the script for 'Meta').
