#!/usr/bin/env node
// build-sankey.mjs — template renderer for the user-journeys skill.
// Reads dtctl query JSON output and fills the Sankey HTML template.
//
// Usage:
//   node build-sankey.mjs --mode common --records <file.json> --app "NAME" [--max-depth 6] --out ~/Downloads/out.html
//   node build-sankey.mjs --mode journey --records <file.json> --app "NAME" --funnel-steps '["a","b","c"]' --out ~/Downloads/out.html

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

const D3_LIBS = [
  { file: "d3-array.min.js",  url: "https://cdn.jsdelivr.net/npm/d3-array@3.2.4/dist/d3-array.min.js" },
  { file: "d3-path.min.js",   url: "https://cdn.jsdelivr.net/npm/d3-path@3.1.0/dist/d3-path.min.js" },
  { file: "d3-shape.min.js",  url: "https://cdn.jsdelivr.net/npm/d3-shape@3.2.0/dist/d3-shape.min.js" },
  { file: "d3-sankey.min.js", url: "https://cdn.jsdelivr.net/npm/d3-sankey@0.12.3/dist/d3-sankey.min.js" },
];
const D3_CACHE = "/tmp/brandon-insights-d3";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

function loadRecords(file) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  const result = parsed.result ?? parsed;
  if (result && Array.isArray(result.records)) return result.records;
  if (Array.isArray(result)) return result;
  throw new Error(`Unexpected JSON shape in ${file} (kind=${result && result.kind})`);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const mode = args.mode;
  if (!mode || !["common", "journey"].includes(mode)) {
    console.error('Error: --mode must be "common" or "journey"'); process.exit(1);
  }
  if (!args.records) { console.error("Error: missing --records <file>"); process.exit(1); }
  if (!args.app)     { console.error("Error: missing --app <name>"); process.exit(1); }
  if (!args.out)     { console.error("Error: missing --out <path>"); process.exit(1); }
  if (mode === "journey" && !args["funnel-steps"]) {
    console.error('Error: --mode journey requires --funnel-steps \'["step1","step2"]\''); process.exit(1);
  }

  const records = loadRecords(args.records);
  const d3Libs = await getD3Libs();
  const generatedAt = args["generated-at"] ||
    new Date().toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
  const maxDepth = parseInt(args["max-depth"] || "6", 10);

  const tmplName = mode === "common" ? "sankey-common.html.tmpl" : "sankey-journey.html.tmpl";
  let html = fs.readFileSync(path.join(SKILL_ROOT, "assets", tmplName), "utf8");

  const recordsJson = JSON.stringify(records).replace(/<\/script>/g, "<\\/script>");

  html = html
    .split("__D3_LIBS__").join(d3Libs)
    .split("__RECORDS_JSON__").join(recordsJson)
    .split("__APP_NAME__").join(args.app)
    .split("__GENERATED_AT__").join(generatedAt)
    .split("__MAX_DEPTH__").join(String(maxDepth));

  if (mode === "journey") {
    const funnelSteps = args["funnel-steps"];
    JSON.parse(funnelSteps); // validate
    html = html.split("__FUNNEL_STEPS_JSON__").join(funnelSteps);
  }

  const outPath = args.out.replace(/^~/, process.env.HOME || "");
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${outPath}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
