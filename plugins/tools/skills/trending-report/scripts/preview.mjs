#!/usr/bin/env node
// Renders assets/fixtures/sample.json straight into a preview HTML file, with
// no tenant, no dtctl, and no --data directory required. This is what makes
// the restyled layout re-checkable by anyone who can open a browser.
//
// Usage:
//   node scripts/preview.mjs
//   node scripts/preview.mjs --fixture assets/fixtures/sample.json --out /tmp/preview-trending.html
//
// build-report.mjs isn't imported here: it parses process.argv and calls
// process.exit at module load, so importing it would run its own CLI rather
// than exposing a function. The few lines duplicated below (placeholder
// substitution + the "don't corrupt the contract comment" comment-splice)
// are copied verbatim from renderReport() in build-report.mjs — if you
// change one, change the other.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const fixturePath = path.resolve(SKILL_ROOT, args.fixture || "assets/fixtures/sample.json");
const outPath = path.resolve(args.out || "/tmp/preview-trending.html");

const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report-trending.html.tmpl"), "utf8");
const data = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

// Pre-rendered as if by build-report.mjs's markdownToHtml (the contract
// says this placeholder always arrives as finished HTML) — includes
// <strong>/<code> so the .findings-body inline-formatting path renders
// visibly in the preview, not just plain bullets.
function demoFinding(sentences) {
  return `<ul>${sentences.map((s) => `<li>${s}</li>`).join("")}</ul>`;
}
const replacements = {
  "{{REPORT_TITLE}}": "sample-frontend — Trending Report",
  "{{FRONTEND_NAME}}": "sample-frontend",
  "{{ENVIRONMENT_NAME}}": "Production",
  "{{DATE_RANGE_LABEL}}": `${data.trafficMonthly.labels[0]} – ${data.trafficMonthly.labels[data.trafficMonthly.labels.length - 1]}`,
  "{{FINDINGS_TRAFFIC_HTML}}": demoFinding([
    "Sessions grew <strong>6.4%</strong> month-over-month, the fourth straight month of growth.",
    "XHR volume outpaced navigations, consistent with the <code>/checkout</code> SPA flow staying on one page load.",
    "One data gap: XHR Requests is missing for April — see the traffic table.",
  ]),
  "{{FINDINGS_CWV_HTML}}": demoFinding([
    "LCP improved from <strong>4.3s to 2.1s</strong> over the period, crossing into the good band in May.",
    "INP and CLS followed the same trend — both are now comfortably inside <code>good</code>.",
    "Safari · Mobile is the one browser/device combination still in needs-improvement; see page 4.",
  ]),
  "{{FINDINGS_BROWSER_HTML}}": demoFinding([
    "Chrome · Desktop remains the largest segment by visits and is fully in the good band.",
    "Safari · Mobile lags the rest of the fleet on all three Core Web Vitals.",
    "Edge · Desktop is a small but growing segment worth watching next period.",
  ]),
};

// Same reasoning as build-report.mjs: the top-of-file contract comment cites
// every placeholder token verbatim as documentation prose, so a blind global
// replace would corrupt it. Cut it out by position, substitute everywhere
// else, splice the untouched comment back in.
const commentStart = template.indexOf("<!--");
const commentEnd = template.indexOf("-->", commentStart) + "-->".length;
const before = template.slice(0, commentStart);
const comment = template.slice(commentStart, commentEnd);
let after = template.slice(commentEnd);
let head = before;
for (const [placeholder, value] of Object.entries(replacements)) {
  head = head.split(placeholder).join(value);
  after = after.split(placeholder).join(value);
}
after = after.replace("{{DATA_JSON}}", () => JSON.stringify(data));
let html = head + comment + after;

const chartJs = fs.readFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), "utf8")
  .replace(/\/\/# sourceMappingURL=\S+/g, "");
html = html.replace('<script src="chart.umd.min.js"></script>', `<script>${chartJs}</script>`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
