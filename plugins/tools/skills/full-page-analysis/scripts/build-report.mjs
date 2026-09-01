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
import { THRESHOLDS, computeFindings } from "./lib/findings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

// ── analyst notes markdown -> HTML ─────────────────────────────────────
// Copied verbatim from monthly-report/scripts/build-report.mjs so both
// skills parse the "## heading" analyst-notes convention identically.
// Mirrors the original app's extractMarkdownSection: split on "## " headings,
// case-insensitive substring match against a keyword.
function extractMarkdownSection(markdown, keyword) {
  const lines = markdown.split(/\r?\n/);
  const headingIdx = lines.findIndex(
    (l) => /^##\s+/.test(l) && l.slice(2).trim().toLowerCase().includes(keyword.toLowerCase())
  );
  if (headingIdx === -1) return "";
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(headingIdx + 1, end).join("\n").trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Minimal markdown -> HTML: bullet lists + plain paragraphs, nothing exotic
// (matches what findings-prompt.md actually produces).
function markdownToHtml(body) {
  if (!body.trim()) return "";
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^-\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${escapeHtml(bullet[1])}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

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
export function loadRecords(dataDir, filename) {
  const p = path.join(dataDir, filename);
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) { skipped.push(filename); return []; }
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  const result = parsed.result ?? parsed;
  if (result && Array.isArray(result.records)) return result.records;
  // A query that legitimately matches zero rows still comes back as
  // kind: "records" but with records: null (not []). Zero exceptions on a
  // page load is the common case, not a malformed response.
  if (result && result.kind === "records" && result.records === null) return [];
  if (Array.isArray(result)) return result;
  throw new Error(`Unexpected JSON envelope shape in ${filename} (kind=${result && result.kind})`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
const args = parseArgs(process.argv.slice(2));
if (!args.data) { console.error("Missing --data <dir>"); process.exit(1); }
if (!args.out) { console.error("Missing --out <report.html>"); process.exit(1); }
if (!args["page-title"]) { console.error("Missing --page-title <title>"); process.exit(1); }

const raw = {
  summary: loadRecords(args.data, "instance-summary.json")[0] || {},
  requests: loadRecords(args.data, "instance-requests.json"),
  exceptions: loadRecords(args.data, "instance-exceptions.json"),
};
// `??` throughout, never `||`: a legitimate zero (no failures, no 5xx, a
// sub-millisecond DNS phase) must stay a zero and not collapse to null.
const first = (rows) => rows[0] || {};
// Grail Long counters (count, countDistinctExact, countIf) come back through
// dtctl as JSON *strings* — `"77334"`, not `77334`. Every consumer downstream
// does arithmetic on these (share-of-loads, sums, sorts), and string "+" is
// concatenation, so they are coerced once here rather than defensively at each
// use. Percentile results are already JSON numbers; passing them through
// Number() is a no-op.
// Empty string and unparseable input both become null, not 0 and not NaN:
// Number("") is 0, and `NaN ?? 0` is NaN, so neither is caught downstream.
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const loadCountRow = first(loadRecords(args.data, "load-count.json"));
const cwvRow = first(loadRecords(args.data, "cwv-percentiles.json"));
const ttfbRow = first(loadRecords(args.data, "ttfb-phases.json"));
const longTaskRow = first(loadRecords(args.data, "longtasks-agg.json"));
const errorRow = first(loadRecords(args.data, "errors-agg.json"));

const data = {
  instance: normalizeRaw(raw),
  // Denominator for every request-scoped rule. Distinct hard-navigation loads
  // for the page — NOT the page-summary count in `cwv.loads`.
  loadCount: num(loadCountRow.loads),
  cwv: {
    loads: num(cwvRow.loads),
    lcpP50: num(cwvRow.lcp_p50), lcpP75: num(cwvRow.lcp_p75), lcpP95: num(cwvRow.lcp_p95),
    fcpP50: num(cwvRow.fcp_p50), fcpP75: num(cwvRow.fcp_p75), fcpP95: num(cwvRow.fcp_p95),
    inpP50: num(cwvRow.inp_p50), inpP75: num(cwvRow.inp_p75), inpP95: num(cwvRow.inp_p95),
    clsP50: num(cwvRow.cls_p50), clsP75: num(cwvRow.cls_p75), clsP95: num(cwvRow.cls_p95),
    ttfbP50: num(cwvRow.ttfb_p50), ttfbP75: num(cwvRow.ttfb_p75), ttfbP95: num(cwvRow.ttfb_p95),
  },
  ttfbPhases: {
    loads: num(ttfbRow.loads),
    dnsP75: num(ttfbRow.dns_p75),
    connectionP75: num(ttfbRow.connection_p75),
    waitingP75: num(ttfbRow.waiting_p75),
    requestP75: num(ttfbRow.request_p75),
    cacheP75: num(ttfbRow.cache_p75),
  },
  resources: loadRecords(args.data, "resources-agg.json").map((r) => ({
    path: r["url.path"],
    domain: r["url.domain"],
    initiatorType: r["performance.initiator_type"],
    loads: num(r.loads) ?? 0,
    requests: num(r.requests) ?? 0,
    durationP50: num(r.duration_p50),
    durationP75: num(r.duration_p75),
    durationP95: num(r.duration_p95),
    transferP75: num(r.transfer_p75),
    blocking: num(r.blocking) ?? 0,
    failures: num(r.failures) ?? 0,
  })),
  thirdParty: loadRecords(args.data, "thirdparty-agg.json").map((r) => ({
    domain: r["url.domain"],
    loads: num(r.loads) ?? 0,
    requests: num(r.requests) ?? 0,
    durationP75: num(r.duration_p75),
    transferP75: num(r.transfer_p75),
  })),
  longTasks: {
    loads: num(longTaskRow.loads),
    loadsWithLongTasks: num(longTaskRow.loads_with_long_tasks),
    countP75: num(longTaskRow.count_p75),
    avgDurationP75: num(longTaskRow.avg_duration_p75),
  },
  errors: {
    loads: num(errorRow.loads),
    loadsWithAnyError: num(errorRow.loads_with_any_error),
    loadsWithException: num(errorRow.loads_with_exception),
    loadsWith4xx: num(errorRow.loads_with_4xx),
    loadsWith5xx: num(errorRow.loads_with_5xx),
    exceptionTotal: num(errorRow.exception_total),
    http4xxTotal: num(errorRow.http_4xx_total),
    http5xxTotal: num(errorRow.http_5xx_total),
  },
  browserDevice: loadRecords(args.data, "browser-device.json").map((r) => ({
    browser: r["browser.name"],
    device: r["device.type"],
    loads: num(r.loads) ?? 0,
    lcpP75: num(r.lcp_p75),
  })),
  thresholds: THRESHOLDS,
};

const actionRow = loadRecords(args.data, "instance-action.json")[0] || {};
data.instance.action = {
  name: actionRow["user_action.name"] ?? null,
  type: actionRow["user_action.type"] ?? null,
  durationMs: actionRow.duration != null ? Number(actionRow.duration) / 1e6 : null,
  startAbsoluteMs: actionRow.start_time ? Date.parse(actionRow.start_time) : null,
  endAbsoluteMs: actionRow.end_time ? Date.parse(actionRow.end_time) : null,
};

// Surface partial runs rather than letting a section render blank: a missing
// file looks exactly like a healthy zero once it reaches the template.
if (skipped.length) console.warn(`Skipped missing/empty data files: ${skipped.join(", ")}`);
data.skipped = skipped;
data.findings = computeFindings(data);

const analystNotesHtml = args.findings
  ? markdownToHtml(extractMarkdownSection(fs.readFileSync(args.findings, "utf8"), "analyst notes"))
  : "";

const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report.html.tmpl"), "utf8");
const tokens = fs.readFileSync(path.join(SKILL_ROOT, "assets", "strato-tokens.css"), "utf8");

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let html = template
  .split("{{PAGE_TITLE}}").join(esc(args["page-title"]))
  .split("{{GENERATED_AT}}").join(new Date().toISOString().slice(0, 10))
  .split("{{STRATO_TOKENS}}").join(tokens)
  .split("{{ANALYST_NOTES}}").join(analystNotesHtml)
  .replace("{{DATA_JSON}}", () =>
    JSON.stringify(data).replace(/<\/script>/g, "<\\/script>"));

// Mirrors monthly-report: the analyst-notes area stays editable in the
// browser after the file is opened, same as every other exec-body block.
html = html.replace(/class="exec-body"/g, 'class="exec-body" contenteditable="true" spellcheck="false"');

// Inject a floating save bar. The save button downloads the current DOM as
// an HTML file to ~/Downloads — the PDF step uses that file if it exists.
// Hidden at print time so it never appears in the PDF. Copied from
// monthly-report/scripts/build-report.mjs and retheme only: monthly-report's
// bar is hand-rolled dark-theme hex, this report runs on Strato light tokens,
// so the accent colours become var(--dt-primary) and the panel/text colours
// become the same --dt-bg-container / --dt-text-primary / --dt-border-default
// roles every other panel in this template already uses.
const outPath = args.out.replace(/^~/, process.env.HOME || "");
const reportFilename = path.basename(outPath);
html = html.replace("</body>", `<style>
  #dt-save-bar{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;align-items:center;gap:12px;background:var(--dt-bg-container);border:1px solid var(--dt-primary);border-radius:10px;padding:10px 18px;box-shadow:var(--dt-shadow-overlay);font-family:var(--dt-font-sans);font-size:13px;color:var(--dt-text-primary)}
  #dt-save-bar button{background:var(--dt-primary);color:#fff;border:none;border-radius:6px;padding:7px 16px;cursor:pointer;font-size:13px;font-weight:600}
  #dt-save-bar button:hover{background:color-mix(in srgb, var(--dt-primary) 85%, white)}
  @media print{#dt-save-bar{display:none!important}}
</style>
<div id="dt-save-bar">
  <span>Edit findings above, then save when ready</span>
  <button id="dt-save-btn" onclick="dtSave()">Save changes</button>
</div>
<script>
function dtSave(){
  var html='<!DOCTYPE html>\\n'+document.documentElement.outerHTML;
  var blob=new Blob([html],{type:'text/html'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=${JSON.stringify(reportFilename)};
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
  var btn=document.getElementById('dt-save-btn');
  btn.textContent='✓ Saved to Downloads';btn.style.background='var(--dt-success)';
  setTimeout(function(){btn.textContent='Save changes';btn.style.background=''},3000);
}
</script>
</body>`);

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
}
