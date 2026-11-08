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

Added 2026-11-08 — blocks keep their distance (`docs/feature-done-checklist.md` "Blocks — spacing and page looks"):
- `spacing.py [port] [looks…]` — every pair of block kinds, one on the line under the other, on every page look:
  both picked with real Cmd-clicks, outlines >= 2px apart (>= 0 against text), the line below on its rule on
  Lined/Worn, nothing drawn off. Needs a note called `Spacing` (any text) and a.m4a, pic.png, clip.mp4.
  Mac 2026-11-08: 245 pairs, 0 problems.
- `gaps.py <vault> [port]` — the awkward cases: stuck blocks split on open (saved, not undone), a picture in a
  sentence left alone, a transcript between two voice notes, a narrow column, a click in the gap picks the
  block, picked tables/formulas ringed. Writes its own notes. Mac: 26/26.

Starting texts the older checks need (worked out again 2026-11-08 — keep them here):
- `Drag` (drag.py, before EVERY seed — it moves things and doesn't reset): `Para A first words`, a voice note
  `data-name="Voice one"` (src `Lecture%203.m4a`), `Para B middle words`, the table `| a | b |` / `| - | - |` /
  `| 1 | 2 |`, a voice note `data-name="Voice two"` (src `Lecture%203%20take%201.m4a`), `$$` `x^2` `$$`,
  `Para C last words` — each separated by a blank line. down.py only needs `Drag` to hold one voice note.
- `Select` and `Guard` must already show a voice note when opened (they wait for one, then set their own text).
- `Table` (split2.py): any table. Close the split it leaves open before running down.py.
- Files: `Lecture 3.m4a`, `Lecture 3 take 1.m4a` (copies of any recording), `a.m4a`, `b.m4a`, `pic.png`, `clip.mp4`.
