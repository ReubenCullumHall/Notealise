# What reaches users, and what doesn't

The one rule: **only a pushed `v*` tag becomes a release, and only a release auto-updates a
user's installed app.** Everything else is a holding area. This doc exists because that line got
blurred once (see "How this went wrong once" below) and the fear it caused — "my half-finished
bug fix went straight to everyone's app" — is worth putting to rest in writing.

## The three layers

| Layer | What it is | Who it reaches |
|---|---|---|
| **Working tree** (`npm run dev`) | Live, uncommitted code in a session's checkout | Nobody. Not even other sessions, if each uses its own worktree. |
| **`main` branch** (committed + pushed) | The **waiting area** — finished work accumulating for the next release. `CHANGELOG.md`'s `## [Unreleased]` is its manifest. | **No user's app.** `release.yml` triggers on `v*` tags only, never on a branch push. Pushing `main` is safe. |
| **A `v*` tag** (pushed) | A release. CI builds installers, publishes the GitHub release, writes `latest.yml`. | **Every installed app**, within ~10s of the user next opening it (Windows self-installs; macOS downloads the `.dmg` and the user drags it across). |

Exception, and it is deliberate: **`site/` deploys to Vercel on every push to `main`.** The
download page and the other site pages are live-on-push. That is fine — the site is not the app,
carries no user data, and a bad deploy is a one-commit revert. Only the **app** sits behind the
tag gate.

## The waiting-area model

1. A piece of work — bug fix or feature — is **not done** until Reuben has verified it in the
   real app. For anything touching the updater, the main process, or packaging, "the real app"
   means a **packaged build**, not `npm run dev` — that is the one subsystem `npm run dev` cannot
   show you (it forks on `app.isPackaged`; see `CLAUDE.md`'s Gotchas and `feature-updates.md`).
2. Once verified, it earns a `## [Unreleased]` line in `CHANGELOG.md` (`CLAUDE.md`'s "Tracking
   pending changes"). That line is the record that Reuben signed off on it.
3. Work accumulates on `main` / in `[Unreleased]` until **release day**.
4. Release day runs the ritual in `release-checklist.md`, which now starts with the
   **release-review gate** below.

Committing unverified work to `main` is not forbidden — sometimes a session commits a
work-in-progress so another can build on it, or to hand off at session end. It is safe *because*
of the gate: nothing on `main` reaches an app until Reuben has reviewed the full diff and tagged.
What is forbidden is that unverified work reaching a **release**.

## The release-review gate

**Before every `git tag`**, run:

```
tools/release-review.sh
```

It prints, for the range `<last tag>..HEAD`:

- every commit, with its message
- the full list of files changed, grouped by area (main / renderer / shared / site / docs / build)
- `git diff --stat`, and the option to see the full diff
- the current `## [Unreleased]` section

Reuben then goes down it **item by item** and says, for each: *verified, ship it* / *hold it*.
Read the **diff**, not the commit messages — a commit titled "Add cross-session status file
convention" once carried the entire update-notification feature (commit `205d4c6`). A message can
be wrong; a diff cannot.

**Holding an item** means one of:

- the release waits until Reuben has verified it, or
- the commit is reverted on a short release-prep commit (`git revert <sha>`), the release goes
  out without it, and the revert is itself reverted afterwards to bring the work back onto `main`
  for next time.

Only once every item in the range is "ship it" does the version get bumped and the tag pushed.

## Concurrent sessions

Reuben runs several Claude Code sessions on this repo at once. **Each session works in its own
`git worktree`** (`EnterWorktree`), so each has its own working directory and its own index.
Without that, all sessions share one working tree and one staging area, and a `git commit` in one
session sweeps up whatever another session left unstaged — which is exactly how `205d4c6` ended
up mislabelled and carrying three sessions' work. See `notesapp-mac-sandbox-concurrency` and
`notesapp-git-commit-scoping` in project memory.

Every commit is still pathspec-scoped regardless: `git commit -- <explicit paths>`, never
`git add .` / `git add -A` / `git commit -a`.

## How this went wrong once (2026-08-28)

- The update-notification layer (corner toast, macOS Gatekeeper walkthrough, a Mac button fix)
  was committed to `main` as `205d4c6`, under the message "Add cross-session status file
  convention" — a shared-index accident: another session's `git commit` swept up in-progress
  work from a session that had not finished it.
- `v1.0.0` was then cut as a "version reset, no app changes." It was not: it flushed everything
  in `[Unreleased]`, including that update layer, which had never been checked in a packaged
  build. The `CHANGELOG` was correct; the person cutting the release read the commit messages,
  not the diff, and mischaracterised it.
- Net effect on users was small (the button fix is a strict improvement; the toast is additive
  and low-risk) but it should not have been a surprise. The gate above is the fix.
