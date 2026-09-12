/* Shared by install/windows.html and install/mac.html.

   The download is only started when the visitor arrived by clicking a Download
   button on the home page — those link here with ?dl=1. A direct visit (someone
   searching for help with the warning, a shared link) just reads the steps.

   When it does fire, it runs in a hidden <iframe> so the page the visitor is
   reading never navigates away — a cross-origin <a download> is ignored by
   browsers and opens a self-closing tab instead (see site/DESIGN.md), whereas an
   iframe pointed at GitHub's attachment response just downloads.

   The Mac build is Apple silicon only (Reuben, 2026-09-11). When the browser
   says plainly that this Mac has an Intel processor, the page says so instead of
   starting a download that would not open — see isIntelMac. */

(function () {
  var REPO = "ReubenCullumHall/Notealise";
  var FILE = { windows: "Notealise-Setup.exe", mac: "Notealise.dmg" };
  var OSNAME = { windows: "Windows", mac: "macOS" };

  var os = document.body.getAttribute("data-os");
  var name = FILE[os];
  if (!name) return;

  var url = "https://github.com/" + REPO + "/releases/latest/download/" + name;

  // The "get it again" / "download it" link always points at the stable URL.
  var links = document.querySelectorAll("a[data-download]");
  for (var i = 0; i < links.length; i++) links[i].href = url;

  var wantsDownload = new URLSearchParams(location.search).has("dl");
  if (!wantsDownload) return;

  // Drop the param so a reload or a shared link doesn't re-trigger.
  try {
    history.replaceState(null, "", location.pathname);
  } catch (e) {}

  var msg = document.querySelector(".status-msg");
  var link = document.querySelector(".status-link");

  if (os === "mac") {
    isIntelMac(function (intel) {
      if (intel) sayIntelUnsupported();
      else start();
    });
  } else {
    start();
  }

  function start() {
    // Reflect that the download is running, rather than inviting one.
    if (msg) msg.textContent = "Your " + (OSNAME[os] || "") + " download has started.";
    if (link) link.textContent = "Not downloading? Get it again.";

    // Fire once per tab, so a back-then-forward doesn't download twice.
    var already = false;
    try {
      already = sessionStorage.getItem("notealise-dl-" + os) === "1";
      sessionStorage.setItem("notealise-dl-" + os, "1");
    } catch (e) {}
    if (already) return;

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

  // No download is started; the link stays, in case the guess is wrong.
  function sayIntelUnsupported() {
    if (msg) msg.textContent = "Notealise needs a Mac with Apple silicon (M1 or newer). This Mac looks like it has an Intel processor, so it would not open here.";
    if (link) link.textContent = "Download it anyway";
  }

  /* True only when the browser SAYS this is an Intel Mac: Chrome, Edge and Opera
     report the architecture outright (userAgentData, secure pages only), and
     Firefox names the graphics chip ("Intel Iris…", "AMD Radeon…"). Safari hides
     the chip behind "Apple GPU" on every Mac, so Safari always gets the download
     — telling someone "you can't use this" on a Mac that can is worse than a
     download that fails. Never waits more than 2s. */
  function isIntelMac(done) {
    var answered = false;
    function answer(v) {
      if (answered) return;
      answered = true;
      done(v);
    }
    setTimeout(function () { answer(false); }, 2000);
    var ua = navigator.userAgentData;
    if (ua && ua.getHighEntropyValues) {
      ua.getHighEntropyValues(["architecture"]).then(function (v) {
        if (v.architecture === "x86") answer(true);
        else if (v.architecture === "arm") answer(false);
        else answer(graphicsSayIntel());
      }, function () { answer(graphicsSayIntel()); });
    } else {
      answer(graphicsSayIntel());
    }
  }

  function graphicsSayIntel() {
    try {
      var gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return false;
      var dbg = gl.getExtension("WEBGL_debug_renderer_info");
      var r = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
      return /intel|amd|radeon|nvidia|geforce/i.test(r) && !/apple m\d/i.test(r);
    } catch (e) {
      return false;
    }
  }
})();
