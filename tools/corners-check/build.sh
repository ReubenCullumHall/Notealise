#!/bin/bash
# Builds a scratch copy of THIS tree into $WORK (default /tmp/corners-check). Run once, then
# shots.py. Same recipe as tools/voice-check/build.sh, without the test recording.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-/tmp/corners-check}"
MAC="$HOME/notes-app-mac"
export PATH="$HOME/.local/opt/node/bin:$PATH"
mkdir -p "$WORK/app"
rsync -a --delete "$HERE/src/" "$WORK/app/src/"
for f in package.json electron.vite.config.ts tailwind.config.js postcss.config.js tsconfig.json tsconfig.web.json tsconfig.node.json; do
  cp "$HERE/$f" "$WORK/app/"
done
ln -sfn "$MAC/node_modules" "$WORK/app/node_modules"
ln -sfn "$MAC/node_modules" "$WORK/node_modules"
(cd "$WORK/app" && env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron-vite build --outDir "$WORK/out" > "$WORK/build.log" 2>&1) \
  || { echo "build failed — see $WORK/build.log"; exit 1; }
echo "built into $WORK"
