/* Shared by install/windows.html and install/mac.html.

   The download is only started when the visitor arrived by clicking a Download
   button on the home page — those link here with ?dl=1. A direct visit (someone
   searching for help with the warning, a shared link) just reads the steps.

   When it does fire, it runs in a hidden <iframe> so the page the visitor is
   reading never navigates away — a cross-origin <a download> is ignored by
   browsers and opens a self-closing tab instead (see site/DESIGN.md), whereas an
   iframe pointed at GitHub's attachment response just downloads. */

(function () {
  var REPO = "ReubenCullumHall/Notes-app";
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

  // Reflect that the download is running, rather than inviting one.
  var msg = document.querySelector(".status-msg");
  var link = document.querySelector(".status-link");
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
})();
