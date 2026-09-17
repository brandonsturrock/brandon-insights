#!/usr/bin/env node
// Renders assets/fixtures/sample.json through report-cm.html.tmpl without a
// Dynatrace tenant — reuses build-report.mjs's own assembleHtml() (template
// substitution, Chart.js inlining, contenteditable + save-bar injection) so
// there is exactly one place that knows the template's placeholder contract.
//
// Usage:
//   node scripts/preview.mjs [--out <path>] [outPath]
//   (default outPath: SCRATCH/preview-cm.html if $CLAUDE_SCRATCH_DIR is set,
//    else /tmp/preview-cm.html)
//
// --out is accepted as well as a bare positional because build-report.mjs and
// the trending skill's preview both take the flag form: taking only a
// positional here meant `--out foo.html` silently wrote a file named "--out".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleHtml, markdownToHtml } from "./build-report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

const fixture = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "assets", "fixtures", "sample.json"), "utf8"));

const argv = process.argv.slice(2);
const flagIdx = argv.indexOf("--out");
const outArg = flagIdx >= 0 ? argv[flagIdx + 1] : argv.find((a) => !a.startsWith("-"));
const outPath = outArg || path.join(process.env.CLAUDE_SCRATCH_DIR || "/tmp", "preview-cm.html");

assembleHtml({
  data: fixture.data,
  findings: markdownFindings(fixture.findings),
  frontend: fixture.frontend,
  environment: fixture.environment,
  dateRangeLabel: fixture.dateRangeLabel,
  generatedAt: fixture.generatedAt,
  outPath,
});

// The fixture stores findings as raw "## Heading" markdown (the same shape
// findings.txt has in a real run) so it doubles as a readable sample of what
// an analyst actually writes — convert with the same minimal markdown ->
// HTML the real build path applies, rather than pre-baking HTML into the
// fixture and never exercising that conversion here.
function markdownFindings(sections) {
  const out = {};
  for (const [placeholder, markdown] of Object.entries(sections)) {
    out[placeholder] = markdownToHtml(stripHeading(markdown));
  }
  return out;
}
function stripHeading(markdown) {
  return markdown.replace(/^##[^\n]*\n/, "");
}
