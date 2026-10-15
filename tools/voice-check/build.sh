#!/bin/bash
# Builds a scratch copy of THIS tree into $WORK (default /tmp/voice-check) and makes a spoken
# test recording with the Mac's own `say` — no microphone involved. Run once, then the checks.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-/tmp/voice-check}"
MAC="$HOME/notes-app-mac"
export PATH="$HOME/.local/opt/node/bin:$PATH"
mkdir -p "$WORK/app"
rsync -a "$HERE/src/" "$WORK/app/src/"
for f in package.json electron.vite.config.ts tailwind.config.js postcss.config.js tsconfig.json tsconfig.web.json tsconfig.node.json; do
  cp "$HERE/$f" "$WORK/app/"
done
# main's externals resolve from next to out/, the build's own from the app folder
ln -sfn "$MAC/node_modules" "$WORK/app/node_modules"
ln -sfn "$MAC/node_modules" "$WORK/node_modules"
(cd "$WORK/app" && env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron-vite build --outDir "$WORK/out" > "$WORK/build.log" 2>&1) \
  || { echo "build failed — see $WORK/build.log"; exit 1; }
if [ ! -f "$WORK/memo.m4a" ]; then
  say -o "$WORK/memo.aiff" "This is a test voice note for the zoom check. It talks for a while so the recording is long enough to zoom in a few times. One, two, three, four, five, six, seven, eight, nine, ten. Eleven, twelve, thirteen, fourteen, fifteen, sixteen, seventeen, eighteen, nineteen, twenty."
  afconvert -f m4af -d aac "$WORK/memo.aiff" "$WORK/memo.m4a"
fi
echo "built into $WORK"
