/* Which Mac build a visitor needs. Shared by the home page's "Download for
   macOS" button (mac-chooser.js) and the Mac install guide (install/guide.js).

   macOS has one build per chip since 2026-09-15: Notealise.dmg for Apple silicon
   and Notealise.intel.dmg for Intel (Reuben: Intel Macs are back, as their own
   download, so the Apple silicon one stays one app's size).

   NotealiseMacChip.pick(done) answers:
     "arm64" / "x64"  the browser says which chip this Mac has
     "single"         the latest release has only one Mac build — every release
                      up to v1.0.2 carries a universal Notealise.dmg that opens on
                      either chip, so there is nothing to ask
     null             the visitor has to be asked (Safari, always; anyone not on
                      a Mac)
   Never waits more than 4s. If GitHub cannot be reached, the release is assumed
   to have both builds — true of every release from the split on. */

(function () {
  var REPO = "ReubenCullumHall/Notealise";
  // The Intel name is fixed — see INTEL_DMG in src/shared/update.ts, and
  // src/main/macDmgNames.test.ts, which checks this line.
  var FILE = { arm64: "Notealise.dmg", x64: "Notealise.intel.dmg" };

  // `knownChip`, when given, skips detection: the visitor already answered.
  function pick(done, knownChip) {
    var chip = knownChip || null, names = null, finished = false;
    var pending = knownChip ? 1 : 2;
    function finish() {
      if (finished) return;
      finished = true;
      if (names && names.indexOf(FILE.x64) === -1) return done("single");
      done(chip);
    }
    function settled() {
      if (--pending === 0) finish();
    }
    if (!knownChip) detectChip(function (c) { chip = c; settled(); });
    releaseAssets(function (n) { names = n; settled(); });
    setTimeout(finish, 4000);
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
        gives "Apple M2", "Intel Iris…", "AMD Radeon…".
     3. Safari hides the name behind "Apple GPU" on every Mac, so it is asked.
        An ASTC-texture guess was built for Safari on 2026-09-11 and never
        checked on a real Intel Mac; Reuben chose asking over guessing.
     A software renderer (SwiftShader, llvmpipe) says nothing about the chip. */
  function detectChip(done) {
    // The chip of the device reading the page only means something if it is the
    // Mac. Someone on a Windows PC or a phone fetching it for their Mac is asked.
    if (!/Macintosh/.test(navigator.userAgent)) return done(null);
    var ua = navigator.userAgentData;
    if (ua && ua.getHighEntropyValues) {
      ua.getHighEntropyValues(["architecture"]).then(function (v) {
        if (v.architecture === "arm") done("arm64");
        // The Intel build of Chrome on an Apple silicon Mac (it comes across with
        // Migration Assistant from an old Mac) runs under Rosetta and says x86 —
        // but its graphics chip is still named "Apple M…".
        else if (v.architecture === "x86") done(chipFromGraphics() === "arm64" ? "arm64" : "x64");
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
      if (/apple [am]\d/i.test(r)) return "arm64"; // "Apple M4", or an A-series MacBook
      if (/intel|amd|radeon|nvidia|geforce/i.test(r)) return "x64";
    } catch (e) {}
    return null;
  }

  window.NotealiseMacChip = { FILE: FILE, pick: pick };
})();
