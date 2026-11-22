/* What we offer. Everything here is an extra: with no script the page still
   shows every step, picture and link.
   1. The plaques read the newest update and the number of guides from the two
      pages they open, so they can't go stale.
   2. The things to touch: follow a link, draw the maths, change the paper,
      theme and font.
   3. The path: the home page's "walk the path" ink line, here running from
      title to title as you scroll, then forking into the download buttons. */
(function () {
  function page(url) {
    return fetch(url, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(url); return r.text(); })
      .then(function (html) { return new DOMParser().parseFromString(html, "text/html"); });
  }
  function fill(name, text) {
    var el = document.querySelector('[data-plaque="' + name + '"]');
    if (el && text) el.textContent = text;
  }
  function clean(el) { return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }

  page("updates.html").then(function (doc) {
    var newest = doc.querySelector("article.rel");
    if (!newest) return;
    var name = clean(newest.querySelector(".rel-title"));
    var date = clean(newest.querySelector("time"));
    if (name && date) fill("updates", name + " · " + date);
  }).catch(function () {});

  page("tutorials.html").then(function (doc) {
    var n = doc.querySelectorAll("a.tut-link").length;
    if (n > 0) fill("tutorials", n + (n === 1 ? " guide" : " guides"));
  }).catch(function () {});

  /* Links between notes: one note at a time, and the sheet keeps the height of
     the tallest so nothing below it jumps when a link is followed. */
  var worlds = document.querySelector(".of-worlds");
  if (worlds) {
    var notes = worlds.querySelectorAll(".of-world");
    var worldsWidth = 0;
    var sizeWorlds = function (force) {
      /* A phone's address bar sliding away is a "resize" too: only a real
         change of width can change how tall these notes are. */
      var w = worlds.clientWidth;
      if (force !== true && w === worldsWidth) return;
      worldsWidth = w;
      worlds.classList.remove("is-live");
      worlds.style.minHeight = "";
      var tallest = 0;
      each(notes, function (n) { tallest = Math.max(tallest, n.offsetHeight); });
      worlds.classList.add("is-live");
      worlds.style.minHeight = tallest + "px";
    };
    var show = function (key, focus) {
      each(notes, function (n) {
        var on = n.getAttribute("data-world") === key;
        n.classList.toggle("is-shown", on);
        if (on && focus) {
          n.classList.remove("is-entering");
          void n.offsetWidth;
          n.classList.add("is-entering");
          var title = n.querySelector("h3");
          title.setAttribute("tabindex", "-1");
          title.focus({ preventScroll: true });
        }
      });
    };
    sizeWorlds(true);
    show("plan");
    worlds.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("[data-go]") : null;
      if (!a) return;
      e.preventDefault();
      show(a.getAttribute("data-go"), true);
    });
    window.addEventListener("resize", sizeWorlds);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { sizeWorlds(true); });
  }

  if (window.katex) {
    each(document.querySelectorAll("[data-tex]"), function (el) {
      try { window.katex.render(el.getAttribute("data-tex"), el, { throwOnError: true, displayMode: true }); }
      catch (e) { /* the plain sum stays */ }
    });
  }

  /* The glow: once each, as it comes into view. */
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var glowSeen = new IntersectionObserver(function (seen) {
      seen.forEach(function (e) {
        if (!e.isIntersecting) return;
        glowSeen.unobserve(e.target);
        setTimeout(function () { e.target.classList.add("is-glowing"); }, 320);
      });
    }, { threshold: 0.9, rootMargin: "-12% 0px -18% 0px" });
    each(document.querySelectorAll("[data-glow]"), function (el) {
      glowSeen.observe(el);
      el.addEventListener("animationend", function () { el.classList.remove("is-glowing"); });
    });
  }

  /* Page looks: starts on whichever theme the visitor's page is showing. */
  var looks = document.querySelector(".of-looks");
  if (looks) {
    var root = document.documentElement.getAttribute("data-theme");
    var dark = root ? root === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    var pick = function (key, value) {
      looks.setAttribute("data-" + key, value);
      each(document.querySelectorAll('[data-set="' + key + '"]'), function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-value") === value));
      });
    };
    pick("theme", dark ? "dark" : "light");
    each(document.querySelectorAll("[data-set]"), function (b) {
      b.addEventListener("click", function () { pick(b.getAttribute("data-set"), b.getAttribute("data-value")); });
    });
  }

  /* ── The path ─────────────────────────────────────────────────────────────
     The same line as the home page's "walk the path" (landing.js): same weight,
     and every join vertical, so it reads as one line. It leaves each title where a
     pen would lift off its last letter and joins the next where a pen would
     land on its first. Its tip follows the reader's scroll, and a title inks
     in, left to right, as the tip reaches it. Drawn once: scrolling back up
     leaves it where it got to. */
  var walk = document.querySelector(".of-walk");
  var strand = walk && walk.querySelector(".of-strand");
  if (!walk || !strand) return;

  var NS = "http://www.w3.org/2000/svg";
  var ua = navigator.userAgent || "";
  var MOBILE = /[?&]device=phone(?:&|$)/.test(location.search) ||
    !!(navigator.userAgentData && navigator.userAgentData.mobile) ||
    /android|iphone|ipad|ipod|windows phone|mobile/i.test(ua) ||
    (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var railQuery = window.matchMedia("(max-width: 860px)");

  var endTitle = walk.querySelector(".of-end-title");
  var endWords = walk.querySelector(".of-end-words");
  var endTip = endTitle.querySelector(".of-anchor");
  var winBtn = document.getElementById("winBtn");
  var macBtn = document.getElementById("macBtn");
  var linuxBtn = document.getElementById("linuxBtn");
  /* On a phone the app can't be installed, so the ending is the home page's
     own line instead of three buttons that can't do anything. */
  if (MOBILE) {
    endWords.textContent = "Built for Mac, Windows and Linux.";
    walk.classList.add("is-phone");
  }

  /* Where a pen would start and finish each letter, measured from the real
     Fraunces outlines at this weight: em units, y up from the baseline. x runs
     from the left of a first letter and BACK from the end of a last letter,
     because Safari places the end of a line exactly but can draw a letter
     inside it most of a pixel from where it reports it. Each point sits inside the ink, so the line's round end
     is buried in the letter and the two read as one stroke. */
  var PEN = {"in":{"V":[0.1115,0.64],"F":[0.1567,0.6549],"E":[0.1567,0.6541],"B":[0.1565,0.638],"P":[0.1567,0.638],"L":[0.1563,0.636],"M":[0.1766,0.656],"T":[0.0866,0.6329],"S":[0.4808,0.616],"C":[0.5831,0.6286],"A":[0.3555,0.63]},"out":{"s":[0.1104,0.0719],"r":[0.0559,0.3637],"p":[0.1327,0.0898],"w":[0.0772,0.4428],"n":[0.0944,0.0337],"e":[0.1665,0.0418],"t":[0.1284,0.03]},"endIn":[0.1252,0.65],"endOut":[0.1054,0.0742]};
  /* How far the letter's stroke reaches to the left and right of each of those
     points, in em, read from the drawn titles. As the line arrives it widens to
     those two edges, so it runs into a heavy stem and becomes it. A letter that
     isn't listed starts on a fine point, and the line thins to meet it. Curved
     strokes are capped, because their width across the page overstates them. */
  var EDGE = {"in":{"V":[0.013,0.105],"F":[0.029,0.104],"E":[0.029,0.104],"B":[0.029,0.104],"P":[0.029,0.104],"L":[0.029,0.104],"M":[0.035,0.105],"T":[0.051,0.016],"A":[0.013,0.105]},"out":{"s":[0.06,0.048],"r":[0.05,0.019],"p":[0.037,0.085],"n":[0.05,0.024]},"endIn":[0.01,0.085],"endOut":[0.046,0.044]};
  var LINE = 2.4;       // the line's weight between titles, as on the home page
  var SWEEP_MS = 620;   // the title has crossed in by now (.7s sweep in offer.css)

  var titles = [];
  each(walk.querySelectorAll(".of-title"), function (h) {
    var box = h.querySelector(".of-title-in");
    var ink = h.querySelector(".of-title-ink");
    if (!reduce) {
      var ghost = document.createElement("span");
      ghost.className = "of-title-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.textContent = ink.textContent;
      box.insertBefore(ghost, ink);
    }
    titles.push({ el: h, box: box, ink: ink, tip: h.querySelector(".of-anchor"), walked: false, readyAt: 0, y: 0 });
  });
  if (!titles.length) return;

  /* One <path> per stretch: title to title, last title to the ending, then the
     three branches. */
  var stretches = [];
  function addPath() {
    var p = document.createElementNS(NS, "path");
    strand.appendChild(p);
    var s = { el: p, len: 0, y0: 0, y1: 0, cur: 0, shown: -1, xs: [], ys: [], ls: [], key: null, sx: 0, sy: 0, ox: 0, oy: 0 };
    stretches.push(s);
    return s;
  }
  var legs = titles.map(addPath);
  var forks = MOBILE ? [] : [addPath(), addPath(), addPath()];
  var dots = titles.map(function () {
    var c = document.createElementNS(NS, "circle");
    c.setAttribute("r", "4");
    strand.appendChild(c);
    return c;
  });

  function r(n) { return Math.round(n * 100) / 100; }
  var letter = document.createRange();
  function letterBox(el, i) {
    var node = el.firstChild;
    letter.setStart(node, i);
    letter.setEnd(node, i + 1);
    var rects = letter.getClientRects();
    return rects[rects.length - 1];
  }
  /* The pen's two points on a piece of text, in the walk's own coordinates. */
  function penPoints(el, anchor, box, inAt, outAt, inEdge, outEdge) {
    var text = el.firstChild.nodeValue;
    var size = parseFloat(window.getComputedStyle(el).fontSize);
    var first = letterBox(el, 0);
    var last = letterBox(el, text.length - 1);
    var base = anchor.getBoundingClientRect().bottom - last.top;   // top of a letter's box to its baseline
    letter.selectNodeContents(el);
    var lines = letter.getClientRects();
    var lineEnd = lines[lines.length - 1].right;
    var spacing = parseFloat(window.getComputedStyle(el).letterSpacing) || 0;
    var a = inAt || PEN.in[text.charAt(0)] || [0.12, 0.66];
    var b = outAt || PEN.out[text.charAt(text.length - 1)] || [0.12, 0.05];
    var sides = function (e) {
      e = e || [0.026, 0.026];
      return [Math.max(0.5, e[0] * size), Math.max(0.5, e[1] * size)];
    };
    return {
      inW: sides(inEdge || EDGE.in[text.charAt(0)]),
      outW: sides(outEdge || EDGE.out[text.charAt(text.length - 1)]),
      inX: first.left + a[0] * size - box.left,
      inY: first.top + base - a[1] * size - box.top,
      outX: lineEnd - spacing - b[0] * size - box.left,
      outY: last.top + base - b[1] * size - box.top
    };
  }
  function soft(x) { return x * x * (3 - 2 * x); }
  /* Walks a run of curves into points a couple of pixels apart. */
  function trace(curves) {
    var xs = [], ys = [], ls = [], total = 0;
    curves.forEach(function (c, ci) {
      var reach = Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]) + Math.hypot(c[6] - c[4], c[7] - c[5]);
      var n = Math.max(6, Math.ceil(reach / 2.2));
      for (var k = ci ? 1 : 0; k <= n; k++) {
        var t = k / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
        var x = a * c[0] + b * c[2] + d * c[4] + e * c[6];
        var y = a * c[1] + b * c[3] + d * c[5] + e * c[7];
        if (xs.length) total += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
        xs.push(x); ys.push(y); ls.push(total);
      }
    });
    return { xs: xs, ys: ys, ls: ls, len: total };
  }
  /* The ribbon's two edges. It eases from each letter's own stroke to the line's
     normal weight over the first and last stretch of the join. a and b are how
     far it reaches left and right at each end. */
  function setPath(s, curves, y0, y1, a, b) {
    curves = curves || [];
    var ax = curves.length ? curves[0][0] : 0, ay = curves.length ? curves[0][1] : 0;
    var base = LINE / 2;
    a = a || [base, base];
    b = b || [base, base];
    /* Something above only moved this stretch (a toggle opening): shift what is
       already drawn instead of working it all out again on every frame. */
    var key = a.concat(b).map(r).join(",") + ":" + curves.map(function (c) {
      return c.map(function (v, i) { return r(v - (i % 2 ? ay : ax)); }).join(" ");
    }).join(";");
    if (key === s.key) {
      s.y0 = y0; s.y1 = y1;
      var mx = r(ax - s.ox), my = r(ay - s.oy);
      if (mx !== s.sx || my !== s.sy) {
        s.sx = mx; s.sy = my;
        s.el.setAttribute("transform", "translate(" + mx + " " + my + ")");
      }
      return;
    }
    s.key = key;
    s.ox = ax; s.oy = ay; s.sx = 0; s.sy = 0;
    s.el.removeAttribute("transform");
    var was = s.len ? s.cur / s.len : 0;
    var t = trace(curves);
    var n = t.xs.length;
    s.y0 = y0; s.y1 = y1;
    s.xs = t.xs; s.ys = t.ys; s.ls = t.ls; s.len = t.len;
    s.lx = new Array(n); s.ly = new Array(n); s.rx = new Array(n); s.ry = new Array(n); s.hw = new Array(n);
    var span = Math.min(58, t.len * 0.26);
    for (var i = 0; i < n; i++) {
      var p = t.xs[Math.max(0, i - 1)], q = t.ys[Math.max(0, i - 1)];
      var dx = t.xs[Math.min(n - 1, i + 1)] - p, dy = t.ys[Math.min(n - 1, i + 1)] - q;
      var m = Math.hypot(dx, dy) || 1;
      var hl = base, hr = base, gone = t.ls[i], left = t.len - gone, k;
      if (gone < span) { k = soft(1 - gone / span); hl += (a[0] - base) * k; hr += (a[1] - base) * k; }
      if (left < span) { k = soft(1 - left / span); hl += (b[0] - base) * k; hr += (b[1] - base) * k; }
      s.hw[i] = (hl + hr) / 2;
      s.lx[i] = t.xs[i] - (dy / m) * hl; s.ly[i] = t.ys[i] + (dx / m) * hl;
      s.rx[i] = t.xs[i] + (dy / m) * hr; s.ry[i] = t.ys[i] - (dx / m) * hr;
    }
    s.cur = reduce ? s.len : was * s.len;
    s.shown = -1;
    drawStretch(s);
  }
  /* Draws the ribbon as far as the tip, with a round end. */
  function drawStretch(s) {
    if (Math.abs(s.cur - s.shown) < 0.1) return;
    s.shown = s.cur;
    var n = s.xs.length;
    if (s.cur <= 0.5 || n < 2) { s.el.setAttribute("d", ""); return; }
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      var m = (lo + hi) >> 1;
      if (s.ls[m] <= s.cur) lo = m; else hi = m;
    }
    var gap = s.ls[hi] - s.ls[lo];
    var f = gap > 0 ? Math.min(1, (s.cur - s.ls[lo]) / gap) : 0;
    var mix = function (a) { return r(a[lo] + (a[hi] - a[lo]) * f); };
    var tipH = r(s.hw[lo] + (s.hw[hi] - s.hw[lo]) * f);
    var out = ["M", r(s.lx[0]), r(s.ly[0])];
    for (var i = 1; i <= lo; i++) out.push("L", r(s.lx[i]), r(s.ly[i]));
    out.push("L", mix(s.lx), mix(s.ly), "A", tipH, tipH, 0, 0, 0, mix(s.rx), mix(s.ry));
    for (var k = lo; k >= 0; k--) out.push("L", r(s.rx[k]), r(s.ry[k]));
    out.push("A", r(s.hw[0]), r(s.hw[0]), 0, 0, 0, r(s.lx[0]), r(s.ly[0]), "Z");
    s.el.setAttribute("d", out.join(" "));
  }
  /* Down from one point to another, leaving and arriving vertically. With a belly
     out to one side it is two halves whose bend matches where they meet, so
     there is no visible join; otherwise it is one clean S. */
  function wave(ax, ay, bellyX, bx, by) {
    var h = by - ay;
    var d1 = Math.abs(bellyX - ax), d2 = Math.abs(bellyX - bx);
    var between = (bellyX - ax) * (bellyX - bx) <= 0;
    if (between || Math.min(d1, d2) < Math.max(d1, d2) * 0.14) {
      return [[ax, ay, ax, ay + h * 0.5, bx, by - h * 0.5, bx, by]];
    }
    var my = ay + h * Math.sqrt(d1) / (Math.sqrt(d1) + Math.sqrt(d2));
    var h1 = (my - ay) * 0.56, h2 = (by - my) * 0.56;
    return [
      [ax, ay, ax, ay + h1, bellyX, my - h1, bellyX, my],
      [bellyX, my, bellyX, my + h2, bx, by - h2, bx, by]
    ];
  }

  var walkTop = 0;
  var startY = 0;   // where the line leaves the first title
  function shape() {
    var box = walk.getBoundingClientRect();
    walkTop = box.top + window.scrollY;
    strand.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    var rail = railQuery.matches;
    var railX = 7;
    var pts = titles.map(function (t) {
      var b = t.box.getBoundingClientRect();
      var p = penPoints(t.ink, t.tip, box);
      p.mid = b.top - box.top + b.height / 2;
      t.y = rail ? p.mid : p.inY;
      return p;
    });
    startY = rail ? pts[0].mid : pts[0].outY;
    var colW = Math.min(280, box.width * 0.3);
    var endPen = penPoints(endWords, endTip, box, MOBILE ? PEN.in.B : PEN.endIn, PEN.endOut, MOBILE ? EDGE.in.B : EDGE.endIn, EDGE.endOut);

    titles.forEach(function (t, i) {
      var p = pts[i];
      var c = dots[i];
      c.setAttribute("cx", railX);
      c.setAttribute("cy", r(p.mid));
      c.style.display = rail ? "" : "none";
      var next = pts[i + 1];
      if (next) {
        if (rail) {
          var sway = i % 2 ? railX + 3 : railX - 3;
          setPath(legs[i], wave(railX, p.mid, sway, railX, next.mid), p.mid, next.mid);
        } else {
          /* The belly swings from one side of the title column to the other. */
          var belly = i % 2 ? colW * 0.2 : colW * 0.72;
          setPath(legs[i], wave(p.outX, p.outY, belly, next.inX, next.inY), p.outY, next.inY, p.outW, next.inW);
        }
      } else {
        /* The last title runs down its own column until the last picture has
           ended, and only then swings across to the ending. */
        var stepEnd = t.el.closest(".of-step").getBoundingClientRect().bottom - box.top;
        var sx = rail ? railX : p.outX;
        var sy = rail ? p.mid : p.outY;
        var clear = Math.max(sy + 20, stepEnd - 8);
        var h = endPen.inY - clear;
        setPath(legs[i], [
          [sx, sy, sx, sy + (clear - sy) / 3, sx, clear - (clear - sy) / 3, sx, clear],
          [sx, clear, sx, clear + h * 0.56, endPen.inX, endPen.inY - h * 0.5, endPen.inX, endPen.inY]
        ], sy, endPen.inY, rail ? null : p.outW, endPen.inW);
      }
    });

    if (forks.length) {
      var fsx = endPen.outX;
      var fsy = endPen.outY;
      var lb = winBtn.getBoundingClientRect(), mb = macBtn.getBoundingClientRect(), rb = linuxBtn.getBoundingClientRect();
      var lx = lb.left + lb.width / 2 - box.left, ly = lb.top - box.top + 1;
      var mx = mb.left + mb.width / 2 - box.left, my = mb.top - box.top + 1;
      var rx = rb.left + rb.width / 2 - box.left, ry = rb.top - box.top + 1;
      var stacked = rb.top - lb.top > lb.height * 0.6;
      var fx = stacked ? lb.left - box.left + Math.min(lb.width * 0.12, 46) : mx;
      var topY = Math.min(ly, my, ry);
      /* One long S from the last letter to the fork, then each branch leaves it
         vertically, so nothing turns sharply on the way to the buttons. */
      var fy = fsy + (topY - fsy) * 0.46;
      var th = fy - fsy;
      var trunk = [[fsx, fsy, fsx, fsy + th * 0.6, fx, fy - th * 0.54, fx, fy]];
      var bh = topY - fy;
      var END_W = [0.85, 0.85];   // a fine point on the button's thin edge
      var branch = function (ex, ey) {
        return trunk.concat([[fx, fy, fx, fy + bh * 0.58, ex, ey - bh * 0.5, ex, ey]]);
      };
      if (stacked) {
        setPath(forks[0], null, 0, 0);
        setPath(forks[1], null, 0, 0);
        setPath(forks[2], trunk.concat([[fx, fy, fx, fy + (ry - fy) / 3, fx, ry - (ry - fy) / 3, fx, ry]]), fsy, ry, endPen.outW, END_W);
      } else {
        setPath(forks[0], branch(lx, ly), fsy, ly, endPen.outW, END_W);
        setPath(forks[1], branch(mx, my), fsy, my, endPen.outW, END_W);
        setPath(forks[2], branch(rx, ry), fsy, ry, endPen.outW, END_W);
      }
    }
  }

  /* How far along a stretch the tip is when it has reached height y. These
     lines only ever go down, so a binary search on length finds it exactly. */
  function lengthAt(s, y) {
    if (!s.len || y <= s.y0) return 0;
    if (y >= s.y1) return s.len;
    var at = y - s.sy;   // the points are kept where they were first worked out
    var lo = 0, hi = s.ys.length - 1;
    while (hi - lo > 1) {
      var m = (lo + hi) >> 1;
      if (s.ys[m] < at) lo = m; else hi = m;
    }
    var dy = s.ys[hi] - s.ys[lo];
    return s.ls[lo] + (dy > 0 ? (at - s.ys[lo]) / dy : 0) * (s.ls[hi] - s.ls[lo]);
  }

  /* The tip. It stays at the first title until that title is halfway down the
     screen, then rides the middle of the screen. If the first title already
     starts above the middle, nothing is drawn until the reader scrolls, and the
     tip catches up with the middle over the next half-screen. Over the last
     screenful it eases to the bottom edge so it always reaches the buttons. */
  function target() {
    var vh = window.innerHeight;
    var y = window.scrollY;
    var left = document.documentElement.scrollHeight - (y + vh);
    var near = Math.max(0, Math.min(1, 1 - left / vh));
    var natural = y + vh * (0.5 + 0.5 * near) - walkTop;
    if (startY + walkTop >= vh * 0.5) return natural;
    var blend = vh * 0.45;
    if (y >= blend) return natural;
    var meet = blend + vh * 0.5 - walkTop;
    return startY + (meet - startY) * (y / blend);
  }

  var reach = -Infinity;
  var ease = 0.26;   // set each frame from the time passed, so a slow phone keeps up too
  function advance(s, want, top) {
    if (want <= s.cur) return false;
    /* Anything already off the top of the screen just catches up. */
    if (s.y1 < top) s.cur = want;
    else {
      s.cur += (want - s.cur) * ease;
      if (want - s.cur < 0.6) s.cur = want;
    }
    drawStretch(s);
    return s.cur < want;
  }
  function step(now) {
    var busy = false;
    var top = window.scrollY - walkTop;
    titles.forEach(function (t, i) {
      var before = i ? legs[i - 1] : null;
      var arrived = !before || before.cur >= before.len - 1;
      if (!t.walked && arrived && reach >= t.y - 1) {
        t.walked = true;
        t.readyAt = now + SWEEP_MS;
        t.el.classList.add("is-walked");
      }
      if (dots[i]) dots[i].classList.toggle("is-on", t.walked);
      var leg = legs[i];
      /* Scrolling fast: the title finishes crossing in at once, so the line
         never waits behind the reader. */
      if (t.walked && now < t.readyAt && reach >= t.y + window.innerHeight * 0.14) {
        t.readyAt = now;
        t.el.classList.add("is-quick");
      }
      if (t.walked && (now >= t.readyAt || leg.y1 < top)) {
        if (advance(leg, lengthAt(leg, reach), top)) busy = true;
      } else if (t.walked && reach > leg.y0) {
        busy = true;   // waiting for the title to finish crossing in
      }
      if (!t.walked && before && reach >= t.y - 1) busy = true;
    });
    var last = legs[legs.length - 1];
    if (forks.length && last.cur >= last.len - 1) {
      forks.forEach(function (f) { if (advance(f, lengthAt(f, reach), top)) busy = true; });
    }
    return busy;
  }

  var raf = 0;
  var lastFrame = 0;
  function loop(now) {
    raf = 0;
    var dt = lastFrame ? Math.min(120, now - lastFrame) : 16;
    ease = 1 - Math.exp(-dt / 54);
    reach = Math.max(reach, target());
    if (step(now)) {
      lastFrame = now;
      raf = window.requestAnimationFrame(loop);
    } else {
      lastFrame = 0;
    }
  }
  function wake() { if (!raf && !reduce) raf = window.requestAnimationFrame(loop); }

  var queued = 0;
  function reshape() {
    if (queued) return;
    queued = window.requestAnimationFrame(function () { queued = 0; shape(); wake(); });
  }

  walk.classList.add(reduce ? "is-drawn" : "is-walking");
  shape();
  if (reduce) {
    titles.forEach(function (t, i) { t.walked = true; dots[i].classList.add("is-on"); });
  } else {
    reach = target();
    wake();
  }
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", reshape);
  window.addEventListener("load", reshape);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reshape);
  if (window.ResizeObserver) new ResizeObserver(reshape).observe(walk);
})();
