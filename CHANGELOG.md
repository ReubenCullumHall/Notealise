# Changelog

Tracks what's been built and verified since the last release, so a release doesn't require
re-scanning the codebase — see `CLAUDE.md`'s "Tracking pending changes" for how entries get
added and consumed. Loosely follows [Keep a Changelog](https://keepachangelog.com/) for the
version-heading/date convention (no Added/Changed/Fixed subcategories — one line per feature is
enough for a solo project). History before this file existed lives in the `v*` git tags.

## [Unreleased]
- Add tabs: open several notes at once as a strip across the top of the editor. Ctrl/Cmd+click a
  note in the sidebar (or a search result) to open it in a tab of its own; a plain click still
  replaces what's open, as before. Ctrl+Tab / Ctrl+Shift+Tab cycle through them, Ctrl/Cmd+1-9 jump
  straight to one, Ctrl/Cmd+W closes one, and tabs can be dragged along the strip to reorder
- Add split screen: up to three columns side by side, each with its own title, format bar, word
  count and cursor. Open one with the split icon at the end of a column's row, with Ctrl/Cmd+\, or
  by dragging a tab onto a column's left or right edge — dropping a tab on the middle of a column
  instead replaces what that column is showing
- Rearrange a split by dragging a column by its own row: onto another column's edge to move it
  there, onto the middle to swap the two. Nothing opens or closes, and the tab strip is unaffected
- Add a "+" button at the end of the tab strip, and an empty column from the split icon: both say
  "Select a note" until you pick one — from the sidebar, from the tabs, or by making a new note.
  An empty column you never fill closes itself as soon as you go elsewhere
- Add "Reopen your tabs" (Settings -> General -> Startup, now on by default, replacing "Reopen last
  note"): the notes you had open and the way they were split come back the next time you launch,
  and each vault remembers its own. Notes renamed or deleted while the app was closed are quietly
  dropped rather than reopened as dead tabs
- Selecting notes for dragging, archiving or binning is now the six-dot handle on the row — click
  it, and Ctrl/Cmd+click more handles for a set. Ctrl/Cmd+click on the row itself opens the note in
  a new tab instead, so the modifier means one thing everywhere
- Remove the Edit/Read toggle: the editor already renders as you type and shows the raw Markdown
  only on the line you're editing, so a separate reading mode was a second way to look at the same
  thing
- The note's name, the format bar, the word count and the split icon now share one row per column,
  and the tab strip is always on screen — nothing appears or disappears as you open notes and split
  the screen, so the text never shifts under you
- Close Window is now Shift+Ctrl/Cmd+W, because Ctrl/Cmd+W closes the current tab, as it does in
  every other tabbed editor

## [0.5.0] - 2026-07-29
- Add an Extra dark theme: pitch black everywhere, for OLED screens and dark rooms. Sits beside Dark
  and Light in Settings -> Spaces -> Theme, and like the rest of a space's look it can differ per
  space
- Add a text colour setting beneath the theme cards — light grey (the default, easier over a long
  session) or white (maximum contrast, pairs with Extra dark). Applies to the dark themes; the light
  theme always uses dark ink
- Add Settings -> Spaces -> Appearance -> Button definition: outlines every button, toggle and picker
  a step further off the background — lighter on Dark, light grey on Extra dark, a darker grey on
  Light. Off by default, and buttons drawn without an edge in the first place are left as they are
- Fix list, heading and quote buttons doing nothing when the cursor sat on an empty line — a new
  note, or straight after pressing Enter, which is exactly when you reach for one
- Add four customisable buttons to the format bar, two each side of B/I/U/S — empty ones show a "?"
  that opens a picker on click; once a button has a command, clicking runs it and you change it in
  Settings -> Spaces -> Shortcuts. 13 commands to choose from: Heading 1/2/3,
  bulleted/numbered/checklist, quote, inline code, code block, LaTeX formula, link, table and divider
- Add Settings -> Shortcuts: set all four buttons against a preview of the bar, or clear them all
- Remove the LaTeX formula (ƒx) button from the format bar's permanent group — not everyone writes
  maths, and it's now one of the commands you can put on a custom button. Ctrl/Cmd+Shift+L still
  inserts a formula either way
- Add Spaces: up to 7 named, emoji-tagged presets, each a real top-level vault folder with its own
  theme, accent, density, sidebar arranging and format-bar buttons (e.g. a maths-revision space can
  carry the formula shortcut while a journal space doesn't). Switch between them from a row above
  "Switch folder" in the sidebar, or from Settings -> Spaces, which also creates, renames (renames
  the folder on disk) and deletes them (straight to your computer's Recycle Bin, not this app's own
  bin — a space is a different thing from a single trashed note). A vault always keeps at least one
  space: a brand-new or emptied-out vault gets one made for it automatically, so notes never end up
  stuck outside every space
- Add Settings -> Your collection: a shell for the page-look, font and tint library the Spaces page's
  "Explore library" buttons will open into, once those features land
- Emptying the bin no longer asks for confirmation — one click and it's gone, since the bin view
  itself is a deliberate stop and everything in it already passed its own delete confirmation

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
