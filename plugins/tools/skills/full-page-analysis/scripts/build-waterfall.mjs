#!/usr/bin/env node
// build-waterfall.mjs — template renderer for the full-page-analysis skill.
// Reads dtctl query JSON output files and fills the waterfall HTML template.
//
// Usage:
//   node build-waterfall.mjs --summary /tmp/wf_summary.json --requests /tmp/wf_requests.json --exceptions /tmp/wf_exceptions.json --page-title "PAGE" --out ~/Downloads/out.html

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function extractRecords(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed.records && Array.isArray(parsed.records)) return parsed.records;
  if (parsed.result && Array.isArray(parsed.result.records)) return parsed.result.records;
  return [];
}

const args = parseArgs(process.argv.slice(2));

if (!args.summary || !args.requests || !args.exceptions) {
  console.error("Error: missing required flags --summary --requests --exceptions"); process.exit(1);
}
if (!args["page-title"]) { console.error("Error: missing --page-title"); process.exit(1); }
if (!args.out)           { console.error("Error: missing --out"); process.exit(1); }

const summaryParsed = readJSON(args.summary);
const summary = extractRecords(summaryParsed)[0] || {};
const requests = extractRecords(readJSON(args.requests));
const exceptions = extractRecords(readJSON(args.exceptions));

const payload = JSON.stringify({ __raw: true, summary, requests, exceptions })
  .replace(/<\/script>/g, "<\\/script>");

const templatePath = args.template || path.join(SKILL_ROOT, "assets", "template.html");
let html = fs.readFileSync(templatePath, "utf8");
html = html
  .replace("__DATA_JSON__", payload)
  .replace("__PAGE_TITLE__", args["page-title"]);

const outPath = args.out.replace(/^~/, process.env.HOME || "");
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
