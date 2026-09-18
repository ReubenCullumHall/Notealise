/* slow-site.js — serves site/ over a deliberately slow, shared pipe, so the
   landing page can be watched loading the way a visitor on weak wifi sees it.

     node tools/slow-site.js site                 # ~1.6 Mbit/s, 150ms  (weak wifi)
     KBPS=400 LATENCY=300 node tools/slow-site.js site   # two bars of phone signal
     PORT=8020 node tools/slow-site.js site       # if 8011 is taken

   Then open http://localhost:8011/ . Reload with the browser's cache off, or the
   second load tells you nothing. The loading screen only shows once per browser
   session, so use a new private window for each run.


   Why not DevTools throttling: this works in any browser, including a phone on
   the same wifi, with no developer tools open.

   Faithfulness to GitHub Pages: text files are gzipped before they are metered,
   because Pages gzips them too. Metering the uncompressed bytes would have
   exaggerated the CSS/JS cost by roughly 3x and sent us after the wrong file.

   The pipe is SHARED across every connection, like real wifi: one token bucket
   for the whole server, refilled 50x a second. Each response also waits LATENCY
   ms before its first byte (round-trip time). */
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = process.argv[2];
const PORT = Number(process.env.PORT || 8011);
// Defaults: ~1.6 Mbit/s down, 150ms RTT — Chrome's own "Fast 3G", which is a
// fair stand-in for a weak cafe/hotel wifi or a phone on two bars.
const KBPS = Number(process.env.KBPS || 1600);          // kilobits per second
const LATENCY = Number(process.env.LATENCY || 150);     // ms before first byte
const BYTES_PER_SEC = (KBPS * 1000) / 8;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".mp4": "video/mp4", ".woff2": "font/woff2", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".ico": "image/x-icon",
};
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest))|javascript|svg/;

/* ── the shared pipe ───────────────────────────────────────────────────── */
let tokens = 0;
const TICK = 20; // ms
setInterval(() => {
  // Ceiling is 100ms of capacity, not a full second: an idle bucket that has
  // banked a whole second lets the next file through almost instantly, which is
  // exactly the burst that made two identical test runs disagree.
  tokens = Math.min(tokens + (BYTES_PER_SEC * TICK) / 1000, BYTES_PER_SEC * 0.1);
  drain();
}, TICK).unref();

const queue = []; // { buf, offset, res, done }
function drain() {
  while (tokens >= 1 && queue.length) {
    const job = queue[0];
    if (job.res.destroyed) { queue.shift(); job.done(); continue; }
    const take = Math.min(Math.floor(tokens), job.buf.length - job.offset, 16 * 1024);
    if (take <= 0) break;
    tokens -= take;
    job.res.write(job.buf.subarray(job.offset, job.offset + take));
    job.offset += take;
    if (job.offset >= job.buf.length) { queue.shift(); job.res.end(); job.done(); }
  }
}
function meteredSend(res, buf) {
  return new Promise((done) => { queue.push({ buf, offset: 0, res, done }); drain(); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the server ────────────────────────────────────────────────────────── */
http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, url);
  if (url.endsWith("/")) file = path.join(file, "index.html");
  if (!path.resolve(file).startsWith(path.resolve(ROOT))) { res.writeHead(403).end(); return; }

  let body;
  try { body = fs.readFileSync(file); }
  catch { res.writeHead(404, { "content-type": "text/plain" }).end("not found"); return; }

  const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  const gzip = COMPRESSIBLE.test(type) && /gzip/.test(req.headers["accept-encoding"] || "");
  if (gzip) body = zlib.gzipSync(body, { level: 6 });

  const head = {
    "content-type": type,
    "content-length": String(body.length),
    "cache-control": "no-store",          // every reload is a cold load
    "accept-ranges": "none",
  };
  if (gzip) head["content-encoding"] = "gzip";

  await sleep(LATENCY);                    // round-trip time
  if (res.destroyed) return;
  res.writeHead(200, head);
  await meteredSend(res, body);
  console.log(`${String(body.length).padStart(7)}B  ${gzip ? "gz" : "  "}  ${url}`);
}).listen(PORT, () => {
  console.log(`serving ${ROOT} on http://localhost:${PORT}  (${KBPS} kbit/s, ${LATENCY}ms RTT)`);
});
