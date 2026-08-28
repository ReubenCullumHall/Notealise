#!/usr/bin/env bash
# release-review.sh — the gate that runs BEFORE `git tag` on release day.
#
# Prints everything that would ship in the next release: every commit, every
# file, the diffstat, and the CHANGELOG's [Unreleased] section — so Reuben can
# sign off item by item against the actual DIFF, not the commit messages.
# See docs/workflow.md.
#
# Usage:   tools/release-review.sh           # review <last tag>..HEAD
#          tools/release-review.sh --full    # also dump the complete diff
#          tools/release-review.sh v0.9.0    # review from a specific tag

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

FULL=0
FROM=""
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    *) FROM="$arg" ;;
  esac
done

git fetch --tags --quiet 2>/dev/null || true
[ -n "$FROM" ] || FROM="$(git describe --tags --abbrev=0)"
HEAD_SHA="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

rule() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

rule
echo "RELEASE REVIEW   ${FROM}..HEAD (${HEAD_SHA}, branch ${BRANCH})"
rule

N=$(git rev-list --count "${FROM}..HEAD")
if [ "$N" -eq 0 ]; then
  echo "Nothing to release — HEAD is at ${FROM}."
  exit 0
fi
echo "${N} commit(s) since ${FROM}:"
echo
git log --no-merges --format='  %h  %s  (%an, %ad)' --date=short "${FROM}..HEAD"

echo
rule
echo "FILES CHANGED, BY AREA   (read the diff for each — messages have lied before)"
rule
git diff --name-status "${FROM}..HEAD" | awk -F'\t' '
  { p=$2; line="  " $1 "  " $2 "\n" }
  p ~ /^src\/(main|preload|shared)\//                          { main=main line; next }
  p ~ /^src\/renderer\//                                       { rend=rend line; next }
  p ~ /^site\//                                                { site=site line; next }
  p ~ /^docs\// || p ~ /CLAUDE\.md/ || p ~ /CHANGELOG\.md/ || p ~ /\.md$/ { docs=docs line; next }
  p ~ /^\.github\// || p ~ /electron-builder/ || p ~ /package.*json/ || p ~ /vite/ || p ~ /tsconfig/ || p ~ /^tools\// { build=build line; next }
  { other=other line }
  END {
    if (main)  printf "\n[ MAIN / PRELOAD / SHARED — ships in the binary, verify in a PACKAGED build ]\n%s", main
    if (rend)  printf "\n[ RENDERER — ships in the binary ]\n%s", rend
    if (site)  printf "\n[ SITE — deploys to Vercel on push, NOT part of the app release ]\n%s", site
    if (docs)  printf "\n[ DOCS / CHANGELOG ]\n%s", docs
    if (build) printf "\n[ BUILD / CI / TOOLING ]\n%s", build
    if (other) printf "\n[ OTHER ]\n%s", other
  }'

echo
rule
echo "DIFFSTAT"
rule
git diff --stat "${FROM}..HEAD"

echo
rule
echo "CHANGELOG  ## [Unreleased]"
rule
awk '/^## \[Unreleased\]/{f=1;next} /^## \[/{f=0} f' CHANGELOG.md | sed 's/^/  /'

echo
rule
echo "SIGN-OFF  — for each item above: verified in the real app → ship it, else → HOLD"
echo "  Hold = release waits, or  git revert <sha>  on a release-prep commit."
echo "  Only tag once every item is 'ship it'.   See docs/workflow.md."
rule

if [ "$FULL" -eq 1 ]; then
  echo
  rule; echo "FULL DIFF   ${FROM}..HEAD"; rule
  git diff "${FROM}..HEAD"
fi
