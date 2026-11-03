#!/usr/bin/env node
// Local review page: serves the report on 127.0.0.1, autosaves edits back to the HTML, renders the PDF on request.
//   node review.mjs --in <report.html> --out <file.pdf> [--cleanup <path>...]
// Prints "Review: <url>", then exits 0 (PDF done, prints "PDF: <path>"), 3 (rewrite requested), 4 (timed out), 2 (no browser/usage), 1 (bad input).
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NO_BROWSER, cleanupTargets, expandHome, findBrowser, finalize, openFile, renderPdf } from "./render-pdf.mjs";

const MAX_BODY = 25 * 1024 * 1024;
const CONFIG = /<script id="dt-review-config">[\s\S]*?<\/script>/g;

export async function startReview({ inHtml, outPdf, cleanup = [], timeoutMs = 3600000, render = renderPdf, open = openFile }) {
  const token = crypto.randomBytes(16).toString("hex");
  let port, timer, resolveDone, closed = false;
  const done = new Promise(r => { resolveDone = r; });
  const server = http.createServer((req, res) => handle(req, res).catch(e => {
    arm();
    if (!res.headersSent) send(res, 500, { ok: false, error: e.message }); else res.destroy();
  }));

  const close = () => { closed = true; clearTimeout(timer); server.close(); server.closeAllConnections?.(); };
  const end = result => { resolveDone(result); close(); };
  const arm = () => { clearTimeout(timer); if (!closed) timer = setTimeout(() => end({ code: 4 }), timeoutMs); };

  const send = (res, status, json, onSent) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(json), onSent);
  };
  const sameToken = t => {
    const a = Buffer.from(t ?? ""), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  // null = over the limit (still drained, so the client sees the 413 instead of a reset)
  const readBody = req => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n <= MAX_BODY) chunks.push(c); });
    req.on("end", () => resolve(n > MAX_BODY ? null : Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  // temp file + rename so a crash or a concurrent render never sees half a report; an empty body never blanks it
  const save = html => {
    if (!html) return;
    const tmp = `${inHtml}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, html.replace(CONFIG, ""));
    fs.renameSync(tmp, inHtml);
  };

  async function handle(req, res) {
    const u = new URL(req.url, "http://127.0.0.1");
    const origin = `http://127.0.0.1:${port}`;
    if (req.headers.host !== `127.0.0.1:${port}` || !sameToken(u.searchParams.get("t"))
      || (req.method === "POST" && req.headers.origin !== undefined && req.headers.origin !== origin))
      return send(res, 403, { ok: false, error: "forbidden" });
    arm();

    if (req.method === "GET" && u.pathname === "/") {
      const config = `<script id="dt-review-config">window.DT_REVIEW={token:"${token}"}</script>`;
      const html = fs.readFileSync(inHtml, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(html.includes("</head>") ? html.replace("</head>", () => config + "</head>") : config + html);
    }
    if (req.method !== "POST" || !["/save", "/finish", "/rewrite"].includes(u.pathname))
      return send(res, 404, { ok: false, error: "not found" });

    const theme = u.searchParams.get("theme");
    if (u.pathname === "/finish" && theme !== "light" && theme !== "dark") { req.resume(); return send(res, 400, { ok: false, error: "bad theme" }); }
    const body = await readBody(req);
    if (body === null) return send(res, 413, { ok: false, error: "too large" });
    save(body);

    if (u.pathname === "/save") { res.writeHead(204, { "Cache-Control": "no-store" }); return res.end(); }
    if (u.pathname === "/rewrite") return send(res, 200, { ok: true }, () => end({ code: 3 }));

    clearTimeout(timer); // a render can outlast a short timeout; the response re-arms it
    const r = await render({ inHtml, outPdf, theme });
    if (!r.ok) { arm(); return send(res, 500, { ok: false, error: r.error }); }
    finalize(outPdf, cleanupTargets(cleanup, outPdf));
    send(res, 200, { ok: true, pdf: outPdf }, () => { open(outPdf); end({ code: 0, pdf: outPdf }); });
  }

  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  port = server.address().port;
  arm();
  return { url: `http://127.0.0.1:${port}/?t=${token}`, token, done, close };
}

async function main() {
  // --cleanup swallows every remaining arg, so split it off before parseArgs
  const argv = process.argv.slice(2);
  const ci = argv.indexOf("--cleanup");
  const { values } = parseArgs({ args: ci < 0 ? argv : argv.slice(0, ci), options: { in: { type: "string" }, out: { type: "string" } } });
  if (!values.in || !values.out) {
    console.error("usage: review.mjs --in <report.html> --out <file.pdf> [--cleanup <path>...]");
    process.exit(2);
  }
  if (!findBrowser()) { console.error(NO_BROWSER); process.exit(2); }
  const abs = p => path.resolve(expandHome(p));
  const inHtml = abs(values.in), outPdf = abs(values.out);
  if (!fs.existsSync(inHtml)) { console.error(`Input not found: ${inHtml}`); process.exit(1); }

  const review = await startReview({ inHtml, outPdf, cleanup: ci < 0 ? [] : argv.slice(ci + 1) });
  console.log(`Review: ${review.url}`);
  openFile(review.url);
  const result = await review.done;
  const [code, line] = result.code === 0 ? [0, `PDF: ${result.pdf}`]
    : result.code === 3 ? [3, "REWRITE"]
    : [4, `Timed out — edits are saved in ${inHtml}`];
  process.stdout.write(line + "\n", () => process.exit(code)); // exit only after the line is flushed
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
