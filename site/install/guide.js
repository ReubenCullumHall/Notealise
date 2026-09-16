/* Shared by install/windows.html and install/mac.html.

   The download is only started when the visitor arrived by clicking a Download
   button on the home page — those link here with ?dl. A direct visit (someone
   searching for help with the warning, a shared link) just reads the steps.

   When it does fire, it runs in a hidden <iframe> so the page the visitor is
   reading never navigates away — a cross-origin <a download> is ignored by
   browsers and opens a self-closing tab instead (see site/DESIGN.md), whereas an
   iframe pointed at GitHub's attachment response just downloads.

   macOS has one build per chip since 2026-09-15 (see ../mac-chip.js). The home
   page works out which one the visitor needs — asking in a popup when the
   browser will not say — and links here with ?dl=arm64 or ?dl=x64. ?dl=1 (no
   answer: an old link, or a browser without <dialog>) is worked out here, and
   when it cannot be, the status strip asks. */

(function () {
  var REPO = "ReubenCullumHall/Notealise";
  var BASE = "https://github.com/" + REPO + "/releases/latest/download/";
  var FILE = { windows: "Notealise-Setup.exe", mac: "Notealise.dmg" };
  var OSNAME = { windows: "Windows", mac: "macOS" };

  var os = document.body.getAttribute("data-os");
  var name = FILE[os];
  if (!name) return;

  var msg = document.querySelector(".status-msg");
  var link = document.querySelector(".status-link");

  // The "get it again" / "download it" link always points at a stable URL. On a
  // Mac it is re-pointed once the visitor's chip is known.
  function pointLinksAt(file) {
    var links = document.querySelectorAll("a[data-download]");
    for (var i = 0; i < links.length; i++) links[i].href = BASE + file;
  }
  pointLinksAt(name);

  var params = new URLSearchParams(location.search);
  var wantsDownload = params.has("dl");
  var dlChip = params.get("dl");
  if (wantsDownload) {
    // Drop the param so a reload or a shared link doesn't re-trigger.
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {}
  }

  // Fire once per tab and file, so a back-then-forward doesn't download twice —
  // but going back and picking the other Mac does. A choice the visitor makes on
  // this page always downloads.
  function alreadyDownloaded(file) {
    try {
      return sessionStorage.getItem("notealise-dl-" + os) === file;
    } catch (e) {
      return false;
    }
  }

  function sayStarted() {
    if (msg) msg.textContent = "Your " + (OSNAME[os] || "") + " download has started.";
    if (link) link.textContent = "Not downloading? Get it again.";
  }

  function start(file, byHand) {
    // Reflect that the download is running, rather than inviting one.
    sayStarted();

    var already = !byHand && alreadyDownloaded(file);
    try {
      sessionStorage.setItem("notealise-dl-" + os, file);
    } catch (e) {}
    if (already) return;

    try {
      var frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.display = "none";
      frame.src = BASE + file;
      document.body.appendChild(frame);
    } catch (e) {
      /* the visible link is already wired */
    }
  }

  var Mac = window.NotealiseMacChip;
  if (os !== "mac" || !Mac) {
    if (wantsDownload) start(name, false);
    return;
  }

  /* ---- macOS: which chip ------------------------------------------------ */

  var slot = document.querySelector(".status-chip");
  var chosen = null; // the file this page has settled on, once it has

  function settleOnFile(file) {
    chosen = file;
    pointLinksAt(file);
    var shown = document.querySelectorAll("[data-file]");
    for (var i = 0; i < shown.length; i++) shown[i].textContent = file;
  }

  function slotButton(text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "linkish";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // One line under the status naming the version, with the other one a click
  // away — detection can be wrong, and a visitor can pick the wrong card.
  function sayWhichVersion(chip) {
    if (!slot) return;
    var other = chip === "x64" ? "arm64" : "x64";
    slot.textContent = chip === "x64"
      ? "This is the version for Intel Macs. "
      : "This is the version for Macs with Apple silicon. ";
    slot.appendChild(slotButton(
      chip === "x64" ? "On a Mac with Apple silicon? Get that version" : "On an Intel Mac? Get the Intel version",
      function () { download(other, true); }
    ));
    slot.hidden = false;
  }

  function download(chip, byHand) {
    settleOnFile(Mac.FILE[chip]);
    sayWhichVersion(chip);
    start(Mac.FILE[chip], byHand);
  }

  // The same question the home page's popup asks, as two choices in the strip.
  function askHere() {
    if (msg) msg.textContent = "Choose your Mac to start the download.";
    if (!slot) return;
    slot.textContent = "Which Mac do you have? Check in Apple menu → About This Mac: ";
    slot.appendChild(slotButton("Apple silicon", function () { download("arm64", true); }));
    slot.appendChild(document.createTextNode(" or "));
    slot.appendChild(slotButton("Intel", function () { download("x64", true); }));
    slot.hidden = false;
  }

  function settle(answer, byHand) {
    if (answer === "single") {
      if (slot) slot.hidden = true;
      settleOnFile(Mac.FILE.arm64);
      return start(Mac.FILE.arm64, byHand);
    }
    if (answer) return download(answer, byHand);
    askHere();
  }

  // One question at a time: a double-click, or a click while the page is still
  // working out the chip, would otherwise download the file twice.
  var asking = false;
  function ask(byHand, knownChip) {
    if (asking) return;
    asking = true;
    Mac.pick(function (answer) {
      asking = false;
      settle(answer, byHand);
    }, knownChip);
  }

  // Until a file is settled on, the link works out (or asks) which build to
  // give. Without JavaScript it is a plain link to the Apple silicon one.
  if (link) {
    link.addEventListener("click", function (e) {
      if (chosen) return;
      e.preventDefault();
      ask(true);
    });
  }

  if (wantsDownload) {
    // An answer from the home page still checks the release has that build:
    // before the first release with both, the one universal file is the right
    // download for either answer.
    var answered = dlChip === "arm64" || dlChip === "x64" ? dlChip : null;
    ask(false, answered || undefined);
  }
})();
