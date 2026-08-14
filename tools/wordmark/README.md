# Wordmark animation tooling (`site/index.html`)

The "alise" half of the Notealise wordmark is **generated, not hand-written**. The clip paths,
their switch-on delays, and the pen dot's path and keyframes inside `site/index.html` are all
emitted by `gen_pen.py`.

**How the reveal works (rewritten 2026-08-12).** Each letter is cut into ~44 **slices** of the
pen's journey — a slice being the glyph pixels whose nearest point on the centreline falls in
that stretch — and each slice is a clipped copy of the glyph that switches on as the pen
reaches it. The boundary between consecutive slices is the level set of the arc parameter,
which is the clean cut across the stroke that a pen leaves, so the only edges on screen are
the letter's own outline and that cut.

It was a thick stroke swept along the centreline and grown with `stroke-dashoffset` until then.
**Do not put that back.** Every "harsh edge / sharp bit / splot" reported against this animation
came from it: mid-stroke you were seeing the edge of the *disc*, not the edge of the letter. See
`site/DESIGN.md`, tenth pass, sixth addendum.

**Do not hand-edit the `<g>` blocks or anything between the `wordmark:begin/end` and
`wordmark-keyframes:begin/end` markers in `site/index.html`.** Change the generator and re-run
it; hand edits there are silently lost the next time anyone regenerates.

The full reasoning for every design decision lives in `site/DESIGN.md`. Read that
before changing anything here; several of the obvious-looking simplifications have already been
tried and failed for reasons recorded there.

## Requirements

Not in `package.json` on purpose — this is build-time-only tooling for one static page, not an
app dependency (CLAUDE.md's "ask before adding any dependency" rule is about the app).

```bash
python3 -m pip install playwright numpy pillow scikit-image imageio-ffmpeg
python3 -m playwright install chromium
```

`scikit-image` is only needed by `build_centerlines.py` (for `skeletonize`).

## Regenerating

Serve the site first — the tools drive a real browser against a real URL:

```bash
cd site && python3 -m http.server 8787
```

Then, in order — each step is idempotent and only step 3 is needed for a timing change:

```bash
# 1. Only if the glyph outlines changed (new font, new letter paths):
python3 tools/wordmark/sample_outlines.py http://localhost:8787/index.html tools/wordmark/outlines.json

# 2. Only if the letterforms or the routing changed. Rewrites geometry.json's centerlines
#    from the glyphs themselves (keeps the old file as geometry.json.bak):
python3 tools/wordmark/build_centerlines.py

# 3. Regenerate the animation into site/index.html:
python3 tools/wordmark/gen_pen.py
```

`gen_pen.py` rewrites `site/index.html` in place. Take a copy first if you want to compare.

## The knobs

`build_centerlines.py` decides **where the pen goes**:

| Name | What it does |
| --- | --- |
| `HINTS` | where the pen enters and leaves each letter, as bbox fractions |
| `ROUTE` | an explicit route, for letters the cheapest legal walk gets wrong. Only `a` needs one — it genuinely retraces its own stem, and minimal-overdraw routing refuses to |
| `PRUNE_PX` | skeleton barbs shorter than this are artefacts of skeletonisation |
| `SMOOTH` / `RESAMPLE` | how much the staircase is smoothed, and output sample spacing |

`gen_pen.py` decides **when**:

| Name | What it does |
| --- | --- |
| `ALISE_START` | when the pen starts, ms from page load ("Note" finishes typing at 850) |
| `TOTAL_DRAW` | total inking time across the whole word |
| `CONNECT_MS` | pen travel time between strokes |
| `DOT_R` | pen dot radius — 170 = the font's own stroke weight |
| `ALISE_SCALE` | alise size relative to Note |
| `INK_DROP` | **measured, not derived** — run `measure_align.py` and use what it prints |
| `OVERSHOOT` | how far alise's lowest ink may fall below Note's flat N/t feet. **0 (flush) by Reuben's call**, not by rule — see the comment on the constant before changing it |
| `MASK_SAFETY` | margin on the measured centreline reach — now only a reporting check that the pen path visits the whole letter, not a drawing width |
| `GRID` | cell size when measuring how much new ink each sample lays |
| `SMOOTH_W` | smooths the new-ink rate, so the pen eases rather than jerks |
| `MIN_SPEED` / `MAX_SPEED` | floor and ceiling on that pacing: how briskly the pen may cross ink it already laid, and how long it may linger where a lot is appearing |
| `KF_PER_STROKE` | pen keyframes per stroke; enough of them that the dot tracks a varying speed |

### Command line

```bash
# the live page, at the committed speed
python3 tools/wordmark/gen_pen.py

# a speed variant, written somewhere else so site/index.html is untouched
python3 tools/wordmark/gen_pen.py --out /tmp/v2/index.html --total-draw 1870 --connect 32
```

`--total-draw` and `--connect` are the only two speed knobs. Everything before alise — the
"Note" typing and the pause after it — is governed by `ALISE_START` and deliberately does
**not** scale with them, so a faster cursive does not also speed up the typing.
Total finish time is `ALISE_START + total_draw + 4 × connect`.

**The reveal has no stroke and no cap.** Both used to be load-bearing and both are gone; the
notes that stood here explaining why the cap must be `butt` are in `site/DESIGN.md`'s history.
What matters now:

- A slice's clip is the ink the pen lays over one stretch of its journey, so the frontier is
  the boundary between two slices — a clean cut across the stroke. There is no cap to choose
  and no disc whose edge can show.
- Slices overlap **backwards** in arc (`SLICE_ARC_BACK`), never forwards. Abutting traced
  polygons leave hairline seams; overlapping backwards closes them onto ground the previous
  slice already inked, so it costs nothing. Forwards would be ink arriving before the pen.
- `SLICES` is a resolution in **time**. Raise it if the cut ever reads as jumping rather than
  travelling; 24 was visibly steppy on the `a` (25ms median between steps), 44 is not (15ms).

**Pacing is measured, not assumed.** The generator sweeps a probe over a grid and counts how many
cells each sample newly exposes, then hands out time in proportion — so the ink front advances
evenly. Constant pen speed does not achieve that: where a stroke crosses or retraces itself the pen
is over ink that is already painted, and a viewer reads that as the ink hanging while the dot
travels. The slices inherit this curve, because each one's switch-on time is read off it.

**Stroke order is not set here any more.** `geometry.json`'s `center_d` is the finished route,
in writing order, so `gen_pen.strokes_for()` is the identity. Change the route in
`build_centerlines.py` and re-run both steps.

**Watch the reach printout at the end of a `gen_pen.py` run.** It reports the furthest any painted
pixel sits from the pen's path, as a multiple of the pen dot. Near 1x is healthy; approaching 2x
means a letter has a limb the centreline never really visits, and that limb will appear away from
the dot however the reveal is done. It says so. The slice count per letter is printed beside it —
a letter with fewer than `SLICES` has stretches that own no new ink, which is normal for the `a`
(it retraces its own stem) and suspicious anywhere else.

## Verifying (do not skip)

```bash
# 1. does the ink appear where the pen is?  <- run this one first
python3 tools/wordmark/verify_ink_vs_pen.py http://localhost:8787/index.html

# 2. does the mask reveal the whole glyph?
python3 tools/wordmark/verify_nomask.py http://localhost:8787/index.html /tmp/nomask.png
python3 tools/wordmark/verify_shoot_static.py http://localhost:8787/index.html /tmp/static.png
# then diff the two ink masks — anything above a few px is a real hole

# 3. is alise on Note's line?
python3 tools/wordmark/measure_align.py http://localhost:8787/index.html
```

**Two traps, each of which has cost a pass.**

*Coverage:* comparing the finished animation against the `prefers-reduced-motion` render proves
nothing, because the mask is applied in *both* — they are clipped identically and the diff comes
out clean. Coverage must be checked against the element with its `mask` attribute **removed**,
which is what `verify_nomask.py` does.

*Timing:* coverage being perfect tells you nothing about **when** each pixel arrives. The whole
"ink appears out of sequence" bug (DESIGN.md, tenth pass) lived underneath a clean coverage
check for two passes, because every pixel did get painted — just not where the pen was. A check
that only looks at the end state cannot see a timing defect. That is what
`verify_ink_vs_pen.py` is for, and why it is step 1.

Other tools:

- `verify_ink_vs_pen.py URL [t0 t1 step]` — seeks frame by frame and measures how far each
  newly-inked pixel is from the pen dot, in units of the dot's own radius. Anything flagged is
  ink appearing away from the pen.
- `measure_align.py URL [scale]` — measures alise against Note off the live page and prints the
  `INK_DROP` to put in `gen_pen.py` if it is out by more than a pixel.

- `verify_shoot.py URL OUTDIR "t1,t2,..."` — frame-exact screenshots at given ms. It pauses
  `document.getAnimations()` and sets `currentTime`, so results are deterministic rather than
  racing wall-clock delays.
- `verify_dotonly.py URL` — hides every letter and samples the pen dot alone across the window;
  this is how "the dot never fades and never disappears" is checked.
- `verify_t_glitch.py URL OUTDIR` — hides the caret and dumps ink column runs during the "o"
  phase, to confirm the `t` crossbar sliver is still covered.
- `verify_record.py URL OUTDIR` — real-time (non-seeked) recording, to confirm the seek-based
  results match actual playback.

## Ownership slices — the reveal itself

Each letter is drawn as ~44 **clipped `<use>` copies**, not one path. A slice is the set of glyph
pixels whose nearest point on the centreline falls in that stretch of the pen's journey, and each
one switches on, whole, when the pen arrives at its start. Two things follow, and they are the
whole design:

- Nothing can appear before it is written, because a pixel belongs to exactly one stretch.
- The boundary between two consecutive slices is the level set of the arc parameter — the clean
  cut across the stroke that a pen leaves. Mid-draw, a letter is bounded by its own outline and
  that cut, and by nothing else.

Slices are computed by `build_centerlines.py` (`ownership_bands`) and stored in geometry.json;
`gen_pen.py` emits a `<clipPath>` and a `<use>` for each, plus a switch-on delay read off the
pen's pacing curve. No masks and no strokes are involved.

| Knob | What it does |
| --- | --- |
| `SLICES` | how many slices per letter (44). A resolution in **time** — raise it if the cut reads as jumping |
| `SLICE_ARC_BACK` | how far a slice reaches **backwards** into its predecessor, in slices. Backwards only: forwards is ink before the pen |
| `BAND_GROW_PX` | a whisker of spatial slack for raster rounding. Small on purpose — at 3px, 44 overlapping clips double-composite the letter's antialiased outline and the finished wordmark comes out 289px heavier |
| `CROSS_WINDOW_PX` | how close two passes must be to count as candidates for writing a pixel. It picks **which pass** owns a crossing (the first one, so the stroke reads as continuous) and nothing else — *where in that pass* is always the true nearest sample. Deciding both with one window is what bent every slice boundary into a chevron until 2026-08-13 |

**Measuring coverage:** removing the clips leaves every copy stacked, and their antialiased edges
composite darker — that inflates the "true letterform" and invents holes. The reference must be the
glyph rendered **once**. The sharper check is to diff the finished animation against the previous
build and ask how many differing pixels fall in the letters' **interior**: an outline-only
difference is antialiasing, an interior one is a seam or a hole.

## Exporting the animation with a transparent background

`render_promo.py` writes the wordmark as transparent PNG frames by seeking the real page frame
by frame (`document.getAnimations()` paused, `currentTime` set) and screenshotting with the
background omitted. **Not a screen recording** — the alpha is captured, not keyed, so there is no
edge fringing. Keying a recording is much worse here: every glyph edge is antialiased against
white, so a luma key leaves pale fringing on exactly the thin curves `alise` is made of.

It renders two ink colours (brand and white), crops both to one canvas sized to the union of all
frames, and **asserts that no frame's ink reaches the edge of the capture rectangle** — so a
layout change that pushes the wordmark out of frame fails loudly instead of silently cropping the
`e`'s tail. Output goes to `promo/`, which is gitignored: it is Reuben's marketing material, not
project files.

Encoding needs a real ffmpeg. **Playwright's bundled one cannot do this** — it is built
`--disable-everything` and its only decoders are MJPEG and VP8, so it cannot read PNG or raw
frames at all (it *can* encode VP8 `yuva420p`; the gap is input, not output). There is no system
ffmpeg or Homebrew on the Mac; the `imageio-ffmpeg` pip package ships a full ffmpeg 7.1 for arm64
and is what these commands assume.

```bash
FF=$(python -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")

# ProRes 4444 - the editing master (Premiere / Final Cut / Resolve)
"$FF" -framerate 60 -i seq-ink/%04d.png \
      -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -alpha_bits 16 -vendor apl0 out.mov

# VP9 + alpha - for the web only
"$FF" -framerate 60 -i seq-ink/%04d.png \
      -c:v libvpx-vp9 -pix_fmt yuva420p -crf 18 -b:v 0 -row-mt 1 out.webm
```

Measured round-trip on the ProRes: alpha differs from the source PNG by at most **1/255** and RGB
by at most **2/255** on opaque pixels — the residue is the RGB→YUV conversion.

**ffmpeg cannot verify its own WebM alpha.** It writes it correctly (the file carries
`alpha_mode: 1`) but its decoder ignores VP9's alpha side-channel and reports the stream as opaque
`yuv420p`. Check it in a browser instead — a `<video>` over a coloured background — which is the
only place webm alpha is used anyway. Premiere's webm alpha support is unreliable; use the `.mov`
for editing.
