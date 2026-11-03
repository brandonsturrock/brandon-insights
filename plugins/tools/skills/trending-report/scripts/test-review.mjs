#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startReview } from "./review.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rv-"));
const reviews = [];
const PAGE = "<html><head></head><body>ORIGINAL</body></html>";

// One review over its own work dir; render/open are fakes so no browser is involved.
async function setup(name, opts = {}) {
  const workDir = path.join(tmp, name);
  fs.mkdirSync(workDir);
  const inHtml = path.join(workDir, "r.html");
  fs.writeFileSync(inHtml, PAGE);
  const outPdf = path.join(tmp, `${name}.pdf`);
  const opened = [];
  const review = await startReview({ inHtml, outPdf, cleanup: [workDir], open: f => opened.push(f), ...opts });
  reviews.push(review);
  const base = new URL(review.url).origin;
  const post = (route, body = PAGE, headers = {}) =>
    fetch(`${base}${route}${route.includes("?") ? "&" : "?"}t=${review.token}`, { method: "POST", body, headers });
  return { workDir, inHtml, outPdf, opened, review, base, post };
}

// fetch cannot override Host, so use a raw request
const statusWithHost = (url, host) => new Promise((resolve, reject) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Host: host } },
    res => { res.resume(); resolve(res.statusCode); }).on("error", reject);
});

try {
  // --- access control and the page itself ---
  const a = await setup("a");
  const { url, token } = a.review;
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{32}$/);
  assert.equal((await fetch(a.base + "/")).status, 403);                         // no token
  assert.equal((await fetch(a.base + "/?t=wrong")).status, 403);                 // wrong token
  assert.equal(await statusWithHost(url, "evil.test"), 403);                     // DNS-rebinding Host
  assert.equal(await statusWithHost(url, new URL(url).host), 200);
  assert.equal((await fetch(url, { method: "POST", headers: { Origin: "http://evil.test" } })).status, 403);
  assert.equal((await a.post("/save", PAGE, { Origin: "http://evil.test" })).status, 403);
  assert.equal((await a.post("/save", PAGE, { Origin: a.base })).status, 204);   // same-origin POST is fine
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(page.headers.get("cache-control"), "no-store");
  const body = await page.text();
  assert.match(body, /<script id="dt-review-config">window\.DT_REVIEW=\{token:"[0-9a-f]{32}"\}<\/script><\/head>/);
  assert.ok(body.includes(`token:"${token}"`) && body.includes("ORIGINAL"));
  assert.equal(fs.readFileSync(a.inHtml, "utf8"), PAGE);                         // serving never rewrites the file
  assert.equal((await fetch(`${a.base}/nope?t=${token}`)).status, 404);
  assert.equal((await fetch(`${a.base}/save?t=${token}`)).status, 404);          // GET on a POST route
  assert.equal((await a.post("/finish?theme=sepia")).status, 400);

  // --- save ---
  assert.equal((await a.post("/save", '<html><head><script id="dt-review-config">x</script></head><body>EDIT</body></html>')).status, 204);
  assert.equal(fs.readFileSync(a.inHtml, "utf8"), "<html><head></head><body>EDIT</body></html>");
  assert.deepEqual(fs.readdirSync(a.workDir), ["r.html"]);                       // temp file renamed away
  assert.equal((await a.post("/save", "")).status, 204);
  assert.equal(fs.readFileSync(a.inHtml, "utf8"), "<html><head></head><body>EDIT</body></html>"); // empty body never blanks the report
  assert.equal((await a.post("/save", "x".repeat(26 * 1024 * 1024))).status, 413);
  assert.equal(fs.readFileSync(a.inHtml, "utf8"), "<html><head></head><body>EDIT</body></html>");
  assert.match(await (await fetch(url)).text(), /EDIT/);                         // page now serves the edit

  // --- finish failure: server keeps running, nothing deleted ---
  let renderIn;
  const b = await setup("b", {
    render: ({ inHtml, outPdf, theme }) => {
      renderIn = { saved: fs.readFileSync(inHtml, "utf8"), theme };
      if (renderIn.saved.includes("FAIL")) return { ok: false, error: "boom" };
      fs.writeFileSync(outPdf, "%PDF-1.4");
      return { ok: true };
    },
  });
  const failRes = await b.post("/finish?theme=light", "<html>FAIL</html>");
  assert.equal(failRes.status, 500);
  assert.deepEqual(await failRes.json(), { ok: false, error: "boom" });
  assert.deepEqual(renderIn, { saved: "<html>FAIL</html>", theme: "light" });    // saved before rendering
  assert.ok(fs.existsSync(b.workDir));
  assert.ok(!fs.existsSync(b.outPdf));
  assert.equal((await fetch(b.review.url)).status, 200);
  assert.deepEqual(b.opened, []);

  // --- finish ok: PDF opened, work dir deleted, done resolves ---
  const okRes = await b.post("/finish?theme=dark", "<html>FINE</html>");
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), { ok: true, pdf: b.outPdf });
  assert.equal(renderIn.theme, "dark");
  assert.deepEqual(await b.review.done, { code: 0, pdf: b.outPdf });
  assert.ok(!fs.existsSync(b.workDir));
  assert.ok(fs.statSync(b.outPdf).size > 0);
  assert.deepEqual(b.opened, [b.outPdf]);
  await assert.rejects(fetch(b.review.url));                                     // server is closed

  // --- rewrite: done resolves, nothing deleted ---
  const c = await setup("c");
  const rw = await c.post("/rewrite");
  assert.equal(rw.status, 200);
  assert.deepEqual(await rw.json(), { ok: true });
  assert.deepEqual(await c.review.done, { code: 3 });
  assert.ok(fs.existsSync(c.workDir) && fs.existsSync(c.inHtml));
  assert.deepEqual(c.opened, []);

  // --- idle timeout: nothing deleted ---
  const d = await setup("d", { timeoutMs: 100 });
  assert.deepEqual(await d.review.done, { code: 4 });
  assert.ok(fs.existsSync(d.workDir));
} finally {
  for (const r of reviews) r.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
