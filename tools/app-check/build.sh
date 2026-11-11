#!/bin/bash
# Builds a scratch copy of THIS tree into $WORK (default /tmp/app-check), for the app-check
# scripts. Mac only (it uses ~/notes-app-mac's tools). Never touches the installed app,
# ~/notes-app-mac's own profile, or real notes.
#   MINIFY=1 ./build.sh   also builds a compressed copy into $WORK/out-min (run with LAB_OUT=out-min)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${WORK:-/tmp/app-check}"
MAC="$HOME/notes-app-mac"
export PATH="$HOME/.local/opt/node/bin:$PATH"
mkdir -p "$WORK/app"
rsync -a --delete "$HERE/src/" "$WORK/app/src/"
for f in package.json electron.vite.config.ts tailwind.config.js postcss.config.js tsconfig.json tsconfig.web.json tsconfig.node.json; do
  cp "$HERE/$f" "$WORK/app/"
done
# main's externals resolve from next to out/, the build's own from the app folder
ln -sfn "$MAC/node_modules" "$WORK/app/node_modules"
ln -sfn "$MAC/node_modules" "$WORK/node_modules"
(cd "$WORK/app" && env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron-vite build --outDir "$WORK/out" > "$WORK/build.log" 2>&1) \
  || { echo "build failed — see $WORK/build.log"; exit 1; }
if [ "${MINIFY:-}" = "1" ]; then
  perl -0pi -e "s/renderer: \{\n    plugins: \[react\(\), csp\(\)\]/renderer: {\n    build: { minify: 'esbuild', cssMinify: true },\n    plugins: [react(), csp()]/" "$WORK/app/electron.vite.config.ts"
  (cd "$WORK/app" && env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron-vite build --outDir "$WORK/out-min" > "$WORK/build-min.log" 2>&1) \
    || { echo "compressed build failed — see $WORK/build-min.log"; exit 1; }
fi
echo "built into $WORK"
