#!/usr/bin/env node
// Glue script for the full-page-analysis skill.
// Reads a directory of dtctl query JSON outputs (filenames per
// references/queries.md) and fills assets/report.html.tmpl.
//
// Usage:
//   node build-report.mjs --data /tmp/fpa-home --page-title "/" --out ~/Downloads/report.html

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRaw } from "./lib/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

// dtctl -o json --agent --spill=never emits rows under result.records when
// result.kind === "records". Accept a bare array too — the envelope shape is
// not pinned 1:1 anywhere. Same defensive parse as monthly-report.
// Missing or empty files are tolerated and reported, not fatal: SKILL.md
// backgrounds every dtctl invocation, and one failure must not lose the report.
export const skipped = [];
function loadRecords(dataDir, filename) {
  const p = path.join(dataDir, filename);
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) { skipped.push(filename); return []; }
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  const result = parsed.result ?? parsed;
  if (result && Array.isArray(result.records)) return result.records;
  if (Array.isArray(result)) return result;
  throw new Error(`Unexpected JSON envelope shape in ${filename} (kind=${result && result.kind})`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.data) { console.error("Missing --data <dir>"); process.exit(1); }
if (!args.out) { console.error("Missing --out <report.html>"); process.exit(1); }
if (!args["page-title"]) { console.error("Missing --page-title <title>"); process.exit(1); }

const raw = {
  summary: loadRecords(args.data, "instance-summary.json")[0] || {},
  requests: loadRecords(args.data, "instance-requests.json"),
  exceptions: loadRecords(args.data, "instance-exceptions.json"),
};
const data = { instance: normalizeRaw(raw) };

const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report.html.tmpl"), "utf8");
const tokens = fs.readFileSync(path.join(SKILL_ROOT, "assets", "strato-tokens.css"), "utf8");
const chartJs = fs
  .readFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), "utf8")
  .replace(/\/\/# sourceMappingURL=\S+/g, "");

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let html = template
  .split("{{PAGE_TITLE}}").join(esc(args["page-title"]))
  .split("{{GENERATED_AT}}").join(new Date().toISOString().slice(0, 10))
  .split("{{STRATO_TOKENS}}").join(tokens)
  .replace("{{DATA_JSON}}", () =>
    JSON.stringify(data).replace(/<\/script>/g, "<\\/script>"))
  .replace('<script src="chart.umd.min.js"></script>', `<script>${chartJs}</script>`);

const outPath = args.out.replace(/^~/, process.env.HOME || "");
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
