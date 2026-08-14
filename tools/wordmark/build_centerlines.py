"""Rebuild every letter's centerline in geometry.json from the glyph itself.

WHY THIS EXISTS (2026-08-12). The centerlines shipped before this script did not run
through whole limbs of several letters - 35% of the `l`'s outline was more than 250 user
units from any point on its own centerline, and the `s` and `e` were nearly as bad. The
mask widths in gen_pen.py are derived from that worst-case distance, so those letters got
reveal segments up to 1657 units wide against a 340-unit pen dot: a single segment
switching on flashed a whole limb into view nowhere near the dot that is supposed to be
drawing it. That is the "ink appears out of sequence" glitch.

The fix is upstream of the mask: give the pen a path that actually visits every part of
every letter. Then the coverage requirement collapses to roughly the stroke's own
half-width and the mask cannot outrun the pen.

Method
  1. Rasterise the letter's PAINTED shape - fill *plus* the 190 stroke, which is what
     `.wm-letter` actually paints and therefore what has to be covered.
  2. Skeletonise it, and prune the short barbs skeletonisation leaves at wide terminals.
  3. Treat the skeleton as a graph and walk a route that covers every branch. Where the
     degrees don't allow that in one pass, duplicate the cheapest branch (route
     inspection) - except where a hand demonstrably retraces, which is declared in ROUTE.
  4. Smooth each piece and resample, then write one continuous subpath per letter.

The output is `center_d` in geometry.json, in drawing order, complete. That is why
gen_pen.py's `strokes_for()` is now the identity: the ordering decisions live here.

Requires: playwright, numpy, scikit-image, pillow.
    python3 -m pip install playwright numpy scikit-image pillow
    python3 -m playwright install chromium
"""
import io
import json
import os
import re
import shutil

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from scipy.ndimage import binary_dilation
from scipy.spatial import cKDTree
from skimage.measure import approximate_polygon, find_contours
from skimage.morphology import skeletonize

HERE = os.path.dirname(os.path.abspath(__file__))
GEOM = os.path.join(HERE, "geometry.json")
OUTLINES = os.path.join(HERE, "outlines.json")

LETTERS = ["a", "l", "i", "s", "e"]
STROKE = 190            # .wm-letter's stroke-width, in user units
UPP = 4.0               # user units per raster pixel
MARGIN = 220            # user units of padding around each letter
PRUNE_PX = 14.0         # skeleton barbs shorter than this are artefacts
MERGE_PX = 7.0           # graph nodes closer than this are the same junction
SMOOTH = 5              # moving-average window, in samples
RESAMPLE = 7.0          # output sample spacing, user units
SLICES = 44             # slices of the journey per letter - see ownership_bands(). Each is
                        # switched on whole as the pen reaches it, so this is the reveal's
                        # RESOLUTION IN TIME, and the number to raise if the cut ever reads
                        # as jumping rather than travelling. Measured on the generated page:
                        # 24 left the `a` stepping every 25ms (median) and 39ms at worst,
                        # which is 1.5-2 frames at 60fps; 44 brings that to 15ms median,
                        # 28ms worst, and 6-9ms on the other four. The cost is one clip
                        # path per slice, and it is small - the whole file went DOWN from
                        # 285KB to 276KB against the swept-stroke build it replaced,
                        # because the reveal no longer carries a polyline per band.
SLICE_ARC_BACK = 0.6    # how far a slice reaches BACK into its predecessor, in slices.
                        # Abutting polygons leave hairline seams where their traced edges
                        # fail to meet exactly; overlapping backwards closes them onto
                        # ground that is already inked, so it is invisible. Forwards would
                        # not be: that is ink appearing before the pen arrives.
CROSS_WINDOW_PX = 20.0  # raster px: how close a sample must be to the nearest one to count
                        # as a candidate for writing a pixel. It decides WHICH PASS owns a
                        # crossing - the first one, so the stroke reads as continuous and the
                        # second arrives later as an arm joining onto it - and nothing else.
                        # It must NOT also decide where in that pass, which is what the
                        # constant it replaces (BAND_TIE_PX) did; see ownership_bands().
RETRACE_ARC = 0.08      # a run of `near` spanning more than this fraction of the letter's
                        # journey is the pen doubling back over its own ink, not a smooth
                        # stroke - see ownership_bands(). A smooth run spans about
                        # 2*CROSS_WINDOW_PX of arc, which is ~0.03 on the shortest letter,
                        # so this sits comfortably clear of it while still catching the `a`
                        # and `s` retraces (both well over 0.1).
# ---- the analytic reveal (2026-08-13) ------------------------------------------------
# These four replace the raster boundary construction. Each is a geometric bound, not a
# tuned fudge: see safe_halfwidths() and reach_profile() for what each one is bounding and
# why. The raster constants below them survive only for the settle net and the fallback.
CURV_SAFETY = 0.9       # fraction of the local radius of curvature a normal may reach on
                        # the CONCAVE side. Past 1.0 the normals meet at the centre of
                        # curvature and the boundary folds into a spike; 0.9 keeps clear of
                        # it. Measured to cost no coverage - the run prints the settle area.
ARC_SEP_FACTOR = 3.0    # how far apart in ARC two stretches must be before they count as
                        # different passes of the pen, in multiples of the letter's median
                        # reach. Below this they are the same smooth stroke seen twice.
FORWARD_BLEED = 1       # centreline samples a slice reaches FORWARD past its own end, so
                        # neighbours overlap instead of merely abutting. See the note at the
                        # use site: an exact abutment still seams at sub-pixel scale.
OVERLAP_SAMPLES = 5     # centreline samples a slice reaches back into its predecessor.
                        # 1 would close the geometric gap; 2 also covers the antialiased
                        # seam where two clip edges land on the same pixel
SEP_BLEED = 10.0        # user units a flank reaches PAST the separation limit, so two passes
                        # meeting at the medial axis overlap instead of abutting.
                        # THE SAME BUG AS FORWARD_BLEED, on the other axis, and it went
                        # unnoticed for longer because it is invisible to the raster check.
                        # Where the separation bound stops a flank short of the outline, the
                        # neighbouring pass's ribbon is supposed to own the rest - but the two
                        # traced edges land on one pixel, each covering part of it, and the
                        # two partial coverages sum to less than one. That is the white
                        # hairline through the finished `s`, the specks at the `e`'s eye, and
                        # the specks down an analytic `a`'s stem. MEASURED: the clamp is
                        # dominated by separation on exactly those three letters (69/70/67%
                        # of the shortfall) and by curvature on `l` and `i` (100%), which are
                        # the two letters with no cracks.
                        # NOT applied to the curvature bound. That one marks where normals
                        # fold, and reaching past a fold is the triangular spike the analytic
                        # construction exists to remove.
                        # 10 units is ~0.14 CSS px at the wordmark's rendered size, and the
                        # ink it reveals early belongs to a pass the pen has usually already
                        # made - the same trade FORWARD_BLEED already takes at 7 units.
SEP_STEP = 8.0          # user units per step when marching a normal out to find the medial
                        # axis. Near RESAMPLE (7.0) - finer buys nothing, the bound is then
                        # limited by sample spacing rather than by the step.
FALLBACK_LEFTOVER = 0.018  # a letter whose ribbons leave more than this fraction of it
                        # untiled keeps the old raster bands - see main(). Deliberate, per
                        # letter, and printed on every run.
                        # As set, this catches exactly the `a` (1.92%) and nothing else
                        # (l/i/s/e are 0.59-1.39%). The `a` is the one letter that RETRACES
                        # - up its right side and straight back down the same ink - and a
                        # cusp is where a normal-based construction is weakest: the tangent
                        # genuinely reverses, so the samples either side of it give opposed
                        # normals and their ribbons cross rather than abut, leaving hairline
                        # seams down the stem that are faintly visible in the FINISHED
                        # letter. That is a regression on the final letterform, which is not
                        # a trade worth making, so the `a` keeps the traced bands.
# ---- the retrace cusp (2026-08-13, stage A) ------------------------------------------
# What FALLBACK_LEFTOVER above was catching. The `a` retraces - up its right side and
# straight back down the same ink - and a normal-based construction has no defined answer
# at the reversal. Two separate things broke there, and both had to go:
#
#   1. THE TANGENT. np.gradient across the reversal averages the two opposed directions to
#      nearly nothing, so the normal spins and the ribbons built from it collapse into
#      slivers. Fixed by cutting the centreline at the cusp and differentiating each pass
#      SEPARATELY - the sub-path-per-pass with an explicit join, rather than one polyline
#      that happens to fold.
#   2. THE SEPARATION BOUND. safe_halfwidths() stops a normal where some part of the
#      journey far away IN ARC gets nearer - which is right for the `e`'s eye and the `a`'s
#      bowl, and catastrophically wrong for a retrace, where the "far away" stretch is the
#      SAME INK seen a second time. Both passes then clamp each other down to one SEP_STEP
#      and the stem tiles at ~8 units wide. Fixed by canonical arc: a sample on the return
#      pass reports the arc of the outbound sample it sits on, so the bound sees one place,
#      not two. See retrace_canon().
CUSP_DOT = -0.5         # cos of the turn at a vertex that counts as a reversal rather than
                        # a corner. MEASURED across the whole word: the `a`'s reversal is
                        # -1.000 and the sharpest genuine corner anywhere else is +0.583
                        # (the `s`). There is nothing in between to get wrong, and the word
                        # has exactly one cusp - `a`, sample 493.
CUSP_WIN = 3            # segments averaged either side when measuring that turn. One
                        # segment is too noisy after resampling; three spans ~21 units.
RETRACE_TOL = 1.6       # multiples of RESAMPLE: how close two passes run before they are
                        # the same ink rather than two strokes that merely pass close
RETRACE_GAP = 12        # samples: how far apart in the walk two coincident samples must be
                        # before they are two PASSES rather than one smooth curve seen next
                        # to itself. ~84 user units of path, comfortably more than the few
                        # samples a curve spends within RETRACE_TOL of its own neighbours.
RETRACE_MIN = 4         # samples: the shortest run that counts as a retrace at all,
                        # rather than two passes merely sharing the reversal vertex.
                        # A FRACTION-OF-THE-PASS test was tried here first and is wrong.
                        # The `a`'s post-cusp pass is the stem retrace AND THEN the exit
                        # tail, so only 0.405 of it lies on the outbound ink - under any
                        # gate that would have caught it, and the fold silently never fired.
                        # A retrace is defined by where it STARTS, not by how much of the
                        # pass it fills: it begins at the reversal and ends when the pen
                        # leaves the ink it is repeating. So the leading run is the retrace.
REACH_MARGIN = 14.0     # user units of slack on the measured reach, so the ribbon's flanks
                        # land outside the outline and are clipped away by the glyph
REACH_MAX = 420.0       # user units: how far reach_profile will march before giving up.
                        # Comfortably past the widest half-stroke the letters actually have
                        # (measured max ~231), so it never truncates a real one
BAND_TOLERANCE = 0.5    # contour simplification, raster px
WHISKER_PX2 = 15.0      # raster px2: a traced contour smaller than this is a sliver
                        # where two ownership regions graze, not a piece of letter
BAND_GROW_PX = 1        # a whisker of spatial slack on top, for raster rounding

# Reuben, 2026-08-13, on i/s/e (the `e` opening was already known - see ownership_bands()):
# "a letter should start with a clear stroke, not [a blob at] the turning point or meeting
# point". Cause: SLICES is a resolution in ARC-LENGTH, not in screen area. Slice 0 always
# spans the same fraction of the pen's travel (1/44) regardless of where the pen sets down -
# but where that start point sits somewhere spatially wide (inside a junction, under an
# entry hook), a large, oddly-shaped patch of the glyph is genuinely nearest to that one
# short stretch, and it all switches on in a single jump. HEAD_FRAC/HEAD_MULT subdivide just
# the opening of each letter's journey into much thinner slices so that patch reveals as a
# fast sequence of small growing pieces instead of one blob - same ownership model, same "no
# disc, no mask" reveal, just finer-grained where the pen touches down.
HEAD_FRAC = 0.10        # fraction of a letter's own travel treated as "the start"
HEAD_MULT = 4           # how much finer than a standard slice, within that opening fraction

# Pieces that are a DAB - one touch of the pen, laid down whole rather than sliced across.
# Index -1 is the letter's last piece. See the block in main() that consumes this for the
# three ways of INFERRING it that were tried first, and why each one fails on this font.
#
# `i` only. Its tittle is the one mark in the word the pen does not drag: HINTS["i"] now
# leaves the letter AT the dot, so the dot is the last piece, and drawn last it lands on a
# stem that is already inked - which is both how the reference video writes it and what
# keeps the reveal from cutting the dot in half.
DABS = {"i": (-1,)}

# ---- the writing order (2026-08-14) --------------------------------------------------
# HOW THE WORD IS ACTUALLY WRITTEN, decided with Reuben against the handwriting sources and
# a rendered 0-100 route diagram for every letter.
#
# WHY THIS IS A RE-TRAVERSAL RATHER THAN MORE ROUTE ENTRIES. The walk above turns the
# skeleton GRAPH into a path, and it can only traverse each branch once, from a node to a
# node. What a hand does is neither: it starts partway along a limb, doubles back over ink it
# has already laid, and on the `s` and `e` it cuts a CLOSED LOOP at a chosen point that is not
# a node at all. None of those are expressible as edges, and no value of HINTS can reach them
# - the `s`'s whole body is one self-loop on a single node, so its start was never movable.
# So the graph walk still produces the centreline, and this re-orders the finished polyline.
#
# Each step is (from, to) as a fraction of that centreline, walked backwards where from > to.
# Steps must join end-to-start in SPACE; assert_continuous() checks that on every build, so a
# change upstream that shifts these fractions fails loudly instead of quietly emitting a path
# with a hole in it.
TRAVERSAL = {
    # touch down on the bowl's top-left shoulder, round the bowl, up the stalk, then the
    # entry flick out and back, then down the stalk and away along the tail
    "a": [(0.065, 0.48), (0.48, 0.629), (0.034, 0.0), (0.0, 0.065),
          (0.065, 0.034), (0.629, 0.777), (0.777, 1.0)],
    # baseline, up the ascender, back down, round the bottom, out. The sources describe the
    # `l` as one stroke whose downstroke CROSSES its upstroke at the midline; painted with the
    # 190 stroke those two sides are one limb and the skeleton has already merged them, so the
    # doubling back below is that crossing, not an invention.
    "l": [(0.558, 0.0), (0.0, 0.558), (0.558, 1.0)],
    # up the stem, on to the tittle (dabbed there - see DAB_STEPS), back down, out to the right
    "i": [(0.482, 0.80), (0.80, 1.0), (1.0, 0.482), (0.482, 0.0)],
    # THE LOOP CUT. Start on the shaft where the `i` ends, up and round the top hook, back
    # down, round the bottom, and finish where the return overlaps the shaft again. Cutting at
    # 0.21 rather than at a node is the whole point: it is what lets the `s` begin where the
    # previous letter left off (56 units apart, was 895).
    "s": [(0.21, 0.0), (0.884, 1.0), (1.0, 0.884), (0.884, 0.21)],
    # start out along the crossbar, round the eye anticlockwise, then down and round the bowl
    "e": [(0.05, 0.48), (0.0, 0.05), (0.05, 0.0), (0.48, 1.0)],
}
# (step index, from, to) in the ORIGINAL parameterisation: the stretch that is a dab. The
# tittle is reached by dragging up the stem - there is ink all the way, the skeleton runs
# continuously into it - but it must still switch on as ONE mark, which is what atomic does.
DAB_STEPS = {"i": [(1, 0.872, 1.0)]}
JOIN_TOL = 90.0         # user units two consecutive steps may be apart and still count as
                        # joined. About half a stroke width: loose enough for the loop
                        # closures (the `e`'s eye shuts 51 units from where it opened, the
                        # `s`'s 26), tight enough that a real discontinuity cannot hide.

# Where the pen enters and leaves, as a fraction of the letter's own bounding box.
# Cursive comes in low on the left and leaves low on the right; `l` is entered at the
# top of its ascender, which is how the letter is actually written.
HINTS = {
    "a": {"entry": (0.70, 0.09), "exit": (0.93, 0.52)},
    "l": {"entry": (0.66, 0.06), "exit": (0.90, 0.64)},
    # Entered LOW ON THE LEFT so the stem is written first and the TITTLE IS DRAWN LAST,
    # which is both how the reference video does it (the dot is stroke 3, well after the
    # body) and what stops it glitching. Entering at the dot drew it first, and because
    # nearest-arc ownership hands the dot's stretch of the journey a wedge of the stem's
    # top as well - they are close enough to be the same neighbourhood - the dot arrived
    # wearing an angular hat, with nothing under it yet. Drawn last, that wedge is already
    # inked by the stem, so all the dot adds is the dot.
    "i": {"entry": (0.05, 0.80), "exit": (0.54, 0.10)},
    # Entered LOW ON THE LEFT and swept up, which is how Reuben's own hand-drawn reference
    # writes it (`hand drawn example.mp4`, stroke 6: the pen comes in at the bottom left,
    # runs up to the peak, then back down and round the bowl). It used to enter at the top
    # right, which made the hook at the peak the FIRST thing drawn - so it sat there as a
    # flag with a notch under it, waiting for the stroke that eventually joins it, for as
    # long as the letter took. Entering low, the peak is reached mid-stroke and is connected
    # the moment it appears. Same defect and same cure as the `a`'s entry flick; see ROUTE.
    "s": {"entry": (0.08, 0.78), "exit": (0.88, 0.62)},
    "e": {"entry": (0.24, 0.41), "exit": (0.91, 0.52)},
}

# An explicit route, where the cheapest legal walk is not the way the letter is written.
# Each step is (from-node, to-node, which-edge) with nodes given as bbox fractions and
# `long`/`short` picking between parallel branches.
#
# `a` is the only one that needs this, and it needs it because a hand really does draw
# part of the letter twice: you close the bowl by coming back UP its right-hand side,
# then come straight back DOWN the same ink to make the stem. Minimal-overdraw routing
# refuses to repeat that branch, and the walk it finds instead starts on the exit tail
# and finishes in the middle of the letter - correct as a graph traversal, wrong as
# handwriting. 18% overdraw is the price of it reading as a pen.
ROUTE = {
    # The entry flick is drawn FIRST - the pen touches down on it and pulls straight into
    # the bowl. This was flipped to "flick on the way back up" for one afternoon
    # (2026-08-13, matching the reference video, whose bowl stroke ends at the flick) and
    # flipped back the same day: under a slice reveal, a late flick means the wide
    # pen-down blob at the top has a flick-shaped BITE in it for the ~350ms until the pen
    # comes back up - an angular notch hanging at the letter's head, which is exactly the
    # jitter complained about. Drawn first, the junction ink is laid in one connected
    # piece and the bowl grows out of it. (The video is a thin handwritten stroke with no
    # fat junction, so it doesn't face this trade; the glyph does.)
    "a": [((0.70, 0.09), (0.61, 0.17), "any"),      # the entry flick
          ((0.61, 0.17), (0.49, 0.73), "long"),     # the bowl, anticlockwise
          ((0.49, 0.73), (0.61, 0.17), "short"),    # up the right side, closing it
          ((0.61, 0.17), (0.49, 0.73), "short"),    # back down the same ink: the stem
          ((0.49, 0.73), (0.93, 0.52), "any")],     # out along the tail

    # `e` is written from the inside out: start where the strokes meet, go OUT TO THE
    # RIGHT along the crossbar, up, then over the top and round to the west - i.e.
    # ANTICLOCKWISE round the eye - and finally down, round the bottom and out to the
    # extended tail. Left to the smoothest-continuation solver it went round the eye the
    # other way (up and over the top first, then down the right), which is a clockwise
    # eye and is simply not how the letter is written. Reuben, 2026-08-12.
    "e": [((0.24, 0.41), (0.24, 0.41), "any-rev"),  # the eye, anticlockwise
          ((0.24, 0.41), (0.91, 0.52), "any")],     # the bowl, then out along the tail
}

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def plen(pts):
    pts = np.asarray(pts, float)
    if len(pts) < 2:
        return 0.0
    return float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)))


# ---- 1. rasterise the painted shape -------------------------------------------------

def rasterise(letters):
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 400, "height": 400})
        for L in letters:
            pg.set_content(f'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
                           f'<path id="p" d="{L["letter_d"]}"/></svg>')
            bb = pg.evaluate("() => { const b = document.getElementById('p').getBBox();"
                             "return {x:b.x, y:b.y, w:b.width, h:b.height}; }")
            x0 = bb["x"] - STROKE / 2 - MARGIN
            y0 = bb["y"] - STROKE / 2 - MARGIN
            w = bb["w"] + STROKE + 2 * MARGIN
            h = bb["h"] + STROKE + 2 * MARGIN
            pw, ph = int(round(w / UPP)), int(round(h / UPP))
            pg.set_viewport_size({"width": pw + 20, "height": ph + 20})
            pg.set_content(
                '<style>html,body{margin:0;background:#fff}</style>'
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{pw}" height="{ph}" '
                f'viewBox="{x0} {y0} {w} {h}">'
                f'<path d="{L["letter_d"]}" fill="#000" stroke="#000" stroke-width="{STROKE}" '
                f'stroke-linecap="round" stroke-linejoin="round"/></svg>')
            png = pg.screenshot(clip={"x": 0, "y": 0, "width": pw, "height": ph})
            mask = np.asarray(Image.open(io.BytesIO(png)).convert("L")) < 128
            out[L["name"]] = {"mask": mask, "x0": x0, "y0": y0}
        b.close()
    return out


# ---- 2. skeleton + graph ------------------------------------------------------------

def neighbours(sk, y, x):
    H, W = sk.shape
    return [(y + dy, x + dx) for dy, dx in N8
            if 0 <= y + dy < H and 0 <= x + dx < W and sk[y + dy, x + dx]]


def build_branches(sk):
    pts = set(map(tuple, np.argwhere(sk)))
    deg = {p: len(neighbours(sk, *p)) for p in pts}
    nodes = {p for p in pts if deg[p] != 2}
    branches, seen = [], set()
    for n in nodes:
        for nb in neighbours(sk, *n):
            if (n, nb) in seen:
                continue
            path, prev, cur = [n, nb], n, nb
            seen.add((n, nb))
            while deg.get(cur, 0) == 2:
                nxt = [q for q in neighbours(sk, *cur) if q != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                path.append(cur)
            seen.add((path[-1], path[-2]))
            branches.append(path)
    covered = {p for br in branches for p in br}
    for p in pts - covered:
        loop, prev, cur = [p], None, p
        while True:
            nxt = [q for q in neighbours(sk, *cur) if q != prev and (q not in covered or q == p)]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            if cur == p:
                break
            covered.add(cur)
        covered.update(loop)
        if len(loop) > 3:
            branches.append(loop)
    return branches


def prune(sk):
    for _ in range(6):
        branches = build_branches(sk)
        deg = {tuple(p): len(neighbours(sk, *p)) for p in np.argwhere(sk)}
        killed = 0
        for br in branches:
            if len(br) < 2 or plen(br) >= PRUNE_PX:
                continue
            free = [e for e in (br[0], br[-1]) if deg.get(e, 0) == 1]
            if len(free) != 1:
                continue
            keep = br[-1] if free[0] == br[0] else br[0]
            if deg.get(keep, 0) >= 3:
                for q in br:
                    if q != keep:
                        sk[q] = False
                killed += 1
        if not killed:
            break
    return sk


def build_graph(branches):
    nodes = []
    for b in branches:
        for p in (tuple(b[0]), tuple(b[-1])):
            if not any(np.hypot(p[0] - q[0], p[1] - q[1]) <= MERGE_PX for q in nodes):
                nodes.append(p)
    nodes = [np.array(n, float) for n in nodes]

    def nid(p):
        return int(np.argmin([np.hypot(p[0] - q[0], p[1] - q[1]) for q in nodes]))

    edges = [(nid(b[0]), nid(b[-1]), np.array(b, float)) for b in branches]
    return nodes, edges


def degrees(n, edges):
    deg = [0] * n
    for u, v, _ in edges:
        deg[u] += 1
        deg[v] += 1
    return deg


def eulerise(nodes, edges):
    edges = list(edges)
    while True:
        deg = degrees(len(nodes), edges)
        odd = [i for i, d in enumerate(deg) if d % 2 == 1]
        if len(odd) <= 2:
            return edges
        cand = [(plen(p), (u, v, p)) for u, v, p in edges if u in odd and v in odd and u != v]
        if not cand:
            cand = [(plen(p), (u, v, p)) for u, v, p in edges if u in odd or v in odd]
        cand.sort(key=lambda t: t[0])
        edges.append(cand[0][1])


def heading(pts, at_start, k=12):
    pts = np.asarray(pts, float)
    a, b = ((pts[0], pts[min(k, len(pts) - 1)]) if at_start
            else (pts[-1], pts[max(-k - 1, -len(pts))]))
    v = b - a
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.zeros(2)


def euler_walk(nodes, edges, start, end):
    remaining = dict(enumerate(edges))
    route, cur, head = [], start, None
    while remaining:
        opts = []
        for i, (u, v, p) in remaining.items():
            if u == v == cur:
                opts.append((i, u, p))
            elif u == cur:
                opts.append((i, v, p))
            elif v == cur:
                opts.append((i, u, p[::-1]))
        if not opts:
            best, bd = None, float("inf")
            for i, (u, v, p) in remaining.items():
                for nid_, pts in ((u, p), (v, p[::-1])):
                    d = float(np.linalg.norm(nodes[cur] - nodes[nid_]))
                    if d < bd:
                        bd, best = d, (i, (v if nid_ == u else u), pts)
            i, nxt, pts = best
            remaining.pop(i)
            route.append(pts)
            head, cur = heading(pts, False), nxt
            continue

        def score(o):
            i, nxt, pts = o
            s = 0.0 if head is None else -float(np.dot(head, heading(pts, True)))
            if nxt == end and len(remaining) > 1:
                s += 2.0
            return s

        i, nxt, pts = min(opts, key=score)
        remaining.pop(i)
        route.append(pts)
        head, cur = heading(pts, False), nxt
    return route


def forced_route(name, nodes, edges, bbox):
    """Follow ROUTE[name] literally, resolving nodes by bbox fraction.

    `pick` is "any" / "long" / "short" to choose between parallel branches, optionally
    suffixed "-rev" to run that branch backwards. The suffix is the only way to state a
    direction round a self-loop, where both ends are the same node and orienting by
    endpoint tells you nothing - which is exactly the `e`'s eye."""
    y0, y1, x0, x1 = bbox

    def node_at(fx, fy):
        tx, ty = x0 + fx * (x1 - x0), y0 + fy * (y1 - y0)
        return int(np.argmin([np.hypot(n[1] - tx, n[0] - ty) for n in nodes]))

    pieces = []
    for (fa, fb, pick) in ROUTE[name]:
        rev = pick.endswith("-rev")
        pick = pick[:-4] if rev else pick
        u, v = node_at(*fa), node_at(*fb)
        cands = [(i, e) for i, e in enumerate(edges)
                 if {e[0], e[1]} == {u, v} or (u == v and e[0] == e[1] == u)]
        if not cands:
            raise SystemExit(f"{name}: no branch between nodes {u} and {v}")
        if pick == "long":
            i, e = max(cands, key=lambda t: plen(t[1][2]))
        elif pick == "short":
            i, e = min(cands, key=lambda t: plen(t[1][2]))
        else:
            i, e = cands[0]
        pts = e[2] if e[0] == u else e[2][::-1]
        if rev:
            pts = np.asarray(pts, float)[::-1]
        pieces.append(np.asarray(pts, float))
    return pieces


# ---- 3. smoothing + resampling ------------------------------------------------------

def smooth(pts, w=SMOOTH):
    if len(pts) < w + 2 or w < 3:
        return pts
    pad = w // 2
    ext = np.vstack([np.repeat(pts[:1], pad, 0), pts, np.repeat(pts[-1:], pad, 0)])
    ker = np.ones(w) / w
    sm = np.column_stack([np.convolve(ext[:, 0], ker, "valid"),
                          np.convolve(ext[:, 1], ker, "valid")])
    sm[0], sm[-1] = pts[0], pts[-1]        # pin the ends so pieces still join
    return sm


def ownership_bands(mask, pts_px, frac, x0, y0, upp, atomic=()):
    """Split the glyph into SLICES: which part of the letter belongs to which stretch of
    the pen's journey. This is the whole reveal - gen_pen.py switches each slice on as the
    pen reaches it, and draws nothing else.

    `atomic`: [(t0, t1), ...] stretches that must switch on as ONE slice, never
    subdivided - a piece too short to be a drawn stroke (the `i` dot: a tap, not a drag).
    Splitting a near-circular blob by nearest-arc has no real direction to split along, so
    it comes out as two or three overlapping round fragments rather than one clean mark.

    A slice is the set of glyph pixels whose nearest point on the centreline lies in that
    stretch of the journey. Slices tile the glyph exactly, so nothing is lost, and nothing
    can appear before the pen writes it. The boundary between two consecutive slices is
    the level set of the arc parameter, which is the clean cut across the stroke that a
    pen leaves - so a half-drawn letter is bounded by its own outline and one cut, and by
    nothing else.

    This replaced a disc swept along the centreline (2026-08-12). The disc was the source
    of every artefact reported over that weekend: it is ~211 units across while parts of a
    letter pass within ~175 units of each other, so it reached sideways into strokes not
    yet written; where it was narrower than the stroke it scalloped; where the path turned
    inside one radius it left a cusp; its cap left either a flat chord or, rounded, a full
    disc dumped at each letter's start. Ownership bands were added to contain the first of
    those and could not touch the rest, because the visible edge was the disc's, not the
    letter's. Removing the disc removes the whole family at once.

    Ties break toward the EARLIEST pass, which matters for `a`: it deliberately retraces
    its own stem, so along that stretch two passes are equidistant. Nearest-alone made
    ownership alternate between them and shattered the regions into 184 speckled contours;
    "earliest of the equals" gives clean ones, and is also correct - the ink appears on
    the first pass. It is also what makes a crossing read as one continuous stroke passing
    through, with the second arriving later as an arm joining onto it.
    """
    ys, xs = np.nonzero(mask)
    pix = np.column_stack([ys, xs]).astype(float)
    step = max(1, len(pts_px) // 500)
    Q, F = pts_px[::step], frac[::step]
    own = np.empty(len(pix))
    S = len(Q)
    idx = np.arange(S)[None, :]
    for i in range(0, len(pix), 20000):
        ch = pix[i:i + 20000]
        d = np.sqrt(((ch[:, None, :] - Q[None, :, :]) ** 2).sum(-1))
        # WHICH PASS, then WHERE IN IT. Two separate questions, and conflating them is what
        # bent every cut into a chevron until 2026-08-13.
        #
        # `near` is every sample that could plausibly be the one writing this pixel. Where a
        # letter crosses or retraces itself that set spans two far-apart stretches of the
        # journey, and the whole overlap must go to the FIRST of them - otherwise the join
        # splits down the bisector and the earlier stroke is cut off by a hard diagonal.
        near = d <= d.min(1)[:, None] + CROSS_WINDOW_PX
        # So: keep only the first contiguous run of `near` - that IS the first pass - and
        # then take the genuinely nearest sample within it.
        #
        # Taking the earliest of the whole `near` set instead (what BAND_TIE_PX used to do)
        # is the bug: the window is an absolute distance, so a pixel out at the stroke's
        # edge, ~95 units off the centreline, sweeps in far more early samples than one
        # sitting on it. Ownership retreats at the edges and bulges forward in the middle,
        # every slice boundary comes to a point, and clipped to the glyph that point is the
        # tooth Reuben kept filming. Within one pass the true nearest is right: the level
        # sets of nearest-arc on a smooth curve are its normals - a clean cut across the
        # stroke, which is what a pen leaves.
        first = np.argmax(near, axis=1)
        after = idx >= first[:, None]
        gap = (~near) & after
        end = np.where(gap.any(1), np.argmax(gap, axis=1), S)
        inrun = after & (idx < end[:, None])
        nearest = np.argmin(np.where(inrun, d, np.inf), 1)

        # A RETRACE is not a crossing, and it needs the opposite rule (2026-08-13).
        #
        # The crossing case above works because the two passes land in SEPARATE runs of
        # `near`, so keeping the first run picks the first pass outright. Where the pen
        # retraces its own ink - `a` goes up the right side and comes straight back down it,
        # and `s` does the same at its top - the two passes are ADJACENT in arc, so they
        # fall in ONE run and the true-nearest rule splits the shared width between them.
        # The up-stroke then draws at half width and the missing half reads as a notch cut
        # into the letter, which is what Reuben kept pointing at on the `a` and the `s`.
        #
        # Tell the two apart by how much arc the run spans. A smooth stroke's run is a local
        # neighbourhood, ~2*CROSS_WINDOW_PX of arc; a retrace run reaches across the whole
        # doubled-back stretch and is far longer. On a retrace run take the EARLIEST sample,
        # so the first pass owns the full width and the second adds nothing there - it just
        # carries on past. Anywhere else, nearest, which is what keeps the cut square across
        # the stroke instead of bending it into a chevron.
        span = F[np.clip(end - 1, 0, S - 1)] - F[first]
        own[i:i + 20000] = np.where(span > RETRACE_ARC, F[first], F[nearest])
    ownmap = np.full(mask.shape, np.nan)
    ownmap[ys, xs] = own

    # THIN SLICES, EACH SWITCHED ON WHOLE AS THE PEN REACHES IT. No disc is swept at all.
    #
    # Everything before this revealed the glyph through a disc travelling the centreline,
    # so what a viewer saw mid-stroke was the edge of the DISC, not the edge of the letter:
    # scallops where the disc was narrower than the stroke, a cusp wherever the path turned
    # inside one disc radius, a flat chord at the butt cap, and a full disc dumped at each
    # letter's start. Every one of those is an edge that is not part of the letterform, and
    # no amount of rounding removes them because they are the model, not a parameter.
    #
    # The boundary between two consecutive slices is the level set of the arc parameter -
    # the set of pixels the pen is equidistant along - which IS the clean cut across the
    # stroke that a pen leaves. So the only edges on screen are the letter's own outline
    # plus that one cut, and the stroke's thickness varies only because the letter does.
    # Slice boundaries are NOT uniform: the opening HEAD_FRAC of EACH stroke segment is
    # subdivided HEAD_MULT times finer than the rest, so a spatially-wide start (a
    # junction, an entry hook) reveals as several small pieces in quick succession instead
    # of one blob. Outside the head this is exactly the old `k / SLICES` schedule.
    def head_tail_edges(lo, hi):
        span = hi - lo
        head_n = max(1, round(SLICES * HEAD_FRAC * HEAD_MULT))
        tail_n = max(1, SLICES - round(SLICES * HEAD_FRAC))
        return np.concatenate([
            np.linspace(lo, lo + HEAD_FRAC * span, head_n, endpoint=False),
            np.linspace(lo + HEAD_FRAC * span, hi, tail_n + 1)])

    # The journey is cut at every atomic boundary first, so an atomic stretch (a dot) is
    # never subdivided, and so the stroke that follows one gets its OWN head treatment -
    # it is a fresh pen-down, exactly like a letter's true start, not a continuation.
    breaks = sorted({0.0, 1.0, *[t for pair in atomic for t in pair]})
    segs = []
    for lo, hi in zip(breaks[:-1], breaks[1:]):
        mid = (lo + hi) / 2
        if any(a0 <= mid < a1 for a0, a1 in atomic):
            segs.append(np.array([lo, hi]))
        else:
            segs.append(head_tail_edges(lo, hi))
    edges = np.unique(np.concatenate(segs))

    covered = np.zeros(mask.shape, bool)
    out = []
    for k in range(len(edges) - 1):
        # NOT cumulative, unlike the bands this replaces: cumulative was there to stop
        # abutting polygons leaving hairline seams, and it cost the whole letter being in
        # every clip. Overlapping BACKWARDS in arc closes the same seams for a slice-sized
        # polygon, and it is free: the ground a slice reaches back over was drawn by its
        # predecessor and is already inked, so re-covering it changes nothing on screen.
        # The backward reach stays a fixed arc-fraction (not scaled to the finer head
        # slices) - it only ever re-covers already-inked ground, never new pixels, so a
        # relatively bigger reach on a thin head slice costs nothing on screen.
        lo = -np.inf if k == 0 else edges[k] - SLICE_ARC_BACK / SLICES
        hi = np.inf if k == len(edges) - 2 else edges[k + 1]
        sl = mask & (ownmap >= lo) & (ownmap < hi)
        if sl.sum() == 0:      # `a` retraces its stem, so some slices own nothing new
            continue
        covered |= sl
        # Grown, and deliberately NOT re-clipped to the glyph - see the note this replaces:
        # intersecting with the 4-unit raster pins the clip to a staircase just inside the
        # real outline and erodes a sub-pixel rim off every stroke.
        parts = trace(binary_dilation(sl, iterations=BAND_GROW_PX), x0, y0, upp)
        if parts:
            out.append({"t0": round(float(edges[k]), 6), "t1": round(float(edges[k + 1]), 6),
                        "d": parts})

    # The settle pass, now only a safety net. The slices tile the ownership map, so it is
    # normally empty; it catches any pixel whose nearest-arc came out non-finite. Kept
    # because a hole in a finished letter is the one failure that must not be possible,
    # and it clips to the leftovers rather than the whole glyph so it cannot composite
    # over the letter's antialiased outline and thicken it.
    settle = trace(binary_dilation(mask & ~covered, iterations=BAND_GROW_PX) & mask,
                   x0, y0, upp)
    if settle:
        out.append({"t0": 1.0, "t1": 1.0, "d": settle, "fill": True})
    return out


def apply_traversal(name, user):
    """Re-walk a finished centreline in the order a hand writes the letter.

    Returns the new polyline, each sample's fraction along the ORIGINAL centreline, and the
    index of the step that laid it. The originals are what DAB_STEPS is declared against, and
    keeping them is also what lets a retrace be recognised later: the return pass carries the
    same original fractions as the outbound one.
    """
    seg = np.linalg.norm(np.diff(user, axis=0), axis=1)
    frac = np.concatenate([[0.0], np.cumsum(seg)])
    frac /= frac[-1]
    pts, src, step = [], [], []
    for k, (a, b) in enumerate(TRAVERSAL[name]):
        ia = min(max(int(np.searchsorted(frac, a)), 0), len(user) - 1)
        ib = min(max(int(np.searchsorted(frac, b)), 0), len(user) - 1)
        idx = np.arange(ia, ib + 1) if ia <= ib else np.arange(ib, ia + 1)[::-1]
        if len(idx) < 2:
            raise SystemExit(f"{name}: traversal step {k} ({a}, {b}) is empty")
        if pts:                       # the previous step already emitted this sample
            idx = idx[1:]
        pts.append(user[idx]); src.append(frac[idx]); step.append(np.full(len(idx), k))
    return np.vstack(pts), np.concatenate(src), np.concatenate(step)


def assert_continuous(name, user):
    """Every step must start where the last one finished, in SPACE.

    TRAVERSAL is written as fractions of a centreline this script generates, so anything that
    moves that centreline - a HINTS change, a different prune, a new RESAMPLE - slides those
    fractions off the features they were chosen for. The failure that causes is a pen that
    teleports mid-letter and a stretch of glyph nobody draws, and it is invisible in the
    coverage check because the settle net quietly paints the gap in at the end. So it is
    checked here instead, on every build.
    """
    seg = np.linalg.norm(np.diff(user, axis=0), axis=1)
    frac = np.concatenate([[0.0], np.cumsum(seg)])
    frac /= frac[-1]
    for k, ((a0, a1), (b0, b1)) in enumerate(zip(TRAVERSAL[name][:-1], TRAVERSAL[name][1:])):
        pa = user[min(max(int(np.searchsorted(frac, a1)), 0), len(user) - 1)]
        pb = user[min(max(int(np.searchsorted(frac, b0)), 0), len(user) - 1)]
        d = float(np.hypot(*(pb - pa)))
        if d > JOIN_TOL:
            raise SystemExit(
                f"{name}: traversal breaks between step {k} (ends {a1}) and step {k+1} "
                f"(starts {b0}) - {d:.0f} user units apart, tolerance {JOIN_TOL:.0f}.\n"
                f"  The centreline has moved under TRAVERSAL. Re-read the fractions off a "
                f"fresh route diagram rather than nudging the tolerance.")


def cusp_indices(user):
    """Vertices where the pen REVERSES - the joins between one pass and the next.

    Measured on the resampled centreline rather than taken from the route's piece list,
    because resample() re-indexes everything and because a reversal is a property of the
    geometry, not of how the walk happened to be cut into branches. Averaged over CUSP_WIN
    segments either side: a single segment either side is dominated by resampler jitter.
    """
    seg = np.diff(user, axis=0)
    n = np.linalg.norm(seg, axis=1)
    n[n == 0] = 1e-9
    u = seg / n[:, None]
    hits = []
    for i in range(1, len(u)):
        before = u[max(0, i - CUSP_WIN):i].mean(0)
        after = u[i:min(len(u), i + CUSP_WIN)].mean(0)
        nb, na = np.linalg.norm(before), np.linalg.norm(after)
        if nb < 1e-9 or na < 1e-9:
            continue
        if float(before @ after) / (nb * na) < CUSP_DOT:
            hits.append(i)
    merged = []                      # a reversal spans a few samples; keep one per run
    for i in hits:
        if merged and i - merged[-1] <= 2 * CUSP_WIN:
            merged[-1] = i
        else:
            merged.append(i)
    return merged


def retrace_canon(user, frac, cuts):
    """Arc parameter with a retraced pass folded back onto the ink it repeats.

    safe_halfwidths()'s separation bound asks "is some FAR-AWAY-IN-ARC part of the journey
    nearer than the sample I started from?" and stops the normal there. On a retrace the
    honest answer is that the far-away part is this very ink, written a moment ago, so the
    bound fires everywhere along the doubled stretch and both passes tile at one SEP_STEP.

    Folding fixes it at the source rather than special-casing the bound: a sample on the
    return pass reports its partner's arc, so the two passes occupy ONE arc position and
    the separation test sees a single stroke. The `a`'s bowl and the `e`'s eye are
    untouched - they come near themselves without lying on themselves, so nothing folds.

    KEYED ON GEOMETRY, NOT ON ADJACENCY (2026-08-14). This used to compare a pass only with
    the one immediately before it across a reversal, which is right for a plain there-and-back
    and wrong as soon as the writing order puts anything in between. The `a` is exactly that:
    it goes up the stalk, then out to the entry flick and back, and only then comes down the
    stalk - so the two stalk passes are separated by three steps and the old test never saw
    them as a pair. The separation bound then treated the same ink as two strokes and clamped
    both, which tiled the stalk as hatched stripes and left 2% of the letter unpainted.

    So: a sample folds onto the EARLIEST sample it is geometrically coincident with, whatever
    the order. What still keeps a crossing distinct is the RUN LENGTH - two strokes that cross
    coincide for a sample or two, a retrace coincides for a long contiguous stretch - and
    RETRACE_GAP, which stops a smooth curve matching its own immediate neighbours.
    """
    canon = frac.copy()
    folded = np.zeros(len(user), bool)
    tree = cKDTree(user)
    partner = np.full(len(user), -1)
    for i, p in enumerate(user):
        for j in sorted(tree.query_ball_point(p, RETRACE_TOL * RESAMPLE)):
            if j <= i - RETRACE_GAP:            # an earlier pass, not this one
                partner[i] = j
                break
    on = partner >= 0
    i = 0
    while i < len(on):
        if not on[i]:
            i += 1
            continue
        k = i
        while k < len(on) and on[k]:
            k += 1
        if k - i >= RETRACE_MIN:                # a run this long is a retrace, not a crossing
            canon[i:k] = frac[partner[i:k]]
            folded[i:k] = True
        i = k
    return canon, folded


def slice_edges(atomic, extra=()):
    """The arc schedule every slice boundary sits on. Shared by both band builders so the
    analytic and raster paths cut the journey at exactly the same times, and the pacing in
    gen_pen.py is unaffected by which one produced the geometry.

    `extra`: arc positions that MUST be boundaries - the cusps. A ribbon that straddles a
    reversal is built from two opposed tangents and comes out as a bowtie, so the schedule
    has to break there whatever the even spacing would have done.

    A cusp is added to the finished schedule rather than to `breaks`. Putting it in `breaks`
    restarts the head/tail schedule on the far side of it, which is right after a DAB - a
    fresh pen-down deserves its own fine opening - and wrong after a reversal, where the pen
    never left the page. It also tripled the `a`'s slice count for nothing, since the return
    pass re-reveals ink the outbound pass already laid.
    """
    breaks = sorted({0.0, 1.0, *[t for pair in atomic for t in pair]})
    segs = []
    for lo, hi in zip(breaks[:-1], breaks[1:]):
        mid = (lo + hi) / 2
        if any(a0 <= mid < a1 for a0, a1 in atomic):
            segs.append(np.array([lo, hi]))          # a dab is never subdivided
        else:
            span = hi - lo
            head_n = max(1, round(SLICES * HEAD_FRAC * HEAD_MULT))
            tail_n = max(1, SLICES - round(SLICES * HEAD_FRAC))
            segs.append(np.concatenate([
                np.linspace(lo, lo + HEAD_FRAC * span, head_n, endpoint=False),
                np.linspace(lo + HEAD_FRAC * span, hi, tail_n + 1)]))
    if len(extra):
        segs.append(np.asarray(extra, float))
    return np.unique(np.concatenate(segs))


def frame(user, cuts=()):
    """Unit tangent, unit normal and signed curvature at every centreline sample.

    `cuts`: reversal vertices. Each pass between them is differentiated on its OWN samples,
    so no derivative is ever taken across a reversal. Without this the raw difference at the
    cusp still averages two opposed directions - taking the tangent raw (below) keeps the
    damage to one sample instead of a whole smoothing window, but one sample at the top of
    the `a`'s stem is still a spun normal and a collapsed ribbon.

    Central differences on a curve already smoothed by smooth() and resampled at a uniform
    RESAMPLE spacing, so the spacing term cancels and the derivatives are well conditioned.
    The tangent is smoothed once more: curvature is a second derivative and picks up the
    resampler's own jitter otherwise, and this value is used to decide how far a normal may
    safely reach - a spike in it would punch a notch in the reveal.
    """
    # The TANGENT is taken raw. Smoothing it averages across the cusp where the pen doubles
    # back on itself - the `a` goes up its right side and straight back down the same ink -
    # and two opposed tangents average to nothing, so the normal spins and the ribbons built
    # from it collapse into diagonal slivers. Measured: hatched stripes down the `a`'s stem
    # and 3.5% of the letter untiled. The centreline is already smoothed upstream and
    # resampled at a uniform spacing, so the raw difference is well behaved; a reversal now
    # costs one bad sample instead of a whole smoothing window.
    d1 = np.empty_like(user)
    d2 = np.empty_like(user)
    bounds = [0] + list(cuts) + [len(user)]
    for a, b in zip(bounds[:-1], bounds[1:]):
        span = user[a:b]
        if len(span) < 2:                      # a one-sample pass has no direction of its
            d1[a:b] = d1[max(0, a - 1)]        # own; inherit rather than divide by zero
            d2[a:b] = 0.0
            continue
        g1 = np.gradient(span, axis=0)
        d1[a:b] = g1
        d2[a:b] = np.gradient(smooth(g1, SMOOTH), axis=0)   # curvature: a 2nd derivative
    speed = np.hypot(d1[:, 0], d1[:, 1])
    speed[speed == 0] = 1e-9
    tang = d1 / speed[:, None]
    norm = np.column_stack([-tang[:, 1], tang[:, 0]])       # +90 degrees
    kappa = (d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]) / speed ** 3
    return tang, norm, kappa


def reach_profile(user, norm, mask, x0, y0, upp):
    """How far the painted glyph actually extends from each centreline sample, per side.

    MEASURED OFF THE PAINTED MASK, by marching each normal out until it leaves the ink. An
    earlier version assigned outline points to their nearest sample and took the furthest
    per sample; it is wrong and it was measured wrong - the outline is sparser than the
    resampling, so most samples owned no outline point at all, kept a reach near zero, and
    the ribbons tiled only ~85% of the letter. Marching the real mask asks the question
    directly and per side, which also gives the asymmetry a curved stroke actually has.

    Returned with REACH_MARGIN of slack so the ribbon's flanks land OUTSIDE the outline and
    are clipped away by the glyph, rather than sitting just inside it and showing as an edge.
    """
    steps = np.arange(SEP_STEP, REACH_MAX + SEP_STEP, SEP_STEP)
    out = []
    for sign in (+1, -1):
        p = user[:, None, :] + sign * norm[:, None, :] * steps[None, :, None]
        col = np.clip(np.round((p[..., 0] - x0) / upp).astype(int), 0, mask.shape[1] - 1)
        row = np.clip(np.round((p[..., 1] - y0) / upp).astype(int), 0, mask.shape[0] - 1)
        off = ~mask[row, col]
        first = np.where(off.any(1), np.argmax(off, axis=1), len(steps) - 1)
        out.append(steps[first] + REACH_MARGIN)
    return out[0], out[1]


def safe_halfwidths(user, frac, norm, kappa, reach_l, reach_r, length):
    """How far each normal may reach on each side before it stops describing this stroke.

    Two independent bounds, both local, both derived rather than tuned:

    1. CURVATURE. Normals on the concave side of a bend converge and meet at the centre of
       curvature; past that point the nearest-point map folds back on itself and the level
       set comes to a cusp. Clipped to the glyph that cusp is the triangular spike this
       whole change exists to remove. So the concave side is capped at CURV_SAFETY of the
       radius of curvature. The convex side cannot fold and is left alone, which is what
       preserves coverage on the outside of a bend.

    2. SEPARATION (a discrete medial axis). March outward and stop where some part of the
       journey FAR AWAY IN ARC becomes nearer than the sample we started from - that point
       is on the medial axis between two passes of the pen, and crossing it would let this
       slice reveal ink belonging to a stroke that has not been written. This is what makes
       the `a`'s bowl, the `e`'s eye and the `s`'s facing curves safe without knowing
       anything about them.
    """
    tree = cKDTree(user)
    arc = frac * length
    sep_arc = ARC_SEP_FACTOR * float(np.median(np.maximum(reach_l, reach_r)))
    out = {}
    for sign, reach in ((+1, reach_l), (-1, reach_r)):
        # curvature bound: kappa > 0 means the centre of curvature lies along +normal
        concave = (kappa * sign) > 0
        radius = np.where(np.abs(kappa) > 1e-9, 1.0 / np.maximum(np.abs(kappa), 1e-9), np.inf)
        h = np.where(concave, np.minimum(reach, CURV_SAFETY * radius), reach)

        # separation bound, marched on a fixed ladder so it is one vectorised query
        steps = np.arange(SEP_STEP, float(np.max(h)) + SEP_STEP, SEP_STEP)
        if len(steps):
            probes = user[:, None, :] + sign * norm[:, None, :] * steps[None, :, None]
            flat = probes.reshape(-1, 2)
            _, near_idx = tree.query(flat, k=1)
            near_idx = near_idx.reshape(len(user), len(steps))
            far = np.abs(arc[near_idx] - arc[:, None]) > sep_arc
            beyond = far & (steps[None, :] <= h[:, None])
            first = np.where(beyond.any(1), np.argmax(beyond, axis=1), len(steps))
            limit = np.where(first < len(steps), steps[np.clip(first - 1, 0, None)], np.inf)
            # + SEP_BLEED so the two passes meeting here overlap rather than abut. `h`
            # already carries the curvature bound, so the minimum keeps the fold guard
            # intact - only the separation limit is loosened.
            h = np.minimum(h, np.maximum(limit + SEP_BLEED, SEP_STEP))
        out[sign] = h
    return out[+1], out[-1]


def ribbon(user, tang, norm, hl, hr, i0, i1, span_lo=None, span_hi=None):
    """One slice, as a polygon: the centreline from i0 to i1 offset both ways, closed by a
    straight chord at each end.

    The chord is the segment perpendicular to the tangent - which is exactly the section a
    pen's trailing edge leaves across its own stroke - and because consecutive slices are
    built from the SAME index boundary they share that chord exactly, so they abut in vector
    space with no seam to paper over. The offset sides are pushed past the glyph's outline
    by construction (see reach_profile), so they are clipped away by the glyph itself and
    never appear: mid-draw, the only edges on screen are the letter's own outline and one
    chord.
    """
    idx = np.arange(i0, i1 + 1)
    if len(idx) < 2:
        idx = np.array([max(0, i0 - 1), min(len(user) - 1, i0 + 1)])
    left = user[idx] + norm[idx] * hl[idx][:, None]
    right = user[idx] - norm[idx] * hr[idx][:, None]

    # TERMINAL CAPS. The centreline stops at the first and last sample, but the letter's ink
    # does not - it is painted with a round-capped 190 stroke, so there is a cap's worth of
    # glyph beyond each end that no ribbon would otherwise reach. Push the first/last
    # section straight out along the tangent, far enough to clear the cap; the glyph clips
    # the overshoot away. Without this the reveal leaves a permanent bite at each terminal.
    #
    # A REVERSAL IS A TERMINAL TOO (2026-08-14). Once the pen doubles back - up the `l`'s
    # ascender and down again, out to the `s`'s hook tip and back - the turning point has a
    # round cap of glyph beyond it exactly like a path end, and the ribbon stops at a
    # perpendicular chord short of it. Measured: it left the `l`'s ascender tip, the `l`'s
    # tail tip and the `s`'s hook tip untiled, 4.0% and 4.5% of those letters, which was
    # enough to drop both back to the raster fallback. So the test is the end of the PASS,
    # not the end of the path; span_lo/span_hi are the pass bounds and are 0 and len-1 for a
    # letter that never reverses, which is the old behaviour exactly.
    lo = 0 if span_lo is None else span_lo
    hi = (len(user) - 1) if span_hi is None else span_hi
    if idx[0] <= lo:
        h0 = max(hl[idx[0]], hr[idx[0]])
        if lo == 0:
            # THE PEN-DOWN IS ROUNDED, not squared off (2026-08-14).
            #
            # Extending the opening straight back along the tangent is a RECTANGLE, and where
            # a letter touches down in the middle of a stroke rather than at a glyph terminal
            # the glyph does not clip that rectangle to anything - so the first ink to appear
            # is a block with a hard right-angled corner. Plainly visible on the `l`, which
            # now starts partway up its loop; the `a` was fine only because its start happens
            # to sit on a round terminal, which is what made this look like a per-letter
            # oddity rather than the general case it is.
            #
            # A semicircular cap is the shape a round nib actually leaves when it is set down.
            #
            # ITS RADIUS IS THE PEN'S, NOT THE RIBBON'S. Using the local halfwidth does
            # nothing, because a pen-down is exactly where that halfwidth collapses: the
            # separation bound stops a normal as soon as some far-away-in-arc ink gets nearer,
            # and a letter touches down right beside ink from a later pass every time. MEASURED
            # at sample 0: the `a`, `s` and `e` all clamp to 18 units against a real reach of
            # 142-198, so the opening slice is a sliver and the first ink a viewer actually
            # sees is the NEXT slice's flat chord. That is the squared-off entry.
            #
            # STROKE/2 is safe by construction rather than by luck: the glyph is painted with
            # a 190 stroke along this very centreline, so a disc of half that radius centred
            # on a centreline sample is inside the letter's own ink everywhere. It cannot
            # reach into a limb that has not been written, which is the one thing the
            # separation bound exists to prevent.
            cap_r = max(h0, STROKE / 2)
            th = np.linspace(np.pi, 0.0, 17)
            cap = (user[idx[0]][None, :]
                   + (np.cos(th)[:, None] * norm[idx[0]][None, :]
                      - np.sin(th)[:, None] * tang[idx[0]][None, :]) * cap_r)
            left = np.vstack([cap, left])
        else:
            left = np.vstack([left[0] - tang[idx[0]] * h0, left])
            right = np.vstack([right[0] - tang[idx[0]] * h0, right])
    if idx[-1] >= hi:
        h1 = max(hl[idx[-1]], hr[idx[-1]])
        left = np.vstack([left, left[-1] + tang[idx[-1]] * h1])
        right = np.vstack([right, right[-1] + tang[idx[-1]] * h1])

    poly = np.vstack([left, right[::-1]])
    return "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in poly) + "Z"


def analytic_bands(mask, user, frac, x0, y0, upp, atomic=()):
    """Build the reveal from vector geometry instead of a rasterised nearest-point map.

    Replaces ownership_bands() as the source of slice clips. The old model assigned every
    glyph PIXEL to its nearest centreline point and traced the resulting regions; its level
    sets fold at high curvature (triangular spikes) and its boundaries inherit the raster
    lattice. This builds each slice directly as a ribbon of the centreline capped by
    perpendicular chords, so the boundary is analytic, cannot fold, and carries no lattice.

    Returns the same shape ownership_bands() does - a list of {t0, t1, d} plus an optional
    settle entry - so gen_pen.py is untouched.
    """
    length = float(np.sum(np.linalg.norm(np.diff(user, axis=0), axis=1)))
    cuts = cusp_indices(user)
    tang, norm, kappa = frame(user, cuts)
    reach_l, reach_r = reach_profile(user, norm, mask, x0, y0, upp)
    # CANONICAL arc for the separation bound only. `frac` stays the true journey everywhere
    # else - it is what gen_pen.py times the reveal against, and folding it there would make
    # the retrace take no time at all.
    canon, folded = retrace_canon(user, frac, cuts)
    hl, hr = safe_halfwidths(user, canon, norm, kappa, reach_l, reach_r, length)

    # A pass owns a contiguous run of samples; a ribbon may never leave one.
    span_of = np.zeros(len(user), int)
    for c in cuts:
        span_of[c:] += 1
    edges = slice_edges(atomic, extra=[float(frac[c]) for c in cuts])
    ys, xs = np.nonzero(mask)
    pix_xy = np.column_stack([x0 + xs * upp, y0 + ys * upp])   # dab regions only
    out, covered = [], np.zeros(mask.shape, bool)
    for k in range(len(edges) - 1):
        a0, a1 = edges[k], edges[k + 1]
        # CONSECUTIVE SLICES MUST SHARE THEIR BOUNDARY SAMPLE, not merely abut in arc.
        #
        # Two perpendicular chords one sample apart are not parallel on a curve: on the
        # convex side of a bend the outer offset travels 7*(R+h)/R units while the centreline
        # travels 7, so leaving a one-sample gap between slice k's last vertex and slice
        # k+1's first opens a wedge that widens as the bend tightens. Measured: a fan of
        # hairline gaps up the outside of every curve, and 8-19% of each letter left untiled.
        # Overlapping by OVERLAP_SAMPLES closes it onto ground the predecessor already
        # inked, so it costs nothing on screen.
        # FORWARD bleed as well as backward. Two ribbons that share a boundary sample abut
        # exactly - and an exact abutment is still a seam, because each clip covers its half
        # of the boundary PIXEL partially and the two partial coverages sum to less than
        # one. That is a sub-pixel vector gap: the 4-unit raster coverage check cannot see
        # it at all (holes stayed ~44 however much backward overlap was added) but it is
        # plainly visible as white hairlines across the finished word. Overlapping FORWARD
        # by one sample makes the regions genuinely intersect so there is no shared edge
        # left to seam. It costs one sample of ink ahead of the pen - 7 user units, ~0.1% of
        # a letter - which is far below what any frame can show.
        i0 = int(np.searchsorted(frac, a0, "left")) - OVERLAP_SAMPLES
        i1 = int(np.searchsorted(frac, a1, "left")) + FORWARD_BLEED
        i0, i1 = max(0, min(i0, len(user) - 1)), max(0, min(i1, len(user) - 1))
        if k == len(edges) - 2:
            i1 = len(user) - 1
        # Clamp to the pass this slice belongs to. The backward OVERLAP_SAMPLES and the
        # FORWARD_BLEED are what would otherwise reach across a reversal, and a ribbon with
        # one end's tangent opposed to the other's closes as a bowtie - the exact artefact
        # the swept mask was removed for. Inside a pass they still do their job.
        mid = int(np.searchsorted(frac, (a0 + a1) / 2, "left"))
        s = span_of[min(mid, len(user) - 1)]
        lo = int(np.argmax(span_of == s))
        hi = len(user) - 1 - int(np.argmax((span_of == s)[::-1]))
        i0, i1 = max(i0, lo), min(i1, hi)
        if i1 <= i0 and k < len(edges) - 2:
            continue

        # A RETRACE LAYS NO INK, SO IT EMITS NO SLICE.
        #
        # The return pass runs back down ink the outbound pass already revealed, so a ribbon
        # here can only re-reveal what is on screen - and it brings a second set of traced
        # edges within a sample of the first. Those two nearly-coincident boundaries are a
        # sub-pixel vector seam, and they showed as faint white specks down the finished
        # `a`'s stem: invisible to the raster check, plainly there at 14x. This is the
        # regression FALLBACK_LEFTOVER's comment predicted and kept the `a` on raster to
        # avoid. Emitting nothing removes the second boundary rather than trying to close
        # it, and it is also what the raster path did ("some slices own nothing new").
        # The pen still spends the time: `frac` is untouched, so gen_pen paces the travel.
        if folded[i0:i1 + 1].all():
            continue

        # A DAB KEEPS THE OWNERSHIP REGION, and this is the one deliberate exception.
        # The analytic ribbon exists to make a MOVING boundary clean. A dab has no moving
        # boundary - it is one band, switched on whole - so there is no artefact for a
        # ribbon to prevent, and a ribbon actively hurts: the `i`'s tittle is round and
        # nearly as wide as it is long, so a strip along its short centreline leaves a
        # quarter of the dot uncovered. Nearest-arc gets the whole blob, exactly.
        if any(a0 >= s0 - 1e-9 and a1 <= s1 + 1e-9 for s0, s1 in atomic):
            near = np.argmin(((pix_xy[:, None, :] - user[None, :, :]) ** 2).sum(-1), 1)
            reg = np.zeros(mask.shape, bool)
            sel = (frac[near] >= a0 - 1e-9) & (frac[near] < a1 + 1e-9)
            reg[ys[sel], xs[sel]] = True
            d = trace(binary_dilation(reg, iterations=BAND_GROW_PX) & mask, x0, y0, upp)
            if d:
                out.append({"t0": round(float(a0), 6), "t1": round(float(a1), 6), "d": d})
                covered |= reg
            continue

        d = ribbon(user, tang, norm, hl, hr, i0, i1, lo, hi)
        out.append({"t0": round(float(a0), 6), "t1": round(float(a1), 6), "d": d})
        covered |= rasterise_path(d, mask.shape, x0, y0, upp)

    # Same safety net as before, and for the same reason: a hole in a FINISHED letter is the
    # one failure that must not be possible. It should be near-empty - the run prints how
    # much it is actually covering, and a large number means the ribbons are not tiling.
    left = mask & ~covered
    # NOT re-clipped to `mask`. The mask is a 4-unit raster, so intersecting with it pins
    # this path to a staircase just INSIDE the real outline and leaves a sliver of true ink
    # uncovered along the edge - visible as white hairlines in the finished word, and
    # invisible to a coverage check measured on that same raster. The <use> this clips is
    # the glyph itself, so SVG already confines it exactly; dilating past the outline and
    # letting the glyph do the clipping is both simpler and correct.
    settle = trace(binary_dilation(left, iterations=BAND_GROW_PX + 2), x0, y0, upp)
    if settle:
        out.append({"t0": 1.0, "t1": 1.0, "d": settle, "fill": True})
    return out, int(left.sum()), int(mask.sum())


def rasterise_path(d, shape, x0, y0, upp):
    """Fill an emitted polygon back onto the letter's own raster grid, so coverage can be
    measured against the glyph. Verification only - nothing here reaches the output."""
    img = Image.new("1", (shape[1], shape[0]), 0)
    drw = ImageDraw.Draw(img)
    for sub in d.split("M")[1:]:
        pts = [tuple(map(float, m)) for m in re.findall(r"(-?[\d.]+) (-?[\d.]+)", sub)]
        if len(pts) >= 3:
            drw.polygon([((x - x0) / upp, (y - y0) / upp) for x, y in pts], fill=1)
    return np.array(img, bool)


def trace(region, x0, y0, upp):
    """Region -> an SVG path, in user units."""
    parts = []
    for c in find_contours(np.pad(region.astype(float), 1), 0.5):
        c = approximate_polygon(c, tolerance=BAND_TOLERANCE)
        if len(c) < 4:
            continue
        # Drop slivers. A traced region can come back as a contour with plenty of vertices
        # but effectively no area - a one-pixel whisker where two ownership regions graze
        # each other. It clips to a hairline on screen, which is the stray line that
        # appeared off the top of the `s`. Real slices are thousands of px2; this only ever
        # catches the degenerate ones.
        area = 0.5 * abs(np.dot(c[:, 0], np.roll(c[:, 1], 1)) -
                         np.dot(c[:, 1], np.roll(c[:, 0], 1)))
        if area < WHISKER_PX2:
            continue
        parts.append("M" + " L".join(
            f"{x0 + (b - 0.5) * upp:.0f} {y0 + (a - 0.5) * upp:.0f}" for a, b in c) + "Z")
    return " ".join(parts)


def resample(pts, step):
    d = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    if d[-1] < step:
        return pts
    t = np.arange(0, d[-1], step)
    t = np.append(t, d[-1])
    return np.column_stack([np.interp(t, d, pts[:, 0]), np.interp(t, d, pts[:, 1])])


# ---- main ---------------------------------------------------------------------------

def main():
    geom = json.load(open(GEOM, encoding="utf-8"))
    letters = geom["letters"]
    assert [L["name"] for L in letters] == LETTERS, "geometry.json letter order"
    outlines = [np.array(g["outline"], float)[::2] for g in json.load(open(OUTLINES))]

    rasters = rasterise(letters)
    report = []

    for gi, L in enumerate(letters):
        name = L["name"]
        r = rasters[name]
        mask = r["mask"]
        sk = prune(skeletonize(mask).copy())
        branches = [np.array(b, float) for b in build_branches(sk)
                    if plen(b) >= 4.0 and len(b) >= 2]
        nodes, edges = build_graph(branches)
        ys, xs = np.nonzero(mask)
        bbox = (ys.min(), ys.max(), xs.min(), xs.max())

        if name in ROUTE:
            pieces = forced_route(name, nodes, edges, bbox)
        else:
            def node_at(fx, fy):
                tx = bbox[2] + fx * (bbox[3] - bbox[2])
                ty = bbox[0] + fy * (bbox[1] - bbox[0])
                return int(np.argmin([np.hypot(n[1] - tx, n[0] - ty) for n in nodes]))
            h = HINTS[name]
            start, end = node_at(*h["entry"]), node_at(*h["exit"])
            eul = eulerise(nodes, edges)
            odd = [i for i, d in enumerate(degrees(len(nodes), eul)) if d % 2 == 1]
            if odd:
                if start not in odd:
                    start = min(odd, key=lambda i: np.linalg.norm(nodes[i] - nodes[start]))
                if end not in odd or end == start:
                    others = [i for i in odd if i != start]
                    end = others[0] if others else start
            pieces = euler_walk(nodes, eul, start, end)

        # smooth each piece, then join into ONE continuous polyline for the letter
        chain, piece_len_px = [], []
        for pts in pieces:
            sm = smooth(np.asarray(pts, float))
            chain.append(sm if not chain else sm[1:])
            piece_len_px.append(plen(sm))
        poly_px = np.vstack(chain)

        # A piece under DOT_PIECE_PX is a tap (the `i` dot), not a drawn stroke - its span
        # of the journey, in the same arc-fraction terms `frac` below ends up in (a uniform
        # px->user scale preserves the ratio exactly), must reach ownership_bands as ONE
        # atomic stretch so it is never subdivided. See the constant's own comment.
        piece_bounds = np.concatenate([[0.0], np.cumsum(piece_len_px)])
        piece_bounds_frac = piece_bounds / piece_bounds[-1]
        # DID THE PEN LIFT TO GET HERE? Walk the straight line between the end of one piece
        # and the start of the next: if it crosses blank paper the pen was off the page, and
        # what it lands on is a DAB - a mark made in one touch, which must appear whole and
        # must never be swept. That is the `i`'s tittle, and sweeping it is what left it
        # half-drawn with a bite out of it. Where the jump stays on ink the pieces are one
        # continuous stroke (an entry hook, a retrace), and those are swept like anything
        # else. This replaces a length threshold, which could not tell a tittle from a hook.
        # WHICH PIECES ARE DABS - declared, not inferred, and here is why.
        #
        # A dab is a mark the pen makes in one touch: the `i`'s tittle. It must switch on
        # WHOLE, because a near-circular blob has no direction to sweep along and cutting
        # across it serves it up half-drawn with a bite out of it.
        #
        # Three ways of inferring it were tried and all three are wrong on this font:
        #   - piece length: catches the tittle AND `s`'s entry hook and `a`'s entry flick,
        #     which are joins, and switching those on whole strands them on the page.
        #   - separate connected component of the glyph: the tittle is NOT separate here.
        #     Painted with its 190 stroke the letter rasterises as ONE blob (measured), so
        #     this test finds nothing.
        #   - the pen jumping over blank paper between pieces: for the same reason the
        #     skeleton runs continuously into the tittle, so there is no jump to find. It
        #     also mislabels a single-piece letter (`l`) as one big dab.
        #
        # The wordmark is five fixed letters, not a font renderer, so the honest answer is
        # to say which piece it is. DABS maps a letter to the indices of its dab pieces;
        # `-1` is the last piece, so it survives the route changing length.
        dabs = [False] * len(pieces)
        for di in DABS.get(name, ()):
            dabs[di] = True

        # every sample must sit on ink, or the pen dot rides outside the letter
        yy = np.clip(np.round(poly_px[:, 0]).astype(int), 0, mask.shape[0] - 1)
        xx = np.clip(np.round(poly_px[:, 1]).astype(int), 0, mask.shape[1] - 1)
        outside = int((~mask[yy, xx]).sum())

        # px -> user units
        user = np.column_stack([r["x0"] + poly_px[:, 1] * UPP,
                                r["y0"] + poly_px[:, 0] * UPP])
        user = resample(user, RESAMPLE)

        # THE WRITING ORDER. Everything above produced a path that covers the letter; this
        # re-walks it the way the letter is written. See TRAVERSAL.
        src = stepid = None
        if name in TRAVERSAL:
            assert_continuous(name, user)
            user, src, stepid = apply_traversal(name, user)

        O = outlines[gi]
        gap = float(np.sqrt(((O[:, None, :] - user[None, :, :]) ** 2).sum(-1).min(1)).max())
        L["center_d"] = "M" + " L".join(f"{p[0]:.1f} {p[1]:.1f}" for p in user)

        # which part of the glyph belongs to which stretch of the journey
        back = np.column_stack([(user[:, 1] - r["y0"]) / UPP, (user[:, 0] - r["x0"]) / UPP])
        seg = np.linalg.norm(np.diff(user, axis=0), axis=1)
        frac = np.concatenate([[0.0], np.cumsum(seg)])
        frac /= frac[-1]
        # The arc-fraction boundaries of the pen's separate pieces. Stored because a
        # consumer that wants ownership per STROKE (rather than per slice) cannot recover
        # them from `bands` alone - a band knows its arc range, not which pass it belongs to.
        # `dabs` came from the pen-lift test above. A dab must also be ONE band, or the
        # slicer cuts the tittle into arc-neighbouring fragments that mean nothing on a
        # near-circular blob.
        atomic = [(piece_bounds_frac[k], piece_bounds_frac[k + 1])
                  for k, d in enumerate(dabs) if d]

        L["pieces"] = [float(x) for x in piece_bounds_frac]
        L["dabs"] = dabs

        if name in TRAVERSAL:
            # The route's own piece bounds describe the OLD order and mean nothing now. Both
            # the dabs and the step bounds are recomputed against the walked path.
            atomic = []
            for st, lo, hi in DAB_STEPS.get(name, ()):
                sel = (stepid == st) & (src >= lo - 1e-9) & (src <= hi + 1e-9)
                if not sel.any():
                    raise SystemExit(f"{name}: DAB_STEPS {(st, lo, hi)} selected no samples")
                w = np.nonzero(sel)[0]
                atomic.append((float(frac[w[0]]), float(frac[w[-1]])))
            L["pieces"] = [0.0] + [float(frac[np.nonzero(stepid == k)[0][-1]])
                                   for k in range(int(stepid.max()) + 1)]
            L["dabs"] = [any(abs(a - L["pieces"][k]) < 1e-9 for a, _ in atomic)
                         for k in range(len(L["pieces"]) - 1)]

        # ANALYTIC FIRST, raster only as a measured fallback. `leftover` is how much of the
        # letter the ribbons failed to tile; the settle net would have to paint it in at the
        # end, which is the very "pops complete" failure this is meant to avoid. If a letter
        # cannot be tiled to within FALLBACK_LEFTOVER of itself the analytic geometry is not
        # good enough THERE and that letter keeps the old traced bands - deliberately, per
        # letter, and printed, so it can never be a silent regression.
        bands, leftover, area = analytic_bands(mask, user, frac,
                                               r["x0"], r["y0"], UPP, atomic=atomic)
        mode = "analytic"
        if leftover > FALLBACK_LEFTOVER * area:
            bands = ownership_bands(mask, back, frac, r["x0"], r["y0"], UPP, atomic=atomic)
            mode = "RASTER-FALLBACK"
        L["bands"] = bands
        report.append((name, len(pieces), len(atomic), len(user), plen(user), gap, outside,
                       len(L["bands"]), mode, leftover / max(1, area) * 100))

    shutil.copyfile(GEOM, GEOM + ".bak")
    json.dump(geom, open(GEOM, "w", encoding="utf-8"))

    print(f"{'ltr':>3} {'pieces':>7} {'atomic':>7} {'samples':>8} {'length':>8} "
          f"{'max gap':>8} {'implied width':>14} {'off-ink':>8} {'bands':>6} "
          f"{'mode':>16} {'untiled%':>9}")
    for name, npieces, natomic, nsamp, length, gap, outside, nbands, mode, left in report:
        print(f"{name:>3} {npieces:>7} {natomic:>7} {nsamp:>8} {length:>8.0f} {gap:>8.0f} "
              f"{(gap+95)*2*1.10:>14.0f} {outside:>8} {nbands:>6} {mode:>16} {left:>8.2f}%")
    print(f"\npen dot diameter is 340 user units - implied width is what gen_pen.py will "
          f"cut each\nreveal segment to, so it wants to be near that, not multiples of it.")
    print(f"wrote {GEOM} (previous kept as geometry.json.bak)")


if __name__ == "__main__":
    main()
