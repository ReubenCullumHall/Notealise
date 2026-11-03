# Print / Save as PDF check (2026-11-03)

What it proves, in a real window: right-click a note → Save as… → the Save as window
(format PDF / Web page, page Plain / Keep my look, live preview) → Save… → a real file is
written; the page holds everything in `seed.py`'s notes. Print… opens the same window.
Pure parts (markdown → page HTML, the font-file allow-check) are in `npm test`
(`src/renderer/src/print/noteHtml.test.ts`, `src/shared/printNote.test.ts`).

## Run it (Mac; Windows needs the same steps with its own paths)

1. Scratch copy of the project with `node_modules` linked (never `~/notes-app-mac`'s source —
   other sessions share it). `python3 test_hooks.py <scratch-copy>` adds three TEST-ONLY lines
   to the COPY's `src/main/printNote.ts`: with `PRINT_TEST_OUT=<dir>` set, Save as PDF skips the
   native dialog and writes `<dir>/pdf-<time>.pdf`, the finished page is kept as
   `<dir>/last-pdf.html`, and the print dialog's outcome goes to `<dir>/print-result.txt`.
   The real file is never edited.
2. `electron-vite build --outDir <out>`, `python3 seed.py <vault> <ud>`.
3. `env -u ELECTRON_RUN_AS_NODE PRINT_TEST_OUT=<pdfs> electron <out>/main/index.js
   --user-data-dir=<ud> --remote-debugging-port=<free port> --remote-allow-origins='*'`
   (check the port with `lsof` first: two sessions both picked 9333 on 2026-11-03).
4. `S=<scratch> CLICKS="Web page,Keep my look" SAVE=1 node ui.js` — opens the window from the
   sidebar, clicks those choices (screenshot after each), presses Save…. Env: `NOTE=More`,
   `ITEM="Print…"`, `DARK=1` (dark theme). Needs Playwright from `~/.local/webtools`; to open a
   saved web page, launch Chrome for Testing from `~/Library/Caches/ms-playwright/chromium-*/`.
5. Look at the PDF: `qlmanage -t -s 1300 -o <dir> file.pdf` shows page 1 only.

## What was seen (Mac, 2026-11-03)
Frontmatter, block tag, `[[links]]` as words, colour marks, maths + price-as-text, ticks and a nested
bullet, table, toggle (printed open), 2400px picture shrunk and inline, voice note / video / remote
picture as labelled boxes, file link as text, code kept as written. "Keep my look" embeds Inter and
JetBrains Mono (5 faces). The Mac print dialog opens and stays until acted on; Escape → "cancelled".
The web page opens in Chrome with its fonts and no failed loads. The window in light and dark: the
sheet stays white paper in both.

## Not covered
Windows (save dialog, print dialog, fonts via `file://`), Linux, the dev-server font path
(`http://localhost:5173/…`), a note with hundreds of photos, a printer actually printing.
