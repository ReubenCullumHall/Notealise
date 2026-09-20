# Open items — built, not signed off

Things that are **in the working tree and working as far as they were tested**, but that are not
finished business. Nothing here is in `CHANGELOG.md`'s `[Unreleased]`, and nothing here should go
into it until the line below it is answered.

Reuben's rule, 2026-09-05: *"don't log anything broken, keep that in a separate file for me to fix
at a later date."* So this file is the holding area — a changelog line is a promise to a user, and
an untested thing is not one yet.

**Format:** `### <what> — <what has to happen before it can be logged>`. Delete the section once it
has been answered; move its line into `[Unreleased]` if it earns one.

---

## From the tester-feedback pass (2026-09-05)

The other twelve items from that pass are logged. These two are not.

**Closed 2026-09-06:** shift+scroll's two tuning numbers (`THRESHOLD` 80 px, `IDLE_MS` 220). They
were chosen against synthetic `WheelEvent`s and needed a real hand on a real device. Reuben checked
it live and passed it, so they stand — do not re-tune them without a reason and a device.

**Closed 2026-09-06:** the custom-highlight render gap. `d80f0c6` landed the colour-tags refactor,
so `<mark style="background-color: #hex">` is recognised. Proved by reading computed styles out of
a running build of that exact tree: custom highlight `rgb(255, 59, 48)`, custom text colour
`rgb(52, 199, 89)`, a named `hl-amber` control unchanged. **`main` is releasable again.**

**Closed 2026-09-06:** the colour bar's mid-drag suppression. Reuben dragged across a sentence with
the button held and confirmed the bar stays away until release. It had never been observed because
every attempt to drive a real drag-select through `sendInputEvent` produced no selection at all —
the instrument failed, not the code. **All three items from the tester-feedback pass are now closed.**

### Windows is entirely untested

Every check in this pass was run on macOS. The item most likely to differ is **the intro's writing
box**: Windows reserves gutter space for a scrollbar where macOS overlays it, and the original
tester report almost certainly came from Windows. The fix removed the *cause* (the editor theme's
`40vh` bottom padding, which guaranteed overflow in a 166 px box — see `docs/feature-editor.md`),
which is platform-independent, so this is a confirmation rather than a suspicion.

Also worth a glance on Windows: the search bar's two new opacities (`ink-300/55`, `ink-300/15`)
against ClearType, and the sidebar hover mask, which uses `-webkit-mask-image`.

Added 2026-09-06, from the second round of fixes: the search pill's magnifier now animates its own
`width` to zero as you type, and the selection colour bar is sized by `width: max-content` on a
flex column. Both are layout that a different font metric can shift — the pill by a pixel or two of
reflow mid-animation, the bar by however much wider Segoe sets the "Apply to text" button.

### Reading view would strip a custom colour — pre-existing, not caused here

`reader/ReadingView.tsx` is imported by nothing (its own header says so). Its DOMPurify config
allows `class` but not `style`:

```ts
DOMPurify.sanitize(raw, { ADD_TAGS: ['mark'], ADD_ATTR: ['class', 'type', 'checked', 'disabled'] })
```

So if that component is ever wired up, a **named** colour survives and a **custom** one is silently
dropped. Left alone deliberately: widening a sanitiser allowlist is a security decision, not a
styling one, and `docs/security.md` is the place that decision belongs.

**To close it:** decide it when the reading view is wired up, not before. DOMPurify does sanitise
`style` values rather than passing them through, so allowing it is defensible — but it should be a
considered call with the threat model open, not a line changed in passing.

---

## Try it on the download page — found 2026-09-18

Found while testing the desktop Try-it fix across devices. None of these was caused by it: a
side-by-side run of the old code gave identical numbers on every phone and tablet profile.

### Phone held sideways is cramped — needs Reuben's call on whether it matters
iPhone 14 (750×340) and Pixel 7 (863×360): the window is 268–288px tall, the note scrolls inside
it, and the sidebar needs a 13px scroll to reach Colour. Works, just tight. Set by the
`(max-width: 62rem) and (orientation: landscape)` block in `site/landing.css`.

### Windows High Contrast hides the selected button — needs a fix + a real Windows check
With forced colours on, the `.on` state (a tint plus a border colour) is flattened, so you cannot
tell which Typeface/Theme/Paper is picked. Likely fix: a `@media (forced-colors: active)` rule
giving `.on` a system-colour outline. Same pattern probably affects other buttons on the site.

### iPad Pro held upright gets the phone layout — Reuben's call
834px is under the 62rem breakpoint, so a big tablet shows the glass strip on top. Correct by the
rule; noting that a large tablet counts as “mobile”.

### Firefox never tested — needs a real Firefox on the PC
Playwright's Firefox will not launch on the Mac (its sandbox and GPU helper are killed, headed as
well as headless), so Gecko is the one engine the desktop Try-it fix was not run in. Low risk —
the CSS is `height: auto` on a grid and `min-height: 0` on a flex child — but unverified.

## The `[[` picker closes its own link

**Closed 2026-09-20:** Windows pass done, logged. Choosing a note from the `[[` menu writes the
`]]` and leaves the cursor after it, so the link renders at once (`editor/completions.ts`,
`editor/wikiPass.ts`, `links/model.ts` + its test; how it works is in `docs/feature-editor.md`).
Verified on Windows with real CDP-driven input (a scratch build, `--remote-debugging-port`, mouse
and keyboard over Playwright — see CLAUDE.md's gotchas): picking with Enter, with a click, and via
`/link` all wrote a clean `[[Second Note]]`, no doubled `]]`, cursor landed right after the closing
bracket every time — checked against the raw saved file, not just the decorated view. Reuben
confirmed live in the app after: "works great now."
**Backspace right after a rendered link — tried 2026-09-20 (Mac, browser preview, real keyboard
input, with a control that typed `zz` first):** it deletes BOTH hidden `]]` at once, the chip turns
back into raw `[[Waves`, and nothing else is lost (a second Backspace then takes letters). Before
this change the cursor there showed the raw brackets and Backspace took one `]`. Harmless, and reads
as "unlink", so left as it is — Reuben's call if he would rather it took one bracket. Not tried on
Windows or in the Electron window.

### `/link` does not open the picker by itself — still open, unrelated to the fix above
`wikiLink` inserts `[[]]` with the cursor between, and its own comment calls that "the note picker".
The menu does not open until a letter is typed — completion only starts on typing. Confirmed again
on Windows 2026-09-20 via the same CDP pass: after `/link` inserts `[[]]`, no menu until a character
went in. Not fixed — pre-existing, out of scope of the closing-bracket fix above.

## Carried in from before this pass

### `EntryMeta.collapsed` is read by nothing

Flagged in CLAUDE.md's gotchas, never removed (rule 9 — flag redundancy, let Reuben decide). It was
only ever read by the sidebar's old per-instance expansion XOR, and has never been written by
anything. Removing it is a `workspace.json` shape change, so it is not a five-minute job.
