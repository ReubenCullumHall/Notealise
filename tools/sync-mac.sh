#!/bin/sh
# Copy this project's SOURCE into the Mac run copy, then restart it.
#
# Why this exists. The app cannot be run from the OneDrive tree on a Mac: its
# node_modules is a Windows install, and putting a Mac one there would have
# OneDrive syncing a hundred thousand files. So the Mac runs from a second
# checkout, ~/notes-app-mac, with its own node_modules — and edits made in
# OneDrive do not reach it on their own.
#
# That drift is silent and it is expensive. On 2026-08-23 a whole session's
# fixes were reported as verified while the app being tested was a copy two
# days behind: it had no ErrorBoundary, so a crash showed a blank white window
# with no message, and the bug being chased had already been fixed in a tree
# nobody was running. Everything reported that day had to be re-checked.
#
# Source only. node_modules, out/ and .git stay as they are — the run copy's
# node_modules is the whole point of it, and out/ is rebuilt on launch.
set -e

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${NOTES_MAC_COPY:-$HOME/notes-app-mac}"

[ -d "$DEST" ] || { echo "No run copy at $DEST — set NOTES_MAC_COPY."; exit 1; }

# No --delete: it buys nothing here (a file removed from src is a rare event and
# a stale extra module is inert), and it is the flag that turns a mistyped
# destination into data loss.
rsync -a "$SRC/src/" "$DEST/src/"
rsync -a "$SRC/package.json" "$SRC/electron.vite.config.ts" \
         "$SRC/tsconfig.json" "$SRC/tsconfig.web.json" "$SRC/tsconfig.node.json" "$DEST/"

if diff -rq "$SRC/src" "$DEST/src" >/dev/null; then
  echo "Source synced to $DEST — trees identical."
else
  echo "Sync ran but the trees still differ:"
  diff -rq "$SRC/src" "$DEST/src"
  exit 1
fi

# electron-vite reloads the RENDERER on a file change but never the main
# process, so a running dev server would keep serving the old main against the
# new renderer — the exact mismatch src/renderer/src/boot.ts now warns about.
# Killing it means the next launch is honest.
# Both halves, and in this order. Killing only the supervisor leaves the Electron
# app ORPHANED and still running the old main in memory — which looks exactly
# like a restart that did not take, and cost an afternoon on 2026-08-23.
if pkill -f "electron-vite dev" 2>/dev/null; then
  echo "Stopped the dev server (main does not hot-reload)."
fi
if pkill -f "$DEST/node_modules/electron/dist" 2>/dev/null; then
  sleep 1
  echo "Stopped the app itself — killing the supervisor alone orphans it."
fi
echo
echo "Now run:  cd $DEST && npm run dev"
