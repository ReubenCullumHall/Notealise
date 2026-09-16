/* landing.js — the home page's two pieces of scroll behaviour.

   1. Reveals. Every [data-reveal] fades and rises 12px into place the first
      time it enters view, then stays. One-way, like the top bar's own latch.

   2. The path out. The ink line under "Now it's time to walk the path" draws
      itself down the page as the reader scrolls into the ending. --draw (0 to
      100) on .walk is the scroll progress through that section; 0-55 inks the
      single wave, 55-100 inks the two straightened halves into the buttons. It
      is tied to scroll position, not a clock, and never un-draws.

   Both are gated on prefers-reduced-motion: with it on, everything is simply in
   its finished state from the start and no listener is attached. The CSS already
   states that end state, so this file failing to run leaves a correct page. */

/* ── Nobody waits ─────────────────────────────────────────────────────────
   The hero's opening runs ~5.6s: the wordmark inks itself, then the tagline
   types, then the plain line fades in. That is fine for someone who chose to
   watch it and intolerable for someone who did not, and the second group is
   most people. So the first sign of intent — a scroll, a click, a key, a
   touch — jumps the whole thing to its finished state at once.

   But not as a cut (Reuben, 2026-09-15: "don't harshly cut all the front page
   in, do a slow sweep up slide in like the rest of the website"). Each piece
   still to come — the tagline, the plain line, each of the four stats — is
   finished and then swept up into place, top to bottom, the way the sections
   further down arrive. A piece caught partway (the tagline mid-typing) rises
   the last few pixels from half-faded rather than vanishing and coming back.
   Pieces already on screen are left alone, and the wordmark video keeps
   playing.

   Two things are deliberately left running. Anything set to repeat forever
   cannot be finished, and the tagline's slow ambient flourishes (drift, spin,
   breathe — they run to 22s) are atmosphere rather than an entrance, so
   snapping them to their end state would look like a glitch. The 9s cut-off
   separates the two groups. ── */
(function () {
  var hero = document.querySelector(".hero");
  if (!hero || !document.getAnimations) return;
  if (!document.documentElement.classList.contains("wm-motion")) return;

  var EVENTS = ["wheel", "touchstart", "pointerdown", "keydown", "scroll"];
  var spent = false;

  // top to bottom, the order they sweep in
  var blocks = [document.getElementById("tagline"), hero.querySelector(".hero-plain")]
    .concat([].slice.call(hero.querySelectorAll(".hero-stats li")))
    .filter(Boolean);
  var SWEEP_MS = 900, SWEEP_GAP = 90, SWEEP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

  function blockOf(el) {
    for (var b = 0; b < blocks.length; b++) if (blocks[b].contains(el)) return b;
    return -1;
  }

  function heroSettle() {
    if (spent) return;
    spent = true;
    release();
    var waiting = [], shown = [];   // per block: any entrance still to come / any already visible
    var running = document.getAnimations();
    for (var i = 0; i < running.length; i++) {
      var a = running[i];
      var target = a.effect && a.effect.target;
      if (!target || !hero.contains(target)) continue;
      var t = a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (!t) continue;
      if (t.iterations === Infinity) continue;      // loops forever, can't finish
      if (!(t.endTime <= 9000)) continue;           // ambient, not an entrance
      var b = blockOf(target);
      if (b >= 0) {
        var delay = (a.effect.getTiming && a.effect.getTiming().delay) || 0;
        if (a.playState === "finished") shown[b] = true;
        else if ((a.currentTime || 0) < delay) waiting[b] = true;
        else { waiting[b] = true; shown[b] = true; }
      }
      try { a.finish(); } catch (e) {}              // already done, or unresolved
    }
    if (!blocks[0].animate) return;
    var order = 0;
    for (var k = 0; k < blocks.length; k++) {
      if (!waiting[k]) continue;
      var from = shown[k]
        ? { opacity: 0.45, transform: "translateY(8px)" }
        : { opacity: 0, transform: "translateY(18px)" };
      blocks[k].animate([from, { opacity: 1, transform: "none" }], {
        duration: SWEEP_MS, delay: order * SWEEP_GAP, easing: SWEEP_EASE, fill: "backwards"
      });
      order++;
    }
  }
  function release() {
    for (var i = 0; i < EVENTS.length; i++) {
      window.removeEventListener(EVENTS[i], heroSettle);
    }
  }
  for (var i = 0; i < EVENTS.length; i++) {
    window.addEventListener(EVENTS[i], heroSettle, { passive: true });
  }
})();

(function () {
  var reduce =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── 1. Reveals ────────────────────────────────────────────────────────── */
  var targets = document.querySelectorAll("[data-reveal]");
  var i;

  if (reduce || !("IntersectionObserver" in window)) {
    for (i = 0; i < targets.length; i++) targets[i].classList.add("is-in");
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        for (var n = 0; n < entries.length; n++) {
          if (!entries[n].isIntersecting) continue;
          entries[n].target.classList.add("is-in");
          io.unobserve(entries[n].target); // one-way
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    for (i = 0; i < targets.length; i++) {
      targets[i].classList.add("reveal");
      io.observe(targets[i]);
    }

    /* Safety net. .reveal is what makes an element transparent, and it is added
       here rather than in the markup, so no-JS is already safe. The one failure
       this cannot rule out is JS running, hiding everything, and the observer
       then never delivering — which would leave a blank page. After 3s, show
       whatever is still hidden regardless. Costs nothing when the observer works. */
    window.setTimeout(function () {
      var left = document.querySelectorAll("[data-reveal]:not(.is-in)");
      for (var k = 0; k < left.length; k++) left[k].classList.add("is-in");
    }, 3000);
  }

  /* ── 2. The path out ───────────────────────────────────────────────────
     The ink line under "walk the path". Its shape is measured from the real
     positions of the "h" in "path" and the two buttons, so it lands on them at
     any width; --draw (0..100) is how far the reader has scrolled into the
     section and is what inks the line in (see landing.css). */
  var walk = document.querySelector(".walk");
  var strand = walk && walk.querySelector(".walk-strand");
  if (!walk || !strand) return;

  /* The two buttons below install a desktop app — on a phone or tablet
     neither can do anything, and a reader arriving from an Instagram/TikTok
     link is exactly who hits this. Walking them into a download that can't
     work is worse than no line at all, so the whole ending swaps to a plain
     "not available" notice and the draw never runs. This is a DEVICE check,
     not a width one — narrowing a desktop browser window must still show the
     real line (the buttons still work fine stacked), so it can't key off
     the same breakpoint the "Try it" panel's controls do. */
  var ua = navigator.userAgent || "";
  // ?device=phone forces the phone version, for previewing it in a desktop browser.
  var MOBILE = /[?&]device=phone(?:&|$)/.test(location.search) ||
    !!(navigator.userAgentData && navigator.userAgentData.mobile) ||
    /android|iphone|ipad|ipod|windows phone|mobile/i.test(ua) ||
    // iPads on iPadOS 13+ send a Mac user agent by default; no real Mac has a touchscreen.
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (MOBILE) {
    // No CTA here on purpose (Reuben, 2026-09-13): the app isn't coming to
    // phone any time soon, so two download buttons that can't do anything is
    // worse than just ending plainly. Copy CONFIRMED by Reuben 2026-09-16 —
    // this line is the wording, not a placeholder.
    var walkLineEl = walk.querySelector(".walk-line");
    if (walkLineEl) walkLineEl.textContent = "Built for Mac and Windows.";
    walk.classList.add("unavailable");
    return;
  }

  var hSpan = walk.querySelector(".walk-h");
  var hTip = walk.querySelector(".walk-anchor");
  var walkLine = walk.querySelector(".walk-line");
  var trunk = strand.querySelector(".trunk");
  var forkL = strand.querySelector(".fork-l");
  var forkR = strand.querySelector(".fork-r");
  var winBtn = document.getElementById("winBtn");
  var macBtn = document.getElementById("macBtn");
  if (!hSpan || !trunk || !forkL || !forkR || !winBtn || !macBtn) return;

  function r(n) { return Math.round(n * 10) / 10; }
  function cubic(x0, y0, c1x, c1y, c2x, c2y, x1, y1) {
    return "M " + r(x0) + " " + r(y0) +
           " C " + r(c1x) + " " + r(c1y) + " " + r(c2x) + " " + r(c2y) +
           " "   + r(x1) + " " + r(y1);
  }

  function shape() {
    var box = walk.getBoundingClientRect();
    strand.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);

    /* Start: the foot of the "h" in "path" — where its right leg meets the
       baseline, after the arch curves down. .walk-anchor is a zero-size inline
       box on that baseline, so its rect gives x and y exactly; a small nudge
       left lands on the leg’s ink rather than the advance edge. */
    var tip = (hTip || hSpan).getBoundingClientRect();
    var sx = tip.right - box.left - 2;
    var sy = tip.bottom - box.top;

    var lb = winBtn.getBoundingClientRect();
    var rb = macBtn.getBoundingClientRect();
    /* +1 so each end finishes ON the button edge rather than a hair above it —
       a gap there is what made the old ends look like they trailed off. */
    var lx = lb.left + lb.width / 2 - box.left, ly = lb.top - box.top + 1;
    var rx = rb.left + rb.width / 2 - box.left, ry = rb.top - box.top + 1;

    /* On a narrow screen the two buttons stack (.btns goes one column at 480px),
       so there is nothing to fork out to — a fork just draws a second vertical
       line straight through the top button. Stacked, it is ONE line instead:
       the wave up top, then straight down and finishing at the lower (macOS)
       button. The download buttons centre their icon+label, so their left
       third is empty — the descent runs down THAT band, clear of every glyph,
       rather than through the middle of the Windows label. */
    var stacked = rb.top - lb.top > lb.height * 0.6;
    var colX = stacked
      ? lb.left - box.left + Math.min(lb.width * 0.12, 46)
      : (lx + rx) / 2;

    /* ── The shape ────────────────────────────────────────────────────────────
       ONE rule governs the whole thing: every join is vertical. The "h" ends
       with its right leg pointing straight down, so the ink leaves straight
       down. It arrives at the belly straight down, leaves it straight down,
       and arrives at the fork straight down — and BOTH branches leave the fork
       straight down too, then arrive at their button straight down.

       That is what makes it read as one smooth line rather than a folded one:
       matching tangents on both sides of every join means no cusp anywhere,
       the split is tangent to the trunk (a separation, not a V), and each end
       meets the button edge square-on instead of grazing it. It also makes a
       crossing impossible — nothing ever doubles back past the fork. */
    var fx = colX;                                   // trunk foot: fork centre, or the stacked descent band
    var top = Math.min(ly, ry);
    var fy = sy + (top - sy) * 0.70;                 // fork, 70% of the way down
    var drop = fy - sy;
    var gap = rx - lx;

    // belly, thrown left of the fork. Normally a fraction of the button gap;
    // stacked, that gap is ~0, so use a fixed offset to keep the wave visible.
    var bx = fx - (stacked ? Math.min(box.width * 0.14, 64) : gap * 0.42);
    var by = sy + drop * 0.55;
    var t1 = drop * 0.30;                            // h → belly tangent
    var t2 = drop * 0.24;                            // belly → fork tangent

    trunk.setAttribute("d",
      "M " + r(sx) + " " + r(sy) +
      " C " + r(sx) + " " + r(sy + t1) +             // straight down out of the "h"
      " "   + r(bx) + " " + r(by - t1) +             // straight down into the belly
      " "   + r(bx) + " " + r(by) +
      " C " + r(bx) + " " + r(by + t2) +             // straight down out of the belly
      " "   + r(fx) + " " + r(fy - t2) +             // straight down into the fork
      " "   + r(fx) + " " + r(fy)
    );

    /* Both branches leave the fork on the SAME vertical tangent the trunk
       arrived on, so for the first few pixels they lie on top of each other
       and then ease apart — the line separating, rather than two lines meeting
       at an angle. Each lands vertically on its button's top edge. */
    var h = top - fy;
    function branch(ex, ey) {
      return cubic(
        fx, fy,
        fx, fy + h * 0.48,
        ex, ey - h * 0.36,
        ex, ey
      );
    }
    if (stacked) {
      // One line: straight down the empty left band, past the Windows button,
      // landing on the top edge of the macOS button in that same band.
      forkL.setAttribute("d", "");
      forkR.setAttribute("d",
        "M " + r(colX) + " " + r(fy) +
        " C " + r(colX) + " " + r(fy + (ry - fy) * 0.5) +
        " "   + r(colX) + " " + r(ry - (ry - fy) * 0.2) +
        " "   + r(colX) + " " + r(ry)
      );
    } else {
      forkL.setAttribute("d", branch(lx, ly));
      forkR.setAttribute("d", branch(rx, ry));
    }
  }

  /* The line's start is measured off the rendered text, so it has to be
     re-measured whenever that text moves — most importantly when Fraunces
     finishes loading and the heading reflows. Without this the start sits
     wherever the fallback font put the baseline (measured: 12px high). */
  function watchLayout(fn) {
    if (!window.ResizeObserver) return;
    var ro = new ResizeObserver(function () { fn(); });
    ro.observe(walk);
    var lineEl = walk.querySelector(".walk-line");
    if (lineEl) ro.observe(lineEl);
    var btns = walk.querySelector(".btns");
    if (btns) ro.observe(btns);
  }


  if (reduce) {
    shape();
    watchLayout(shape);
    walk.style.setProperty("--draw", "100");
    return;
  }

  /* ── The sequence ─────────────────────────────────────────────────────────
     One timeline, not two: the heading crosses in left→right, and the instant
     the sweep's edge clears the "h" of "path", the ink starts at that same
     pixel and runs down. The handover has to be exact — a fixed delay was only
     ever a guess — so hClearDelay() solves for it from the mask's own geometry
     and the measured position of the "h" in the line.

     This used to be scroll-scrubbed. It is a plain timed play now: the whole
     thing lasts under two seconds, and tying it to the scrollbar meant it ran
     while the reader was looking somewhere else, so it read as "no animation".
     The ease-out on the draw keeps the glide-to-a-stop that the lag gave. */
  var SWEEP_MS = 900;   // must match .walk-line.sweep in landing.css
  var DRAW_MS = 1500;

  function hClearDelay() {
    /* .walk-line.sweep masks the heading with a 280%-wide gradient that is
       opaque to 42% of its own width, slid from mask-position 100% to 0%
       linearly. In element widths: the mask's left edge sits at (1 - 2.8)·P
       and its opaque edge therefore at 1.176 - 1.8·P. The "h" is inked once
       that edge passes it. */
    var lineBox = walkLine.getBoundingClientRect();
    var hBox = (hTip || hSpan).getBoundingClientRect();
    var hf = lineBox.width ? (hBox.right - lineBox.left) / lineBox.width : 1;
    var p = (1.176 - hf) / 1.8;
    if (!(p >= 0)) p = 0;
    if (p > 1) p = 1;
    return (1 - p) * SWEEP_MS;
  }

  var drawing = false;
  function runDraw() {
    if (drawing) return;
    drawing = true;
    var t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      var t = Math.min(1, (now - t0) / DRAW_MS);
      var e = 1 - Math.pow(1 - t, 3);      // ease-out: quick away, glides to rest
      walk.style.setProperty("--draw", (e * 100).toFixed(2));
      if (t < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  function relayout() { shape(); }

  var played = false;
  function play() {
    if (played) return;
    played = true;
    shape();
    walkLine.classList.add("sweep");
    window.setTimeout(runDraw, hClearDelay());
  }

  if (walkLine && "IntersectionObserver" in window) {
    var lineIO = new IntersectionObserver(function (e) {
      if (!e[0].isIntersecting) return;
      lineIO.disconnect();
      play();
    }, { threshold: 0.6 });
    lineIO.observe(walkLine);
  } else {
    walk.style.setProperty("--draw", "100");
  }

  window.addEventListener("resize", relayout);
  window.addEventListener("load", relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  watchLayout(relayout);
  relayout();
})();

/* landing.js part 3 — "Try it": a working miniature of Notealise.
   The SPACES are the presets: each carries its own look and its own notes, the
   way a real space does. The controls beneath them tweak whichever space you
   are in. Nothing persists — reload and it is back to Journal.

   Colour values are the app's own (src/renderer/src/theme.css): the light and
   dark ramps live in landing.css, the hl/tc palette is here. */
(function () {
  var app = document.getElementById("tryApp");
  if (!app) return;
  var note = document.getElementById("nlNote");
  var tree = document.getElementById("nlTree");
  var tab = document.getElementById("nlTab");
  var pathEl = document.getElementById("nlPath");
  var spacesEl = document.getElementById("nlSpaces");
  var ctlEl = document.getElementById("nlControls");
  if (!note || !tree || !tab || !pathEl || !spacesEl || !ctlEl) return;

  var FONT = {
    serif: '"Fraunces", Georgia, serif',
    sans: '"Inter", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, Menlo, monospace'
  };
  var DENSITY = { roomy: "1.9", normal: "1.65", tight: "1.42" };

  /* The accent, modelled the way the app does it TODAY (settings/model.ts's
     applyAccent, re-copied 2026-09-13). An accent is a HUE; the mode decides
     how far it reaches:
       text  — "Just the writing takes the colour." The accent becomes a
               TEXT colour for headings and note titles (--ink-acc-*) and the
               on-state of the controls (--accent-*). The note's own body stays
               the theme's ink.
       tint  — "Surfaces and controls take it too." The whole ramp: page,
               sidebar, controls, plus a light tint through the ink.
     The demo used to paint the ENTIRE ink ramp in text mode, body included, at
     low saturation — every word went a muddy olive/khaki. That was an old copy
     of the app; the app stopped doing it (model.ts: "Painting the ramp
     unconditionally is what made picking a colour turn every word in the app
     that colour, which is the thing this replaced"). Reuben, 2026-09-13: "the
     accent of the actual simulation doesn't look good". */
  var HUE = { none: null, amber: 40, sage: 140, sky: 205, violet: 273, rose: 342 };

  /* The one place a tint's on-screen colour is defined — the swatch and the
     ink line in the ending both read it. The app palette's own hand-tuned hexes
     (src/shared/palette.ts): one hsl() formula for every hue was what made the
     green and violet swatches read neon next to amber, and the app tunes each
     by eye for exactly that reason. */
  var HEX = { amber: "#d7a542", sage: "#4ab56e", sky: "#4ba0dd", violet: "#b283d8", rose: "#d7708f" };
  function tintColour(tint) { return HEX[tint] || "transparent"; }

  // model.ts TEXT_RAMP, written to --ink-acc-* in both modes
  var ACC_INK = {
    light: { "--ink-acc-900": [62, 26], "--ink-acc-700": [52, 38], "--ink-acc-400": [34, 60] },
    dark:  { "--ink-acc-900": [56, 82], "--ink-acc-700": [48, 70], "--ink-acc-400": [36, 46] }
  };
  // model.ts LIGHT_RAMP / DARK_RAMP — Tinted mode
  var TINT_RAMP = {
    light: {
      "--paper": [34, 97.5], "--surface": [30, 99.6],
      "--brand-200": [36, 85], "--brand-300": [30, 70], "--brand-400": [38, 54],
      "--brand-500": [46, 42], "--brand-600": [60, 25],
      "--ink-900": [16, 12], "--ink-800": [15, 18], "--ink-700": [13, 28],
      "--ink-500": [11, 47], "--ink-400": [10, 57], "--ink-300": [10, 66]
    },
    dark: {
      "--paper": [26, 3.5], "--surface": [20, 9],
      "--brand-200": [26, 17], "--brand-300": [24, 30], "--brand-400": [30, 39],
      "--brand-500": [46, 56], "--brand-600": [72, 73],
      "--ink-900": [13, 86], "--ink-800": [12, 80], "--ink-700": [11, 73],
      "--ink-500": [9, 56], "--ink-400": [9, 47], "--ink-300": [8, 39]
    }
  };
  // model.ts ACCENT_KEYS: the on-state colour, read from the tinted ramp in both modes
  var ACCENT_FROM = { "--accent-400": "--brand-400", "--accent-500": "--brand-500", "--accent-600": "--brand-600" };
  // the marks in the writing — the app's --hl-NAME / --tc-NAME (theme.css)
  var HL = {
    light: { amber: "hsl(40 90% 85%)", sage: "hsl(140 55% 83%)", sky: "hsl(205 88% 86%)", violet: "hsl(273 72% 90%)", rose: "hsl(342 88% 90%)" },
    dark:  { amber: "hsl(40 48% 30%)", sage: "hsl(140 38% 27%)", sky: "hsl(205 52% 32%)", violet: "hsl(273 40% 38%)", rose: "hsl(342 44% 34%)" }
  };
  var TC = {
    light: { amber: "hsl(40 62% 38%)", sage: "hsl(140 46% 36%)", sky: "hsl(205 72% 42%)", violet: "hsl(273 52% 54%)", rose: "hsl(342 62% 48%)" },
    dark:  { amber: "hsl(40 78% 66%)", sage: "hsl(140 52% 64%)", sky: "hsl(205 82% 70%)", violet: "hsl(273 72% 78%)", rose: "hsl(342 78% 74%)" }
  };
  var CLEAR = ["--paper", "--surface", "--brand-200", "--brand-300", "--brand-400", "--brand-500",
               "--brand-600", "--ink-900", "--ink-800", "--ink-700", "--ink-500", "--ink-400",
               "--ink-300", "--ink-acc-900", "--ink-acc-700", "--ink-acc-400",
               "--accent-400", "--accent-500", "--accent-600", "--hl", "--tc"];

  // hsl -> "R G B" channels, because the app's tokens are bare channel triples
  function channels(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    };
    return f(0) + " " + f(8) + " " + f(4);
  }

  function applyAccent(el, tint, mode, theme) {
    for (var i = 0; i < CLEAR.length; i++) el.style.removeProperty(CLEAR[i]);
    var hue = HUE[tint];
    if (hue == null) return;
    var k, acc = ACC_INK[theme], ramp = TINT_RAMP[theme];
    for (k in acc) if (acc.hasOwnProperty(k)) el.style.setProperty(k, channels(hue, acc[k][0], acc[k][1]));
    for (k in ACCENT_FROM) {
      if (!ACCENT_FROM.hasOwnProperty(k)) continue;
      var stop = ramp[ACCENT_FROM[k]];
      el.style.setProperty(k, channels(hue, stop[0], stop[1]));
    }
    if (mode === "tint") {
      for (k in ramp) if (ramp.hasOwnProperty(k)) el.style.setProperty(k, channels(hue, ramp[k][0], ramp[k][1]));
    }
    el.style.setProperty("--hl", HL[theme][tint]);
    el.style.setProperty("--tc", TC[theme][tint]);
  }

  /* Each space: its look and its notes. Picking a space picks a whole look —
     that is what a space IS — and the rows under it open like real notes. */
  var SPACES = {
    journal: {
      name: "Journal",
      look: { font: "serif", density: "roomy", theme: "light", tint: "none", accentMode: "text", paper: "lined" },
      open: 0,
      notes: [
        {
          t: "Tuesday",
          s: "The market had the good bread again.",
          html:
            "<h4>Tuesday</h4>" +
            "<p>The market had the good bread again. Walked back the long way, past the " +
            "allotments, and got in later than I meant to.</p>" +
            "<p>Started the book Sam lent me. Slow, but the kind of slow that is going " +
            "somewhere.</p>" +
            "<p>Tomorrow: ring the dentist, actually.</p>"
        },
        {
          t: "Things to stop doing",
          s: "1. Refreshing the same three tabs",
          html:
            "<h4>Things to stop doing</h4>" +
            "<ul><li>Refreshing the same three tabs</li>" +
            "<li>Saying yes on a Friday to a Monday</li>" +
            "<li>Buying notebooks instead of writing in them</li></ul>" +
            "<p>Kept honestly, this list would be longer. Revisit in a month and see " +
            "which of them stuck.</p>"
        },
        {
          t: "Garden log",
          s: "Tomatoes in, finally. Slugs winning.",
          html:
            "<h4>Garden log</h4>" +
            "<p>Tomatoes in, finally — three weeks later than last year. The slugs are " +
            "still winning on the lettuce.</p>" +
            "<p>Note for next spring: start them off indoors in <mark>early March</mark>, " +
            "not April.</p>"
        }
      ]
    },
    research: {
      name: "Research",
      look: { font: "sans", density: "tight", theme: "dark", tint: "sky", accentMode: "tint", paper: "grid" },
      open: 0,
      notes: [
        {
          t: "Sleep and memory",
          s: "Six papers, two disagree",
          html:
            "<h4>Sleep and memory</h4>" +
            "<p>Working question: <mark>does a short nap help recall as much as a full " +
            "night?</mark></p>" +
            "<ul><li><span class=\"tc\">Finding</span> — five of six papers say yes</li>" +
            "<li><span class=\"tc\">Caveat</span> — small samples</li>" +
            "<li><span class=\"tc\">Gap</span> — nobody over sixty</li></ul>" +
            "<p>Progress: <code>6 read · 3 to go</code></p>"
        },
        {
          t: "Interview — P4",
          s: "Transcript, first pass",
          html:
            "<h4>Interview — P4</h4>" +
            "<p>Forty minutes. Naps most days, but <mark>only when the week is going " +
            "badly</mark> — worth asking the others about.</p>" +
            "<ul><li>Sleeps less before deadlines, not more</li>" +
            "<li>Remembers lectures better after a nap, “or thinks they do”</li>" +
            "<li>Happy to do a follow-up in March</li></ul>" +
            "<p>Code it against the <span class=\"tc\">themes so far</span> tomorrow.</p>"
        },
        {
          t: "Open questions",
          s: "Does it change with age?",
          html:
            "<h4>Open questions</h4>" +
            "<ul><li>Does the effect shrink with age, or just the number of studies?</li>" +
            "<li>Is a 20-minute nap different from a 90-minute one?</li>" +
            "<li>Why do <span class=\"tc\">Paper 2</span> and <span class=\"tc\">Paper 5</span> disagree?</li></ul>" +
            "<p>Bring the <mark>first two</mark> to supervision on Thursday.</p>"
        }
      ]
    },
    work: {
      name: "Work",
      look: { font: "mono", density: "normal", theme: "light", tint: "sage", accentMode: "text", paper: "none" },
      open: 0,
      notes: [
        {
          t: "Release notes",
          s: "Draft for the next version",
          html:
            "<h4>Release notes</h4>" +
            "<p>Draft. Keep it plain — people read these to find out whether the thing " +
            "they reported got fixed.</p>" +
            "<ul><li>Import now lands in its own space</li>" +
            "<li><mark>Fixed</mark>: colours dropping on paste</li>" +
            "<li>Faster first open on a large folder</li></ul>" +
            "<p>Check against <span class=\"tc\">the open issues</span> before publishing.</p>"
        },
        {
          t: "Meeting — Thursday",
          s: "Agenda and the three open questions",
          html:
            "<h4>Meeting — Thursday</h4>" +
            "<p>Agenda, in order of how long they will actually take:</p>" +
            "<ul><li>Sign-off on the release — ten minutes</li>" +
            "<li>What we are cutting — <mark>the whole rest of it</mark></li></ul>" +
            "<p>Open questions: who owns the docs, do we hold for the signing, and is " +
            "anyone actually using the old export.</p>"
        },
        {
          t: "Ideas",
          s: "Half-formed, kept anyway",
          html:
            "<h4>Ideas</h4>" +
            "<p>Half-formed. Kept anyway, because the useful ones never look useful on " +
            "the day you write them down.</p>" +
            "<ul><li>A view that only shows what changed this week</li>" +
            "<li>Templates, but without the ceremony</li>" +
            "<li><span class=\"tc\">Something</span> for reading long PDFs alongside a note</li></ul>"
        }
      ]
    }
  };

  var current = "journal";
  var look = clone(SPACES.journal.look);
  var autoRunning = false;   // the phone demo playing itself (below)

  function clone(o) { var t = {}; for (var k in o) if (o.hasOwnProperty(k)) t[k] = o[k]; return t; }
  function icon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v5h5"/></svg>';
  }

  /* Lined paper: each rule should sit just under the letters, and where the
     letters sit inside a line depends on the font. A zero-size marker in the
     first line finds its baseline; how far that is from the middle of the line
     is fixed for a font, so it is right even while the spacing animates. The
     rule then goes 0.3em below the baseline, clear of descenders. */
  var scrollEl = app.querySelector(".nl-scroll");
  function ruleShift() {
    if (!scrollEl || look.paper !== "lined") return;
    var first = note.querySelector("p, li");
    if (!first) return;
    var mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    first.insertBefore(mark, first.firstChild);
    var cs = window.getComputedStyle(first);
    var fromMiddle = (mark.getBoundingClientRect().top - first.getBoundingClientRect().top) - parseFloat(cs.lineHeight) / 2;
    first.removeChild(mark);
    var rule = 17 * parseFloat(DENSITY[look.density] || DENSITY.normal);
    scrollEl.style.setProperty("--rule-shift", (fromMiddle - rule / 2 + parseFloat(cs.fontSize) * 0.3).toFixed(2) + "px");
  }

  function paint() {
    var sp = SPACES[current];
    var mode = look.theme === "dark" ? "dark" : "light";

    app.setAttribute("data-theme", mode);
    app.setAttribute("data-paper", look.paper || "none");
    app.style.setProperty("--nl-font", FONT[look.font] || FONT.serif);
    app.style.setProperty("--nl-lh", DENSITY[look.density] || DENSITY.normal);
    applyAccent(app, look.tint, look.accentMode, mode);

    // sidebar note list for this space; the open one is highlighted
    var out = "";
    for (var i = 0; i < sp.notes.length; i++) {
      var n = sp.notes[i];
      out += '<button type="button" class="nl-row' + (i === sp.open ? " on" : "") +
             '" data-note="' + i + '">' + icon() +
             "<span><b>" + n.t + "</b><em>" + n.s + "</em></span></button>";
    }
    tree.innerHTML = out;

    var openNote = sp.notes[sp.open];
    note.innerHTML = openNote.html;
    ruleShift();
    tab.textContent = openNote.t;
    pathEl.innerHTML = sp.name + " &rsaquo; " + openNote.t;

    // reflect state
    var sb = spacesEl.querySelectorAll("[data-space]");
    for (var j = 0; j < sb.length; j++) {
      sb[j].classList.toggle("on", sb[j].getAttribute("data-space") === current);
    }
    var cb = ctlEl.querySelectorAll("button[data-set]");
    for (var k = 0; k < cb.length; k++) {
      cb[k].classList.toggle("on", String(look[cb[k].getAttribute("data-set")]) === cb[k].getAttribute("data-val"));
    }

    // the ending picks up whatever look they leave it in — a look THEY chose,
    // so not while the demo is playing itself
    if (autoRunning) return;
    var root = document.documentElement;
    root.setAttribute("data-carry-theme", mode);
    root.setAttribute("data-carry-accent", look.tint);
    root.style.setProperty("--carry-accent", tintColour(look.tint));
  }

  spacesEl.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-space]");
    if (!b) return;
    current = b.getAttribute("data-space");
    look = clone(SPACES[current].look);   // a space carries its own look
    paint();
  });

  tree.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-note]");
    if (!b) return;
    SPACES[current].open = +b.getAttribute("data-note");
    paint();
  });

  ctlEl.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button[data-set]");
    if (!b) return;
    look[b.getAttribute("data-set")] = b.getAttribute("data-val");
    paint();
  });

  // paint the tint swatches from the same palette the note uses
  var sw = ctlEl.querySelectorAll('[data-set="tint"]');
  for (var s = 0; s < sw.length; s++) {
    var v = sw[s].getAttribute("data-val");
    sw[s].style.setProperty("--sw", tintColour(v));
  }

  /* Phone held upright: the sidebar stacks above the note, and the controls
     move into ONE glass panel (.nl-strip in landing.css) pinned to the top of
     the note, every setting on show at once (Reuben, 2026-09-13: "one intuitive
     dashboard kind of control room" — it replaced tabs that showed one tool at
     a time). The click handler above is bound to ctlEl itself, so moving the
     element keeps every control working. Sideways and desktop put it back in
     the sidebar. */
  var side = app.querySelector(".nl-side");
  var main = app.querySelector(".nl-main");
  var upright = window.matchMedia("(max-width: 62rem) and (orientation: portrait)");
  var strip = document.createElement("div");
  strip.className = "nl-strip";
  strip.setAttribute("role", "group");
  strip.setAttribute("aria-label", "Customise this space");

  function placeControls() {
    if (upright.matches) {
      strip.appendChild(ctlEl);
      if (strip.parentNode !== main) main.insertBefore(strip, main.firstChild);
    } else if (ctlEl.parentNode !== side) {
      side.appendChild(ctlEl);
      if (strip.parentNode) strip.parentNode.removeChild(strip);
    }
  }
  placeControls();
  if (upright.addEventListener) upright.addEventListener("change", placeControls);
  else if (upright.addListener) upright.addListener(placeControls);

  /* Upright, the note area is only a little taller than the roomiest look
     needs (Reuben, 2026-09-15: "only a bit larger than the roomiest look, we
     don't need unnecessary scrolling area"). The note each space opens on (the
     only one reachable upright, where the note list is hidden) is measured
     off-screen at the note area's width, at Roomy, in each typeface,
     on lined paper and not — lined adds a blank rule between paragraphs — and
     the tallest sets the height. So the window stays one height while the demo
     switches looks, with no empty paper under the note. */
  var FIT_EXTRA = 20;
  var measurer = null;
  function fitHeight() {
    if (!scrollEl) return;
    if (!upright.matches) { scrollEl.style.minHeight = ""; return; }
    var width = scrollEl.clientWidth;
    if (!width) return;
    if (!measurer) {
      measurer = document.createElement("div");
      measurer.className = "nl nl-measure";
      measurer.setAttribute("aria-hidden", "true");
      measurer.innerHTML = '<div class="nl-scroll"><article class="nl-note"></article></div>';
      document.body.appendChild(measurer);
    }
    measurer.firstChild.style.width = width + "px";
    measurer.style.setProperty("--nl-lh", DENSITY.roomy);
    var mNote = measurer.querySelector(".nl-note");
    var tallest = 0;
    for (var key in SPACES) {
      if (!SPACES.hasOwnProperty(key)) continue;
      mNote.innerHTML = SPACES[key].notes[SPACES[key].open].html;
      for (var f in FONT) {
        if (!FONT.hasOwnProperty(f)) continue;
        measurer.style.setProperty("--nl-font", FONT[f]);
        measurer.setAttribute("data-paper", "none");
        tallest = Math.max(tallest, mNote.getBoundingClientRect().height);
        measurer.setAttribute("data-paper", "lined");
        tallest = Math.max(tallest, mNote.getBoundingClientRect().height);
      }
    }
    scrollEl.style.minHeight = Math.ceil(tallest + FIT_EXTRA) + "px";
  }
  var fitQueued = false;
  function queueFit() {
    if (fitQueued) return;
    fitQueued = true;
    window.requestAnimationFrame(function () { fitQueued = false; fitHeight(); });
  }
  window.addEventListener("resize", queueFit);
  if (upright.addEventListener) upright.addEventListener("change", queueFit);
  else if (upright.addListener) upright.addListener(queueFit);

  paint();
  fitHeight();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { ruleShift(); fitHeight(); });

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var wrap = app.parentNode;
  if (!wrap || !wrap.classList.contains("nl-wrap")) return;

  /* Full screen when you reach it (Reuben, 2026-09-14: Try it stays at 05 and
     takes over the screen). One-way, like the reveals: once the window is
     properly in view it grows edge to edge (landing.css .is-full) and stays. */
  if (reduceMotion || !("IntersectionObserver" in window)) {
    wrap.classList.add("is-full");
  } else {
    var fullIo = new IntersectionObserver(function (entries) {
      for (var n = 0; n < entries.length; n++) {
        if (!entries[n].isIntersecting) continue;
        wrap.classList.add("is-full");
        fullIo.disconnect();
      }
    }, { threshold: 0.35 });
    fullIo.observe(wrap);
  }

  /* Plays itself on phones until touched (Reuben, 2026-09-14). It presses the
     real buttons, so everything it shows is what a tap would do; each press
     gets a brief ring first so a watcher can follow it. It only runs while the
     demo is on screen, and the first real tap anywhere on it hands over for
     good. Programmatic clicks are not "trusted", which is how a real tap is
     told apart from the demo's own. */
  var autoEl = document.getElementById("nlAuto");
  var handsOff = window.matchMedia && window.matchMedia("(hover: none), (max-width: 62rem)").matches;
  if (!autoEl || !handsOff || reduceMotion || !("IntersectionObserver" in window)) return;

  var STEPS = [
    '[data-space="research"]',
    '[data-set="paper"][data-val="dots"]',
    '[data-set="font"][data-val="serif"]',
    '[data-set="theme"][data-val="light"]',
    '[data-set="tint"][data-val="rose"]',
    '[data-space="work"]',
    '[data-set="paper"][data-val="lined"]',
    '[data-set="accentMode"][data-val="tint"]',
    '[data-set="theme"][data-val="dark"]',
    '[data-set="density"][data-val="roomy"]',
    '[data-space="journal"]',
    '[data-set="tint"][data-val="sky"]',
    '[data-set="paper"][data-val="grid"]',
    '[data-set="font"][data-val="mono"]',
    '[data-space="journal"]'
  ];
  var PRESS_MS = 420, EVERY_MS = 1800;
  var step = 0, timer = 0, visible = false;
  autoRunning = true;
  autoEl.hidden = false;

  function press() {
    timer = 0;
    if (!autoRunning || !visible) return;
    var btn = app.querySelector(STEPS[step % STEPS.length]);
    step++;
    if (btn) {
      btn.classList.add("nl-press");
      window.setTimeout(function () {
        btn.classList.remove("nl-press");
        if (autoRunning) btn.click();
      }, PRESS_MS);
    }
    timer = window.setTimeout(press, EVERY_MS);
  }
  var seenIo = new IntersectionObserver(function (entries) {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible && !timer) timer = window.setTimeout(press, 900);
    if (!visible && timer) { window.clearTimeout(timer); timer = 0; }
  }, { threshold: 0.3 });
  seenIo.observe(app);

  function takeOver(e) {
    if (e && e.isTrusted === false) return;
    autoRunning = false;
    paint();   // the tap that took over was applied while the demo still ran; carry it to the ending now
    if (timer) window.clearTimeout(timer);
    seenIo.disconnect();
    wrap.removeEventListener("click", takeOver);
    wrap.removeEventListener("keydown", takeOver);
    autoEl.classList.add("is-done");
    window.setTimeout(function () { autoEl.hidden = true; }, 450);
  }
  wrap.addEventListener("click", takeOver);
  wrap.addEventListener("keydown", takeOver);
})();


/* ── 4. Pick your paper ────────────────────────────────────────────────────
   The 03 sample: paper buttons swap the page's look, the dots wash a colour
   under it. The washes are the app palette's own hexes at a light strength. */
(function () {
  var page = document.getElementById("paperPage");
  if (!page) return;
  var root = page.parentNode;
  var WASH = { amber: "215 165 66", sage: "74 181 110", sky: "75 160 221", rose: "215 112 143" };
  var looks = root.querySelectorAll("[data-look]:not(.paper-page)");
  var washes = root.querySelectorAll("[data-wash]");
  for (var i = 0; i < washes.length; i++) {
    var w = washes[i].getAttribute("data-wash");
    if (WASH[w]) washes[i].style.setProperty("--sw", "rgb(" + WASH[w] + ")");
  }
  function mark(list, on) { for (var j = 0; j < list.length; j++) list[j].classList.toggle("on", list[j] === on); }
  root.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-look")) {
      page.setAttribute("data-look", b.getAttribute("data-look"));
      mark(looks, b);
    } else if (b.hasAttribute("data-wash")) {
      var v = WASH[b.getAttribute("data-wash")];
      page.style.setProperty("--wash", v ? "rgb(" + v + " / 0.12)" : "transparent");
      mark(washes, b);
    }
  });
})();


/* ── 5. Research vs Journal ─────────────────────────────────────────────────
   01's slider. --pos on the stage is how much of the Research look shows,
   from the left. Pointer drags anywhere on the picture move it; the range
   input (invisible, keyboard-focusable) carries the arrow keys and tells
   screen readers what it is. Starts at 25% (Reuben, 2026-09-14). */
(function () {
  var stage = document.getElementById("compare");
  if (!stage) return;
  var range = stage.querySelector(".compare-range");
  var dragging = false;

  function set(pct) {
    pct = Math.max(0, Math.min(100, pct));
    stage.style.setProperty("--pos", pct + "%");
    if (range) range.value = String(Math.round(pct));
  }
  function fromX(clientX) {
    var r = stage.getBoundingClientRect();
    if (r.width) set(((clientX - r.left) / r.width) * 100);
  }

  stage.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging = true;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    fromX(e.clientX);
  });
  stage.addEventListener("pointermove", function (e) { if (dragging) fromX(e.clientX); });
  function stop() { dragging = false; }
  stage.addEventListener("pointerup", stop);
  stage.addEventListener("pointercancel", stop);
  stage.addEventListener("lostpointercapture", stop);

  if (range) range.addEventListener("input", function () { set(+range.value); });
})();

