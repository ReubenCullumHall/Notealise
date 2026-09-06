import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { createHash } from 'node:crypto'

// The renderer's Content-Security-Policy, injected into index.html.
//
// `img-src` / `media-src` are the directives with teeth here, and they admit no
// remote scheme at all. An embed's target comes out of note text, and note text
// arrives from other people — a shared .md, a Notion export, a synced folder.
// A note holding `![](https://tracker/p.gif?v=you)` was a working read receipt:
// the request fired the moment the line scrolled into view and told its author
// when the note was opened, with no script involved anywhere. `file:` is absent
// for the mirror-image reason — `![](file:///Users/you/Pictures/private.jpg)`
// displayed any file on the disk, straight past the vault boundary that every
// IPC read honours.
//
// Pictures IN the vault are unaffected: they are read over IPC and shown as
// `blob:` URLs, which is why that scheme is listed. `data:` in `font-src` is not
// optional — settings/fontLoader.ts injects downloaded and custom typefaces as
// FontFace objects built from base64 the main process hands across, so dropping
// it silently un-renders all 16 downloadable fonts, and that failure looks
// exactly like a font that never downloaded.
//
// `script-src 'self'` is what makes the rest of it worth having: it is the line
// that turns "someone got HTML into a note" from a compromise of the whole
// window.api surface into a rendering bug.
function policy(dev: boolean, scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    // Dev and packaged differ here, and only here.
    //
    // The shipped page runs exactly two kinds of script: the bundled modules
    // (covered by 'self') and index.html's inline pre-paint block, which reads
    // the cached theme and stamps <html> before React exists. That block is
    // covered by its own SHA-256, computed below from the real HTML — a
    // `script-src 'self'` alone silently blocks it, and the symptom is not an
    // error anyone would see: the app just opens on the wrong theme for a beat,
    // every launch, because the static dark/cozy fallback is all that is left.
    //
    // Dev cannot use hashes: Vite injects its own inline bootstrap and the
    // react-refresh preamble, and their contents move. 'unsafe-inline' there
    // keeps HMR working — the alternative was a renderer running without hot
    // reload, which is a trap for whoever next verifies UI work at :5173.
    dev ? "script-src 'self' 'unsafe-inline'" : ["script-src 'self'", ...scriptHashes].join(' '),
    // CodeMirror's decorations and the theme layer both set inline styles from
    // JS. There is no way to run this interface without it.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    // Dev serves the renderer from http://localhost and pushes hot updates over
    // a websocket, which `'self'` does not cover — ws: is a different scheme.
    // The shipped build talks to nothing at all.
    dev ? "connect-src 'self' ws: http://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/** Put the policy in the HTML, rather than in a response header from main.
 *
 *  A packaged build loads the renderer with `loadFile` — `file://` — and a
 *  file:// request is served by Chromium's protocol handler rather than its
 *  network stack, so `session.webRequest.onHeadersReceived` is not a reliable
 *  place to attach a header to it. A control that fires in dev over
 *  http://localhost and silently does nothing in the shipped app is the worst
 *  shape this could take: it would test clean every single time. */
function csp(): Plugin {
  return {
    name: 'notealise-csp',
    transformIndexHtml: {
      // 'post', so the HTML being hashed is the FINAL one — after Vite has
      // injected its own tags. Hashing the pre-transform HTML would produce a
      // policy that is correct about a document that never ships.
      order: 'post',
      handler(html, ctx) {
        const dev = !!ctx.server
        const hashes: string[] = []
        if (!dev) {
          for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
            const digest = createHash('sha256').update(m[1], 'utf8').digest('base64')
            hashes.push(`'sha256-${digest}'`)
          }
        }
        const tag = `<meta http-equiv="Content-Security-Policy" content="${policy(dev, hashes)}" />`
        return html.replace('<head>', `<head>\n    ${tag}`)
      }
    }
  }
}

// electron-vite resolves default entries automatically:
//   main    -> src/main/index.ts
//   preload -> src/preload/index.ts
//   renderer-> src/renderer/index.html (root: src/renderer)
// externalizeDepsPlugin keeps node deps (e.g. chokidar) out of the main/preload
// bundles so they load from node_modules at runtime.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // Apple Notes only exists on macOS, and the release builds each platform
      // on its own runner (.github/workflows/release.yml, matrix.os), so this is
      // a real constant per build. With it false, rollup drops the guarded
      // block in ipc.ts — including the dynamic import inside it — so the
      // module never reaches the Windows bundle at all. A STATIC import would
      // be hoisted and survive; the dynamic one is the whole point.
      __MAC_BUILD__: JSON.stringify(process.platform === 'darwin')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), csp()]
  }
})
