# Changelog

Tracks what's been built and verified since the last release, so a release doesn't require
re-scanning the codebase — see `CLAUDE.md`'s "Tracking pending changes" for how entries get
added and consumed. Loosely follows [Keep a Changelog](https://keepachangelog.com/) for the
version-heading/date convention (no Added/Changed/Fixed subcategories — one line per feature is
enough for a solo project). History before this file existed lives in the `v*` git tags.

## [Unreleased]

## [0.4.0] - 2026-07-28
- Add collapsible + resizable sidebar (panel-left toggle to hide/show; drag the right edge to
  resize between 200-480px; nav button labels drop to icon-only below ~220px)
- Bin and archive buttons now grow to fill the sidebar's width (same height as the settings gear),
  instead of staying a fixed small square
- Add Settings -> Arranging -> "Icons only": drops the Note/Folder nav buttons' text labels and
  centres them as a group, at any sidebar width (hover still shows what each icon does)
- Remove the Organize nav button and its folder-row rename/delete hover icons — drag-and-drop
  (always on) already handles moving/reordering, and the right-click menu already covers rename
  and move-to-bin, so the toggle had nothing left to gate
- Tighten sidebar row spacing (the gap between the drag-handle and the row's icon/title) across
  all density settings, so there's less dead space without shrinking either click target
- Right-clicking empty sidebar space (below the list, or between rows) now offers New note / New
  folder, same as right-clicking a row already did (Electron app only — legacy has no context-menu
  system to hook into)
- Note/Folder nav buttons are now centred in the sidebar regardless of the "Icons only" setting,
  not just when it's on
- Live preview now renders fenced code blocks (styled, matching the reading view) and multi-line
  `$$` math blocks, on top of the existing single-line math and inline formatting
- Fix live preview only revealing/concealing per line instead of per construct — finishing
  `*italic*`, `` `code` ``, a link, a colour tag, or inline math and continuing to type on the same
  line now re-formats it immediately, instead of leaving it raw until the cursor left the line

## [0.3.0] - 2026-07-20
(baseline — see git tag `v0.3.0` and earlier tags for full history before this file started)
