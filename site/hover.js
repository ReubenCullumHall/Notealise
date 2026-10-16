/* Download buttons: the ink flood starts where the cursor comes in and
   drains to where it leaves (hover.css). Sets the circle's centre and how
   far it has to grow — the button's diagonal, so it covers every corner
   from any starting point, and moving the centre on the way out never
   uncovers one. Keyboard focus floods from the middle. */
(function () {
  function place(btn, x, y) {
    var r = btn.getBoundingClientRect();
    btn.style.setProperty("--ink-x", (x == null ? r.width / 2 : x - r.left) + "px");
    btn.style.setProperty("--ink-y", (y == null ? r.height / 2 : y - r.top) + "px");
    btn.style.setProperty("--ink-max", Math.ceil(Math.hypot(r.width, r.height)) + "px");
  }
  function edge(e) {
    var b = e.target.closest && e.target.closest(".btn");
    if (b && !b.contains(e.relatedTarget)) place(b, e.clientX, e.clientY);
  }
  document.addEventListener("pointerover", edge);
  document.addEventListener("pointerout", edge);
  document.addEventListener("focusin", function (e) {
    if (e.target.matches && e.target.matches(".btn")) place(e.target);
  });
})();

/* Highlights: every one sits across the bodies of its letters, from just
   above the top of an "x" to just under the line the letters stand on
   (highlights.css). Fonts put those heights in different places, so each
   highlighted element is measured once its fonts have loaded and gets its
   own --hl-top / --hl-bottom, as a share of the box its colour paints in. */
(function () {
  var SEL = ".hl, .topbar-links a, .tut-link-title, .st-text-link";
  var ctx = document.createElement("canvas").getContext("2d");
  // The font's own numbers say where the baseline and the top of an "x"
  // sit. An inline element paints over its letter box (the font's ascent
  // above the baseline, descent below, plus padding); one laid out as a box
  // (the top bar's links are) has one line centred in its content height.
  // Nothing is inserted into the page, so no line can re-wrap.
  function measure(el) {
    var cs = getComputedStyle(el), fs = parseFloat(cs.fontSize);
    ctx.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    var mt = ctx.measureText("x"), xh = mt.actualBoundingBoxAscent;
    var asc = mt.fontBoundingBoxAscent, desc = mt.fontBoundingBoxDescent;
    if (!xh || !asc) return;
    var pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom), h, base;
    if (cs.display === "inline") { h = pt + asc + desc + pb; base = pt + asc; }
    else {
      h = el.getBoundingClientRect().height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
      base = pt + (h - pt - pb - asc - desc) / 2 + asc;
    }
    if (!h) return;
    var t = (base - xh - 0.03 * fs) / h * 100, b = (base + 0.05 * fs) / h * 100;
    el.style.setProperty("--hl-top", t.toFixed(1) + "%");
    el.style.setProperty("--hl-bottom", b.toFixed(1) + "%");
  }
  function all() {
    document.querySelectorAll(SEL).forEach(measure);
    window.dispatchEvent(new Event("hl-measured"));
  }
  var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(all);
  var t; addEventListener("resize", function () { clearTimeout(t); t = setTimeout(all, 200); });
})();
