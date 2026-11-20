# import-check — trying each import the way a new user would (Mac)

Made 2026-11-16 for the seamless-importing update (`docs/plans/seamless-importing.md`).

    WORK=<scratch dir> ../app-check/build.sh            # a scratch build of this tree
    python3 make_fixtures.py <scratch dir>/fix          # made-up exports: Notion (web-page and .md shaped),
                                                        # an Obsidian-style folder, web pages, a .docx, a Keep Takeout, two big ones
    python3 walk.py <port> <scratch dir> "name=Format label=path" …   # clicks Settings → Data → Import for each, prints what
                                                        # is on screen, times it, screenshots into <scratch dir>/shots
    python3 look.py <port> <scratch dir> <vault> "<note title>" …     # opens notes (Go to a note) and photographs them

`walk.py` wipes `<scratch dir>/work/vault` at the start of every run — read the output before the next run.
The file box is answered by `../app-check/patch_dialog.mjs`. Pick a free port (`lsof -nP -iTCP:<port> -sTCP:LISTEN`).

**The exports are hand-made from what each app's export is known to look like — not real exports.** A finding about
Notion or Keep markup is a lead until it is seen with a real export. Apple Notes is not covered (it reads the real Notes app).
A long scratch path makes Notion-style names hit the 260-character limit ("That name is too long") — keep `<scratch dir>` short.

`LOOK_SCROLL=900 python3 look.py …` scrolls each note down that many pixels before the picture. Go to a note is
switched to "every space" by the script, so imports laid out as separate spaces are reachable.

## The Notion converter (parked 2026-11-20)

The Notion converter and its prototype (`notion_proto.mjs`) are kept on the local branch
`parked/notion-import`, not on `main` — Reuben, 2026-11-20: "park this idea, forget notion import".
`git show parked/notion-import --stat` lists the files; the plan is `docs/plans/seamless-importing.md`.
