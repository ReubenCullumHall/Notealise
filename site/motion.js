/* Smooth motion, on every page (Reuben, 2026-10-31). Three jobs, no library and
   no request to anyone (the Privacy page lists every outside service):
   1. Scrolling glides to a stop instead of following the wheel step for step.
   2. Every open-and-shut box (<details>) opens and closes by sliding, and the
      page under it moves with it.
   3. A soft cursor replaces the sharp arrow and hand.
   Reduced motion leaves all three native; so does no JavaScript. The cursor
   also stays native on a touch screen. Styles are in motion.css. */
(function () {
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // The cursor wants to keep re-reading what is under it while the page moves
  // under a still mouse (scrolling, a box sliding open). The scroll and the
  // boxes call busy(); the cursor sets wake() when it starts.
  var busyUntil = 0, wake = function () {};
  function busy(ms) { busyUntil = Math.max(busyUntil, performance.now() + ms); wake(); }

  /* ── 1. Scrolling ───────────────────────────────────────────────────────
     Wheel turns set a target; each frame the page moves a share of the way to
     it, so the page eases out over about half a second. Everything else
     (scrollbar drag, keys, touch, find-in-page) stays native: a scroll we did
     not make just resets the target to wherever the page now is. */
  var GLIDE = 130; // ms: the time the page takes to cover ~63% of what is left
  var S = { on: false, raf: 0, t0: 0, pos: 0, target: 0, ours: 0 };

  function maxScroll() { return Math.max(0, root.scrollHeight - root.clientHeight); }
  // A pop-up (or the loading screen) locks the page by hiding its overflow.
  function locked() {
    return getComputedStyle(root).overflowY === "hidden" || getComputedStyle(document.body).overflowY === "hidden";
  }
  // True when something under the mouse scrolls by itself and can still move
  // that way (the Try it window's note, a pop-up's text): leave it to the browser.
  function innerScroller(el, dy) {
    for (; el && el !== document.body && el !== root; el = el.parentElement) {
      if (el.nodeType !== 1) continue;
      if (el.hasAttribute("data-no-smooth")) return true;
      var cs = getComputedStyle(el), oy = cs.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        var ob = cs.overscrollBehaviorY;
        if (ob === "contain" || ob === "none") return true;
        if (dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      }
    }
    return false;
  }

  function step(now) {
    var dt = Math.min(now - S.t0, 64); S.t0 = now;
    var diff = S.target - S.pos;
    S.pos = Math.abs(diff) < 0.5 ? S.target : S.pos + diff * (1 - Math.exp(-dt / GLIDE));
    S.ours = S.pos;
    window.scrollTo(0, S.pos);
    busy(120);
    if (S.pos !== S.target) S.raf = requestAnimationFrame(step);
    else { S.on = false; root.classList.remove("mo-scroll"); }
  }
  // mo-scroll is on only while a wheel glide runs, so a link to #download or
  // #faq still slides there with the page's own smooth scrolling.
  function run() {
    if (S.on) return;
    root.classList.add("mo-scroll");
    S.on = true; S.t0 = performance.now(); S.raf = requestAnimationFrame(step);
  }
  function stop() { cancelAnimationFrame(S.raf); S.on = false; root.classList.remove("mo-scroll"); }

  window.addEventListener("wheel", function (e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return; // ctrl = zoom
    if (reduced.matches || locked()) return;
    var dy = e.deltaY;
    if (!dy || Math.abs(e.deltaX) > Math.abs(dy)) return;
    if (innerScroller(e.target, dy)) return;
    var max = maxScroll();
    if (max <= 0) return;
    if (!S.on) S.pos = S.target = window.scrollY;
    // already at the end in the direction asked: let the browser have it
    if ((dy < 0 && S.target <= 0) || (dy > 0 && S.target >= max)) return;
    e.preventDefault();
    if (e.deltaMode === 1) dy *= 40; else if (e.deltaMode === 2) dy *= window.innerHeight;
    S.target = clamp(S.target + dy, 0, max);
    run();
  }, { passive: false });

  window.addEventListener("scroll", function () {
    // Not ours (scrollbar, keys, find-in-page, a clamp when the page got
    // shorter): take over from wherever the page now is.
    if (S.on && Math.abs(window.scrollY - S.ours) > 2) { stop(); S.pos = S.target = window.scrollY; }
    if (!S.on) S.pos = S.target = window.scrollY;
  }, { passive: true });

  /* ── 2. Open-and-shut boxes ─────────────────────────────────────────────
     The box's height is animated between its shut and open sizes, so what is
     below it (the next question, the footer) is pushed down and pulled back up
     as one movement. A box that is closing keeps its `open` attribute until it
     has finished (the .is-closing class tells motion.css which way it is going),
     and a click while it is moving turns it round from where it is. */
  var OPEN_MS = 440, SHUT_MS = 360;

  function answers(d) {
    return Array.prototype.filter.call(d.children, function (c) { return c.tagName !== "SUMMARY"; });
  }
  function settle(d, opening) {
    d._moAnim = null;
    answers(d).forEach(function (c) { c.getAnimations().forEach(function (a) { a.cancel(); }); });
    d.style.removeProperty("height"); d.style.removeProperty("overflow"); d.style.removeProperty("box-sizing");
    d.classList.remove("is-closing");
    if (!opening) d.open = false;
  }
  function flip(d) {
    var anim = d._moAnim, wasShutting = d.classList.contains("is-closing");
    var opening = anim ? wasShutting : !d.open;
    var from = null, fades = null;
    if (anim) { // turn round from where it is
      from = d.offsetHeight;
      fades = answers(d).map(function (c) { return parseFloat(getComputedStyle(c).opacity); });
      anim.cancel(); d._moAnim = null;
      answers(d).forEach(function (c) { c.getAnimations().forEach(function (a) { a.cancel(); }); });
    }
    d.style.overflow = "hidden"; d.style.boxSizing = "border-box"; d.style.removeProperty("height");
    // both natural sizes, measured back to back so nothing paints in between
    var openH, shutH;
    if (d.open) { openH = d.offsetHeight; d.open = false; shutH = d.offsetHeight; d.open = true; }
    else { shutH = d.offsetHeight; d.open = true; openH = d.offsetHeight; }
    if (from === null) from = opening ? shutH : openH;
    var to = opening ? openH : shutH, ms = opening ? OPEN_MS : SHUT_MS;
    d.classList.toggle("is-closing", !opening);

    var a = d.animate({ height: [from + "px", to + "px"] }, { duration: ms, easing: EASE });
    d._moAnim = a;
    a.onfinish = function () { settle(d, opening); };
    // the answer fades and slides a touch as the box moves
    answers(d).forEach(function (c, i) {
      var o = fades ? fades[i] : (opening ? 0 : 1);
      c.animate(
        opening ? { opacity: [o, 1], transform: ["translateY(-6px)", "none"] }
                : { opacity: [o, 0], transform: ["none", "translateY(-4px)"] },
        { duration: opening ? ms * 0.75 : ms * 0.5, delay: opening ? ms * 0.12 : 0, easing: "ease", fill: "both" }
      );
    });
    busy(ms + 120);
  }
  document.addEventListener("click", function (e) {
    var s = e.target.closest && e.target.closest("summary");
    var d = s && s.parentElement;
    if (!d || d.tagName !== "DETAILS" || d.querySelector(":scope > summary") !== s) return;
    if (reduced.matches || !d.animate || e.defaultPrevented) return;
    e.preventDefault();
    flip(d);
  });

  /* ── 3. The cursor ──────────────────────────────────────────────────────
     A thin-lined arrow, and a pointing hand over anything clickable, in the
     manner of the line-icon sheet Reuben sent (2026-10-31): ink outline, paper
     inside, soft corners like the site's own, and one touch of the page's
     highlighter colour (crayon yellow; sky on Tutorials, sage on What's new)
     peeking out behind, the way the highlighter sits behind ink on the pages.
     It glides after the mouse instead of sitting exactly on it. Only for a
     mouse (a touch screen has no pointer to draw), only when the browser can
     put it above a modal pop-up, and never with reduced motion or forced
     colours. The real cursor is hidden by motion.css once this one has
     appeared, so nobody is ever left without a pointer. */
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  var forced = window.matchMedia("(forced-colors: active)");
  if (!fine.matches || reduced.matches || forced.matches || !("showPopover" in HTMLElement.prototype)) return;

  var FOLLOW = 40; // ms: how long it takes to cover about two thirds of the way to the mouse
  var NS = "http://www.w3.org/2000/svg";
  var PAD = 3;     // room round each outline for its line and the yellow edge

  // Each is one outline, drawn in px with its top-left at 0,0. `hot` is the
  // point that sits exactly on the mouse (the arrow's tip, the finger's tip,
  // the middle of the side-to-side arrows); `lines` are strokes inside it.
  var SHAPES = {
    arrow: { hot: [0.2, 0.4], w: 13, h: 20, scale: 1,
      d: "M0 1.7L0 15.7Q0 17.2 1.08 16.16L3.49 13.87Q4.5 12.9 5.03 14.2L6.7 18.32Q7.3 19.8 8.77 19.16L8.83 19.14Q10.3 18.5 9.67 17.03L8.25 13.69Q7.7 12.4 9.1 12.4L11.1 12.4Q12.6 12.4 11.53 11.35L1.21 1.19Q0 0 0 1.7Z" },
    hand: { hot: [9.6, 1], w: 24, h: 25, scale: 0.92,
      d: "M7.4 14.6V3.4A2.2 2.2 0 0 1 11.8 3.4V10A1.7 1.7 0 0 1 15.2 10.4V11A1.6 1.6 0 0 1 18.4 11.4V12.2A1.5 1.5 0 0 1 21.4 12.2V17Q21.4 20 19.6 21.6L19.1 23.4Q19 23.8 18.6 23.8H9.9Q9.5 23.8 9.3 23.4L8.5 21.8Q5.8 19 2.9 15.4C1.6 13.9 2.4 12.4 3.8 12.9L6.4 15.1Q7.4 15.9 7.4 14.6Z",
      lines: "M11.8 10V15M15.2 11V15M18.4 12.2V15" },
    size: { hot: [11, 6.5], w: 22, h: 13, scale: 1,
      d: "M1.07 5.45L5.53 1.05Q6.6 0 6.6 1.5L6.6 2.5Q6.6 4 8.1 4L13.9 4Q15.4 4 15.4 2.5L15.4 1.5Q15.4 0 16.47 1.05L20.93 5.45Q22 6.5 20.93 7.55L16.47 11.95Q15.4 13 15.4 11.5L15.4 10.5Q15.4 9 13.9 9L8.1 9Q6.6 9 6.6 10.5L6.6 11.5Q6.6 13 5.53 11.95L1.07 7.55Q0 6.5 1.07 5.45Z" }
  };

  var cur = document.createElement("div");
  cur.className = "mo-cur is-out"; cur.setAttribute("popover", "manual"); cur.setAttribute("aria-hidden", "true");
  cur.setAttribute("data-state", "");
  var at = document.createElement("div");
  at.className = "mo-pos";
  cur.appendChild(at);
  Object.keys(SHAPES).forEach(function (n) {
    var s = SHAPES[n], k = s.scale;
    var el = document.createElementNS(NS, "svg");
    el.setAttribute("class", "mo-" + n);
    el.setAttribute("viewBox", -PAD + " " + -PAD + " " + (s.w + PAD * 2) + " " + (s.h + PAD * 2));
    el.setAttribute("width", (s.w + PAD * 2) * k); el.setAttribute("height", (s.h + PAD * 2) * k);
    el.style.left = (-(s.hot[0] + PAD) * k) + "px"; el.style.top = (-(s.hot[1] + PAD) * k) + "px";
    // the colour of each layer is in motion.css: yellow edge, paper rim, ink line
    [["mo-sh", s.d], ["mo-rim", s.d], ["mo-ink", s.d], ["mo-ln", s.lines]].forEach(function (p) {
      if (!p[1]) return;
      var path = document.createElementNS(NS, "path");
      path.setAttribute("class", p[0]); path.setAttribute("d", p[1]);
      if (p[0] === "mo-sh") path.setAttribute("transform", "translate(2.4 2.4)");
      el.appendChild(path);
    });
    at.appendChild(el);
  });
  document.body.appendChild(cur);

  var tx = 0, ty = 0, px = 0, py = 0, shown = false, raf = 0, last = 0;
  var state = "", lastTarget = null, SEL = null;

  // What counts as clickable is whatever the page's own stylesheets already
  // mark with a pointer / resize cursor, so a new button is picked up without
  // anyone remembering to list it here.
  function scan() {
    var link = ["a[href]", "button", "summary", 'label[for]', '[role="button"]', "select"], drag = [], text = [
      'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])',
      "textarea", '[contenteditable=""]', '[contenteditable="true"]'];
    function valid(sel) { try { document.querySelector(sel); return true; } catch (err) { return false; } }
    function walk(rules) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.media && !window.matchMedia(r.media.mediaText).matches) continue;
        if (!r.selectorText) { if (r.cssRules) walk(r.cssRules); continue; }
        var c = r.style && r.style.cursor;
        if (!c || !valid(r.selectorText)) continue;
        if (c === "pointer") link.push(r.selectorText);
        else if (/resize|grab|move/.test(c)) drag.push(r.selectorText);
        else if (c === "text") text.push(r.selectorText);
      }
    }
    Array.prototype.forEach.call(document.styleSheets, function (sh) { try { walk(sh.cssRules); } catch (err) { /* a sheet from elsewhere */ } });
    SEL = { link: link.join(","), drag: drag.join(","), text: text.join(",") };
  }
  function hit(t) {
    if (t === lastTarget) return;
    lastTarget = t;
    var s = "";
    if (t && t.closest) {
      if (SEL.text && t.closest(SEL.text)) s = "text";
      else if (SEL.drag && t.closest(SEL.drag)) s = "drag";
      else if (SEL.link && t.closest(SEL.link)) s = "link";
    }
    if (s !== state) { state = s; cur.setAttribute("data-state", s); }
  }
  function place() {
    // on whole screen pixels, so the squares never smear while it glides
    var r = window.devicePixelRatio || 1;
    at.style.transform = "translate3d(" + (Math.round(px * r) / r) + "px," + (Math.round(py * r) / r) + "px,0)";
  }
  function tick(now) {
    var dt = Math.min(now - last, 64); last = now;
    var k = 1 - Math.exp(-dt / FOLLOW);
    px += (tx - px) * k; py += (ty - py) * k;
    place();
    var settling = Math.abs(tx - px) > 0.1 || Math.abs(ty - py) > 0.1;
    if (now < busyUntil) { hit(document.elementFromPoint(tx, ty)); settling = true; }
    raf = settling ? requestAnimationFrame(tick) : 0;
  }
  wake = function () { if (shown && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

  function show() {
    if (!SEL) scan();
    px = tx; py = ty; place();
    try { if (!cur.matches(":popover-open")) cur.showPopover(); } catch (err) { return; }
    shown = true;
    root.classList.add("mo-cursor-on");
    cur.classList.remove("is-out");
  }
  function hide() {
    shown = false; cur.classList.add("is-out"); root.classList.remove("mo-cursor-on");
  }

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    tx = e.clientX; ty = e.clientY;
    if (!shown) show();
    if (!shown) return;
    hit(e.target);
    wake();
  }, { passive: true });
  window.addEventListener("pointerdown", function (e) {
    if (e.pointerType && e.pointerType !== "mouse") hide(); // a finger on a hybrid laptop: back to native
  }, true);
  // out of the window: nothing to draw; back in: it returns on the next move
  root.addEventListener("mouseleave", function () { cur.classList.add("is-out"); });
  root.addEventListener("mouseenter", function () { if (shown) cur.classList.remove("is-out"); });

  // A modal pop-up opens into the top layer above everything already there,
  // this cursor included; take it back to the top whenever one opens.
  function raise() {
    try { if (cur.matches(":popover-open")) { cur.hidePopover(); cur.showPopover(); } } catch (err) { /* nothing to raise */ }
  }
  Array.prototype.forEach.call(document.querySelectorAll("dialog"), function (d) {
    new MutationObserver(raise).observe(d, { attributes: true, attributeFilter: ["open"] });
  });
})();
