/* What we offer, Voice notes: one recording shared by four small controls.
   - The voice note: play, drag along the waveform, skip 10 seconds.
   - Edit clip: drag the two handles to keep a stretch; play stays inside it.
   - Link to a moment: plays from that second.
   - The cassette player: play, skip and mute.
   With no script the words on the page still read; the controls just don't act.
   The look comes from voice-demo.css, the app's own player rules. */
(function () {
  "use strict";
  var box = document.querySelector(".of-voice");
  if (!box) return;

  var BARS = JSON.parse(box.getAttribute("data-bars") || "[]");
  var DUR = parseFloat(box.getAttribute("data-duration")) || 29;
  var MIN_KEEP = 1;   // the handles can't close up to nothing
  var audio = new Audio();
  audio.preload = "metadata";
  audio.src = box.getAttribute("data-src");

  var player = box.querySelector('[data-part="player"]');
  var clip = box.querySelector('[data-part="clip"]');
  var deck = box.querySelector('[data-part="deck"]');
  var seek = player.querySelector(".vn-seek");
  var lit = player.querySelector(".vn-bars.lit");
  var time = player.querySelector(".vn-time");
  var clipWave = clip.querySelector(".of-clip-wave");
  var clipLit = clip.querySelector(".vn-bars.lit");
  var clipHead = clip.querySelector(".of-clip-now");
  var dimL = clip.querySelector(".of-clip-dim-l");
  var dimR = clip.querySelector(".of-clip-dim-r");
  var inH = clip.querySelector('[data-end="in"]');
  var outH = clip.querySelector('[data-end="out"]');
  var clipTime = clip.querySelector(".of-clip-time");
  var keep = clip.querySelector(".of-clip-keep");
  var reset = clip.querySelector(".of-clip-reset");
  var mute = deck.querySelector(".of-deck-mute");

  var scope = "whole";   // "clip" = playing only the stretch between the handles
  var from = 0, to = DUR;
  var raf = 0;

  box.querySelectorAll(".vn-bars").forEach(function (row) {
    var html = "";
    for (var i = 0; i < BARS.length; i++) html += '<i style="height:' + Math.round(BARS[i] * 1000) / 10 + '%"></i>';
    row.innerHTML = html;
  });
  seek.max = String(DUR);

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function clock(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  function fine(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
  }
  function pct(t) { return (t / DUR) * 100; }
  /* A phone may not have started loading the recording yet: move it once it has. */
  function seekTo(t) {
    if (audio.readyState >= 1) { audio.currentTime = t; return; }
    audio.addEventListener("loadedmetadata", function once() {
      audio.removeEventListener("loadedmetadata", once);
      audio.currentTime = t;
    });
  }

  /* Play and pause are one icon whose halves morph (voice-demo.css). Safari
     can't morph them, so the shapes are also written straight onto the icon. */
  var PP = { play: ["M8.6 6.67L12.93 9.34L12.93 14.66L8.6 17.33Z", "M12.93 9.34L17.26 12L17.26 12L12.93 14.66Z"],
    pause: ["M7.4 6.1L9.8 6.1L9.8 17.9L7.4 17.9Z", "M14.2 6.1L16.6 6.1L16.6 17.9L14.2 17.9Z"] };
  var plays = [
    { el: player.querySelector(".vn-play"), scope: "whole" },
    { el: clip.querySelector(".vn-play"), scope: "clip" },
    { el: deck.querySelector(".vn-play"), scope: "whole" }
  ];
  function icons() {
    plays.forEach(function (p) {
      var on = !audio.paused && p.scope === scope;
      var d = on ? PP.pause : PP.play;
      p.el.querySelector(".pp-a").setAttribute("d", d[0]);
      p.el.querySelector(".pp-b").setAttribute("d", d[1]);
      p.el.classList.toggle("is-playing", on);
      p.el.setAttribute("aria-label", on ? "Pause" : "Play");
    });
  }

  function draw() {
    var t = clamp(audio.currentTime || 0, 0, DUR);
    lit.style.clipPath = "inset(0 " + (100 - pct(t)).toFixed(2) + "% 0 0)";
    if (document.activeElement !== seek || audio.paused) seek.value = String(t);
    var partWay = t > 0.05 && t < DUR - 0.05;
    time.textContent = !audio.paused || partWay ? clock(t) : clock(Math.round(DUR));

    var inside = clamp(t, from, to);
    clipHead.style.left = pct(inside) + "%";
    clipLit.style.clipPath = "inset(0 " + (100 - pct(inside)).toFixed(2) + "% 0 " + pct(from).toFixed(2) + "%)";
    clipTime.textContent = fine(inside - from) + " / " + fine(to - from);
  }
  function drawTrim() {
    dimL.style.width = pct(from) + "%";
    dimR.style.width = (100 - pct(to)) + "%";
    inH.style.left = pct(from) + "%";
    outH.style.left = pct(to) + "%";
    [[inH, from], [outH, to]].forEach(function (h) {
      h[0].setAttribute("aria-valuemin", "0");
      h[0].setAttribute("aria-valuemax", String(Math.round(DUR)));
      h[0].setAttribute("aria-valuenow", String(Math.round(h[1] * 10) / 10));
      h[0].setAttribute("aria-valuetext", fine(h[1]));
    });
    var trimmed = from > 0.01 || to < DUR - 0.01;
    keep.textContent = trimmed ? "Keeping " + clock(Math.round(to - from)) + " of " + clock(Math.round(DUR)) : "Drag the two handles to trim";
    reset.hidden = !trimmed;
    draw();
  }

  /* Stops at the right-hand handle, whichever clock notices first. */
  function holdInside() {
    if (scope !== "clip" || audio.paused) return;
    if (audio.currentTime >= to - 0.02) {
      audio.pause();
      audio.currentTime = from;
    }
  }
  function loop() {
    holdInside();
    draw();
    raf = audio.paused ? 0 : requestAnimationFrame(loop);
  }
  function state() {
    icons();
    cancelAnimationFrame(raf);
    raf = 0;
    if (audio.paused) draw(); else loop();
  }
  audio.addEventListener("play", state);
  audio.addEventListener("pause", state);
  audio.addEventListener("ended", state);
  audio.addEventListener("seeked", draw);
  audio.addEventListener("timeupdate", holdInside);
  audio.addEventListener("loadedmetadata", function () {
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    var wasWhole = to >= DUR - 0.01;
    DUR = audio.duration;
    seek.max = String(DUR);
    to = wasWhole ? DUR : Math.min(to, DUR);
    from = Math.min(from, to - MIN_KEEP);
    drawTrim();
  });

  function start() {
    var p = audio.play();
    if (p && p.catch) p.catch(function () { state(); });
  }
  function toggle(want) {
    if (!audio.paused && scope === want) { audio.pause(); return; }
    scope = want;
    var t = audio.currentTime || 0;
    if (want === "clip" && (t < from || t >= to - 0.15)) seekTo(from);
    if (want === "whole" && t >= DUR - 0.05) seekTo(0);
    icons();
    start();
  }
  plays.forEach(function (p) {
    p.el.addEventListener("click", function () { toggle(p.scope); });
  });

  function skip(d) {
    if (scope !== "whole") { scope = "whole"; icons(); }
    seekTo(clamp((audio.currentTime || 0) + d, 0, DUR));
    draw();
  }
  box.querySelectorAll("[data-skip]").forEach(function (b) {
    b.addEventListener("click", function () { skip(parseFloat(b.getAttribute("data-skip"))); });
  });

  seek.addEventListener("input", function () {
    if (scope !== "whole") { scope = "whole"; icons(); }
    seekTo(parseFloat(seek.value) || 0);
    draw();
  });

  /* The scissors takes you to the trim window below. */
  var scissors = player.querySelector(".of-open-edit");
  scissors.addEventListener("click", function () {
    clip.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    clip.classList.remove("is-glowing");
    void clip.offsetWidth;
    clip.classList.add("is-glowing");
    inH.focus({ preventScroll: true });
  });
  clip.addEventListener("animationend", function () { clip.classList.remove("is-glowing"); });

  /* Link to a moment. */
  var moment = box.querySelector(".of-moment");
  moment.addEventListener("click", function () {
    scope = "whole";
    seekTo(parseFloat(moment.getAttribute("data-at")) || 0);
    icons();
    start();
    draw();
  });

  mute.addEventListener("click", function () {
    audio.muted = !audio.muted;
    mute.classList.toggle("is-muted", audio.muted);
    mute.setAttribute("aria-label", audio.muted ? "Turn the sound on" : "Mute");
    mute.setAttribute("aria-pressed", audio.muted ? "true" : "false");
  });

  /* Trimming. */
  function setEnd(which, t) {
    if (which === "in") from = clamp(t, 0, to - MIN_KEEP);
    else to = clamp(t, from + MIN_KEEP, DUR);
    var now = audio.currentTime || 0;
    if (now < from || now > to) seekTo(from);
    drawTrim();
  }
  function timeAt(e) {
    var r = clipWave.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1) * DUR;
  }
  [inH, outH].forEach(function (h) {
    var which = h.getAttribute("data-end");
    h.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      h.focus({ preventScroll: true });
      h.setPointerCapture(e.pointerId);
      h.classList.add("is-held");
    });
    h.addEventListener("pointermove", function (e) {
      if (h.hasPointerCapture(e.pointerId)) setEnd(which, timeAt(e));
    });
    function letGo(e) {
      if (h.hasPointerCapture(e.pointerId)) h.releasePointerCapture(e.pointerId);
      h.classList.remove("is-held");
    }
    h.addEventListener("pointerup", letGo);
    h.addEventListener("pointercancel", letGo);
    h.addEventListener("keydown", function (e) {
      var step = e.shiftKey ? 2 : 0.5;
      var at = which === "in" ? from : to;
      if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setEnd(which, at - step); }
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setEnd(which, at + step); }
    });
  });
  /* A click on the waveform moves the playhead, inside the kept stretch. */
  clipWave.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".of-clip-handle")) return;
    if (scope !== "clip") { scope = "clip"; icons(); }
    seekTo(clamp(timeAt(e), from, to));
    draw();
  });
  reset.addEventListener("click", function () {
    from = 0;
    to = DUR;
    drawTrim();
    inH.focus({ preventScroll: true });
  });

  icons();
  drawTrim();
})();
