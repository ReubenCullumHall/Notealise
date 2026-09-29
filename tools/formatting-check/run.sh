#!/bin/bash
# Build a throwaway copy of the app and open it with a debug port, on its own
# profile and test vault — never Reuben's. Mac only (see README for Windows).
set -e
WORK=${WORK:-/tmp/formatting-check}
E=~/notes-app-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
pkill -f "remote-debugging-port=9333" || true
mkdir -p "$WORK/real" "$WORK/vault/Test" "$WORK/vault/.mdnotes" "$WORK/ud" "$WORK/shots"
rsync -a --exclude node_modules --exclude out --exclude release --exclude .git --exclude legacy --exclude site "$REPO/" "$WORK/real/"
ln -sfn ~/notes-app-mac/node_modules "$WORK/real/node_modules"
(cd "$WORK/real" && ELECTRON_RUN_AS_NODE=1 "$E" node_modules/electron-vite/bin/electron-vite.js build | tail -1)
printf '# Start\n\nhello\n' > "$WORK/vault/Test/Start.md"
echo '{"spaces":[{"folder":"Test","emoji":"🧪","markdownPro":true}],"playStartupAnimation":false}' > "$WORK/vault/.mdnotes/settings.json"
printf '{"vaultPath":"%s","hasOnboarded":true}' "$WORK/vault" > "$WORK/ud/config.json"
(env -u ELECTRON_RUN_AS_NODE nohup "$E" "$WORK/real/out/main/index.js" --user-data-dir="$WORK/ud" --remote-debugging-port=9333 > "$WORK/app.log" 2>&1 &)
sleep 8 && echo "app up on :9333 — now: python3 realtest.py | realtype.py | realedge.py (WORK=$WORK)"
