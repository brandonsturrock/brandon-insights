#!/usr/bin/env node
// Renders assets/fixtures/sample.json through report-trending.html.tmpl without
// a Dynatrace tenant — reuses build-report.mjs's own assembleHtml() (template
// substitution, Chart.js inlining, contenteditable + review-bar injection) so
// there is exactly one place that knows the template's placeholder contract.
//
// Usage:
//   node scripts/preview.mjs [--out <path>] [outPath]
//   (default outPath: preview-trending.html in $CLAUDE_SCRATCH_DIR, else the
//    OS temp dir)
//
// --out is accepted as well as a bare positional because build-report.mjs and
// the monthly skill's preview both take the flag form.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleHtml } from "./build-report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

const data = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "assets", "fixtures", "sample.json"), "utf8"));

const argv = process.argv.slice(2);
const flagIdx = argv.indexOf("--out");
const outArg = flagIdx >= 0 ? argv[flagIdx + 1] : argv.find((a, i) => !a.startsWith("-") && !argv[i - 1]?.startsWith("--"));
const outPath = outArg || path.join(process.env.CLAUDE_SCRATCH_DIR || os.tmpdir(), "preview-trending.html");

// Pre-rendered as if by build-report.mjs's markdownToHtml (the contract
// says this placeholder always arrives as finished HTML) — includes
// <strong>/<code> so the .findings-body inline-formatting path renders
// visibly in the preview, not just plain bullets.
function demoFinding(sentences) {
  return `<ul>${sentences.map((s) => `<li>${s}</li>`).join("")}</ul>`;
}
const labels = data.trafficMonthly.labels;
assembleHtml({
  data,
  findings: {
    FINDINGS_TRAFFIC_HTML: demoFinding([
      "Sessions grew <strong>6.4%</strong> month-over-month, the fourth straight month of growth.",
      "XHR volume outpaced navigations, consistent with the <code>/checkout</code> SPA flow staying on one page load.",
      "One data gap: XHR Requests is missing for April — see the traffic table.",
    ]),
    FINDINGS_CWV_HTML: demoFinding([
      "LCP improved from <strong>4.3s to 2.1s</strong> over the period, crossing into the good band in May.",
      "INP and CLS followed the same trend — both are now comfortably inside <code>good</code>.",
      "Safari · Mobile is the one browser/device combination still in needs-improvement; see page 4.",
    ]),
    FINDINGS_BROWSER_HTML: demoFinding([
      "Chrome · Desktop remains the largest segment by visits and is fully in the good band.",
      "Safari · Mobile lags the rest of the fleet on all three Core Web Vitals.",
      "Edge · Desktop is a small but growing segment worth watching next period.",
    ]),
  },
  frontend: "sample-frontend",
  environment: "Production",
  dateRangeLabel: `${labels[0]} – ${labels[labels.length - 1]}`,
  generatedAt: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  outPath,
});
