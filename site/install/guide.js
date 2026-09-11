/* Shared by install/windows.html and install/mac.html.

   The download is only started when the visitor arrived by clicking a Download
   button on the home page — those link here with ?dl=1. A direct visit (someone
   searching for help with the warning, a shared link) just reads the steps.

   When it does fire, it runs in a hidden <iframe> so the page the visitor is
   reading never navigates away — a cross-origin <a download> is ignored by
   browsers and opens a self-closing tab instead (see site/DESIGN.md), whereas an
   iframe pointed at GitHub's attachment response just downloads.

   macOS has three builds on each release since 2026-09-11: one per chip
   (Notealise.mac-arm64.dmg for Apple silicon, Notealise.mac-x64.dmg for Intel),
   each about half the size, and the universal Notealise.dmg that runs on either.
   The page offers the visitor's own chip when it can tell, and the universal
   build whenever it cannot — see pickMacFile. */

(function () {
  var REPO = "ReubenCullumHall/Notealise";
  var BASE = "https://github.com/" + REPO + "/releases/latest/download/";
  var FILE = { windows: "Notealise-Setup.exe", mac: "Notealise.dmg" };
  var OSNAME = { windows: "Windows", mac: "macOS" };

  var os = document.body.getAttribute("data-os");
  var name = FILE[os];
  if (!name) return;

  // The "get it again" / "download it" link always points at a stable URL. On a
  // Mac it is re-pointed once the page knows which build to offer.
  function pointLinksAt(url) {
    var links = document.querySelectorAll("a[data-download]");
    for (var i = 0; i < links.length; i++) links[i].href = url;
  }
  pointLinksAt(BASE + name);

  var wantsDownload = new URLSearchParams(location.search).has("dl");
  var already = false;
  if (wantsDownload) {
    // Drop the param so a reload or a shared link doesn't re-trigger.
    try {
      history.replaceState(null, "", location.pathname);
    } catch (e) {}

    // Reflect that the download is running, rather than inviting one.
    var msg = document.querySelector(".status-msg");
    var link = document.querySelector(".status-link");
    if (msg) msg.textContent = "Your " + (OSNAME[os] || "") + " download has started.";
    if (link) link.textContent = "Not downloading? Get it again.";

    // Fire once per tab, so a back-then-forward doesn't download twice.
    try {
      already = sessionStorage.getItem("notealise-dl-" + os) === "1";
      sessionStorage.setItem("notealise-dl-" + os, "1");
    } catch (e) {}
  }

  function start(url) {
    if (!wantsDownload || already) return;
    try {
      var frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.style.display = "none";
      frame.src = url;
      document.body.appendChild(frame);
    } catch (e) {
      /* the visible link is already wired */
    }
  }

  if (os !== "mac") return start(BASE + name);

  pickMacFile(function (file, chip) {
    pointLinksAt(BASE + file);
    var shown = document.querySelectorAll("[data-file]");
    for (var i = 0; i < shown.length; i++) shown[i].textContent = file;
    if (chip) offerOtherChip(chip);
    start(BASE + file);
  });

  /* Two questions at once — which chip is this, and does the latest release have
     a build for it — and the universal file unless both come back yes. A release
     published before the split carries only Notealise.dmg, so linking a per-chip
     name blindly would 404 until the next one ships. Never waits more than 4s:
     the universal build works on every Mac, so there is no reason to hold the
     download back for a better answer. */
  function pickMacFile(done) {
    var chip = null, names = null, pending = 2, finished = false;
    function finish(file, c) {
      if (finished) return;
      finished = true;
      done(file, c);
    }
    function settle() {
      if (--pending > 0) return;
      var own = chip ? "Notealise.mac-" + chip + ".dmg" : null;
      if (own && names && names.indexOf(own) !== -1) finish(own, chip);
      else finish(FILE.mac, null);
    }
    detectChip(function (c) { chip = c; settle(); });
    releaseAssets(function (n) { names = n; settle(); });
    setTimeout(function () { finish(FILE.mac, null); }, 4000);
  }

  function releaseAssets(done) {
    if (!window.fetch) return done(null);
    fetch("https://api.github.com/repos/" + REPO + "/releases/latest")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        done(j && j.assets ? j.assets.map(function (a) { return a.name; }) : null);
      }, function () { done(null); });
  }

  /* "arm64", "x64", or null when the browser gives nothing to go on.

     1. Chrome, Edge and Opera say outright (userAgentData, secure pages only).
     2. Otherwise the graphics chip's name, where the browser shares it: Firefox
        and Chrome give "Apple M2", "Intel Iris…", "AMD Radeon…".
     3. Safari hides the name behind "Apple GPU" on every Mac. What it cannot
        hide is what the GPU can do: ASTC texture compression is a feature of
        Apple's own GPUs, which Intel Macs' graphics chips lack. Seen offered on
        Apple silicon (2026-09-11); NOT yet checked on a real Intel Mac, which is
        why the other chip's build stays one click away on the page. A widely
        copied test that looks for S3TC sRGB instead was tried first and is
        WRONG — on an Apple silicon Mac it reads as Intel (measured 2026-09-11)
        — so do not swap it back in.
     A software renderer (SwiftShader, llvmpipe) emulates everything and says
     nothing about the chip, so it counts as no answer. */
  function detectChip(done) {
    var ua = navigator.userAgentData;
    if (ua && ua.getHighEntropyValues) {
      ua.getHighEntropyValues(["architecture"]).then(function (v) {
        if (v.architecture === "arm") done("arm64");
        else if (v.architecture === "x86") done("x64");
        else done(chipFromGraphics());
      }, function () { done(chipFromGraphics()); });
    } else {
      done(chipFromGraphics());
    }
  }

  function chipFromGraphics() {
    try {
      var gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return null;
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      var r = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      if (/swiftshader|llvmpipe|software/i.test(r)) return null;
      if (/apple m\d/i.test(r)) return "arm64";
      if (/intel|amd|radeon|nvidia|geforce/i.test(r)) return "x64";
      if (/apple gpu/i.test(r)) {
        var ext = gl.getSupportedExtensions() || [];
        return ext.indexOf("WEBGL_compressed_texture_astc") !== -1 ? "arm64" : "x64";
      }
    } catch (e) {}
    return null;
  }

  // Detection can be wrong, so the other chip's build is one click away.
  function offerOtherChip(chip) {
    var slot = document.querySelector(".status-chip");
    if (!slot) return;
    var other = document.createElement("a");
    other.href = BASE + "Notealise.mac-" + (chip === "arm64" ? "x64" : "arm64") + ".dmg";
    other.target = "_blank";
    other.rel = "noopener";
    if (chip === "arm64") {
      slot.textContent = "This is the version for Macs with Apple silicon. On an Intel Mac? ";
      other.textContent = "Get the Intel version";
    } else {
      slot.textContent = "This is the version for Macs with an Intel processor. On a Mac with Apple silicon? ";
      other.textContent = "Get that version";
    }
    slot.appendChild(other);
    slot.appendChild(document.createTextNode("."));
    slot.hidden = false;
  }
})();
