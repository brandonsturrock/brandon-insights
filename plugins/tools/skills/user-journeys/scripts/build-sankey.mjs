#!/usr/bin/env node
// build-sankey.mjs — template renderer for the user-journeys skill.
// Reads one row per session ({session_id, views:[{view.name, timestamp}]}), orders and collapses each
// path, groups identical paths, and embeds them (not raw events) into a self-contained HTML page.
//
// Usage:
//   node build-sankey.mjs --mode common  --records <file.json> --app "NAME" --out ~/Downloads/out.html
//        [--max-depth 6] [--top 6] [--raw-views] [--time-range "label"] [--eligible-sessions N]
//   node build-sankey.mjs --mode journey --records <file.json> --app "NAME" --out ~/Downloads/out.html
//        --funnel-steps '["a","b"]' [--funnel-match ordered|strict] [--time-range "label"] [--eligible-sessions N]
//   node build-sankey.mjs --self-test

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);
const CORE_SRC = fs.readFileSync(path.join(SKILL_ROOT, "assets", "sankey-core.js"), "utf8");
const SankeyCore = new Function(`${CORE_SRC}\nreturn SankeyCore;`)();
const RESULT_CAP = 50000; // must match --max-result-records in SKILL.md Step 2
const COMMON_PATH_CAP = 11; // max depth 10 + 1 view to know the path continues

const D3_LIBS = [
  { file: "d3-array.min.js",  url: "https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js" },
  { file: "d3-path.min.js",   url: "https://cdn.jsdelivr.net/npm/d3-path@3.1.0/dist/d3-path.min.js" },
  { file: "d3-shape.min.js",  url: "https://cdn.jsdelivr.net/npm/d3-shape@3.2.0/dist/d3-shape.min.js" },
  { file: "d3-sankey.min.js", url: "https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js" },
];
const D3_CACHE = "/tmp/brandon-insights-d3";

// URL-like view names: drop query/fragment and trailing slash, and group ID-like path segments
// (numbers, UUIDs, long hex, long tokens, short random IDs mixing letters and 2+ digits,
// anything with 4+ digits in a row) as {id}.
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[0-9a-f]{12,}|(?=.*\d)[\w-]{20,}|(?=(?:.*\d){2})(?=.*[a-z])[a-z0-9]{8,}|.*\d{4,}.*)$/i;
function normalizeView(name) {
  const m = /^(https?:\/\/[^/?#]+)?(\/[^?#]*)/i.exec(name);
  if (!m) return name;
  return (m[1] || "") + m[2].split("/").map((s) => (ID_SEGMENT.test(s) ? "{id}" : s)).join("/").replace(/(.)\/+$/, "$1");
}

const time = (t) => { const ms = Date.parse(t); return Number.isNaN(ms) ? 0 : ms; };
const byTimestamp = (a, b) => time(a.timestamp) - time(b.timestamp) || String(a.timestamp).localeCompare(String(b.timestamp));

function loadRows(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = parsed.result ?? parsed;
  if (result?.kind === "result-file") throw new Error("Query result spilled to a file — rerun the Step 2 query with --no-agent");
  const rows = Array.isArray(parsed) ? parsed : result?.records ?? result;
  if (!Array.isArray(rows)) throw new Error(`Unexpected JSON shape in ${file} (kind=${result && result.kind})`);
  return rows;
}

function buildPaths(rows, { normalize, cap }) {
  const views = [], index = new Map(), grouped = new Map(), rawNames = new Set();
  const viewId = (name) => {
    if (!index.has(name)) index.set(name, views.push(name) - 1);
    return index.get(name);
  };
  let sessions = 0, navigations = 0, collapsed = 0, longest = 0;
  for (const row of rows) {
    const p = [];
    for (const v of [...(row.views || [])].sort(byTimestamp)) {
      const name = v["view.name"];
      if (!name) continue;
      navigations++;
      rawNames.add(name);
      const id = viewId(normalize ? normalizeView(name) : name);
      if (p[p.length - 1] === id) collapsed++; else p.push(id);
    }
    if (!p.length) continue;
    sessions++;
    longest = Math.max(longest, p.length);
    const key = (cap ? p.slice(0, cap) : p).join(",");
    const g = grouped.get(key);
    if (g) g[0]++; else grouped.set(key, [1, cap ? p.slice(0, cap) : p]);
  }
  return {
    views,
    paths: [...grouped.values()],
    stats: { rows: rows.length, sessions, navigations, collapsed, longest, distinctRaw: rawNames.size, distinct: views.length },
  };
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchUrl(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} fetching ${url}`)); return; }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function getD3Libs() {
  fs.mkdirSync(D3_CACHE, { recursive: true });
  const parts = [];
  for (const { file, url } of D3_LIBS) {
    const cached = path.join(D3_CACHE, file);
    if (!fs.existsSync(cached)) {
      process.stderr.write(`Downloading ${file}...\n`);
      fs.writeFileSync(cached, await fetchUrl(url));
    }
    parts.push(fs.readFileSync(cached, "utf8"));
  }
  return parts.join("\n");
}

function selfTest() {
  const row = (id, ...names) => ({ session_id: id, views: names.map((n, i) => ({ "view.name": n, timestamp: `2026-01-01T00:00:0${i}Z` })).reverse() });
  // ordering by timestamp, consecutive-repeat collapse, ID grouping
  const built = buildPaths([row("a", "/", "/p/123", "/p/456", "/cart"), row("b", "/", "/cart"), row("c", "/")], { normalize: true, cap: COMMON_PATH_CAP });
  assert.deepEqual(built.paths.map(([, p]) => p.map((i) => built.views[i])), [["/", "/p/{id}", "/cart"], ["/", "/cart"], ["/"]]);
  assert.equal(built.stats.collapsed, 1);
  assert.equal(built.stats.navigations, 7);
  assert.equal(normalizeView("/orders/9f8e7d6c5b4a3210/items?x=1#top"), "/orders/{id}/items");
  assert.equal(normalizeView("/"), "/");
  assert.equal(normalizeView("/product/66vchsjnup"), "/product/{id}");
  assert.equal(normalizeView("/en/html5video"), "/en/html5video");
  assert.equal(normalizeView("https://cdn1234.example.com/a"), "https://cdn1234.example.com/a");
  assert.equal(normalizeView("/home/"), "/home");
  assert.equal(normalizeView("Checkout Page 2024"), "Checkout Page 2024");
  assert.equal(normalizeView("https://shop.example.com/sku-123456/reviews"), "https://shop.example.com/{id}/reviews");
  // loose timestamp formats still order correctly
  assert.deepEqual([{ timestamp: "2026-01-01T00:00:01Z" }, { timestamp: "2026-01-01T00:00:00.5Z" }].sort(byTimestamp).map((v) => v.timestamp), ["2026-01-01T00:00:00.5Z", "2026-01-01T00:00:01Z"]);

  // common: every column conserves sessions; tail pages collapse into Other
  const views = ["/", "/a", "/b", "/c", "/d"];
  const paths = [[5, [0, 1]], [3, [0, 2, 1]], [1, [0, 3]], [1, [0, 4, 1, 2]]];
  const g = SankeyCore.buildCommon(paths, views, 2, 1);
  const col = (s) => g.nodes.filter((n) => n.step === s).reduce((t, n) => t + n.value, 0);
  assert.equal(g.total, 10);
  assert.equal(col(0), 10); assert.equal(col(1), 10); assert.equal(col(2), 10);
  const other = g.nodes.find((n) => n.id === "1:other");
  assert.equal(other.value, 5);
  assert.equal(other.members.size, 3);
  assert.equal(g.nodes.find((n) => n.id === "2:cont").value, 4);
  // tracing counts only the sessions behind the hovered node
  const t = SankeyCore.trace(g.traces, (ids) => ids.includes("1:1"));
  assert.equal(t.n, 5);
  assert.equal(t.links.get("0:0>1:1"), 5);
  assert.equal(t.links.get("0:0>1:other"), undefined);

  // funnel: ordered allows detours, strict does not; later re-entry still counts in strict
  const fv = ["/", "/x", "/login", "/home"];
  const fp = [[4, [0, 2, 3]], [2, [0, 1, 2, 3]], [1, [0, 1, 0, 2]], [3, [1]]];
  const ordered = SankeyCore.buildFunnel(fp, fv, ["/", "/login", "/home"], false);
  assert.deepEqual(ordered.reached, [7, 7, 6]);
  assert.equal(ordered.nodes.find((n) => n.id === "2:exit").value, 1);
  const strict = SankeyCore.buildFunnel(fp, fv, ["/", "/login", "/home"], true);
  assert.deepEqual(strict.reached, [7, 5, 4]);
  assert.equal(strict.nodes.find((n) => n.id === "1:drop").members.get("/x"), 2);
  // unreached step creates no orphan node
  assert.equal(SankeyCore.buildFunnel(fp, fv, ["/", "/missing"], false).nodes.some((n) => n.id === "1:step"), false);
  console.log("ok");
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      mode: { type: "string" }, records: { type: "string" }, app: { type: "string" }, out: { type: "string" },
      "max-depth": { type: "string", default: "6" }, top: { type: "string", default: "6" },
      "funnel-steps": { type: "string" }, "funnel-match": { type: "string", default: "ordered" },
      "raw-views": { type: "boolean", default: false }, "time-range": { type: "string", default: "" },
      "eligible-sessions": { type: "string" }, "generated-at": { type: "string" }, "self-test": { type: "boolean" },
    },
  });
  if (args["self-test"]) return selfTest();

  const fail = (msg) => { console.error(`Error: ${msg}`); process.exit(1); };
  const mode = args.mode;
  if (!["common", "journey"].includes(mode)) fail('--mode must be "common" or "journey"');
  for (const k of ["records", "app", "out"]) if (!args[k]) fail(`missing --${k}`);
  const maxDepth = Number(args["max-depth"]), top = Number(args.top);
  if (!Number.isInteger(maxDepth) || maxDepth < 3 || maxDepth > 10) fail("--max-depth must be an integer from 3 to 10");
  if (!Number.isInteger(top) || top < 3 || top > 15) fail("--top must be an integer from 3 to 15");
  if (!["ordered", "strict"].includes(args["funnel-match"])) fail('--funnel-match must be "ordered" or "strict"');
  let funnelSteps = null;
  if (mode === "journey") {
    if (!args["funnel-steps"]) fail("--mode journey requires --funnel-steps '[\"step1\",\"step2\"]'");
    funnelSteps = JSON.parse(args["funnel-steps"]);
    if (!Array.isArray(funnelSteps) || funnelSteps.length < 2 || funnelSteps.length > 8 || !funnelSteps.every((s) => typeof s === "string")) {
      fail("--funnel-steps must be a JSON array of 2–8 view names");
    }
  }

  const rows = loadRows(args.records);
  // Funnel steps are raw view.name values, so journey mode never normalizes.
  const normalize = mode === "common" && !args["raw-views"];
  const { views, paths, stats } = buildPaths(rows, { normalize, cap: mode === "common" ? COMMON_PATH_CAP : 0 });
  Object.assign(stats, {
    capped: rows.length >= RESULT_CAP,
    cap: RESULT_CAP,
    eligible: args["eligible-sessions"] ? Number(args["eligible-sessions"]) : null,
    normalized: normalize,
  });

  const data = {
    mode, app: args.app, timeRange: args["time-range"], maxDepth, top, funnelSteps,
    funnelMatch: args["funnel-match"],
    generatedAt: args["generated-at"] || new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC",
    views, paths, stats,
  };
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const title = `${mode === "common" ? "Session Path Analysis" : "Journey Analysis"} — ${args.app}`;
  // Data is inserted last so placeholder-looking text inside view names is never substituted.
  const html = fs.readFileSync(path.join(SKILL_ROOT, "assets", "sankey.html.tmpl"), "utf8")
    .split("__TITLE__").join(escapeHtml(title))
    .split("__D3_LIBS__").join(await getD3Libs())
    .split("__CORE_JS__").join(CORE_SRC)
    .split("__DATA_JSON__").join(JSON.stringify(data).replace(/</g, "\\u003c"));

  const outPath = args.out.replace(/^~/, process.env.HOME || "");
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, html);

  const summary = { out: outPath, ...stats, uniquePaths: paths.length, avgNavigations: stats.sessions ? +(stats.navigations / stats.sessions).toFixed(2) : 0 };
  if (mode === "journey") {
    const f = SankeyCore.buildFunnel(paths, views, funnelSteps, args["funnel-match"] === "strict");
    Object.assign(summary, { funnelMatch: args["funnel-match"], enteredFunnel: f.total, reachedPerStep: f.reached, missingSteps: funnelSteps.filter((s) => !views.includes(s)) });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
