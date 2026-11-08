/* Students page, 02 Voice notes (voice-demo.css).
   1. The edit video: loops quietly; a click turns the sound on, another turns it
      off, and it goes quiet by itself when it scrolls out of sight.
   2. A voice note to try: play, scrub, skip, and the mixer (Volume, Tone, Speed)
      work as in the app (voiceMixer.ts's numbers); the scissors says editing is
      in the app; Transcribe shows the words, which light up as they're said. */
(function () {
  "use strict";
  var root = document.querySelector("[data-voice-demo]");
  if (!root) return;
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── 1. The video ─────────────────────────────────────────────────── */
  var film = root.querySelector(".vn-film");
  var video = film && film.querySelector("video");
  var hit = film && film.querySelector(".vn-hit");
  var flashTimer = 0;
  var onScreen = false;

  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function pickSource() {
    if (!video) return;
    var want = video.getAttribute(isDark() ? "data-dark" : "data-light");
    var poster = video.getAttribute(isDark() ? "data-dark-poster" : "data-light-poster");
    if (video.getAttribute("src") === want) return;
    var t = video.currentTime || 0;
    var wasPlaying = !video.paused;
    video.setAttribute("poster", poster);
    video.setAttribute("src", want);
    video.addEventListener("loadedmetadata", function once() {
      video.removeEventListener("loadedmetadata", once);
      try { video.currentTime = t; } catch (e) {}
      if (wasPlaying || (onScreen && !reduced)) play();
    });
  }
  function play() { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
  function flash() {
    film.classList.add("is-flash");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { film.classList.remove("is-flash"); }, 900);
  }
  function setSound(on) {
    video.muted = !on;
    film.classList.toggle("is-sound", on);
    film.classList.toggle("is-muted", !on);
    hit.setAttribute("aria-label", on ? "Turn the sound off" : "Turn the sound on");
    hit.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (video && hit) {
    video.muted = true;
    film.classList.add("is-muted", "is-asking");
    pickSource();
    hit.addEventListener("click", function () {
      film.classList.remove("is-asking");
      var on = video.muted;
      if (on) { stopNote(); if (video.paused) play(); }
      setSound(on);
      flash();
    });
    // Out of sight: quiet, and paused so it costs nothing. Back in sight: playing again, quiet.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          onScreen = e.isIntersecting && e.intersectionRatio >= 0.25;
          if (onScreen) { if (!reduced) play(); }
          else { if (!video.muted) setSound(false); video.pause(); }
        });
      }, { threshold: [0, 0.25] }).observe(film);
    } else if (!reduced) play();
    var mq = window.matchMedia && matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", pickSource);
    new MutationObserver(pickSource).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  /* ── 2. The voice note ────────────────────────────────────────────── */
  var vn = root.querySelector(".vn");
  if (!vn) return;
  var audio = new Audio();
  audio.preload = "metadata";
  audio.src = vn.getAttribute("data-src");
  if ("preservesPitch" in audio) audio.preservesPitch = true;
  if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = true;

  var DUR = parseFloat(vn.getAttribute("data-duration")) || 10.4;
  var BARS = JSON.parse(vn.getAttribute("data-bars") || "[]");
  // [word, from s, to s] — each word of the transcript and when it is said
  var WORDS = JSON.parse(vn.getAttribute("data-words") || "[]");

  var playBtn = vn.querySelector(".vn-play");
  var seek = vn.querySelector(".vn-seek");
  var lit = vn.querySelector(".vn-bars.lit");
  var time = vn.querySelector(".vn-time");
  var back = vn.querySelector("[data-skip='-10']");
  var fwd = vn.querySelector("[data-skip='10']");
  var edit = vn.querySelector(".vn-edit");
  var mixBtn = vn.querySelector(".vn-mixbtn");
  var mixer = vn.querySelector(".vn-mixer");
  var txline = vn.querySelector(".vn-txline");
  var txBtn = vn.querySelector(".vn-txstart");
  var tx = vn.querySelector(".vn-tx");
  var txText = vn.querySelector(".vn-tx-text");

  // the bars, twice: faint underneath, strong on top (clipped to the played part)
  vn.querySelectorAll(".vn-bars").forEach(function (row) {
    var html = "";
    for (var i = 0; i < BARS.length; i++) html += '<i style="height:' + Math.round(BARS[i] * 1000) / 10 + '%"></i>';
    row.innerHTML = html;
  });
  seek.max = String(DUR);

  function clock(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
  var playing = false;
  var raf = 0;
  function draw() {
    var p = Math.min(DUR, audio.currentTime || 0);
    var pct = DUR ? (p / DUR) * 100 : 0;
    lit.style.clipPath = "inset(0 " + (100 - pct).toFixed(2) + "% 0 0)";
    if (document.activeElement !== seek) seek.value = String(p);
    var partWay = p > 0.05 && p < DUR - 0.05;
    time.textContent = playing || partWay ? clock(p) : clock(Math.max(1, Math.round(DUR)));
    if (txText && !tx.hidden) {
      var spans = txText.children;
      for (var i = 0; i < spans.length; i++) spans[i].classList.toggle("said", p >= WORDS[i][1] - 0.02);
    }
  }
  function loop() { draw(); if (playing) raf = requestAnimationFrame(loop); }

  // The sound goes through the same chain as the app's (voicePlayer.ts): two
  // shelves for Tone, a gain for Volume, a limiter so 200% doesn't crackle.
  var ctx = null, low = null, high = null, gain = null;
  function graph() {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      var src = ctx.createMediaElementSource(audio);
      low = ctx.createBiquadFilter(); low.type = "lowshelf"; low.frequency.value = 250;
      high = ctx.createBiquadFilter(); high.type = "highshelf"; high.frequency.value = 3500;
      gain = ctx.createGain();
      var lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
      src.connect(low); low.connect(high); high.connect(gain); gain.connect(lim); lim.connect(ctx.destination);
      applyMix();
    } catch (e) { ctx = null; }
  }

  // Play and pause are one icon whose two halves morph (the CSS `d` rules). Safari can't
  // morph them, so the shapes are also written straight onto the icon here.
  var PP = { play: ["M8.6 6.67L12.93 9.34L12.93 14.66L8.6 17.33Z", "M12.93 9.34L17.26 12L17.26 12L12.93 14.66Z"],
    pause: ["M7.4 6.1L9.8 6.1L9.8 17.9L7.4 17.9Z", "M14.2 6.1L16.6 6.1L16.6 17.9L14.2 17.9Z"] };
  var ppA = playBtn.querySelector(".pp-a"), ppB = playBtn.querySelector(".pp-b");
  function ppShape(on) { var d = on ? PP.pause : PP.play; ppA.setAttribute("d", d[0]); ppB.setAttribute("d", d[1]); }
  ppShape(false);
  function setPlaying(on) {
    playing = on;
    ppShape(on);
    playBtn.classList.toggle("is-playing", on);
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    cancelAnimationFrame(raf);
    if (on) loop(); else draw();
  }
  function startNote() {
    graph();
    if (ctx && ctx.state === "suspended") ctx.resume();
    if (audio.currentTime >= DUR - 0.05) audio.currentTime = 0;
    // one sound at a time: the video goes quiet
    if (video && !video.muted) { setSound(false); }
    var p = audio.play();
    if (p && p.catch) p.catch(function () { setPlaying(false); });
    playBtn.classList.remove("vn-glow");
  }
  function stopNote() { if (!audio.paused) audio.pause(); }
  audio.addEventListener("play", function () { setPlaying(true); });
  audio.addEventListener("pause", function () { setPlaying(false); });
  audio.addEventListener("ended", function () { setPlaying(false); });
  playBtn.addEventListener("click", function () { if (audio.paused) startNote(); else stopNote(); });

  seek.addEventListener("input", function () { audio.currentTime = parseFloat(seek.value) || 0; draw(); });
  function skip(d) { audio.currentTime = Math.max(0, Math.min(DUR, (audio.currentTime || 0) + d)); draw(); }
  back.addEventListener("click", function () { skip(-10); });
  fwd.addEventListener("click", function () { skip(10); });

  // the scissors: tapping it shows the same note pointing at it does
  var toldTimer = 0;
  edit.addEventListener("click", function () {
    edit.classList.add("is-told");
    clearTimeout(toldTimer);
    toldTimer = setTimeout(function () { edit.classList.remove("is-told"); }, 2200);
  });

  /* The mixer — the app's ranges and labels (voiceMixer.ts). */
  var mix = { volume: 1, tone: 0, speed: 1 };
  var SPEED_MIN = 0.5, SPEED_MAX = 3, SPAN = Math.log(SPEED_MAX / SPEED_MIN);
  function r2(n) { return Math.round(n * 100) / 100; }
  function valueFrom(key, pos) {
    if (key === "speed") return Math.min(SPEED_MAX, Math.max(SPEED_MIN, r2(Math.round(SPEED_MIN * Math.exp((pos / 1000) * SPAN) * 20) / 20)));
    return r2(pos / 100);
  }
  function posFrom(key, v) { return key === "speed" ? Math.round((Math.log(v / SPEED_MIN) / SPAN) * 1000) : Math.round(v * 100); }
  function label(key, v) {
    if (key === "volume") return Math.round(v * 100) + "%";
    if (key === "speed") return String(r2(v)) + "×";
    return r2(v) === 0 ? "0" : (v > 0 ? "+" : "−") + String(r2(Math.abs(v)));
  }
  function applyMix() {
    audio.playbackRate = mix.speed;
    if (gain) gain.gain.value = mix.volume; else audio.volume = Math.min(1, mix.volume);
    if (low) { low.gain.value = -mix.tone * 8; high.gain.value = mix.tone * 8; }
    mixBtn.classList.toggle("changed", mix.volume !== 1 || mix.tone !== 0 || mix.speed !== 1);
  }
  var sliders = mixer.querySelectorAll("input[type=range]");
  function showMix() {
    sliders.forEach(function (s) {
      var k = s.getAttribute("data-key");
      s.value = String(posFrom(k, mix[k]));
      mixer.querySelector("[data-value='" + k + "']").textContent = label(k, mix[k]);
    });
  }
  sliders.forEach(function (s) {
    s.addEventListener("input", function () {
      var k = s.getAttribute("data-key");
      mix[k] = valueFrom(k, parseFloat(s.value));
      mixer.querySelector("[data-value='" + k + "']").textContent = label(k, mix[k]);
      applyMix();
    });
  });
  mixer.querySelector(".vn-reset").addEventListener("click", function () {
    mix = { volume: 1, tone: 0, speed: 1 }; showMix(); applyMix();
  });
  mixBtn.addEventListener("click", function () {
    var open = mixer.hidden;
    mixer.hidden = !open;
    mixBtn.classList.toggle("on", open);
    mixBtn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  /* Transcribe: a short "working it out", then the words. */
  if (txText) {
    txText.innerHTML = "";
    WORDS.forEach(function (w, i) {
      var s = document.createElement("span");
      s.textContent = w[0];
      txText.appendChild(s);
      if (i < WORDS.length - 1) txText.appendChild(document.createTextNode(" "));
    });
    // keep only the word spans as children (spaces are text nodes, not counted)
  }
  txBtn.addEventListener("click", function () {
    txBtn.classList.remove("vn-glow");
    var slot = txBtn.parentNode;
    var bar = document.createElement("span");
    bar.className = "vn-txbar";
    bar.innerHTML = '<span class="vn-txfill"></span>';
    var words = document.createElement("span");
    words.textContent = "Transcribing…";
    slot.style.display = "none";
    txline.style.justifyContent = "flex-start";
    txline.appendChild(bar); txline.appendChild(words);
    var fill = bar.firstChild, steps = [18, 46, 71, 92, 100], k = 0;
    var tick = setInterval(function () {
      fill.style.transform = "scaleX(" + steps[k] / 100 + ")"; k++;
      if (k === steps.length) {
        clearInterval(tick);
        setTimeout(function () {
          txline.hidden = true;
          tx.hidden = false;
          tx.classList.add("is-new");
          draw();
          if (!playing) playBtn.classList.add("vn-glow");
        }, 260);
      }
    }, reduced ? 120 : 260);
  });

  draw();
})();
