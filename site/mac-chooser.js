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
    var url = GUIDE + "?dl=" + dl;
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
    withAnswer(function (a) {
      if (a) goToGuide(a);
      else ask();
    });
  });

})();
