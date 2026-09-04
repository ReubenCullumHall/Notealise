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

  function heroSettle() {
    if (spent) return;
    spent = true;
    release();
    var running = document.getAnimations();
    for (var i = 0; i < running.length; i++) {
      var a = running[i];
      var target = a.effect && a.effect.target;
      if (!target || !hero.contains(target)) continue;
      var t = a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (!t) continue;
      if (t.iterations === Infinity) continue;      // loops forever, can't finish
      if (!(t.endTime <= 9000)) continue;           // ambient, not an entrance
      try { a.finish(); } catch (e) {}              // already done, or unresolved
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
    var fx = (lx + rx) / 2;                          // dead centre of the buttons
    var top = Math.min(ly, ry);
    var fy = sy + (top - sy) * 0.70;                 // fork, 70% of the way down
    var drop = fy - sy;
    var gap = rx - lx;

    var bx = fx - gap * 0.42;                        // belly, left of the fork
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
    forkL.setAttribute("d", branch(lx, ly));
    forkR.setAttribute("d", branch(rx, ry));
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

  /* The accent, modelled the way the app does it (settings/model.ts's
     applyAccent). An accent is a HUE; the mode picks which ramp that hue is
     written through:
       text  — TEXT_RAMP: only the ink tokens take it, so just the writing
               is coloured ("Just the writing takes the colour.")
       tint  — the full RAMP: brand and surface tokens take it too, so the
               sidebar, chrome and page shift with it ("Surfaces and controls
               take it too.")
     Hues are the app's own eight named colours (theme.css). Each entry is
     [saturation, lightness] for that token, exactly the shape model.ts uses. */
  var HUE = { none: null, amber: 40, sage: 140, sky: 205, violet: 273, rose: 342 };

  /* The one place a tint's on-screen colour is defined. The swatch in the
     controls and the ink line in the ending both read from this, so the line
     is exactly the colour the reader pointed at — no second, approximate
     value that drifts from the swatch. */
  function tintColour(tint) {
    var h = HUE[tint];
    return h == null ? "transparent" : "hsl(" + h + " 62% 52%)";
  }

  var TEXT_RAMP = {
    light: { "--ink-900": [26, 16], "--ink-700": [22, 30], "--ink-500": [18, 46], "--ink-400": [15, 57] },
    dark:  { "--ink-900": [30, 84], "--ink-700": [26, 74], "--ink-500": [20, 58], "--ink-400": [18, 49] }
  };
  var FULL_RAMP = {
    light: {
      "--paper": [40, 96.5], "--surface": [46, 99],
      "--brand-200": [26, 85], "--brand-400": [22, 60], "--brand-500": [26, 44], "--brand-600": [32, 22],
      "--ink-900": [26, 16], "--ink-700": [22, 30], "--ink-500": [18, 46], "--ink-400": [15, 57]
    },
    dark: {
      "--paper": [48, 6], "--surface": [38, 11],
      "--brand-200": [28, 21], "--brand-400": [24, 39], "--brand-500": [28, 58], "--brand-600": [32, 84],
      "--ink-900": [30, 84], "--ink-700": [26, 74], "--ink-500": [20, 58], "--ink-400": [18, 49]
    }
  };
  var RAMP_KEYS = ["--paper", "--surface", "--brand-200", "--brand-400", "--brand-500",
                   "--brand-600", "--ink-900", "--ink-700", "--ink-500", "--ink-400"];

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
    for (var i = 0; i < RAMP_KEYS.length; i++) el.style.removeProperty(RAMP_KEYS[i]);
    var hue = HUE[tint];
    if (hue == null) { el.style.removeProperty("--hl"); el.style.removeProperty("--tc"); return; }
    var ramp = (mode === "text" ? TEXT_RAMP : FULL_RAMP)[theme];
    for (var k in ramp) {
      if (ramp.hasOwnProperty(k)) el.style.setProperty(k, channels(hue, ramp[k][0], ramp[k][1]));
    }
    // the marks in the writing, from the same hue — the app's --hl-*/--tc-* pair
    el.style.setProperty("--hl", theme === "dark"
      ? "hsl(" + hue + " 46% 30%)" : "hsl(" + hue + " 82% 86%)");
    el.style.setProperty("--tc", theme === "dark"
      ? "hsl(" + hue + " 74% 68%)" : "hsl(" + hue + " 62% 42%)");
  }

  /* Each space: its look and its notes. Picking a space picks a whole look —
     that is what a space IS — and the rows under it open like real notes. */
  var SPACES = {
    journal: {
      name: "Journal",
      look: { font: "serif", density: "roomy", theme: "light", tint: "none", accentMode: "text" },
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
    study: {
      name: "Study",
      look: { font: "sans", density: "tight", theme: "dark", tint: "sky", accentMode: "tint" },
      open: 0,
      notes: [
        {
          t: "Photosynthesis",
          s: "Light-dependent reactions · Calvin cycle",
          html:
            "<h4>Photosynthesis</h4>" +
            "<p>Two stages. The <mark>light-dependent</mark> reactions happen in the " +
            "thylakoid membrane; the Calvin cycle happens in the stroma.</p>" +
            "<ul><li>Light hits chlorophyll → electrons excited</li>" +
            "<li>ATP and NADPH made</li>" +
            "<li>Both feed the <span class=\"tc\">Calvin cycle</span></li></ul>" +
            "<p>Overall: <code>6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂</code></p>"
        },
        {
          t: "Cell transport",
          s: "Diffusion, osmosis, active transport",
          html:
            "<h4>Cell transport</h4>" +
            "<p>Three ways things cross a membrane. The first two are free; the third " +
            "costs the cell energy.</p>" +
            "<ul><li><span class=\"tc\">Diffusion</span> — high to low, no ATP</li>" +
            "<li><span class=\"tc\">Osmosis</span> — water, down a water potential gradient</li>" +
            "<li><span class=\"tc\">Active transport</span> — low to high, <mark>needs ATP</mark></li></ul>" +
            "<p>Exam trap: osmosis is diffusion, but they want the word osmosis.</p>"
        },
        {
          t: "Past paper — June",
          s: "Q4 still not clicking",
          html:
            "<h4>Past paper — June</h4>" +
            "<p>Q4 still not clicking. It gives a graph of rate against light intensity " +
            "and asks what is limiting after the plateau.</p>" +
            "<p><mark>Answer: something other than light</mark> — CO₂ or temperature. " +
            "The plateau is the whole clue.</p>" +
            "<p>Redo Q4 and Q7 before Thursday.</p>"
        }
      ]
    },
    work: {
      name: "Work",
      look: { font: "mono", density: "normal", theme: "light", tint: "sage", accentMode: "text" },
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

  function clone(o) { var t = {}; for (var k in o) if (o.hasOwnProperty(k)) t[k] = o[k]; return t; }
  function icon() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h7l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M13 3v5h5"/></svg>';
  }

  function paint() {
    var sp = SPACES[current];
    var mode = look.theme === "dark" ? "dark" : "light";

    app.setAttribute("data-theme", mode);
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

    // the ending picks up whatever look they leave it in
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

  paint();
})();
