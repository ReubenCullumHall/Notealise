/* "Download for macOS" on the home page (Reuben, 2026-09-15). Needs mac-chip.js.

   When the browser says which chip this Mac has, the button goes straight to
   the install guide, which downloads that build. When it cannot — Safari, every
   time, or a visitor who is not on a Mac — a "Which Mac do you have?" popup asks
   first, in the home page's own theme (mac-chooser.css), and the answer goes to
   the guide as ?dl=arm64 / ?dl=x64. The guide starts the download and shows how to
   open it. Without JavaScript, or without <dialog> (Safari before 15.4), the
   button stays a plain link to install/mac.html?dl=1 and the guide works it out. */

(function () {
  var btn = document.getElementById("macBtn");
  var Mac = window.NotealiseMacChip;
  if (!btn || !Mac) return;
  var GUIDE = btn.getAttribute("href").split("?")[0];

  var dialog = document.createElement("dialog");
  if (typeof dialog.showModal !== "function") return;
  dialog.className = "mac-chooser";
  dialog.setAttribute("aria-labelledby", "mac-chooser-title");
  var arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>';
  dialog.innerHTML =
    '<form method="dialog">' +
      '<p class="mc-eyebrow">macOS</p>' +
      '<h2 class="mc-title" id="mac-chooser-title" tabindex="-1" autofocus>Which Mac do you have?</h2>' +
      '<p class="mc-lede">Notealise comes in a version for each kind of Mac. To check, open the <strong>Apple menu &rarr; About This Mac</strong> and pick the one that matches.</p>' +
      '<div class="mc-options">' +
        '<button class="mc-option" value="arm64">' +
          '<span class="mc-option-name">Apple silicon' + arrow + '</span>' +
          '<span class="mc-option-says"><span class="mc-hint">About This Mac shows</span>' +
          '<span class="mc-kv"><span>Chip</span> Apple M1, M2, M3&hellip;</span></span>' +
        '</button>' +
        '<button class="mc-option" value="x64">' +
          '<span class="mc-option-name">Intel' + arrow + '</span>' +
          '<span class="mc-option-says"><span class="mc-hint">About This Mac shows</span>' +
          '<span class="mc-kv"><span>Processor</span> &hellip;Intel Core i5, i7&hellip;</span></span>' +
        '</button>' +
      '</div>' +
      '<div class="mc-actions"><button class="mc-cancel" value="">Cancel</button></div>' +
    '</form>';
  document.body.appendChild(dialog);

  /* Getting to the guide smoothly (Reuben, 2026-09-15). Browsers with
     cross-page view transitions crossfade into it on their own — nav.css and
     install/guide.css both opt in, and the guide's content rises into place.
     The rest fade this page out here and the guide fades in on arrival. */
  var reduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var crossPage = "onpagereveal" in window;
  var root = document.documentElement;

  function goToGuide(answer) {
    var dl = answer === "arm64" || answer === "x64" ? answer : "1";
    var url = GUIDE + "?dl=" + dl + (devAlwaysAsk() ? "&dev" : "");
    if (reduced || crossPage) return void (location.href = url);
    root.classList.add("mc-leaving");
    setTimeout(function () { location.href = url; }, 200);
  }

  function ask() {
    if (!dialog.open) dialog.showModal();
  }

  // Every way out of the popup runs its exit animation first: a card (go to the
  // guide), Cancel, or Esc.
  function leave(chip) {
    if (dialog.classList.contains("is-leaving")) return;
    var picked = chip === "arm64" || chip === "x64";
    if (reduced) {
      dialog.close();
      if (picked) goToGuide(chip);
      return;
    }
    dialog.classList.add("is-leaving");
    setTimeout(function () {
      dialog.close();
      dialog.classList.remove("is-leaving");
      if (picked) goToGuide(chip);
    }, 180);
  }
  dialog.querySelector("form").addEventListener("submit", function (e) {
    e.preventDefault();
    leave(e.submitter ? e.submitter.value : "");
  });
  dialog.addEventListener("cancel", function (e) {
    e.preventDefault();
    leave("");
  });

  // Back from the guide can restore this page exactly as it was left — faded
  // out. Put it back.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) root.classList.remove("mc-leaving");
  });

  // The answer is fetched once, starting as soon as the visitor reaches for the
  // button, so the click itself rarely waits on GitHub.
  var answer, known = false, waiting = [];
  function withAnswer(cb) {
    if (known) return cb(answer);
    waiting.push(cb);
    if (waiting.length > 1) return;
    Mac.pick(function (a) {
      answer = a;
      known = true;
      var w = waiting;
      waiting = [];
      for (var i = 0; i < w.length; i++) w[i](a);
    });
  }
  ["pointerenter", "focus", "touchstart"].forEach(function (type) {
    btn.addEventListener(type, function () { withAnswer(function () {}); }, { once: true, passive: true });
  });

  btn.addEventListener("click", function (e) {
    // Cmd/Ctrl/Shift/middle-click keep their usual meaning: open the guide.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (devAlwaysAsk()) return ask();
    withAnswer(function (a) {
      if (a) goToGuide(a);
      else ask();
    });
  });

  /* DEV_CHOOSER_BUTTON — temporary (Reuben, 2026-09-15). A dev-only switch that
     makes "Download for macOS" always ask, so the popup can be seen before any
     release carries both Mac builds (until then the real button never asks). It
     also tells the guide to act as if the release had both, so the page after a
     pick looks as it will — an Intel pick downloads nothing until that release
     exists. Shown on local addresses or with ?dev in the URL, never otherwise —
     the same rule as nav.js's theme switch, and it sits just above that switch.
     To remove: delete this block, devAlwaysAsk() and its three uses above, the
     `dev` checks in install/guide.js, and .dev-chooser in mac-chooser.css — grep
     the tag. */
  var DEV_KEY = "nl-dev-mac-chooser";
  function devAlwaysAsk() {
    try { return !!devSwitch && localStorage.getItem(DEV_KEY) === "ask"; } catch (e) { return false; }
  }
  var devSwitch = null;
  (function () {
    var host = location.hostname;
    var local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host) ||
      /\.local$/.test(host) ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
    if (!local && !/[?&]dev(=|&|$)/.test(location.search)) return;
    devSwitch = document.createElement("button");
    devSwitch.type = "button";
    devSwitch.className = "dev-chooser";
    devSwitch.setAttribute("aria-label", "Mac chooser: always ask (dev only)");
    function label() {
      devSwitch.innerHTML = "<b>Mac chooser</b>" + (devAlwaysAsk() ? "Always ask" : "Normal");
    }
    devSwitch.addEventListener("click", function () {
      try {
        if (devAlwaysAsk()) localStorage.removeItem(DEV_KEY);
        else localStorage.setItem(DEV_KEY, "ask");
      } catch (e) {}
      label();
    });
    document.body.appendChild(devSwitch);
    label();
  })();
})();
