# Changelog

Tracks what's been built and verified since the last release, so a release doesn't require
re-scanning the codebase — see `CLAUDE.md`'s "Tracking pending changes" for how entries get
added and consumed. Loosely follows [Keep a Changelog](https://keepachangelog.com/) for the
version-heading/date convention (no Added/Changed/Fixed subcategories — one line per feature is
enough for a solo project). History before this file existed lives in the `v*` git tags.

## [Unreleased]

## [0.9.0] - 2026-08-25
- The editor no longer switches off your computer's spell check. It had been turning it off for
  every note, so a machine set to check your spelling everywhere else was told not to bother here,
  and there was nothing you could do about it. The app still ships no dictionary of its own — if
  your writing gets checked it is your system doing it, with the words you have already taught it.
  Autocorrect stays off on purpose: underlining a word is advice, rewriting it is not, and in
  Markdown that rewriting means curly quotes turning up inside a code block. **Not yet confirmed to
  mark words on macOS** — see docs/product-rulings.md; the block is definitely gone, whether the
  underline arrives is what testers need to tell us
- Drag the line between two side-by-side notes to give one of them more room. Double-click it to
  put them back to even, or use the arrow keys once it has focus. Each space remembers how you left
  its columns, and a column will not shrink below the width where text stops reading as a column
- Fixed: selecting several lines drew a ragged block, with a notch out of the top-left corner and a
  small tab hanging off the bottom-left. Most visible on an empty note, where there is nothing else
  in the selection to distract from it. The editor's 28px margin was on the wrong element, so
  CodeMirror worked out where the text began from the wrong edge and drew the full-width part of a
  selection 28px wider than the first and last lines. Nothing about the note's layout changes
- A grip now appears beside whichever paragraph you are working on, matching the one on a photo and
  the one on a note in the sidebar. Drag it to move that paragraph up or down the note. A code block
  or a table moves whole, blank lines inside it included; select several lines first and it moves
  exactly those
- Drag a paragraph or a picture from one side of a split view into the other to move it between
  notes. Hold Alt to leave the original where it is. A picture's link is re-pointed as it lands, so
  it still shows in its new note without a second copy of the file appearing in the vault
- With the eye on, clicking the code under a picture now copies that link. Paste it into another
  note and both notes show the same picture from one file, instead of the vault filling up with
  duplicates
- Deleting a picture from a note no longer deletes the file when other notes are still using it.
  The text goes, the file stays, and a line says which notes still hold it. The file is only moved
  to the bin when the last note stops using it — before this, removing a picture from a note you had
  pasted it into silently took it out of the note you pasted it from
- The confirmation for deleting a shared picture now names every note that would lose it, and each
  one is a link: click to go and look at exactly where it sits in that note, or Cmd/Ctrl-click to
  open it in a tab and keep deciding
- Fixed: the six-dot handle for reordering a table's columns was cut off along its top edge. A
  table clips anything overhanging its box, and the room reserved above it was 8px short of what
  the handle needed
- Fixed: adding a photo to a note and then switching away made that note invisible to the app. The
  index lays open notes over the last scan of the vault, so a note's edits counted only while it was
  open — the moment it left the tab strip the app fell back to what the scan had said at startup,
  and nothing ever rescanned it. That is why deleting a photo two notes shared gave no warning: the
  second note was not, as far as the app knew, using it. The other note then lost its picture, and
  because the loaded copy was still in memory the damage only showed after a restart. A note is now
  re-read the moment its buffer is let go, and a change to the EMBEDS counts as a change worth
  re-indexing, not just a change to the links
- With the eye on, clicking the code under a picture now selects the whole line, ready to copy.
  It used to put the cursor on the picture instead — which collapsed the selection, ringed the
  picture and jumped the view back, so the one thing that read-out exists for could not be done
- A note's scrollbar is now hidden until you move the pointer near it. In a split view the left
  pane's bar runs down the middle of the window between the two notes and reads as a divider; it
  only ever appears when a note is longer than the window, and it stays grabbable the moment it
  shows
- Hold a drag near the top or bottom of a note, or of the sidebar, and it scrolls — the bottom and
  top sixth of whichever pane you are over, at a speed that ramps up the closer you get to the edge.
  On a trackpad the fingers that would scroll are the ones holding the drag, so moving a photo or a
  note further than one screenful was simply not possible before
- Hover labels no longer run off the edge of the window. The vertical position assumed every label
  was a single line 28px tall; the eye's label wraps to two, and the eye sits in the bottom-right
  corner, so its label was pinned to the window edge with the rest hanging off the bottom. Labels
  are now measured after they are laid out, flip above the control when there is no room below, and
  are clamped into the window on both axes at any size
- The six-dot handle on a photo or video no longer pops up a "Drag to move" label. Hover labels are
  drawn as bare text with no panel behind them, so floating over a note it picked up the note's
  typeface instead of the interface's and read as stray serif text lying on the picture. The dots
  already say what they are
- Pasting a big video and switching notes before it finishes now says "try again", and the picture
  loader retries once before giving up — a large file was still being written when the note asked
  for it, so it showed "Video not found" for a file that arrived a moment later
- "Show me this file on my computer", on a bin or recovery row, now explains itself first: the
  folder it opens is a holding pen inside a hidden `.mdnotes`, and moving or renaming the file there
  leaves Restore with nothing to find. For a photo it also names the note it came out of and asks
  you not to edit that note until it is back, because restore aims at the words either side of where
  the picture sat
- Restoring or deleting the last thing in the bin now takes you back to your notes, the same way
  "Empty recycle bin" already did — rather than leaving you on an empty shelf to find the way out
- Fixed: restoring two photos at once that were deleted from the same part of a note put the first
  one at the end. Each one remembers the text around it as it stood when THAT one was cut, so the
  earlier photo's memory still mentioned the later one; they now go back most-recently-deleted
  first, which rebuilds the note each one was recorded against
- Development: `src/main/workspace.test.ts` runs the bin, the recovery net and restore against a
  real temporary vault. It exists because a bug hid in the one place nothing covered — both halves
  either side of it were tested, so a bin record that reached disk without the note position on it
  looked like the restore was broken. Also `src/shared/media.ts`: the groundwork for giving every
  attachment an identity that survives being renamed, matched only when exactly one missing file and
  one new file agree on size and kind, so a note is never repointed at the wrong picture. Nothing
  is wired to it yet
- Selecting a photo or video by its grip no longer paints a grey selection block over it or parks a
  full-height cursor beside it — the ring around the picture says it is selected, which was always
  the intent. There was a rule meant to do this already, but it targeted the browser's own
  `::selection` while the editor draws its own selection layer, so it read correctly and had never
  applied. Ordinary text selection is untouched
- Restoring a photo or video from the bin now puts it back in the right place even if you have
  been editing the note since. It used to remember a line and column, which describe the note as it
  was at the moment you deleted — type two paragraphs at the top and every line below moves, so the
  picture came back somewhere else entirely while the message still said "back where it was". It
  now remembers the text either side of the picture instead, and finds that again on the way back.
  Where the note has been rewritten around the spot, the picture goes on the end and says so rather
  than guessing — and "back where it was" is now only said when it is true
- Development: `npm run sync:mac` copies the source into the Mac run copy at `~/notes-app-mac`,
  verifies the two trees came out identical, and stops any dev server left running (the main
  process never hot-reloads, so a live one would serve old main against new renderer). It replaces
  `~/notes-app-mac/run-mac.sh`, which lived in the disposable copy and had gone missing — the
  documented sync step was silently doing nothing, and the two trees drifted two days apart. That
  drift, not the restore logic, was behind the blank-white-window and the photos that came back to
  the vault but not into their note: the copy being tested had no error boundary and did not record
  where in a note a photo came from
- Deleting a space now takes its saved look with it by default, instead of leaving it behind in
  Settings -> Spaces -> Saved presets as an orphan you'd have to clean up yourself. A prompt next
  to the delete button — "Save the preset before deleting?" — lets you keep it in one click if you
  want to reuse that look later. The "Use on…" button on each saved preset is bigger, and its menu
  no longer renders behind the Theme section below it
- Drag a note or folder onto a different space, in the switcher at the bottom of the sidebar, to
  move it there — hold over a space while dragging to open it and drop into a specific subfolder,
  and a multi-select moves together. Anything that arrives this way lands at the top of its new
  home, under a small "Moved" divider, instead of getting lost in the usual sorting; drag it into
  its final spot to clear that
- First-run onboarding: opening the app for the first time now walks you through it — choosing a
  vault folder, importing notes you already have (skip is one click, no "are you sure"), naming
  the spaces you take notes for, writing your first note, seeing that note as a real .md file on
  your disk, then picking a font and an accent colour to write in. Finishing seeds a handful of
  curated welcome notes (skipped if you imported instead) pointing at tutorials, report-a-bug and
  request-a-feature, and hands off into the app with a short fade rather than ending on a separate
  closing screen. Quitting partway through and reopening resumes at the exact step you left.
  Settings -> General -> Developer can replay it. Picking an 11th space at the Spaces step (the cap
  is 10) now says so instead of silently doing nothing. The Import step no longer flashes its own
  "Import complete" screen before auto-advancing to "Notes brought in" — that screen and its
  buttons used to disappear before there was any real chance to read or click them. The font-picker
  screen no longer repeats a text sample under the cards; each card's own preview is enough
- New setting, Settings -> Spaces or Customisation -> Fonts: pick a typeface for a space's
  interface (sidebar, settings, buttons) and separately for its notes (body, headings, title), plus
  a dyslexia-friendly override for just a note's body text. Four fonts ship with the app (Inter,
  OpenDyslexic, JetBrains Mono, Fraunces); sixteen more are previewable and downloadable on demand
  from Settings -> Your collection -> Fonts, or bring in your own .ttf/.otf/.woff/.woff2. Code
  blocks always stay JetBrains Mono, whatever else is picked
- New setting, Settings -> Linking content -> position: put a note's links strip at the bottom of
  the note instead of the top, for a space whose header is already busy. Top stays the default for
  every existing space
- Deleting something forever from the bin — one item, or the whole "Empty recycle bin" — no longer
  sends it straight to the OS trash. It now waits 7 days in a hidden safety net (Settings ->
  Recovery) before the app deletes it for good, so nothing you delete through the app can vanish
  by accident. Restore it any time from there, or delete it immediately if you don't want to wait
- New setting, Settings -> General -> Animations: turn off interface motion (the settings
  window's open/close animation, hovers, dropdown fades and the like) for instant transitions
  everywhere
- A brand-new space (including your very first one) now defaults to following your system's
  light/dark setting instead of always opening in Dark, so a fresh vault doesn't land jarring
  against the OS. Pick "System" any time in Theme, under Settings -> Spaces or Customisation, to
  switch a space back to following the OS — it re-applies live if you flip the OS setting while
  the app is open
- A short wordmark animation now plays while a vault opens — white ink on dark themes, dark ink on
  light, matching whichever space was last open — then fades into the app. Off switch in
  Settings -> General
- The "alise" wordmark on the landing page is now drawn in the order the word is actually written
  by hand — every letter rises out of the baseline where the last one left off, doubles back where
  a pen would, and the i is dotted at the top mid-word. It used to start each letter at its top or
  its middle and fly the pen across the word between them
- Each letter's first mark is now a rounded pen-down instead of a squared-off cut edge
- Fixed white hairline cracks that were left through the finished s and e — they were there in
  every frame, including the final one, and were invisible to the animation's own coverage check
- Fixed a stray mark in the landing page's "Note" typing: a slice of the t's crossbar appeared
  next to "No" a step before the t itself did
- Paste an image, drag a photo or video in from Finder, or use "Photo or video" in the / menu or
  a format-bar slot to add it straight into a note — it plays or shows inline as you write, right
  where you put it. Hover it to reveal a small grip and drag the whole picture or video up or down
  past other lines to move it elsewhere in the note
- Click a photo or video's grip to select the whole thing, then Backspace to delete it. It leaves
  the note and the file goes to the bin, alongside your deleted notes and with the same 7-day
  recovery net beneath it, so nothing is lost by a mis-hit key. You get asked first — the dialog
  offers Cancel, which puts the picture straight back exactly where it was, and a pair of ticks,
  "Always ask" and "Never ask again", so how much checking you want is your call. With the asking
  off, a delete says "Moved to the bin" with an Undo beside it instead. Settings -> General ->
  Photos and video turns the asking back on. Enter no longer means Delete in that dialog — it lands
  on Cancel, so the key you press to make a box go away can't be the one that deletes a file
- Restoring a photo or video puts it back INTO the note it came out of, at the spot it was — not
  just back into your vault for you to find and re-add. It works from the bin and from the 7-day
  recovery list alike, and if the note has changed so much that the spot is gone it lands at the
  end and says so. Both lists now mark media with a "Media" tag and an information dot explaining
  this, and restoring anything at all — note, folder or photo — offers a "Navigate" button to go
  straight to where it landed, so you don't restore something and then have to hunt for it
- Deleting one photo no longer turns the one next to it into code. Drag three files in at once and
  they sit on consecutive lines; deleting one put the cursor onto its neighbour's line, which is
  what makes an embed show its raw source, so the survivor flipped from a picture into
  `<video controls src="...">`. The cursor now lands on the line ABOVE, and a cursor merely
  touching the edge of a photo no longer counts as being inside it
- The app can no longer show you a blank white window. A crash anywhere in the interface used to
  unmount everything, leaving an empty window with no message and no way back — now it says what
  broke, says plainly that your notes are safe files on your disk, and offers a Reload button
- The app now keeps track of which notes hold which photos and videos, rather than only knowing
  what one note's text happened to say. The first thing it buys: deleting a photo that a second
  note also shows now says so — "It's also in Packing list, which will lose its picture" — instead
  of quietly breaking the other note. It's built from the same scan the backlinks already use, so
  it costs no extra reading of your vault, and it updates as you type
- Every row in the bin and in Settings -> Recovery gained a "Show me this file on my computer"
  button. A deleted file physically waits inside `.mdnotes/`, which is a hidden folder on both Mac
  and Windows — so "it's in the bin, nothing has left your disk" was true and completely
  impossible to check for yourself
- Restoring something onto a name that has been taken since puts it back with a suffix rather than
  overwriting, which it always did — but it now says which name it actually used, and a restored
  photo's markdown is re-pointed at that name instead of coming back as a broken picture
- New eye button in the corner of a note: shows the code behind each photo and video, printed under
  it, with the rest of the note left formatted. For answering "what file is this actually pointing
  at" when a picture won't load or a file has been renamed underneath it. Separate from the
  Markdown pro raw-view switch, and remembered per note
- Fixed a successful import reporting itself as "Import failed" when the app hit a problem opening
  the new space afterwards. The notes were already safely on disk, but the message sent you back to
  the setup screen and invited a retry that would have brought everything in twice

## [0.8.0] - 2026-08-09
- Dragging a note out of a folder now works by dropping it on empty space in the sidebar, not just
  by dragging it above the folder — the empty space below your notes had no drop target at all
- Notes and folders inside an open folder are now smaller, indented in from the sidebar edge, and
  connected to it with a guide line, so it's clear where a folder's contents start and end. A
  coloured or selected nested row is inset to match instead of its colour running edge to edge like
  a top-level row's
- New setting: Colour -> Reduce opacity for nested colours, for painting a nested note or folder's
  colour more quietly than a top-level one's while keeping the exact same hue
- Editor width, in Settings -> Customisation / Spaces -> Appearance: Normal (the width it's always
  been), Wide, or Full width, for using more of a large monitor instead of leaving empty space on
  either side of the text
- Renamed the app to Notealise — new name in the installer, Start Menu/desktop shortcut, window
  title, and macOS app menu
- Raised the space cap from 7 to 10, so a vault with more top-level folders can register all of
  them as spaces instead of the switcher silently dropping the extras
- Fixed the open-note and multi-select rings on a coloured, washed-style row: they used to be a
  fixed brand-hued outline that clashed against the row's own colour (e.g. a blue ring on a red
  note); now both ring in white on dark themes / black on light, framing the note's colour cleanly
  instead of fighting it
- Search results are now ranked by how close they are to the note you have open — a match in the
  same folder as what you're working on comes before one from elsewhere in the space; with nothing
  open, results are unchanged
- New toggle on the search bar: search every space at once instead of just the active one. Results
  from elsewhere are tagged with their space, and opening one switches you there first
- Fixed the open note's selection ring on a coloured row pulling away from the colour at its
  rounded ends, leaving a sliver of colour showing outside a supposedly-connected ring — happened
  at every density, worse the more rounded the row
- The drag-handle dots are bigger and no longer shrink on subfolder rows, so they stay legible
  instead of blurring into a grey smear at the smaller size

## [0.7.1] - 2026-08-08
- Settings and the update banner no longer show the app's version number — an update now just says
  it's available/downloading/ready, so a new release feels like a new update rather than a number
  going up
- The app icon's document glyph is bigger within its card, so it doesn't look undersized next to
  other apps in the taskbar/dock

## [0.7.0] - 2026-08-08
- Bring notes in from other apps, in Settings -> Import (or File -> Import notes...). Pick the
  format, choose your files, and everything lands in one new space in your vault — never mixed in
  with the notes you already have, so an import you don't like is one space to delete
- Import from Notion: export your workspace from Notion as Markdown & CSV, then just hand the app
  the .zip it downloaded. It unpacks it for you, rebuilds your page hierarchy as folders, strips
  the long ID that Notion adds to every filename, and repoints the links between your pages at
  their new homes
- Import from HTML: choose .html files or a whole folder of them and each page comes in as a note,
  with headings, lists, tables and links converted to Markdown, images copied in alongside, and any
  folders inside kept as folders
- Import from Markdown: point it at a folder of .md files — an Obsidian vault, a Bear export,
  anything already in Markdown — and it comes across untouched, folders and pictures included.
  Nothing is converted, because it's already the format your notes are kept in
- Import from Word: choose .docx files and each becomes a note, with its pictures pulled out as
  real image files rather than buried in the text. Bold, italic, underline, highlights, tables,
  lists and links all survive; older .doc files can't be read, so the picker won't offer them
- Import from Google Keep: download your notes from Google Takeout, unzip it and choose the "Keep"
  folder. Checklists keep their ticks, pictures come across, notes in the Bin are left behind, and
  each note is filed under its first Keep label
- Import from Apple Notes (Mac only): brings in the notes from the Notes app on your Mac, keeping
  your folder structure. macOS asks once for permission. Notes locked with a password can't be read
  by anything outside Apple Notes, so they're listed rather than imported
- Imported notes keep the date they were really last edited, so they sort alongside your own notes
  instead of all arriving as if written today
- A long import can be stopped part-way. Whatever has already come across stays, in its own space,
  for you to keep or delete
- If notes you're importing already exist in your vault, the preview says so before you commit —
  importing again makes a second copy rather than merging
- Every import leaves an Import Report note in the new space, listing anything that was skipped or
  that lost some formatting on the way in
- Tables, images and tick-boxes now draw properly in the editor instead of showing their raw
  Markdown, and web links can be clicked to open in your browser. Underlined and superscript text
  reads as underlined and superscript rather than as visible tags
- Add colours for notes and folders. Hover a row in the sidebar and click the circle in the buttons
  that appear, or right-click it and choose Colour. Pick one from your palette, or any colour at all
  from the picker — a saturation square, a hue slider and a hex box. Select several rows first and
  they all take it at once
- A folder's colour carries to everything inside it, so a coloured folder reads as one group.
  Colouring a note or a subfolder directly overrides what it inherited, and the inheriting can be
  switched off entirely
- Choose how a colour shows, per space: a coloured tag on the six-dot handle, which marks the row
  without recolouring it; a tinted row; or a solid row, where the whole row is the colour and the
  name switches to black or white to stay readable against it
- Add "Give a new folder a colour": each folder you make takes one from your palette straight away,
  picked from the colours its neighbours aren't using, so folders look different from each other
  without you choosing one every time. Switching it on also colours the folders you already have,
  and never touches one you'd coloured yourself
- Your palette starts as eight colours and holds up to twelve. Edit it in Settings -> Customisation
  -> Colour, or save a colour into it from the picker on any row
- Colours are kept alongside your pins and folder order, never inside your notes — the `.md` files
  this app writes are unchanged
- Selecting notes and folders is now a mode. Click a row's six-dot handle once, then click anywhere
  on any other row to add it, instead of aiming at the dots every time. A folder's arrow still opens
  it, so you can reach the notes inside; and the selection clears only on Esc or Clear, never by
  clicking the background by mistake
- Split Settings -> Master settings into two pages: General, for startup, dates, numbers and the
  clock, and Customisation, for everything about how the app looks and what it shows. Customisation
  still answers for every space at once, and links through to Spaces for setting just one
- Every space now saves its own look as a preset, on its own — there's no button to press and
  nothing to remember. Change a space's theme, colours, density or format buttons and its preset
  keeps up. Find them under Settings -> Spaces -> Saved presets
- Saved presets are kept in the app rather than in your notes folder, so switching source folder no
  longer wipes the spaces you set up. Your looks from every folder you've opened are all there,
  grouped by which folder they came from
- Use a saved preset on any space: drag it onto a space at the top of the page, or open "Use on..."
  and pick one space, all of them at once, or a brand-new space named after the preset. The folder
  and the notes in it are never touched — only the look moves
- Choose what a preset brings with it. Tick Appearance, Colour, Arranging, Note chrome or Format
  buttons, so you can take one space's colours without losing your own shortcuts
- Presets are shareable files. Export one to send to someone, or export the lot to carry your looks
  to another machine, then drop the file onto the list or use Import. A shared preset carries no
  trace of your folder names, and importing one never overwrites a look you already had
- Deleting a space now offers to delete its saved preset too, rather than leaving it behind or
  silently taking it with the folder
- Tables now stay tables while you edit them. They no longer turn back into `| --- |` the moment
  your cursor goes near one — click any cell and type, Tab to the next, Shift+Tab back. You never
  see a pipe
- Text in a table cell now wraps and the row grows taller, instead of stretching its column further
  and further across the note
- Hover a table for a + down its right edge and along its bottom: click to add a column or a row, or
  drag it out for several at once and back in to remove them, down to a single cell
- Empty rows and cells no longer look smaller than filled ones — every cell holds a full line's
  height whether or not you've typed anything in it, so a freshly added row is just as easy to click
- Remove a row by clearing it and pressing Backspace again, the same as an empty block in most
  editors — no separate control sitting on every row
- Drag a column by the small handle above it to reorder your columns, like Notion. Click the handle
  to select the column, then Backspace or Delete to remove it
- Set a column's alignment from the small mark in the corner of its heading — left, centred, right,
  or none — instead of editing the dashes by hand. Alignment a note already had is kept exactly
- `/table` and the table button now insert an empty 2x2 grid, ready to type into, instead of a table
  full of the word "Column"
- Add "Markdown pro" (Settings -> Customisation -> Linking content, or per space). It puts a button
  in the bottom-right of every note that switches to the raw Markdown — every asterisk, hash and
  table pipe visible, exactly as the file has them. Bold still looks bold and headings stay large;
  only the hidden marks come back. Each note remembers which way you last looked at it
- Report a bug (Settings) now goes to a real support inbox with the subject fixed to "bug report",
  so it sorts straight into a filter instead of a placeholder address
- Add "Request a feature", right below Report a bug in Settings — same idea, its own inbox, subject
  fixed to "feature request"
- The app finally has a real logo: the sidebar now shows the mark beside your vault name, switching
  between the light and dark version to match your theme. The Dock/taskbar icon uses it too
- Fix a setting changed just as you switch source folder being saved into the folder you moved to
  rather than the one you changed it in — which could hand the new folder the old one's list of
  spaces. The theme the app paints on next launch is now left alone in that moment too
- Fix renaming a space reporting that it couldn't be renamed when the folder had in fact been
  renamed and only its saved look hadn't followed. The rename now stands, and the message tells you
  the look kept its old name instead of claiming the whole thing failed
- Fix the settings gear reopening on whichever page you last jumped to from the File menu. Once that
  window has closed the gear goes back to General, the way it does before you ever use the menu
- Fix the outline marking the open note vanishing on sidebar rows coloured with the "solid" style:
  on a colour close to the app's own accent there was nothing left to show which note was open
- A table's add-row, add-column and column handles now appear when you reach them with the Tab key,
  not only when hovered — they could be focused but stayed invisible while they were
- Switching a note in and out of Markdown pro now tells you if the change couldn't be saved, instead
  of the button quietly springing back with nothing said

## [0.6.0] - 2026-08-02
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
- Add "Reopen your tabs" (Settings -> Master settings -> Startup, now on by default, replacing
  "Reopen last note"): the notes you had open and the way they were split come back the next time you launch,
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
- Add note links: type `[[` anywhere to connect one note to another, and pick from the list. Five
  forms, all plain text in your file so it still reads anywhere else: `[[Waves]]` by name,
  `[[Term 3/Waves]]` by path, `[[Waves|the waves chapter]]` to say it in your own words,
  `[[Waves#Interference]]` to land on a heading, and `[[Term 3]]` for a folder. Notes and folders
  carry different icons so you can see which a link points at
- Clicking a link opens it in a new tab, so the note that sent you there stays open — Ctrl/Cmd+click
  opens it here instead, Alt+click opens it beside this one, and a link can be dragged into any
  column. A link to a note you haven't written yet shows dashed; clicking it makes the note, next
  to the one you're in
- Every note carries a strip of its connections above the text: what it links to, then what links
  back to it. Hover one to see which of the two it is, which space it lives in, and the line the
  link sits in
- The `[[` list shows the space you're writing in, under Content / Space headings. To reach another
  space, type its name first (`[[Physics`) and the list follows you there — a link that already
  crosses spaces keeps working wherever you are
- Renaming a note updates the links that pointed at it. Moving one between folders needs no update:
  links find a note by name, so they keep working wherever it ends up
- Add a file-path bar between the tabs and the format bar, reading Space -> Folder -> Note. It isn't
  a label: clicking a folder in it opens that folder in the sidebar and closes the others, so you
  can see what else is in there
- Notes can show when they were last edited beside the word count, on your machine's clock. Hover
  it for the full dates, including when the note was created
- Tabs now belong to a space. Switching space puts that space's notes on screen and no others —
  what you had open elsewhere is still open, just not in front of you
- Add Settings -> Tutorials, starting with a walkthrough of every form a link can take and what
  each one is for. More guides, and one to download, are coming
- Add Settings -> Source folder: where your notes actually live, what the hidden `.mdnotes` folder
  holds, and the button to point the app at a different folder. Both used to sit permanently at the
  bottom of the sidebar; the sidebar keeps the space switcher, which you use constantly
- Rebuild Settings around Master settings — everything, set for the whole app at once — with each
  space able to answer the same questions differently from Settings -> Spaces. Both show the same
  page; only where the change lands differs, and master flags anything your spaces disagree about
- The Settings window now sizes itself to the app window instead of sitting at a fixed 720x600
- Add "Link to a note" to the command list, on `/link` and available as a format-bar button. Every
  editor command now appears in both the `/` menu and the button picker automatically — four of
  them used to exist only as buttons, and nothing said which
- Hover labels are now the app's own: they appear directly under whatever you're pointing at, as
  plain text rather than a system box. Fixes labels that showed the wrong thing after you clicked
  the control (the search bar's "titles only", the archive filter), and buttons that showed nothing
  at all (split screen, collapse sidebar)

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
