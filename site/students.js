/* Notealise for students — draft. Four small jobs:
   1. arrivals as you scroll, 2. the marker-stroke highlighters,
   3. the subject tabs in 01, 4. the flashcard in 03. */
(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 1. Arrivals. No JS or reduced motion: nothing is ever hidden.
  var items = document.querySelectorAll("[data-rv]");
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        // siblings arriving together are staggered a little
        var el = e.target, i = Array.prototype.indexOf.call(el.parentNode.children, el);
        el.style.transitionDelay = Math.min(i, 6) * 60 + "ms";
        el.classList.add("in"); io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.05 });
    items.forEach(function (el) { el.classList.add("rv"); io.observe(el); });
    // safety net: anything already on screen that the observer missed
    setInterval(function () {
      document.querySelectorAll(".rv:not(.in)").forEach(function (el) {
        if (el.getBoundingClientRect().top < innerHeight) el.classList.add("in");
      });
    }, 1200);
  }

  // 2. Marker strokes: wobbly edges and frayed ends, in each section's pen.
  // The stroke's body runs from y=45 to y=83 of its 100-high drawing; it is
  // squeezed to sit between the band's measured top and bottom (hover.js),
  // the same place as every other highlight on the site.
  function stroke(col, top, bottom) {
    var k = (bottom - top) / 38, ty = top - 45 * k;
    var d = "M3 48 C 30 44, 60 47, 100 45 S 170 43, 197 46 L 199 50 L 196 53 L 198 57 L 195 61" +
            " L 198 66 L 196 70 L 199 75 L 196 80 C 160 83, 120 81, 90 84 S 30 82, 4 85" +
            " L 6 80 L 2 76 L 5 71 L 1 66 L 4 61 L 1 56 L 4 52 Z";
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 100' preserveAspectRatio='none'>" +
              "<g transform='translate(0 " + ty.toFixed(2) + ") scale(1 " + k.toFixed(4) + ")'>" +
              "<path d='" + d + "' fill='" + col + "'/>" +
              "<path d='M8 52 C 60 50, 140 50, 192 52' stroke='" + col + "' stroke-width='3' opacity='.5' fill='none'/></g></svg>";
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }
  function paint() {
    document.querySelectorAll(".hl").forEach(function (el) {
      var probe = document.createElement("span");
      probe.style.color = "var(--hl-stroke)";
      el.appendChild(probe);
      var col = getComputedStyle(probe).color;
      probe.remove();
      var cs = getComputedStyle(el);
      var top = parseFloat(cs.getPropertyValue("--hl-top")) || 34;
      var bottom = parseFloat(cs.getPropertyValue("--hl-bottom")) || 81;
      el.style.setProperty("--marker", stroke(col, top, bottom));
    });
  }
  paint();
  window.addEventListener("hl-measured", paint);
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // 3. Subject tabs: each one swaps the paper, the typeface and the example.
  // One student's four subjects, and the rest of the page follows them: the
  // questions in 03 are these notes turned round, Physics is the Waves note
  // the pictures in 04 and 05 show (Reuben, 2026-10-15: "a running theme").
  // Every subject is a heading and five rows, each short enough to stay on
  // one line on the smallest phone, so all four notes are exactly the same
  // size and the paper never grows or shrinks between tabs (Reuben,
  // 2026-10-16: "make them all the same size"). A formula on its own takes
  // two rows.
  var SUBJECTS = {
    bio:     { look: "lined", font: "serif", h: "Cell structure",
               p: ["Mitochondria release energy.", "Ribosomes make proteins.", "The nucleus holds the DNA.", "Water moves in by osmosis.", "Plant cells also have a wall."] },
    // drawn with KaTeX like the app: $…$ in a line, $$…$$ on a line of its own
    maths:   { look: "graph", font: "sans", h: "Differentiation",
               p: ["The gradient at a point.", "If $y = x^2$, then", "$$\\frac{dy}{dx} = 2x$$", "Next: the chain rule."],
               plain: ["The gradient at a point.", "If y = x², then", "dy/dx = 2x", "", "Next: the chain rule."] },
    // the same Waves note the pictures in 04 and 05 come from
    physics: { look: "dots", font: "sans", h: "Waves",
               p: ["A wave carries energy.", "Wave speed: $v = f\\lambda$", "Frequency is in hertz (Hz).", "Sound waves are longitudinal.", "Next: Interference."],
               plain: ["A wave carries energy.", "Wave speed: v = fλ", "Frequency is in hertz (Hz).", "Sound waves are longitudinal.", "Next: Interference."] },
    // another script entirely, to show notes in any language (Reuben, 2026-10-15)
    korean:  { look: "grid", font: "sans", lang: "ko", h: "존댓말, polite speech",
               p: ["Add -요 to sound polite.", "안녕하세요. 반가워요.", "저는 학생이에요. I’m a student.", "감사합니다 is formal thanks.", "With friends, just 고마워."] }
  };
  function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
  function tex(src, display) {
    return window.katex.renderToString(src, { displayMode: display, throwOnError: false });
  }
  // one line of a note: a formula on a line of its own, or text with $…$ in it
  function line(t) {
    var m = /^\$\$([\s\S]+)\$\$$/.exec(t);
    if (m) return '<div class="st-math">' + tex(m[1], true) + "</div>";
    return "<p>" + t.split(/(\$[^$]+\$)/).map(function (part) {
      return /^\$[^$]+\$$/.test(part) ? tex(part.slice(1, -1), false) : esc(part);
    }).join("") + "</p>";
  }
  function body(s) {
    var rows = window.katex ? s.p : (s.plain || s.p);
    return rows.map(window.katex ? line : function (t) { return "<p>" + (esc(t) || "&nbsp;") + "</p>"; }).join("");
  }
  var page = document.getElementById("stPaper");
  // The paper is as tall as the tallest subject at this width, so switching
  // tabs never makes it grow or shrink (Reuben, 2026-10-15: "no UI element
  // resizing"). Each subject is laid out in an invisible copy to measure it.
  function fit() {
    if (!page) return;
    var tall = 0;
    Object.keys(SUBJECTS).forEach(function (k) {
      var s = SUBJECTS[k], c = page.cloneNode(true);
      c.removeAttribute("id"); c.classList.remove("swap");
      c.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;min-height:0;width:" + page.offsetWidth + "px";
      c.dataset.look = s.look; c.dataset.font = s.font;
      c.querySelector(".paper-h").textContent = s.h;
      c.querySelector("#stPaperBody").innerHTML = body(s);
      c.querySelector("#stPaperBody").removeAttribute("id");
      page.parentNode.appendChild(c);
      // its laid-out height, not its box on screen: the note is tilted, and a
      // tilted box is taller, which left extra space at the bottom
      tall = Math.max(tall, Math.ceil(parseFloat(getComputedStyle(c).height) - 0.01));
      c.remove();
    });
    page.style.minHeight = tall + "px";
  }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(fit);
  var ft; addEventListener("resize", function () { clearTimeout(ft); ft = setTimeout(fit, 150); });
  var tabs = document.querySelectorAll(".st-tabs button");
  function show(key) {
    var s = SUBJECTS[key]; if (!s || !page) return;
    tabs.forEach(function (b) { var on = b.dataset.subject === key; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    var swap = function () {
      page.dataset.look = s.look; page.dataset.font = s.font;
      if (s.lang) page.lang = s.lang; else page.removeAttribute("lang");
      document.getElementById("stPaperH").textContent = s.h;
      document.getElementById("stPaperBody").innerHTML = body(s);
      page.classList.remove("swap");
    };
    if (reduce) return swap();
    page.classList.add("swap"); setTimeout(swap, 180);
  }
  tabs.forEach(function (b) { b.addEventListener("click", function () { show(b.dataset.subject); }); });

  // 3b. Formulas in the revision questions, drawn like the app draws them
  // (the plain words inside stay if KaTeX hasn't loaded).
  if (window.katex) document.querySelectorAll("[data-tex]").forEach(function (el) {
    window.katex.render(el.dataset.tex, el, { throwOnError: false });
  });

  // 3c. Opening a question grows the card down over the gap below it; the
  // page around it never moves (Reuben, 2026-10-16: "it moves on top, not
  // tied into the structure"). The card's place on the page is held at its
  // starting size (the first question open). If opening every question would
  // run past the gap into the next section, the held size grows just enough
  // that it can't.
  var qs = document.querySelector(".st-qs"), qwrap = qs && qs.closest(".st-flip");
  function hold() {
    if (!qwrap) return;
    var ds = qwrap.querySelectorAll("details"), was = [];
    ds.forEach(function (d, i) { was.push(d.open); d.open = i === 0; });
    qwrap.style.height = "";
    var start = qwrap.offsetHeight;
    ds.forEach(function (d) { d.open = true; });
    var all = qwrap.offsetHeight;
    ds.forEach(function (d, i) { d.open = i === 0; });
    qwrap.style.height = start + "px";
    var sec = qwrap.closest("section"), next = sec && sec.nextElementSibling;
    while (next && next.tagName !== "SECTION") next = next.nextElementSibling;
    var firstThing = next && next.querySelector(".st-label, h2");
    if (firstThing) {
      var room = firstThing.getBoundingClientRect().top - qwrap.getBoundingClientRect().bottom - 24;
      if (all - start > room) qwrap.style.height = Math.ceil(all - room) + "px";
    }
    ds.forEach(function (d, i) { d.open = was[i]; });
  }
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(hold);
  var ht; addEventListener("resize", function () { clearTimeout(ht); ht = setTimeout(hold, 150); });

  // 4. The flashcard: click to open and shut.
  var flip = document.getElementById("stFlip");
  if (flip) flip.addEventListener("click", function () {
    var open = flip.getAttribute("aria-pressed") !== "true";
    flip.setAttribute("aria-pressed", open);
    var hint = document.querySelector(".st-hint");
    if (hint) hint.textContent = open ? "Tap again to shut it." : "Tap the card to open it.";
  });
})();
