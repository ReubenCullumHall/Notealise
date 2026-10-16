/* Home page — "Own your files": headlines type in letter by letter, then the
   key phrase is "selected"; the four hero numbers decode from noise. */
(function () {
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  var STEP = 26; // ms per letter — keep in step with home.css

  // Split every text node of a headline into letters, words kept unbreakable.
  document.querySelectorAll(".stop-title, .try h2").forEach(function (h) {
    var i = 0;
    h.setAttribute("aria-label", h.textContent.replace(/\s+/g, " ").trim());
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 1) return walk(n);
        if (n.nodeType !== 3) return;
        var frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); i++; return; }
          var w = document.createElement("span"); w.className = "w";
          for (var c = 0; c < part.length; c++) {
            var s = document.createElement("span"); s.className = "ch";
            s.textContent = part[c]; s.style.setProperty("--i", i++);
            w.appendChild(s);
          }
          frag.appendChild(w);
        });
        n.parentNode.replaceChild(frag, n);
      });
    })(h);
    h.classList.add("typed");
    h.style.setProperty("--type-end", (i * STEP + 120) + "ms");
  });

  // Hero numbers: scramble for a moment as each fact arrives, then settle.
  var GLYPHS = "01#$%&*+=<>/.:mdx";
  document.querySelectorAll(".hero-stats li").forEach(function (li) {
    var b = li.querySelector("b"); if (!b) return;
    var real = b.textContent, done = false;
    li.addEventListener("animationstart", function () {
      if (done) return; done = true;
      var t0 = performance.now(), DUR = 700;
      (function tick(t) {
        var k = Math.min(1, (t - t0) / DUR), out = "";
        for (var j = 0; j < real.length; j++) {
          out += (j / real.length < k) ? real[j] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
        }
        b.textContent = out;
        if (k < 1) requestAnimationFrame(tick); else b.textContent = real;
      })(t0);
    });
  });
})();

/* The stat row's two lines draw in once the tagline is done. Its last move is
   "constraint" squeezing from bold into italic (tl-squeeze in index.html), so
   that animation ending is the cue — measured off the tagline itself, not a
   clock, so a slow clip or the loading screen can't put them out of step. */
(function () {
  var root = document.documentElement;
  var row = document.querySelector(".hero-stats");
  var tag = document.getElementById("tagline");
  if (!row || !root.classList.contains("wm-motion")) return;
  var drawn = false;
  function draw() { if (drawn) return; drawn = true; requestAnimationFrame(function () { row.classList.add("lines-in"); }); }
  if (tag) tag.addEventListener("animationend", function (e) { if (e.animationName === "tl-squeeze") draw(); });
  // If the tagline never finishes (it was never started), draw a little after
  // it would have: its longest lead is 3050ms + 2556ms of typing and squeeze.
  function fallback() { setTimeout(draw, 3050 + 2556 + 1200); }
  if (window.__wmPlaying) fallback(); else document.addEventListener("wm-playing", fallback, { once: true });
})();
