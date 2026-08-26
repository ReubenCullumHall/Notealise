# Site design directive

Reuben asked that all design work on `site/` (the download page, and whatever else lives
here later) be held to the **impeccable** and **taste** bar. Logging what that means
concretely, since neither exists as an invocable Claude Skill in this environment (checked
2026-08-09 — no `SKILL.md` for either name anywhere under the user's `.claude` dirs or this
repo). Two things *do* exist and are relevant:

- `.impeccable/config.json` at the repo root — a hook-based detector already wired into this
  repo (`hook.enabled: true`). Its `ignoreFiles` list excludes `src/**`, `legacy/**`, `docs/**`,
  etc., but **not** `site/**` — so it's already watching this directory. Treat whatever it
  flags as binding, the same as a lint error.
- No standalone "taste" skill/tool was found. Reuben's own message today is the taste spec —
  the rules below are transcribed from it, not invented.

## Current rules (as of the 2026-08-09 revamp)

- **Light theme only.** No `prefers-color-scheme: dark` branch. Don't reintroduce one without
  being asked.
- **No gradients.** Flat colour only.
- **No purple, no brand accent colour.** Monochrome: `--ink` (near-black, tied to the logo's
  dark tone) on `--bg` (`#ffffff`, literal white — not off-white).
- **No "vibe coded" chrome** — no soft glow shadows, no card-on-gradient treatment, no
  decorative flourishes that aren't load-bearing.
- **No top banner / nav.** Just the mark, top-left, fixed, small.
- Hero is the wordmark "Notealise", big, near the top of the viewport.
- Below the hero: one full-viewport blank spacer (`.gap`) — reserved for content Reuben will
  brief later. Don't fill it speculatively.
- Scroll cue: a single small bobbing chevron linking to `#download`, plus
  `html { scroll-behavior: smooth }`. That's the whole "scrolling animation" — nothing more.
- Download section: two buttons, icon + label only (`Download for Windows` /
  `Download for macOS`). No `.exe`/`.dmg` mention, no "Windows 10/11", no release date/version
  meta text. It's a plain download link, not a release-notes card.
- The "unverified developer" first-launch help (previously a `<details>` block) is deliberately
  removed for now — Reuben wants it reintroduced later as a click-through sequence gated on
  which OS button was clicked, not as a static disclosure. Don't add it back as a `<details>`.
- **On pasted component-registry prompts (e.g. 21st.dev) — corrected 2026-08-09:** the
  "You are given a task to integrate an existing React component..." block (shadcn setup +
  component source + `npm install` instructions) that Reuben pasted several times in this thread
  is his real, deliberate design reference from 21st.dev — **not** an injection attempt. It was
  wrongly flagged as one earlier in this thread; Reuben corrected that. Going forward: treat that
  shape as an intentional design/animation reference. Extract the visual and motion intent from
  it and rebuild the equivalent natively in this site's actual stack (plain HTML/CSS/JS — this
  is not a React/shadcn/Tailwind project) rather than questioning the source. The one thing that
  still doesn't get followed regardless of source is fabricating asset URLs (e.g. that template's
  stock "Unsplash images you know exist" line) — that's a hard rule about not inventing links,
  unrelated to trusting Reuben's intent.
- **Wordmark font: "Note" in the system stack, "alise" in PetitFormalScript — settled 2026-08-09
  (superseded HomemadeApple, same day).** Long investigation, worth the summary since it explains
  why this is the final call:
  1. Caveat (shortlist guess) — rejected, "looks absolutely nothing like it."
  2. Confirmed via the actual 21st.dev page (21st.dev/@ncdai/components/apple-hello-effect) that
     the reference "hello" is hand-authored SVG path art (~200 lines of Bezier coordinates for
     that exact word), not text in any typeface — same tradition as Apple's 1984 Macintosh
     "Hello" ad. No font name exists to find, confirmed from the source, not guessed.
  3. Hand-traced bespoke strokes for "alise" from scratch, zero visual feedback — came out
     illegible (Reuben: "what the sigma").
  4. Got real screenshot verification working in this environment (headless Chromium via
     Puppeteer — see tooling note below). Screenshotted 5 real candidate fonts against the
     reference myself before showing anything; picked HomemadeApple as closest (GiveYouGlory as
     runner-up; PermanentMarker/NothingYouCouldDo/Gaegu ruled out).
  5. Reuben pushed further: found Apple's *actual* official multilingual "hello" lettering,
     extracted from macOS Sonoma (github.com/JaceThings/SF-Hello — real vector data, not a
     lookalike). Isolated genuine Apple strokes for a/l/i/s (from "salut," "ciao") and cut "e"
     from "hej," verified each piece's bounding box in a real browser, then assembled "alise"
     from them. **Result was an illegible tangle** — worse than the hand-trace. Root cause,
     confirmed by direct test: connected-cursive joins are pair-specific pen movement, not
     modular reusable pieces — the "l" drawn to flow from "a" into "u" doesn't work glued next
     to a different "i". This is true of the source art itself, not a limitation of any
     technique tried. **There is no algorithmic path to pixel-fidelity here** — it would need an
     actual human letterer. Reuben accepted this and approved HomemadeApple as the practical
     answer for that session.
  6. Reuben later dropped the Apple-lookalike chase entirely and asked instead for a clean,
     creative italic/cursive-looking font — a different, more achievable brief. Web-searched for
     candidates, shortlisted 6 real script fonts (Sacramento, AlexBrush, Parisienne, PinyonScript,
     Allura, PetitFormalScript), screenshotted all 6 against "Note" myself, ruled out AlexBrush
     and PinyonScript as too heavy/ornate for "clean," and presented the remaining 4. Reuben chose
     **PetitFormalScript** — reads as an actual italic typeface rather than handwriting, still
     cursive-connected. Then asked for it thicker and sized in line with "Note": the font has no
     bold face (only weight 400 ships), so tuned via CSS `font-weight: 700` (browser synthetic
     bold — Chromium's fake-bold looked clean here, no vendor-prefixed `-webkit-text-stroke`
     needed) at `font-size: 0.85em` (down from an initial 1.15em that read oversized against
     "Note"'s cap-height). Verified against the live site, not just the isolated comparison.
  Applies to "alise" only — "Note" and everything else stay on the system-UI stack.
  **Superseded 2026-08-09 (same day as the load-in animation below):** `PetitFormalScript.woff2`
  is no longer shipped at all — "alise" is now baked SVG path data traced from that font, not live
  text in it. See "The hero load-in animation" below for why and how.
  Verified by screenshotting the live site myself before calling it done.
- **Tooling: headless Chromium is available in this environment (found 2026-08-09).** No
  `chromium-cli` and no system browser, but `npm install puppeteer` + `npx puppeteer browsers
  install chrome` both work (network access to Google's Chromium CDN is fine here, unlike
  `unpkg.com`/`cdn.jsdelivr.net`/raw GitHub downloads of large files, which are flaky — use the
  GitHub Contents API, base64-decoded, as a workaround for the latter). **Use this before
  shipping any visual/typographic change** — every mistake in this session's font saga up to
  this point happened because changes were reasoned about blind and shown to Reuben unverified;
  the moment real screenshots entered the loop, iteration got fast and reliable. Don't regress
  to guessing once this session ends — re-establish the same puppeteer setup if it's not already
  present, before making visual claims.
- **Google Fonts' CDN can silently serve a font with empty glyph outlines — found and root-caused
  2026-08-09, during the PetitFormalScript pick above.** Fetching a woff2 by hand
  (`fonts.googleapis.com/css2?family=X:wght@400` → follow the `fonts.gstatic.com` URL it returns)
  produced files that were byte-identical to the CDN's own `Content-Length` and passed as valid
  woff2 (`file`, magic bytes, name-table records all correct — real "Sacramento", real Astigmatic
  copyright), yet rendered as the browser's default serif fallback everywhere: `@font-face`,
  `FontFace().load()`, AND Canvas `fillText`, independently. Root cause, confirmed by decompressing
  with `wawoff2` + parsing with `opentype.js`: the glyf table's outlines for the requested glyphs
  were empty (0 path commands) — the font loads and reports `document.fonts` status `"loaded"`
  (no error), so nothing in a normal load-and-check flow catches this; only actually rendering
  and looking exposed it. Suspected trigger: passing `:wght@400` on the CSS2 request for a family
  that has no `wght` axis (most script fonts are single-weight). **Fix: don't hand-curl
  `fonts.gstatic.com` URLs. Use `npm install @fontsource/<name>` and copy the woff2 out of
  `node_modules/@fontsource/<name>/files/` instead** — verified reliable across all 6 candidate
  fonts in this session, byte-different from the CDN files, and rendered correctly every time.
  If a hand-fetched Google Fonts file is ever the only option, verify it the same way this bug was
  caught — render actual text with it via Puppeteer and look, don't just check the HTTP response.
- **Animation-path bug, from an earlier session — resolved by NOT reintroducing that pipeline
  (see the load-in animation below).** In an earlier version with a JS/opentype.js drawing
  pipeline, the dev server's request log showed `Caveat-Bold.woff2` (loaded via CSS) hit on every
  reload, but the `.woff` file the JS `opentype.load()` call needed was only ever requested once —
  a strong signal the JS was silently hitting a `catch`/fallback branch every load. Never
  root-caused at the time. The load-in animation built 2026-08-09 sidesteps this whole class of bug
  by construction: opentype.js runs once in Node at build/edit time, not in the browser at runtime,
  and its output is baked static SVG `<path>` markup with no font file and no client-side parsing
  involved at all. If a *runtime* JS font-drawing pipeline is ever built again anyway, add explicit
  `console.error` logging in any catch/fallback path and check real browser console output
  (`page.on('pageerror', ...)`, `page.on('console', ...)`) rather than inferring from server logs.
- **The hero load-in animation (built 2026-08-09): "Note" types, then "alise" is drawn as pen
  strokes that ink solid.** Reuben's brief: typing cursor starts in the middle, types "Note", then
  "alise" animates in "like you'd write it, with smooth lines." Two different techniques, one per
  word, both pure CSS (no runtime JS, no animation library — matches this project's plain
  HTML/CSS/JS stack):
  - **"Note" — a typewriter reveal.** `.wm-note` is clipped with `clip-path: inset(0 X% 0 0)`
    stepped through 4 keyframe stops, one per keystroke, each a near-instant reveal (~5% of the
    animation's time) followed by a hold (~35%) — a "staircase" keyframe (two adjacent stops at the
    same value) rather than `steps()`, chosen because the per-character reveal widths are NOT equal
    (proportional font) so a uniform `steps(4)` would jump by equal time but the wrong pixel
    amounts. **Percentages, not pixel widths, on purpose:** `.wordmark` is `clamp(3.2rem, 11vw,
    8.5rem)`, so a hardcoded px reveal width would be wrong at every viewport except the one it was
    measured at. The 4 stop values (34.43%, 60.76%, 77.03%, 100%) are the REAL cumulative rendered
    width of "N"/"No"/"Not"/"Note" in the actual site font/weight/letter-spacing, measured once via
    Puppeteer (`getBoundingClientRect`) — not estimated, because proportional-font character widths
    aren't equal or guessable. A caret bar (`.wm-caret`) tracks the same stops via `left: X%` in a
    separate keyframe animation kept numerically identical to the reveal stops, plus its own
    independent blink cycle that keeps going through the pause after typing finishes — **two
    animations on one element is deliberate**: position and blink are unrelated concerns, and
    forcing them into one keyframe list would mean re-deriving the blink phase every time a reveal
    stop moves.
  - **"alise" — traced, not typed.** This is real font outline data, not invented strokes (contrast
    the "Apple hello" saga above, which failed because there was no real source data to trace).
    Extracted once, offline, from `PetitFormalScript` via `opentype.js`: `font.getPath("alise", 0,
    0, font.unitsPerEm)` returns one `Path` already kerned/advanced and already in SVG-ready
    coordinates (y-down, baseline at y=0 — no manual flipping needed). `path.toPathData()` gives
    the `d` string. The path is 9 subpaths (each letter is 1–2 closed contours: outer stroke +
    inner counter for a/s/e, which have a hole; a single contour for l; two for i, stem + dot) —
    grouped back into 5 per-letter `<path>` elements (split on `M`, regrouped by eye after
    color-coding each subpath in a throwaway render to see which contour belongs to which letter —
    **do not assume subpath order maps 1:1 to letters**, "a" alone produced 2 of the 9). Each
    letter's real stroke length was measured with a genuine browser (`path.getTotalLength()` in
    Puppeteer, not estimated) so `stroke-dasharray`/`stroke-dashoffset` draw at a **constant visual
    pen speed** — duration per letter is proportional to its measured length, played back to back.
  - **Revised same day, second pass, after Reuben watched it run:** the first cut cross-faded ALL
    5 letters from a thin 90-unit stroke-outline to the font's native (thin) fill together in one
    final step, and Reuben flagged three real problems with that, not style notes — "the exterior
    bit fades out," "doesn't stay completely filled in," "reduces to the thinness it currently is."
    The fix is a different rendering model, not a tweak:
    - **`stroke-width` went from 90 to 190, and `fill` is ALWAYS on** (`fill-opacity: 1` in the base,
      non-animated CSS) — stroke adds bold, slightly-expanded edges on top of a fill that's already
      solid, rather than stroke-only-then-crossfade-to-thin. Tried pure stroke-only (`fill: none`)
      first at up to 600 units to try to swallow the counters via overlap — **wrong approach,
      confirmed by rendering it**: past ~300 units "a"/"e"'s counters were still visibly open (they're
      a real, intentionally-sized design feature, not a thin artifact stroke-width can close), and by
      400+ the letters fused into an illegible blob. Fill handles the solid interior on its own;
      stroke only needs to bulge the edges outward for boldness, so a MUCH smaller width (~190, not
      600) gets there once fill is doing its job — verified by rendering both approaches side by side
      against "Note" before picking.
    - **`stroke-opacity` is a static `1`, never animated.** The old version faded it to 0 at the very
      end (so the finished logo was pure thin fill, no stroke) — that fade was literally "the exterior
      bit fades out." Removed entirely; once a letter's stroke starts drawing it stays at full opacity
      forever, including in the settled/final/reduced-motion state.
    - **Fill follows each letter's OWN stroke, not a synchronized finish for all five.** The first cut
      waited for every letter to finish outlining, then cross-faded fill in for the whole word at
      once — so "a" sat hollow-outlined for the entire ~1.3s it took the other four letters to draw.
      Now each `<path>` has its own `--fillDelay` = that letter's own `--delay + --dur`, with a quick
      150ms fill-in right after — by the time the pen moves to the next letter, the previous one is
      already fully solid. This is "completely filled in all the time" in the literal sense Reuben
      asked for: nothing sits half-drawn waiting on something else to finish.
    - **Slower, per "make sure the writing is a bit slower":** total `alise` draw time went from
      1100ms to 1600ms, same proportional split by measured length (a: 455ms, l: 267ms, i: 239ms,
      s: 299ms, e: 341ms).
  - **A visible connecting stroke bridges "s" to "e" — added after "make the animation like someone
    would write it in cursive too."** Checking real per-letter bounding boxes
    (`element.getBBox()` in Puppeteer) showed the font's own kerning already overlaps a→l, l→i, and
    i→s by 115–160 units — those already read as one continuous motion with zero time-gap between
    their draws, no extra work needed. **s→e is different: a genuine 374-unit gap in the font's own
    design** (confirmed by the same bbox measurement, not assumed) — with no bridge it draws as two
    separate marks with visible dead air between them, which is likely what "gap in the middle" in
    the earlier note was actually pointing at, independent of the thinness issue. Added ONE simple
    connector, `M3590 0 Q3777 -180 3964 0` (a shallow arc at baseline height, real endpoints again —
    "s"'s right edge to "e"'s left edge, not eyeballed), stroked at the same width/color, drawn in a
    130ms slot inserted between "s" finishing and "e" starting (pushing "e"'s delay back
    accordingly). Deliberately not added to the other three pairs — they already touch/overlap by
    design, and a connector there would draw a visible line through already-drawn letter shapes.
  - **The font file is gone.** Since "alise" is now baked path data, nothing loads
    `PetitFormalScript.woff2` at runtime any more — the `@font-face` rule and the font file were
    removed from `site/`. If the word or font ever changes, redo the extraction (this is fully
    reproducible, not a one-off hand edit): `npm install @fontsource/<name>`, decompress
    `files/*.woff2` with `wawoff2`, parse with `opentype.parse()` (NOT `opentype.loadSync`, which
    is broken/deprecated in the installed version and silently returns `undefined`), call
    `.getPath()`, split/group/measure as above — including the per-letter `getBBox()` pass if
    connectors are needed again.
  - **Third pass, same day: Reuben asked to lock the spec down by direct Q&A rather than more
    guess-and-show-me rounds** ("ask me as many questions as you need... ask me how that animation
    should work for both the note and the alise bit"). Two rounds of `AskUserQuestion`, 8 questions
    total, produced concrete answers that changed four things:
    - **Caret now disappears the instant typing ends, not after a lingering blink through the
      pause.** `caret-life`'s duration dropped from 1300ms to 850ms (matching `note-type`'s own
      end), and its keyframe stops were recomputed for that shorter span — it still blinks (twice)
      during typing, then `forwards` holds it at `opacity: 0` from 850ms on, so the ~450ms gap
      before "alise" starts is now genuinely empty, not "caret still blinking with nothing
      happening."
    - **The s→e connector was removed entirely**, on explicit instruction, reverting to fully
      discrete letters — the 374-unit gap between them (see above) is left as-is; Reuben's answer
      was "remove the connector," not "make the gap smaller," so that's what shipped, even though
      the connector had been visually confirmed working.
    - **"alise" slowed further**, 1600ms → 2000ms total draw time for the 5 letters (same
      proportional split by measured stroke length: a 569ms, l 334ms, i 299ms, s 373ms, e 426ms).
      Per-letter fill still follows immediately after that letter's own stroke (150ms each) — that
      part of the second-pass fix wasn't in question this round, only the speed was.
    - **A pen-tip dot was added** — a small circle that leads each letter's stroke as it draws,
      answering "should there be a visible pen tip." Implemented with CSS Motion Path
      (`offset-path` + `offset-distance`), NOT a hand-tuned position keyframe: each dot's
      `offset-path` is set to that letter's OUTER contour only (reusing the same subpath data from
      the "traced, not typed" extraction above — index 0/2/3/5/7 of the original 9 subpaths, i.e.
      skipping each letter's inner counter and, for "i", skipping the dot), and `offset-distance`
      animates 0%→100% over the identical `--dur`/`--delay`/easing as that letter's own
      `stroke-dashoffset` draw, so the dot's position at any instant matches the current tip of the
      visible stroke by construction rather than by tuning two animations to agree.
      **Two real bugs, caught only by scrubbing (not by reading the CSS):** (1) first cut used one
      shared `dot-trace` keyframe whose `0%` stop set `opacity: 1` — with `animation-fill-mode:
      both`, that stop applies retroactively during an animation's DELAY phase too (the `backwards`
      half of `both`), so every dot was visible from t=0, stacked uselessly to the right of "Note,"
      long before its own letter started. Fixed by splitting the first fraction of a percent into
      its own `opacity: 0` stop (`0%, 0.1%`) before the real `opacity: 1` start at `0.2%` — the
      delay phase now correctly shows the pre-animation value. (2) at the size that matched the
      stroke width (`r`, same radius as half the 190-unit stroke), the dot was visually
      indistinguishable from the stroke's own `stroke-linecap: round` end-cap — same color, same
      size, same position, so it added nothing visible. Sized up to `r="170"` (stroke radius is 95)
      so it visibly bulges past the stroke's own rounded tip — confirmed via a high-`deviceScaleFactor`
      zoomed screenshot, since at normal render size the whole dot is under 10px and easy to
      mistake for "working" when it's actually just invisible.
  - **Full timeline as of the fourth pass** (ms from page load; superseded by the dot/ink split
    below, kept here as the shape of it — see that section for the current per-letter numbers):
    0 pre-roll caret blink at the true start of "N" (fixed this pass — see below) → 250 typing
    starts → 850 "Note" done, caret vanishes immediately → 1300 "alise" starts: each letter's dot
    leads, its ink follows 200ms behind, its fill starts the instant its own ink catches up → ~4350
    settled. The settled state is pixel-identical to the static/reduced-motion fallback by
    construction (both are the same base CSS with all animations having already reached
    `both`/`forwards` end values).
  - **Verified by scrubbing, not just watching.** A single Puppeteer screenshot only proves one
    instant. Real verification here paused every animation and set
    `document.getAnimations().forEach(a => { a.pause(); a.currentTime = t })` for a spread of `t`
    values across the whole timeline (currently ~4.35s end to end), screenshotting each — this is
    what caught the caret bug on the first pass (it was pinned at `left: 0` for the whole typing
    phase; only a mid-typing frame showed it not moving, a single end-state screenshot would have
    missed it entirely), and on the third pass is what caught the pen-dot's two bugs above (both
    invisible to a read of the CSS — one made the dot visible when it shouldn't render at all, the
    other made it render but be indistinguishable from something already on screen).
  - **`prefers-reduced-motion` is the default state, not an override.** The base (non-media-query)
    CSS renders the finished logo with no clip, no stroke-outline, no caret — the `@media
    (prefers-reduced-motion: no-preference)` block is what ADDS the hidden-until-animated starting
    states and the animations themselves. This also means a browser that doesn't understand the
    media feature at all gets the correct static logo, not a half-clipped one — confirmed by
    rendering with `page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}])`.
  - **Fourth pass, same day: Reuben flagged "alise" as visibly out of scale with "Note," asked for
    the dot to actually lead the ink (not move in lockstep with it), asked for slower again, and
    reported the caret "blinking in the middle of the page" instead of at the start of "Note."**
    Given the density of asks, this round opened with `AskUserQuestion` (4 questions) rather than
    guessing — confirmed cap-height matching (not overall-height or literal font-size matching),
    a visible trailing gap between dot and ink (not just a slight lead), one single combined
    slowdown (not separate dot/ink speeds), and confirmed a specific suspected bug for the caret
    before touching any code.
    - **Sizing fix, measured not eyeballed.** "Cap-height matching" means the body of the lowercase
      "alise" letters (a/i/s/e, NOT l's tall ascender) should equal the height of "Note"'s capital
      N. Got real numbers for both sides: Note's N ink cap-height via `CanvasRenderingContext2D
      .measureText('N').actualBoundingBoxAscent/Descent` (NOT `getBoundingClientRect`, which
      returns the CSS line-box — at `line-height: 1` that equals the font-size, not the glyph's
      actual ink height, and would have derived a scale from the wrong number entirely); "alise"'s
      current "a" height from the already-known font-unit bbox data. Ratio of the two gave the
      exact scale factor (1.384×) to apply to the SVG's `height`/`width`, still expressed in `em`
      (not px) so it stays correct at every viewport under `.wordmark`'s `clamp()`. Verified after
      the change: re-measured both sides on the live site, ratio came out to 1.0035 — a match, not
      an eyeball guess. New values: `height: 0.9943em; width: 2.9529em` (was `0.7184em`/`2.1338em`).
    - **Dot now leads the ink with a visible gap, on two separate timelines sharing one set of
      real per-letter lengths.** Previously one pair of CSS variables (`--delay`/`--dur`) drove
      both the dot's `offset-distance` and the letter's `stroke-dashoffset` identically, so they
      moved in perfect lockstep — visually indistinguishable from "the dot IS the stroke's tip,"
      not "the dot is drawing the ink." Split into `--dotDelay`/`--dotDur` (unchanged pacing, still
      proportional to real measured stroke length) and `--inkDelay`/`--inkDur` (same duration as
      the dot, but delayed a further 200ms — `inkDelay = dotDelay + 200`) so the stroke reveal
      chases the dot at a fixed 200ms lag throughout, rather than converging or drifting. The
      per-letter fill still follows immediately after that letter's OWN ink finishes (`fillDelay =
      inkDelay + inkDur`), unchanged in concept from the third pass.
    - **Slower again: alise's total draw time (dot pacing) went from 2000ms to 2700ms**, same
      proportional split by measured stroke length (a 768ms, l 450ms, i 404ms, s 504ms, e 575ms).
      Combined with the 200ms ink lag, total time from the last letter's dot starting to its fill
      completing is ~200ms longer than the dot-only figure — end-to-end timeline is now ~4.35s
      from page load (was ~3.45s).
    - **The caret bug was real, and exactly what Reuben described.** `.wm-caret`'s base
      (non-animated) CSS sets `left: 100%` — correct for the settled/reduced-motion state, where
      the caret is invisible anyway so position doesn't matter. But the animated `caret-move` used
      `animation-fill-mode: forwards` only, not `both` — so during the animation's own DELAY phase
      (0–250ms, before typing starts), with no `backwards` fill, the element showed its base
      stylesheet value instead of the animation's `0%` keyframe. That base value is `left: 100%`,
      i.e. the position AFTER "Note," not before it — so for the entire 250ms pre-roll, the caret
      blinked at roughly the middle of the eventual full "Notealise" word, which is exactly "the
      middle of the page" relative to a reader with no other text yet on screen to anchor against.
      Fix: `caret-move 600ms steps(1, jump-end) 250ms both` — `both` adds the missing `backwards`
      half, so the delay phase now correctly shows the `0%` keyframe (`left: 0%`, the true start of
      "N") from the very first frame. Confirmed by checking a t=100ms frame against a t=850ms
      (fully-typed) frame: the caret's x-position at 100ms now lines up exactly with where "N"
      starts once typed, on the real page, not just in isolation.
  - **Fifth pass: Reuben reported "alise" still far too large and the dot not accurately tracing
    the letters (pace was right, positioning wasn't).** Measured both on the live site before
    touching anything.
    - **Sizing: the fourth pass's cap-height match was correct for what it matched, but matched
      the wrong feature.** It matches the x-height letters (a/e, 95.5px) to Note's cap-height
      (95px) — that part is exactly on target. But `l`/`i`/`s` carry tall ascenders that were
      never part of that ratio, and they measure 135px/121px/110px — the "l" alone is as tall as
      Note's entire font-size box (136px). That's what reads as "far too large": the ascenders
      tower over "Note" even though the x-height sits correctly matched. This is a real design
      fork (match ascenders to cap-height instead → the more usual proportion for a script paired
      with a bold sans, but shrinks the whole SVG ~30% and puts a/e noticeably below Note's
      cap-height) rather than a bug, so instead of picking one, three real scale candidates were
      rendered off the live site (`prefers-reduced-motion: reduce`, so each is the true settled
      look) and handed to Reuben as a comparison artifact rather than decided blind: current
      (×1.00), a midpoint (×0.85), and ascender-matched (×0.704, where `l`'s 135px comes down to
      Note's 95px and a/e come down to ~67px). Awaiting his pick before changing `.wm-alise-svg`'s
      `height`/`width`.
    - **Dot accuracy: a real, measured bug, not a pacing issue — confirmed by asking rather than
      guessing, per Reuben's standing instruction to check ambiguous asks against his intent
      first.** Letters with an enclosed counter (a hole in the glyph — the bowl of "a", the eye of
      "e", the loop of "s") are TWO SVG subpaths: an outer contour and an inner one, both baked
      into the same `<path d="...">` from the font's real glyph outline (opentype.js emits fill
      geometry, and a letter with a counter needs both contours to render the hole correctly). The
      ink's `stroke-dashoffset` reveal correctly draws both, back to back, using the full path's
      length (`--len` = sum of both contours). But the pen-dot's `offset-path` used only the OUTER
      contour (`alise-outer.json`, from the third pass) — a shorter path than what the ink was
      actually drawing, sharing the ink's own duration. Measured on the live site: the outer
      contour is only 56% of the full path length for "s", 70% for "a", 78% for "e", 90% for "i"
      (only "l" has no counter, so it was the one letter already correct — outer fraction 100%).
      Net effect: the ink — timed against the TRUE full length — raced ahead of the dot, which was
      timed against a shorter path over the same duration; the dot would reach the end of its
      (outer-only) path and vanish while the ink was still drawing the inner counter, worst on "s"
      where the ink had already passed the dot's entire path by the time the dot finished. Fix:
      point each dot's `offset-path` at the exact same `d` as its ink `<path>`, so dot and ink
      share identical geometry and length — the 200ms lead (fourth pass) then falls out correctly
      for free, since same duration + same path + a head start means the dot's arc-length position
      is always ahead of the ink's, smoothly, through the outer→inner jump. Confirmed two ways:
      geometrically, sampling `offsetDistance`/`strokeDashoffset` across each letter's draw window
      showed the arc-length gap between dot and ink staying positive throughout and closing to ~0
      right as the ink finishes (never negative, never stuck) — and visually, a zoomed screenshot
      mid-draw on "s" (the worst case) shows the dot sitting right at the ink's leading tip, not
      floating disconnected from it.
  - **Sixth pass, same day: Reuben picked a sizing option, then flagged two more real issues on
    the live result — "Note" and "alise" touching at the seam, and the (just-fixed) dot's motion
    reading as "violent."**
    - **Sizing: picked "ascender-matched" (option C, ×0.704 relative to the fourth pass's
      cap-height-matched baseline), then asked for it "a tiny bit smaller."** Read literally as
      undershooting the ascender-to-cap-height target rather than hitting it exactly — the
      ascender now lands just under Note's cap-height instead of flush with it. Applied ×0.65
      overall (ascender ~88px against Note's 95px cap-height, ~92%), re-measured on the live
      site to confirm, and it's the size shipped. `.wm-alise-svg` is now
      `height: 0.6463em; width: 1.9194em` (was `0.9943em`/`2.9529em`).
    - **The "e"/"a" seam: a real, measured bug introduced by the resize above, not a separate
      ask.** `.wm-alise-svg`'s `margin-left` (`0.01em`) was tuned back when the SVG was much
      bigger; the small built-in left-bearing inside the SVG's own `viewBox` (it starts at
      `x: -58`, giving a little blank space before the "a" glyph) shrank proportionally with the
      ×0.65 resize, and the fixed `margin-left` didn't compensate. Measured gap after the resize:
      ~0.3px — visually touching, which is exactly the "looks like two separate boxes" Reuben
      called out (the two halves read as jammed together rather than one word). Fixed by raising
      `margin-left` to `0.06em`, chosen by rendering four real candidates (0.03/0.05/0.07/0.09em)
      off the live site and picking by eye — 0.03 still read as touching, 0.09 started to read as
      two separate words, 0.06 landed as "one word, two rhythms."
    - **The dot's motion: "violent" was a specific, diagnosable shape, not just a feel complaint —
      and it's a direct consequence of the same-day sync fix above.** Confirmed by sampling the
      dot's actual on-screen (x,y) trajectory across the "l" stroke, frame by frame: it moves
      smoothly up the ascender, then sharply REVERSES and comes back down an almost-parallel
      track before continuing into the tail. That's not a bug in the new sync — it's the honest
      shape of a font glyph's fill outline, which traces up one edge of a stroke and back down
      the other (the outline has to enclose the ink shape, so a single-width stroke is still two
      parallel edges joined by a U-turn at the tip). The fourth pass's "outer contour only" dot
      path had exactly the same shape and hid it by being a much shorter, decoupled path; today's
      sync fix (dot now shares the ink's real geometry) made the letters land correctly but
      exposed this cusp as a sharp, fast direction reversal — which reads as "violent."
      **Fix: a smoothed centerline built from the same outline, used only for the dot's path (the
      ink keeps the true outline, unaffected).** Per subpath: sample ~100 points by arc length,
      then for each point in the first half, find its nearest point elsewhere on the same subpath
      (excluding a ~12%-of-length neighborhood around it, so a point doesn't just match its own
      close neighbor) and take the midpoint — approximating the medial axis by pairing each edge
      point with the opposite edge point actually nearest it, rather than assuming symmetry (a
      naive "pair arc-length s with L-s" was tried first and produced a good result on simple
      strokes like "l" but tangled, self-crossing paths on letters with real loops — "a" and "s" —
      because their two edges aren't equal length; nearest-point matching fixed that). Confirmed
      by re-sampling "l"'s trajectory after the fix: same up-then-down journey (correct — that IS
      how the stroke is shaped), but now a smooth, gradual arc through the turn rather than a
      sharp cusp. Checked visually against the messier letters ("a", "s") too — a couple of small
      tangles remain very close to tight cusps (e.g. "s"'s small top loop), small enough on screen
      not to read as a problem.
      **Also slower, per the same ask.** New dot durations are paced off the new (shorter,
      centerline) path lengths rather than the old full-outline lengths, at roughly 1.3× the old
      per-letter pace (a 768→1131ms, l 450→461ms, i 404→512ms, s 504→716ms, e 575→780ms) — modest
      rather than dramatic, since the pacing itself was already confirmed correct two passes ago
      and only the motion shape was in question. Ink keeps sharing each letter's duration and now
      trails the dot by 250ms (was 200ms). Total settle time is now ~5.3s from page load (was
      ~4.35s). Re-verified the dot/ink sync survived the path change: sampled the pixel distance
      between the dot and the ink's current tip across "s" — 6 to 48px through the draw (small
      relative to the letter's on-screen size, consistent with the dot legitimately riding the
      centerline rather than the outer edge) — and confirmed it never balloons the way the
      pre-fix bug did.
  - **Checkpoint, 2026-08-09: paused here by Reuben's own call — "not perfect" but logged, not a
    dead end.** Known remaining rough edges, for whoever (human or Claude) picks this back up:
    small path tangles near tight cusps on "a" and "s" in the dot's centerline (see the sixth pass
    above); the seam gap (`0.06em`) and the sizing (`×0.65` off the fourth pass's cap-height
    baseline) were both picked by eye off a handful of rendered candidates, not derived from a
    formula, so either could still move; total animation length (~5.3s) has crept up across
    passes and hasn't been reconsidered as a whole in a while. Don't re-derive the font choice,
    the stroke+fill technique, or the dot-leads-ink structure from scratch — those are settled,
    see the passes above for why. Read this file's own retrospective in memory (search this
    project's Claude memory for "notealise" or "design iteration") before starting the next round
    — it covers what made some rounds fast and others slow.

## Seventh pass, 2026-08-10 — the "Note" typing caret desync, and replacing the outline-trace
technique entirely

Reuben sent a screen recording of the live animation and flagged two things: a vertical bar
appearing next to "No" that looked like a broken "t", and the alise dot "doesn't actually create
the ink look... looks like it's messing around." He asked to be asked questions rather than have
either guessed at again. Both were verified against the real render (Playwright + a
programmatically-installed headless Chromium — no such tool existed in this environment before
this session; `python3 -m pip install playwright && python3 -m playwright install chromium` gets
one, and `document.getAnimations()` + setting `.currentTime` gives frame-exact, deterministic
screenshots of any point in the animation instead of racing real wall-clock delays) before
touching any code.

**The caret bug was real and mechanical, not a matter of taste — fixed outright.** `.wm-caret`'s
two animations ran on separate, unsynced clocks: `caret-life` (the blink) was `850ms, 0ms delay`;
`caret-move` (the position) was `600ms, 250ms delay`. Consequence, confirmed frame-by-frame: when
"N" appeared at 284ms the caret was invisible (mid blink-off) and didn't show until 462ms — a
stray ~180ms lag; it happened to land in sync when "o" appeared; then it went invisible exactly as
"t" appeared and never showed again before the word finished. That inconsistency (sometimes
synced, sometimes 180ms late, sometimes entirely absent for a letter) is what read as "the t
rendering weird" — there was never a partial glyph, "Note" has always revealed whole characters
via a stepped `clip-path`. Fix: `caret-life` now runs on the identical `600ms, 250ms` timeline as
`caret-move`, with blink phases keyed to the same 5.7/48.5/91.4% breakpoints, so the caret is
guaranteed visible the instant any letter appears.

**The ink complaint went deeper than the dot, and the whole per-letter drawing technique got
replaced.** Zooming into the "a" draw frame-by-frame (not just the dot's cusp behaviour, the
actual visible ink) showed a floating comma, a "σ", an "x" — unrecognizable as a letter for most
of its ~1.1s draw — then a snap to solid "a" in a 150ms flash at the end. Mechanism: the old
technique stroke-traced the glyph's OUTLINE (both the outer and inner/counter contour, since a
letter with a hole needs both) with fill invisible the whole time, fill only appearing after the
full outline finished. A thin partial silhouette of a cursive letterform does not read as "part of
a letter" — a real pen's ink grows solid as it moves. Combined with the dot's sixth-pass
centerline (deliberately DIFFERENT from that outline, to kill the "violent" cusp reversal), the
dot was never riding what was actually visible on screen either. Reuben's call, given the choice
between patching the dot's alignment (cheap, keeps the scribble problem) or rebuilding the
technique (bigger, fixes both): **rebuild**.

**New technique — a growing-ink mask, driven by the exact same path the dot already rides:**
- Each letter's hand-tuned centerline (already computed in the sixth pass — the medial-axis
  nearest-point-pairing algorithm, unchanged, still exactly the path each `<circle
  class="wm-pen-dot">` uses) now ALSO drives an SVG `<mask>`: a thick (`stroke-width: 900`),
  round-capped stroke traced along that same centerline inside a `<mask>` element, revealing the
  real glyph fill underneath as its `stroke-dashoffset` animates. `pathLength="1"` on the mask's
  `<path>` normalizes dasharray/dashoffset to 0–1 regardless of the path's real length, so no
  arc-length computation was needed to keep it in sync with the dot's `offset-distance`.
  `stroke-width: 900` was reached empirically, not derived — 340 (roughly outline-stroke-width ×
  1.8) left every letter looking like a thin wire skeleton, confirming the true glyph fill has
  real calligraphic thick/thin variation the old fixed 190-unit outline stroke never had to cover.
  900 was verified by screenshotting the fully-revealed state and confirming it matches the
  static/no-animation glyph shape exactly, letter by letter.
- The dot and the mask now share ONE set of timing custom properties (`--revealDelay`/
  `--revealDur`, on a `<g>` wrapping both), rather than the dot leading the ink by a fixed 250ms as
  in every earlier pass. There is no longer a separate "outline trace" phase and "flash-fill"
  phase to desync — the reveal IS the fill, continuously, so the dot sits exactly at the leading
  edge of visible ink by construction, not by tuning.
  `--inkDelay`/`--inkDur`/`--fillDelay`/`--fillDur`/`--len` and the `draw-stroke`/`letter-fill`
  keyframes are gone; `--revealDelay`/`--revealDur` reuse the old `--dotDelay`/`--dotDur` values
  verbatim (1300/1131 · 2431/461 · 2892/512 · 3404/716 · 4120/780 for a/l/i/s/e) — they were
  already contiguous letter-to-letter with no gap, so the ~4.9s total settle time is close to the
  old ~5.3s despite dropping the old per-letter 250ms dot-lead stagger.
- A mask can only ever reveal within the shape it's masking, never add ink outside the letter's
  own true outline — so an oversized mask stroke bulging past a glyph's edge (which 900 units
  does, generously) cannot bridge into a neighbouring letter or widen the "e"/"a" seam. Confirmed
  the seam still shows real daylight after the rebuild.
- Same known residual as the sixth pass, inherited unchanged since the centerline data itself
  didn't change: the medial-axis pairing still has small self-tangles very close to tight cusps on
  "a" and "s". Visible on close frame-by-frame inspection as a brief double-back in the reveal
  front; not visible at normal playback speed in the verification recordings taken this session.
  Don't re-derive the centerline algorithm to chase this without a concrete complaint — it was
  already adjudicated "small enough" once, and the mask technique doesn't make it any worse than
  the dot alone did.
- Verified: full frame-by-frame sequences of "a" (worst case: longest draw, first letter,
  previously the least recognizable) and "s" (previously the sharpest cusp-reversal complaint)
  both show solid ink growing with the dot riding the front edge; the `prefers-reduced-motion:
  reduce` static fallback still renders the complete solid wordmark (masks default to fully
  revealed with no `stroke-dasharray` set outside the animated media query, same pattern the old
  technique used); a real-time (non-seeked) recording settles at the same ~4.9s the seek-based
  math predicts, confirming the deterministic-seek verification method matches actual playback.

## Eighth pass, 2026-08-10 — the seventh pass shipped two regressions; both found and fixed

Reuben, same day: "you've made the text thinner, revert this", the "t" glitch is still there, and
the dot should "DIRECTLY create what lines are underneath it... AS ACCURATE AS POSSIBLE."

- **The wordmark really had got thinner, from TWO compounding causes.** (1) The seventh pass
  rewrote the letter rule as `.wm-letter { fill: var(--ink) }` and silently dropped
  `stroke: var(--ink); stroke-width: 190` — that stroke is where the weight comes from, and
  without it only the raw glyph fill renders. (2) The reveal mask was **also eating ~11% of the
  glyph** (measured 10,345 px). Restored the stroke verbatim; see the mask fix below.
- **The mask-coverage check in the seventh pass was worthless and said everything was fine.** It
  compared the finished animated state against the `prefers-reduced-motion` static state — but
  `mask="url(#ink-X)"` is on the element in BOTH, so both were clipped identically and the diff
  was ~0. **To test whether a mask covers its target you must compare against the element with
  the mask attribute REMOVED** (`page.evaluate` stripping it), never against another masked
  render. That one mistake is what let a visibly-wrong wordmark pass as verified.
- **Root cause of the clipping: mask width was derived from the distance to the NEAREST glyph
  edge.** The centerline is a medial-axis *approximation* and is not perfectly centred, so on an
  off-centre stretch the nearest edge is the short side and the far edge is never reached — which
  is why the missing ink formed a thin rim along the outer edge of every stroke rather than a
  blob (the overlay that made this obvious: true glyph in grey, revealed ink in black, missing in
  red — worth rebuilding if this ever regresses). Fixed by computing the real **coverage
  radius**: assign every outline sample to its nearest centerline sample, and require that
  centerline sample to be wide enough to reach it. Median required radius turned out to be ~67–80
  units against a nearest-edge measure of ~48–70 — i.e. the old measure was short almost
  everywhere, not just in a few spots.
- **Second root cause: the centerline stops short of the stroke tips**, so every outline point
  around a tip was assigned to the last centerline sample and demanded a radius up to 658 units
  there (vs ~70 typical). Rather than let those spots balloon, each subpath end is now **extended
  along its own tangent out to the real tip** (extend by the furthest projection of the outline
  points it owns). That fixes the coverage spike and means the pen now travels the whole stroke,
  which is what a real pen does. The dot's `offset-path` is rebuilt from the same extended
  centerline, so dot and mask still share one geometry.
- **The reveal is now 34 short segments per letter, each only as wide as the glyph is there**
  (`--w`), instead of one uniform 900-wide stroke. That is what makes the dot the creator: a
  uniform 900 mask bloomed ink up to 450 units ahead of a 170-radius dot, whereas a segment sized
  to the local stroke puts the reveal front exactly at the dot. Segment timing is derived by
  **numerically inverting CSS `ease-in-out`** (cubic-bezier(.42,0,.58,1)) so each segment's
  delay/duration lands where the eased dot actually is; segments run `linear` inside their own
  short window, which approximates the eased curve closely enough at 34 segments while the dot
  keeps its true `ease-in-out` `offset-distance`. **The per-letter delays and durations are
  unchanged** from every earlier pass (1300/1131 · 2431/461 · 2892/512 · 3404/716 · 4120/780), so
  this is not slower — total settle stays ~4.9s.
- **Dot radius now follows the same thickness curve** (`@keyframes dot-r-a…e`, generated, `r`
  animated as a CSS property) at scale **1.0** — the dot is exactly as wide as the ink it lays
  down, so every black pixel has been under it. Rendered 1.0 / 1.4 / 1.9 against each other
  first: the difference is marginal because the dot still reads as a nib at the leading edge in
  all three (it protrudes past the drawn ink's round cap), so the most accurate one won. If a
  more visible pen tip is ever wanted, it is one constant (`DOT_SCALE`) — no re-derivation.
- **The "t" glitch was real and was NOT the caret** (the seventh pass blamed the caret and was
  half right — the caret desync was a separate genuine bug, already fixed). Measured with the
  caret hidden via injected CSS, so ink could not be confused for it: during the "o" phase the
  wordmark shows a THIRD run of ink at x 328–332 that a real "No" does not have (a real "No" ends
  at 324). That is the **t's crossbar reaching left of the reveal edge** — `clip-path` cuts on one
  straight edge and cannot exclude it. Fixed as Reuben specified, with a background-matched patch
  (`.wm-t-patch`, `background: var(--bg)` so it follows the theme rather than assuming white) over
  59.4–60.8% of the wordmark's width, opacity 1 until the 91.4% breakpoint where "Not" is revealed
  and 0 after — and placed **before `.wm-caret` in the DOM** so the caret always paints on top of
  it. Percentages rather than px so it holds at every `clamp()` font size. Verified: during the
  "o" phase the ink runs now match a real "No" exactly.
- **The generator is `tools/wordmark/gen_ink2.py`'s successor, `gen_pen.py`** — see the ninth
  pass. If the centerline, the font, or the 190 stroke weight ever changes, the segment widths
  must be regenerated from it — they are computed against the current geometry, not hand-tuned.

## Ninth pass, 2026-08-10 — one word, one pen, handwriting stroke order

From a second screen recording: alise still too big and "not on the same line", reading as "two
separate animations spliced together"; the pen should draw a little quicker and in the direction a
hand would actually move; and the dot must never fade in or out and must stay the weight of the
font rather than swelling. Thickness and typeface explicitly not to be touched.

- **Why alise sat low, measured rather than nudged.** `.wm-alise-svg`'s viewBox stops at y=19 but
  the 190 stroke extends 95 user units past the glyph outline, and `overflow: visible` lets it
  paint outside the box. An inline-block's baseline is its bottom margin edge, so alise's *visual*
  bottom hung ~0.0355em below Note's baseline while Note's own round letters overshoot only
  ~0.0114em. Net ~5 CSS px of droop, and the `l` ascender was clearing Note's cap height as well —
  together that is what read as spliced-on. Fix is a computed `vertical-align` on the SVG:
  `0.035472 × scale − 0.01136` em. **Rendered four options as a real comparison page rather than
  arguing about it in prose** (unchanged / aligned at 100% / 93% / 86%); Reuben picked **93% +
  aligned**, so `height`/`width` are now `0.6011em`/`1.7850em` and `vertical-align: 0.02163em`.
  Any future size change must recompute the nudge from that formula — the two are coupled.
- **Stroke order is now handwriting order, and only "a" and "e" were actually wrong.** Checking
  each letter's centerline against the glyph outline first showed `l`, `i` and `s` already ran the
  natural way (start low, up into the stroke, back down and out — for `l` the ascender really is a
  narrow Λ that merges into the stem at y≈-485, so its existing start point *is* where a hand
  starts). That the two Reuben named were exactly the two that needed changing is a good check on
  the reading. Rebuilt by re-ordering and reversing slices of the existing centerline arrays:
  `a` = reverse(sub0[:177]) + sub1[:205] + sub0[319:] — top of the bowl, the "c" anticlockwise,
  then down the stem and curl out. `e` = reverse(sub0) — inside the eye, out along the crossbar,
  over the top, down the left, round the bottom, exit bottom-right. **The medial-axis branch
  sub0/sub1 split is not a stroke boundary**; don't assume it is.
- **Choosing the stroke order is now free, because coverage is guaranteed independently.** The
  eighth pass's coverage rule (every outline point must be reachable from its nearest centerline
  sample) means dropping a branch from the drawn path — `e`'s sub1, `a`'s top junction tangle —
  can only widen the neighbouring masks, never leave a hole. So writing order is a pure design
  choice with no correctness cost. Verified: 4 stray px of 88,461 against the unmasked render.
  **Coverage must be solved per LETTER across all of its strokes at once** — solving it per stroke
  makes each stroke responsible for the whole letter (the `i` body would have to reach its own
  tittle) and inflated the widths ~3× before this was caught.
- **One pen for the whole word, not five dots.** A single `<circle>` now rides one continuous
  offset-path built from every stroke plus straight connectors between them, so it *travels* the
  gaps instead of teleporting. Opacity is a hard 1 throughout with a cut to 0 at 99.9→100% — it
  never fades at either end (verified by hiding every `.wm-letter` and sampling the dot alone
  across the window: visible 1020→4320ms, no gaps, opacity exactly 1.0 at every sample).
- **Dot radius is constant at 170** — the font's own nominal stroke weight — instead of tracking
  local thickness, which had it swelling into a blob on the fat parts of a letter. Ink can still
  bloom marginally ahead of it where a mask segment is wider than the pen; that is the accepted
  trade for a dot that stays the weight of the type.
- **Everything is linear now and all pacing lives in the keyframe positions.** The eighth pass's
  ease-in-out inversion is gone: with one shared pen there is a single clock, and constant pen
  speed across the whole word is both what a hand does and what makes the ink front and the dot
  impossible to desync. Drawing time 3600→2950ms with 50ms per connector, and the start moved
  1300→1000ms to close the dead gap after "Note" finishes at 850ms. **Ends at 4350ms, was 4900.**
- **Generator and verification harness now live in `tools/wordmark/`** (moved out of the session
  scratchpad 2026-08-10 so they survive — `/private/tmp` does not). `gen_pen.py` supersedes the
  earlier `gen_ink*.py`; the stroke plans live in `strokes_for()` and its index splits are against
  the current centerline arrays, so they must be re-derived if the centerline is regenerated.
  **`site/index.html`'s `<g>` blocks, `.wm-ink-seg` paths and `@keyframes pen-move` are generated
  output — edit the generator, never the HTML.** See `tools/wordmark/README.md` for how to run
  and verify it, including the coverage-check trap that cost the eighth pass.

## Tenth pass, 2026-08-12 — the nudge that never applied, and the pen that outran itself

Two complaints from Reuben against a screen recording of the finished animation: alise still
sits low against Note, and when the draw reaches **s** and **e** parts of the letters appear
out of sequence with the dot that is supposed to be making them. Both turned out to be real,
and neither was where the previous pass thought it was.

### 1. alise sat low because the nudge was written into a property that does nothing

`.wordmark` is `display: inline-flex`. **alise is therefore a FLEX ITEM, and `vertical-align`
does not apply to flex items at all.** The ninth pass computed a careful
`vertical-align: 0.02163em` from the geometry, wrote it into the stylesheet, and it has never
moved anything — which is why alise still looked dropped after a pass whose headline fix was
raising it. The derivation was fine; the property was inert.

Measured all four candidate mechanisms in a real browser rather than reasoning about the box
model, by overriding each and diffing the rendered pixels (0.05em test displacement):

| mechanism | moves alise? |
| --- | --- |
| `vertical-align` | **no** — does not apply to flex items |
| `margin-bottom` | **no** — a flex item's baseline is synthesised from its *border* box |
| `position: relative; top` | yes, 1:1 |
| `transform: translateY` | yes, 1:1 |

`margin-bottom` failing is the non-obvious one, and it is the fix a reader is most likely to
reach for after learning that `vertical-align` is out. It is now `top`.

**The constants are measured, not derived.** `gen_pen.py` carries `INK_DROP` (em of alise ink
below the text baseline per unit of `ALISE_SCALE`) and `NOTE_OVERSHOOT` (how far Note's round
letters fall below its flat N/t feet), and `measure_align.py` reports the residual off the live
page and prints the constant to change if it is more than a pixel. The first derived guess was
out by ~0.5px; one measure-adjust-remeasure cycle took it to zero. **Ink bottom is aligned to
ink bottom, not baseline to baseline** — every alise letter is round-bottomed so it should
overshoot exactly as Note's `o` and `e` do, and the 190 stroke means alise's own baseline is no
longer where its ink ends.

### 2. The ink outran the pen because the centerlines did not go where the letters are

The reveal mask is a thick stroke swept along each letter's centerline, and `gen_pen.py` sizes
each segment from the true coverage requirement: wide enough that every outline point is
reachable from its nearest centerline sample. That rule is correct and is what guarantees no
part of a letter is left unpainted. **It also means a centerline that misses part of a letter
does not produce a hole — it produces an enormous segment**, and when that segment switches on,
the limb it reaches flashes into view nowhere near the dot.

That is exactly what the old centerlines did. Measured against each glyph's own outline:

| letter | outline points >250 units from any centerline sample | widest mask segment |
| --- | --- | --- |
| a | 6% | 989 |
| **l** | **35%** | **1657** |
| i | 8% | 1082 |
| s | 12% | 1172 |
| e | 8% | 957 |

The pen dot is **340** units across. The `l`'s entire exit swash had no centerline under it at
all, so one 1657-unit segment — 4.9x the pen — drew the whole letter in a single frame at
1975ms. Rendering the glyph, its centerline and its unreachable outline points as one picture
made this obvious in a way the numbers alone had not; do that first next time.

**The fix is upstream of the mask.** `build_centerlines.py` now derives each centerline from
the glyph itself: rasterise the PAINTED shape (fill *plus* the 190 stroke — that is what has to
be covered), skeletonise it, prune the barbs skeletonisation leaves at wide terminals, then walk
a route over the skeleton graph that covers every branch. Widest segment is now **1.4x** the pen
dot, and the whole class of defect is gone rather than tuned down:

| | before | after |
| --- | --- | --- |
| frames where ink appeared >2.2x the dot radius away | 18 | **0** |
| worst single burst | 5251 px | 1799 px |
| worst distance/dot ratio | 4.98 | 2.10 |

**Stroke order moved out of `gen_pen.py` entirely.** `center_d` is now the finished route, in
writing order, so `strokes_for()` is the identity and the index-slicing stroke plans
(`s0[:177][::-1]` and friends) are deleted. Those only ever existed to re-cut centerlines that
missed limbs; they were also pinned to array indices that any regeneration would invalidate,
which the ninth pass flagged as a hazard and this removes.

Falling out of it: one continuous stroke per letter instead of nine strokes across the word, so
there are four pen travels rather than eight, and the draw ends at **4150ms, was 4350**.

### The `a` retraces, and that had to be paid for in time rather than avoided

`a` is the one letter whose graph cannot be covered in a single pass, and the reason is that a
hand really does draw part of it twice: you close the bowl by coming up its right-hand side and
then come straight back **down the same ink** to make the stem. Minimal-overdraw routing refuses
to repeat that branch — the walk it finds instead starts on the exit tail and finishes in the
middle of the letter, correct as a graph traversal and wrong as handwriting. So `a` gets an
explicit route (`build_centerlines.ROUTE`) and 18% overdraw.

**That introduced a new artefact, caught only by looking at frames.** At one constant speed the
second pass down the stem is ~160ms in which the pen moves and no new ink appears — and because
the dot is the same colour as the ink it is crossing, it reads as the animation freezing in the
middle of the first letter. Fixed by making time follow ink rather than distance:
`retrace_weight()` marks samples that come back within 50 units of ink laid earlier in the same
stroke, and those get `RETRACE_SPEED` (0.35) of the time per unit length. A hand moves fast over
ink it has already laid; the slow part is laying it. Stall is now **75ms**, imperceptible.

This needed one more change: speed now varies *within* a stroke, and CSS interpolates
`offset-distance` linearly between keyframes, so a single keyframe per piece would let the dot
cut the corner off every speed change and drift off the ink front. The generator now emits a
keyframe wherever the weight steps plus a floor of `KF_PER_STROKE` evenly spaced — 135 in total,
where there used to be 9. Mask segment timings come from the same weighted fractions, so the two
cannot desync.

### What is verified, and with what

`verify_ink_vs_pen.py` is new and is the check that would have caught this originally. Every
other tool here verifies that the *finished letterform* is right; nothing verified the thing a
viewer actually complains about, which is ink switching on where the dot isn't. Coverage was
perfect the whole time this bug existed — every pixel did get painted, just not when or where a
hand would paint it. **A check that only looks at the end state cannot see a timing defect.**

Current state, all against the live page:

- ink appears at the pen: median 1.06x the dot radius, max 2.10x, **0 frames flagged**
- coverage against the mask-removed letterform: 4 stray px of 88,463 (unchanged from the ninth
  pass — the mask still reveals the whole glyph)
- pen dot: opacity exactly 1.0 throughout, one constant size, no visibility gaps, 1020→4140ms
- alignment residual: 0.00000em
- **real-time playback** (not seeked): ink strictly monotonic, 99.9% drawn at 4152ms against a
  generator schedule of 4150ms

`skeletonize` comes from scikit-image, which is a new build-time-only dependency for this
directory — not an app dependency, same standing as playwright and numpy here.

### Tenth pass, addendum — a second look at the same two things

Reuben checked the result and found both again, smaller. Worth recording, because in each case the
first fix had been verified and was still not finished.

**The `s` still hitched, and the ink-vs-pen check said it was fine.** No detached ink — the max
distance was 1.44x the dot. What was wrong showed up in a number that check was already printing
and nothing was reading: new ink per frame fell to 2–28 px between 3130–3180ms against 100–200
either side. The ink front stopped while the dot carried on. Two causes, neither of which is
"the mask outran the pen":

- **The reveal disc's radius follows the letter's local thickness**, so it is not constant along a
  stroke. Consecutive segment widths across the dip run 401, 401, 362, 268. Where the disc grows the
  front runs out ahead of the pen; where it shrinks the front stops dead until the pen catches up.
- **A stroke that crosses itself re-covers painted ink.** `s` and `e` each cross once, and `a`
  retraces its stem deliberately.

Both read identically to a viewer — the ink hangs while the dot moves — and because the dot is the
same colour as the ink it is crossing, it looks like the animation hanging rather than a pen
travelling.

The fix replaces the hand-rolled retrace rule from the first pass (which only caught the third
cause, by proximity, with a hard-coded 50-unit radius) with something that **measures** instead of
modelling: `new_ink()` sweeps the reveal disc over a grid and counts cells that were not already
covered, and time is handed out in proportion. The pen lingers where a lot of ink is appearing and
moves briskly across ink it already laid, with no special case for why. `RETRACE_R`/`RETRACE_SPEED`
are gone; `GRID`, `SMOOTH_W`, `MIN_SPEED`, `MAX_SPEED` replace them.

| | after the first fix | after this |
| --- | --- | --- |
| longest stall (no new ink) | 75ms | **50ms** |
| worst ink-to-dot distance | 2.10x | **1.81x** |
| new ink per frame, p10–p90 | wide | **158–326 px** |

**The alignment target changed, and it is now taste rather than rule.** The first pass matched
alise's lowest ink to Note's *lowest* ink, so the script overshoots exactly as `o` and `e` do —
which is what typography says to do, since every alise letter is round-bottomed. Reuben looked at
four renders and chose **flush with Note's flat N/t feet** instead (`OVERSHOOT = 0`). This script is
heavy and set low against a 700-weight sans, and giving it the o/e overshoot on top still read as
sagging. Recorded so nobody restores the "correct" 0.0098em on principle.

**One more trap, in the measuring tool itself.** `measure_align.py` flagged a 0.67px residual after
the change and printed an `INK_DROP` that would have undone most of the raise Reuben had just
chosen. Both edges being compared are **antialiased curves**, and where their coverage crosses the
128 threshold moves with sub-pixel position: stepping `top` by a known 4 device px moved the
measured bottom by 6. Its tolerance is now 4 device px, and it says out loud that it measures an
edge and does not have taste. **A measurement precise enough to state is not automatically precise
enough to act on** — and a tool that tunes toward its own noise will walk a design away from the
render that was actually approved.

### Tenth pass, second addendum — the lumpy front, and why per-segment widths had to go

Reuben looked again and called it: *"the 's' bit has this slight glitch and it looks
unprofessional — solve this so it isn't visible until the real stroke is created."* He was right,
and the two fixes before this had both missed it because both were measuring the wrong thing.

**What it actually was.** Every `.wm-ink-seg` is a **round-capped** stroke grown by
`stroke-dashoffset`, so the revealed region is the union of a chain of discs. Giving each segment
its own width — which the coverage figures invite, since the requirement genuinely varies along a
letter — makes that chain a **lumpy sausage**: bulge, pinch, bulge. Where a segment's disc is
narrower than the glyph is thick it never reaches the glyph's own edge, so a notch shows and then
fills in a moment later when a wider neighbour arrives. The `s` ran 258→422 across its length and
read as a caterpillar rather than a pen. At high zoom it is unmistakable, and it is exactly "ink
visible before the stroke that makes it exists".

**The fix is one width per letter** — the max of that letter's coverage requirement. Then the
revealed region is a constant-radius sweep, the front is a single clean pen tip, and everything
behind it is bounded by the glyph's own outline. This is a geometric property, not a tuning: with
one radius there is no radius step to bulge or pinch at.

Per *letter* and not per word: one width for all five would size every letter to the fattest part
of the fattest one, and that surplus is precisely what runs ahead of the pen.

**The trade, accepted.** On the thin parts of a letter the disc is now wider than strictly needed,
so ink appears a little further ahead of the dot: the median ink-to-dot distance goes from 1.03x to
1.31x the dot radius. The worst case barely moves (1.81x → 1.89x) and nothing is flagged, so the
front still reads as being at the pen. Steady and slightly ahead beats exactly-at-the-pen and lumpy.

**Why the earlier checks did not catch it.** `verify_ink_vs_pen.py` asks *how far from the dot did
ink appear* — and the answer was fine (1.44x). The new-ink-rate work asked *is the front advancing
evenly* — also fine by then. Neither asks *is the front the right shape*. The metric that does:
count reveal-boundary pixels that run through the **interior** of the glyph more than a few dot
radii behind the pen. Behind the pen there should be no such edge at all, only the glyph's own
outline. Median per frame across the `s` fell 28 → 18 and p90 43 → 24 (the floor is antialiasing
plus the legitimate seam where one letter's mask meets the next).

The general lesson, third time in this project: **each of these three fixes was verified against a
check that could not see the next defect.** Coverage could not see timing; timing could not see
front shape. When a visual complaint survives a green check, the check is measuring the wrong
quantity — go and look at the pixels at high zoom before adjusting anything.

### Tenth pass, third addendum — flush at last, and the cap was the culprit

Reuben: *"really make it flush, like you covered up the part of the t on note in the cursor typing
animation, do the same kind of treatment there."*

**The cause, finally.** Uniform width per letter fixed the bulge/pinch chain but left the
`stroke-linecap: round` on the reveal stroke — and a round cap puts a **semicircle of half the
stroke width ahead of the pen**. That is ~211 user units, about 10 CSS px live, which is *wider
than the pen dot itself*. So the letter appears fractionally before the pen reaches it, and where
the glyph widens just ahead, that reads as a blob. Every measurement up to here had been asking how
far ink was from the dot as an unsigned distance, which is why it kept passing: the answer was
"about one dot radius", and the sign — *ahead* — was the whole complaint.

**The fix removes the overshoot rather than covering it.** `stroke-linecap: butt` ends the ink on a
flat line perpendicular to the stroke, exactly at the pen. So there is nothing left for a
`.wm-t-patch`-style cover-up to hide; the patch treatment would have papered over geometry that
should not exist. Measured with a signed, directional metric (project newly-inked pixels onto the
pen's own direction of travel, in dot radii):

| | median | p90 | max |
| --- | --- | --- | --- |
| round cap | 1.14 | 2.67 | **4.95** |
| butt cap | **0.06** | **0.30** | **1.70** |

Ink now ends *under* the dot.

**Two consequences that are not optional.** Butt caps do not join, so the 32 abutting segments per
letter would notch at every boundary falling on a curve — the artefact just removed, in a new form.
So each letter is now **one** reveal path (5 in total, not 160), with `stroke-linejoin: round`
handling its bends, and the pacing moved from 32 per-segment delays into a keyframed
`stroke-dashoffset` off the same weights. And a square cap leaves the letters' rounded terminal
tips unpainted, so the path is generated `END_EXTEND` longer at both ends — running off the glyph
along the tangent, painting nothing, given no dwell time. Coverage is unchanged at 5 stray px of
88,463, which is what proves the extension is enough.

The generated keyframes now live in a **delimited region** (`wordmark-keyframes:begin/end`), because
there are 1 + 5 blocks rather than a fixed one: a plain "replace @keyframes pen-move" would have
left the previous run's five `ink-*` blocks behind to accumulate. Verified idempotent.

**Speed.** `gen_pen.py` takes `--out`, `--total-draw` and `--connect`, so variants are generated
into a copy and `site/index.html` is only touched when that is meant. Reuben's brief was alise only
— the "Note" typing and the pause after it do not scale — so `ALISE_START` stays at 1000 and the
finish time is `ALISE_START + total_draw + 4 × connect`. Three variants built at 3.50s / 3.00s /
2.50s against the 4.15s current, all four settling on a byte-identical final wordmark (46,768 ink
px) and all three staying flush at speed (median 0.06–0.10 dot radii ahead).

**The lesson, and it is the same one a fourth time:** an unsigned metric could not see a directional
defect. Coverage could not see timing; timing could not see front shape; front shape as a distance
could not see which *side* of the pen the ink was on. Each check was green and blind to the next
thing. When a visual complaint survives a green check, the check is measuring the wrong quantity.

**Chosen: variant 2 — alise finishes at 2998ms** (`TOTAL_DRAW = 1870`, `CONNECT_MS = 32`), 28%
quicker than the 4.15s it had been. `CONNECT_MS` was scaled down with `TOTAL_DRAW` rather than left
at 50: pen travel between letters has to stay the same *fraction* of the draw, or on a shorter
animation those four gaps grow to 13% of it and read as four pauses.

Reuben's condition was that "Note" keep its speed, and that is checked rather than assumed —
frames 0–1000ms are **pixel-identical** to the slower build. It holds structurally too: the typing
(250–850ms) and the pause after it are hand-written CSS the generator never touches, and only
`ALISE_START` couples the two halves.

### Tenth pass, fourth addendum — fragments visible on load (a regression from the butt cap)

Reported straight after variant 2 landed: on first load or reload, bits of the wordmark are
already on screen before anything is drawn. Real, and caused by the butt-cap change three
addenda up.

Butt caps need each reveal path generated slightly longer than its letter, or the rounded
terminal tips never get painted. That head extension was **already taken up at the `0%`
keyframe** (`dashoffset: 1 - lead`) — and because the reveal animation carries
`animation-fill-mode: both` together with a per-letter delay, **whatever sits at 0% is what that
letter displays from page load until its turn arrives.** The extension is stroked at full width
and ends exactly on the letter's first centerline point, so it overlaps the glyph there: each of
the five letters sat showing its own pen-down blob. Measured at `currentTime 0`: 2256px of
scattered fragments, matching the 2254px in Reuben's screen recording frame-for-frame.

Fix: `0%` is now a hard `dashoffset: 1` — nothing revealed — and the head extension is taken up
over `HEAD_REVEAL_MS` (10ms) at the start of the letter's *own* animation, which is the pen
landing on the paper rather than a state the page can be caught sitting in. Verified: alise ink is
0px at every sample from 0 to 999ms and first appears at 1011ms, on a real reload rather than a
seek. Coverage, flushness, the dot, the alignment and the finish time are all unchanged.

**The general trap, worth more than the bug:** with `fill-mode: both` and a delay, the `0%`
keyframe is not just the start of the animation — it is the element's **resting state for the
whole page load**, and for the later letters that is seconds. Anything put there is on screen
before the animation begins. Every check to date had been driven by seeking `currentTime`, which
never sits in the delay window and so never saw it; it took an actual reload to show up.

Also noted and deliberately left alone: the caret is visible for the first 250ms before typing
starts (`caret-life` opens at `opacity: 1`, with the same delay + `both`). That is original,
pre-dates all of this, and reads as a cursor waiting to type — not a defect, but it is the other
thing on screen at load, so it is written down here rather than discovered again.

### Tenth pass, fourth addendum — ownership bands, and the `e` written from the inside

Two reports: the `s` nub was still there, and the `e` "isn't started like that — it should start on
the inside bit, not start with the connection, one continuous line that sweeps round and connects
to it." Both turned out to be the same root cause, which is why fixing the cap didn't touch either.

**The root cause.** The reveal is a disc swept along the centreline. That disc is ~211 units across,
and different parts of a letter pass within ~175 units of each other. So drawing one stroke reaches
SIDEWAYS into a stroke that has not been written yet. Butt caps fixed the FORWARD overshoot; no cap
can help with the sideways one. Measured on the `s`: at 15% along, the path is 175 units from ink
the pen does not reach until 95%, while the coverage requirement there is 198 units. **There is no
disc radius that both paints the letter and stays out of its neighbour** — and no reroute either,
since the `s`'s skeleton has one 3-way junction plus a loop, so every valid route passes that
junction twice. On the `e` the same thing meant the crossing blob appeared the instant the letter
started, which is exactly why it read as beginning at the connection.

**The fix: reveal by ownership.** Each letter is split into six bands — the set of glyph pixels
whose nearest point on the centreline lies in that stretch of the journey — and each band is drawn
only by its own stretch. Nothing can appear before the pen writes it, however wide the disc is.
Bands tile the glyph, so nothing is lost. `build_centerlines.py` computes them from the raster and
stores them in geometry.json; `gen_pen.py` emits a clip path, a mask and a `<use>` per band.

Details that are load-bearing:

- **Ties break toward the EARLIEST pass.** `a` deliberately retraces its own stem, so two passes are
  equidistant along it. Nearest-alone made ownership alternate between them and shattered the bands
  into 184 speckled contours; "earliest of the equals" gives 6 clean ones and is also right, since
  the ink appears on the first pass.
- **Bands overlap in ARC, not in space.** They must overlap or the traced polygons leave hairline
  seams, but growing a band spatially also grows it sideways — towards the very branch being kept
  hidden. Overlapping along the journey grows it only forwards and backwards, where the seams are.
- **The band clip is NOT re-clipped to the glyph.** The clip only says which stretch owns a pixel;
  the glyph decides what paints. Intersecting with the 4-unit raster pinned the clip to a staircase
  that cut just inside the real outline and eroded a sub-pixel rim off every stroke.
- **The glyph, masks and clips must sit inside `<defs>`.** A bare `<path>` that is merely referenced
  still renders where it stands, and with no class on it that is the glyph's fill without its
  stroke: 29% of every letter, painted on the page from load. Caught by measuring, not by reading.

**A measurement trap worth more than the bug.** With bands, removing masks and clips to get "the
true letterform" leaves six copies stacked, and their antialiased edges composite darker — inflating
the reference by ~1140px and inventing 1199px of holes that were not there. Coverage is only honest
against the glyph rendered ONCE (`scratch coverage.py`, and `verify_nomask.py` now needs the same
care). Real figure: 56-77px of 88,463, against 5px before bands, all of it sub-pixel slivers.

**The `e`.** With ownership bands the disc can no longer reveal the junction at the letter's start,
so it now does what was asked: begins as a thin stroke inside the eye, runs east along the crossbar,
up, over the top westward, down the west side, round the bottom and out to the extended tail — and
the connection happens as it comes back round, rather than being the first thing drawn. The
anticlockwise direction is forced by `ROUTE["e"]`'s `any-rev`; a self-loop has both ends at the same
node, so a direction cannot be expressed by endpoints alone.

Everything else held: ink ahead of the pen median 0.07 dot radii, 0 frames flagged, longest stall
30ms (was 50), largest detached fragment across all five letters 5px, dot and alignment untouched,
nothing visible before 1000ms on a real reload, and the "Note" phase pixel-identical to the approved
build. File grew 196KB -> 232KB.

### Tenth pass, fifth addendum — the rough frontier, and where it actually came from

Reuben, with three screenshots: "the letter hasn't been fully written at this stage, but there is a
slight roughness to the edges, cover them as much as you can because this looks unprofessional,
make it so that this bit is only 'inked' when the letter has fully been 'written'." Visible on the
`a` from ~1330-1450ms, the `s` from ~2290-2490ms and the `e` from ~2600-2780ms: a sawtooth on the
edge of the ink laid so far.

**First, a correction to the record.** The previous session widened `BAND_TIE_PX` to 20 raster px
to answer an earlier report of "harsh lines where the a, s and e join", regenerated, and could not
see its own screenshots to check. It is a good change on its own terms - it is what stops a
crossing being split down the bisector - but it **did not fix this**, and the "all verified" state
written above predates it. Re-measured on the shipped page before touching anything:
`verify_ink_vs_pen.py` gave **10 flagged frames, largest 1021px, max ratio 3.98x**, not the two
small bursts recorded above. Re-run the verifiers after regenerating; the numbers here are only as
honest as the last run.

**The cause, found by bisection rather than by reading.** Three candidates, each patched out live
at the same frame: removing the band clips did not remove the sawtooth, and switching the reveal to
round caps did not either - which is what made this hard, because those are the two obvious
suspects. Widening the reveal stroke 1.6x *with the clips off* gave a perfectly smooth frontier;
widening it with the clips **on** brought the tooth straight back. So:

> Where the reveal disc presses past its ownership band's clip, the frontier the viewer sees is the
> **clip polygon's own outline**, not the pen's. And an ownership boundary between two passes of the
> same letter is a medial line - it comes to a point.

A dead end worth recording: the first theory was that the disc was too narrow to reach some pixels
as the pen passed them, leaving bites. Measured directly - for every glyph pixel, the arc position
of the nearest point on the path against the earliest arc position at which the disc covers it -
that is **15 to 154 raster px per letter**, far too few to be what is on screen. The frontier is a
shape problem, not a coverage one.

**The fix: the clip cannot present a corner, and the offcut waits for the letter.**
`BAND_ROUND_PX = 16` opens each band clip with a disc, so every spike narrower than 2r is gone and
every convex corner is left at radius r - the frontier can only ever be curved. Closing first fills
the matching concave nicks.

Two details are load-bearing, both found by measuring the finished wordmark rather than the
animation:

- **The last band is never rounded.** Its clip is the cumulative one, so its outline *is* the
  letter's outline - there is no ownership boundary in it to spike, and rounding it instead rounds
  the glyph's real corners and its tail tip. Rounding all six thickened the static
  `prefers-reduced-motion` render by **519px** and moved **3920px** of the outline's antialiasing.
- **The settle pass clips to the shaved slivers, never to the whole glyph.** Rounding only ever
  removes pixels, so a sliver can be left for no band's mask to reach; a seventh copy of the glyph
  picks it up the instant the letter's last stroke lands, which is Reuben's condition exactly. But
  a seventh *full-glyph* copy composites over the letter's antialiased outline and darkens it -
  the same compositing trap the fourth addendum records as a measurement artefact, here as a real
  one. Clipped to the slivers, which are interior, it lands on ink that is already solid.
  `.wm-settle`'s `opacity: 0` **must** sit inside `@media (prefers-reduced-motion: no-preference)`:
  this page opts IN to animation, so under reduced motion there is no animation to switch the copy
  back on, and it is the copy carrying the slivers.

**Then the cap - tried round, reverted, and the reason is worth more than the change.** With the
clips rounded, the corners still left were flat chords across the stroke: the butt cap. Raising
`BAND_ROUND_PX` past 16 does almost nothing about those (24 and 32 were rendered and compared; the
frontier barely moves and the ink only lags the pen further), because they are not the clip's
doing. So the cap went to **round**, on the argument that ownership bands had made the third
addendum's forward-overshoot objection obsolete: the bulge lands in the next band's territory and
this band's cumulative clip excludes it.

**That argument is true and it is not sufficient, and the checks I ran could not see the gap.**
Bands stop a cap reaching ANOTHER band's territory. They say nothing about what the cap does WITHIN
a band - and at a letter's start the dash goes from zero length to non-zero in a single frame, so a
round cap paints a **full disc of the whole stroke width, at once**. Reuben caught it in a screen
recording and named it: a "splot" at the opening of the a, the s and the e. Measured on the `a`
afterwards: 6ms in, butt had put down 145px against round's 3,765px; 30ms in, 4,743 against 8,765.

Everything I had checked stayed green through it. Nothing was visible before 1000ms, the finished
mark was unchanged, and `verify_ink_vs_pen.py` **improved** (median 1.58 -> 1.47, 10 flagged frames
-> 8) - because that metric asks how far NEW ink is from the dot, and a disc centred ON the pen is
the best possible answer to that question. It cannot see that the disc arrived all at once. Fourth
time in this project, and the same shape every time: **a visual complaint that survives a green
check means the check is measuring the wrong quantity.** Two dead ends from the same session, both
disproved by rendering rather than reasoning: widening the reveal disc (x1.3/x1.6/x2.0 - the splat
survives and the `s`'s notch gets worse), and shortening the head extension from `w/2 + END_EXTEND`
to `END_EXTEND` (byte-different output, visually identical, because the keyframes take the whole
lead up inside `HEAD_REVEAL_MS` either way).

So the cap is **butt**, as the third addendum had it. The flat chord is a corner and it is the
corner still left in the frontier; it costs less than the splat. Anyone switching it back has to
solve the zero-length-dash disc first.

**What it costs and what it holds.** The settle adds 0.0-0.2% of each letter - 18 to 137px at 6x
device scale, invisible, no pop. Against the build before this pass: the "Note" phase 0-999ms is
**pixel-identical**, the openings of the a, s and e are back to matching the previous build within
a few px, nothing is visible before 1000ms, no console errors, and the finished wordmark differs
only by sub-pixel antialiasing on the settle slivers. Reuben's brief for this pass was "rounded off
is better than fully fixed, just don't make it visually jarring".

`verify_ink_vs_pen.py` flags the letter-end frames at high ratios. That is the settle's antialiasing
reaching the far end of a letter the pen has already left - ~20px of real ink, not a visible burst.
**The ratio metric cannot tell that apart from a genuine burst; check the frame before believing a
flag** - and, per the cap above, it cannot see a burst centred on the pen at all.

### Tenth pass, sixth addendum — the disc goes, and the reveal becomes the letter itself

Reuben, after two passes that each measured clean and neither of which he could see any
difference from: *"nothing looks like its changed... the lines should be created, not add harsh or
unnecessary lines/sharp edges (even if rounded), make the lines appear as they are needed. It
should look like someone is writing them with a continuous pen stroke (except the e of course) and
only the slight thickness change should be present."*

He was right, and the reason the previous two passes could not deliver it is one sentence:

> The reveal was `glyph ∩ swept disc`, so what a viewer saw mid-stroke was the edge of the DISC,
> not the edge of the letter.

Every artefact of that weekend was a corollary. Scallops where the disc was narrower than the
stroke. A cusp wherever the centreline turned inside one disc radius - measured on the `a`, 93
degrees within a single radius. A flat chord at the butt cap, and a full stroke-width disc dumped
at each letter's start when that cap was rounded. Ownership bands contained one symptom (ink
appearing sideways in a stroke not yet written) and could not touch the rest. Rounding the band
clips, widening the disc, shortening the head extension, changing the cap - all of them are
adjustments INSIDE a model whose output is the wrong shape by construction.

**What replaced it.** The ownership map was already the answer and was only being used as a guard.
A slice is the set of glyph pixels whose nearest point on the centreline lies in one stretch of the
journey; the boundary between two consecutive slices is therefore the level set of the arc
parameter, which is exactly the clean cut across the stroke that a pen leaves. So: cut each letter
into ~44 slices and switch each one on, whole, as the pen reaches it. The only edges on screen are
the letter's own outline and one cut. Thickness varies only because the letter does.

Nothing is swept, nothing is stroked, nothing is masked. `.wm-ink-seg`, `stroke-dasharray`, the
per-band dashoffset keyframes, the caps, `END_EXTEND`, `HEAD_REVEAL_MS` and `MASK_SAFETY` all stop
being part of the reveal. **The file got smaller: 285KB -> 276KB** (70KB gzipped), because a clip
polygon per slice is cheaper than a stroked polyline per band.

Load-bearing details:

- **Slices overlap BACKWARDS in arc, never forwards** (`SLICE_ARC_BACK`). Abutting traced polygons
  leave hairline seams; overlapping backwards closes them onto ground the previous slice already
  inked, so it is invisible. Forwards would be ink arriving before the pen.
- **`SLICES` is a resolution in TIME, not in space.** 24 left the `a` stepping every 25ms and 39ms
  at worst - 1.5 to 2 frames at 60fps, and visible as the cut jumping. 44 gives 15ms median / 28ms
  worst on the `a` and 6-9ms on the other four.
- **`BAND_GROW_PX` went 3 -> 1.** Each slice's clip is dilated past the glyph so neighbours meet;
  with 44 of them, 3px of slack had them double-compositing along the letter's antialiased outline
  and the finished wordmark came out 289px heavier. At 1px it is +40px on 88,556 - 0.045%.
- **The settle pass survives as a safety net only.** The slices tile the ownership map so it is
  normally empty, but a hole in a finished letter is the one failure that must not be possible.

**Verified against the pre-weekend build.** "Note" phase 0-999ms pixel-identical. No ink whatsoever
before 1000ms. No console errors. `gen_pen.py` idempotent. The finished wordmark differs by 12,759
sub-pixel edge pixels at 8x device scale of which **zero are in the letters' interior** (max delta
inside: 2/255) - i.e. no seams and no holes, only antialiasing on the outline - and the static
reduced-motion render is 40px heavier on 88,556.

And the check that had been wrong all weekend finally agrees with the eye: `verify_ink_vs_pen.py`
gives **median 1.44 dot radii, p90 1.83, max 2.84, 2 frames flagged** - against 1.58 / 2.47 / 3.98
and 10 flagged on the build this replaced. Ink now appears where the pen is because the geometry
says so, not because a radius was tuned until it did.

**The lesson this pass is really about.** Four times running, a fix was verified green by a check
that could not see the defect being complained about, and twice I reported progress Reuben could
not see. Coverage could not see timing; timing could not see front shape; the ink-vs-pen ratio
could not see a burst centred on the pen. When someone looking at the animation keeps saying it is
wrong and the numbers keep saying it is right, **the model is wrong, not the parameters** - stop
adjusting and go and find what is generating the shape.

### Tenth pass, seventh addendum — the chevron, and a constant that had been bending every cut

The sixth addendum's slices were the right model and still looked wrong on the `a`, which Reuben
filmed again: a sharp tooth growing at the leading edge all the way round the bowl. Two of my own
renders had shown that tooth and I had called the letter clean anyway. It was not.

**Finding it took one picture.** Colour the glyph by *when* the pen writes each pixel, alternating
the shade per slice, and look at the boundaries. They were not cuts across the stroke - they were
**chevrons**, pointing forward in the middle of the stroke and retreating at both edges. Clipped to
the glyph, the point of a chevron is a tooth. The reveal was doing exactly what it was told; the
ownership map underneath it was the wrong shape.

**The cause was `BAND_TIE_PX`, and it had been there since ownership bands were introduced.** The
rule was "any sample within 20 raster px of the nearest counts as equidistant, take the earliest",
and it exists for a real reason: where a letter crosses or retraces itself, the whole overlap must
go to the first pass or the join splits down the bisector and the earlier stroke is cut off by a
hard diagonal. But 20px is an **absolute** window, and a pixel out at the stroke's edge sits ~95
units off the centreline while one on the centreline sits at 0 - so the edge pixel sweeps in far
more early samples than the middle one does. Ownership retreats at the edges. Every boundary in
every letter was bent, and the swept disc had been hiding it: with a disc the frontier was the
disc's edge, so the ownership boundary only showed at band seams. Take the disc away and the
chevron is the frontier.

**The fix is to separate the two questions the constant was answering at once.** Which pass writes
this pixel, and where in that pass:

1. `near` = every sample within `CROSS_WINDOW_PX` of the nearest. At a crossing this spans two
   far-apart stretches of the journey.
2. Keep only the **first contiguous run** of `near` - that is the first pass, and the crossing rule
   is preserved exactly as it was.
3. Within that run, take the **genuinely nearest** sample. No tie window.

Step 3 is what was missing. The level sets of nearest-arc on a smooth curve are its normals, so
within one pass the boundary is a clean cut straight across the stroke - which is what a pen
leaves. The ownership map went from chevrons to ladder rungs, and the tooth went with it.

**Verified.** "Note" phase 0-999ms pixel-identical, no ink before 1000ms, no console errors,
`gen_pen.py` idempotent, static render +33px on 88,556 (0.037%), and on real playback (no seeking)
blank at 0.49s, complete by 3.57s.

**One number moved the wrong way, and it is worth recording why it was ignored.**
`verify_ink_vs_pen.py` went from 2 flagged frames to 9 (median 1.44 -> 1.56, p90 1.83 -> 2.41, max
unchanged at 2.85). That is the chevron scoring *well*: by delaying the stroke's edges relative to
its middle, it kept new ink closer to the dot - the metric was rewarding the exact deformation
being removed. All nine flags sit between 2.37x and 2.85x, against the pre-weekend build's ten
flags reaching 3.98x, so nothing is worse than what shipped before. **Fifth time this weekend a
check preferred the artefact; look at the pixels.**

**Still angular, and known:** the `e`'s opening. It begins inside the eye at the junction where the
crossbar meets the bowl, so its first slice covers a genuinely wide, irregular piece of letter and
reads as a small wedge for ~80ms. That is the letter being started where it is started, not a
reveal artefact - but it is the one moment left that does not look like a pen.

## Eleventh pass, 2026-08-26 — the finished word flashing on load, then blanking and replaying

Reuben reported the wordmark showing complete ("Notealise" fully formed) for a couple of frames on
page load, then blanking and playing the reveal from the start.

**The default state IS the finished word, by design** (see "`prefers-reduced-motion` is the default
state, not an override" above) - `@media (prefers-reduced-motion: no-preference)` only ADDS the
hidden-until-animated starting states on top of that default. Correct for a browser that doesn't
understand the media feature, or for reduced-motion users. It also means: if that one media query
isn't resolved by the very first style pass, the base (visible) rule is what paints. Viewport-based
media features are known synchronously from the initial layout; a system-preference feature like
`prefers-reduced-motion` depends on an OS accessibility lookup, which isn't guaranteed to land
before that first pass, especially in real Safari. That reproduces the report exactly: finished
word, then blank, then a normal replay once the query catches up.

**Could not reproduce it under Playwright** - WebKit or Chromium, localhost, zero network latency,
dozens of rapid-capture loads, zero flashes in either engine. Consistent with the theory (a
scripted browser likely answers `matchMedia` from a fixed value at process launch rather than a
live OS lookup), not evidence against it - but it means this fix is argued from the CSS timing
model, not a red-to-green repro.

**Fix: swap the gate from a media query to a plain class.** A synchronous script in `<head>`,
before any wordmark markup exists, reads `matchMedia('(prefers-reduced-motion: reduce)')` once and
adds `wm-motion` to `<html>` if it doesn't match. Every hidden-until-animated rule - the
hand-written `.wm-note`/`.wm-caret`/`.wm-pen-dot` block and the generated `.wm-slice`/`.wm-settle`
block - now gates on `html.wm-motion` instead of the media query directly. The reduced-motion
fallback is unchanged: no script, no `matchMedia` support, or an explicit "reduce" preference all
still mean the class is never added and the finished word shows immediately. What changes is that
the *animated* path now depends on a DOM class set before the wordmark is even parsed, not a media
feature resolving on its own clock.

`gen_pen.py`'s `SETTLE_CSS` owns the generated half of this gate - edited only in the generator,
regenerated, and diffed against a scratch copy per the usual rule (empty diff outside the intended
lines). Verified via Playwright, both engines: `prefers-reduced-motion: reduce` still renders the
settled word with zero `wm-motion` class and zero animation; `no-preference` gets the class, and
the settled state after the reveal is visually identical to the reduced-motion render, same as
before this pass.

**Not yet watched live.** Fixed and verified structurally, not verified against the original bug
reproducing and then disappearing - the flash never happened under test, so there's no red-to-green
here, only "the mechanism that would cause this is now gone." Worth a real look in actual Safari
once this is deployed.
