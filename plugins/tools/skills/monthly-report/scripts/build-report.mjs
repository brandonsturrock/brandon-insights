#!/usr/bin/env node
// Glue script for the monthly-report skill.
// Reads dtctl query JSON output (+ a findings markdown file) and fills
// the current-month report HTML template (report-cm.html.tmpl).
//
// Usage:
//   node build-report.mjs --type current-month --frontend "NAME" --data <dir> --findings <findings.md> --out <report.html>
//   node build-report.mjs --type current-month --demo --out /tmp/demo-cm.html

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { demo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--demo") { out.demo = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

// CLI arg parsing/validation and the renderReport(args.out) call at the
// bottom of this file only run when the script is invoked directly (`node
// build-report.mjs ...`) — guarded so `scripts/preview.mjs` can `import
// { assembleHtml }` from here (to reuse the placeholder-substitution /
// Chart.js-inlining / contenteditable logic) without tripping the "Missing
// --type" exit this file's own CLI entry requires.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = isMain ? parseArgs(process.argv.slice(2)) : {};
if (isMain && args.type !== "current-month") {
  console.error('Missing/invalid --type (must be "current-month")');
  process.exit(1);
}
if (isMain && !args.out) {
  console.error("Missing --out <report.html>");
  process.exit(1);
}
if (isMain && !args.demo && !args.data) {
  console.error("Missing --data <dir> (or pass --demo)");
  process.exit(1);
}
// ── shared formatting helpers ──────────────────────────────────────────────
function fmtMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return ms >= 1000 ? (ms / 1000).toFixed(2) + "s" : Math.round(ms) + "ms";
}
function compact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}
function pctChange(curr, prev) {
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}
function monthLabel(ms) {
  return new Date(ms).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}
function monthYearLabel(ms) {
  return new Date(ms).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
function dayLabel(ms) {
  return String(new Date(ms).getUTCDate());
}

// ── dtctl JSON envelope parsing ─────────────────────────────────────────
// dtctl's `-o json --agent --spill=never` output shape (see dtctl SKILL.md /
// references/queries.md): rows inline under `result.records` when
// `result.kind === "records"`. Be defensive about the exact envelope nesting
// since it isn't pinned down 1:1 anywhere — accept a bare array too.
function loadRecords(dataDir, filename) {
  const p = path.join(dataDir, filename);
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  const result = parsed.result ?? parsed;
  if (result && Array.isArray(result.records)) return result.records;
  if (Array.isArray(result)) return result;
  throw new Error(`Unexpected JSON envelope shape in ${filename} (kind=${result && result.kind})`);
}

// ── findings markdown -> per-section HTML ──────────────────────────────
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

// **bold** and `inline code` are both things findings-prompt.md's own output
// actually uses (an analyst calling out a figure or a literal page/exception
// name), so they need to survive the markdown pass rather than showing up as
// literal asterisks/backticks in the rendered notes panel. Applied AFTER
// escapeHtml so the asterisks/backticks being matched can never come from
// user-authored HTML the escape was meant to neutralise.
function inlineMarkdown(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

// Minimal markdown -> HTML: bullet lists + plain paragraphs + inline
// bold/code, nothing exotic (matches what findings-prompt.md actually
// produces). Exported so scripts/preview.mjs converts its fixture's findings
// markdown through the same path a real run uses, instead of a second copy
// of this conversion.
export function markdownToHtml(body) {
  if (!body.trim()) return "";
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^-\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineMarkdown(escapeHtml(bullet[1]))}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${inlineMarkdown(escapeHtml(line))}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

function loadFindings(findingsPath, sections) {
  const markdown = fs.readFileSync(findingsPath, "utf8");
  const out = {};
  for (const [placeholder, keyword] of Object.entries(sections)) {
    out[placeholder] = markdownToHtml(extractMarkdownSection(markdown, keyword));
  }
  return out;
}

// ── data transforms: current-month ──────────────────────────────────────
function buildCurrentMonthData(dataDir) {
  const dailyDeviceRows = loadRecords(dataDir, "cm-daily-device.json");
  const deviceCompareRows = loadRecords(dataDir, "cm-device-compare.json");
  const cwvTierRow = loadRecords(dataDir, "cm-cwv-tier.json")[0] || {};
  const distRow = loadRecords(dataDir, "cm-cwv-distribution.json")[0] || {};
  const dailyCwvRows = loadRecords(dataDir, "cm-daily-cwv.json");
  const topPagesRows = loadRecords(dataDir, "cm-top-pages.json");
  const errorRows = loadRecords(dataDir, "cm-errors.json");
  const errorCountRows = loadRecords(dataDir, "cm-error-count.json");
  const topExceptionsRows = loadRecords(dataDir, "cm-top-exceptions.json");
  const topRequestErrorsRows = loadRecords(dataDir, "cm-top-request-errors.json");

  // Strip warm-up days (queries start 2d before month start to avoid timeseries artifacts on day 1)
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const inMonth = (r) => r.day.slice(0, 10) >= monthStart;
  const dailyDeviceRowsFiltered = dailyDeviceRows.filter(inMonth);
  const dailyCwvRowsFiltered = dailyCwvRows.filter(inMonth);
  const errorCountRowsFiltered = errorCountRows.filter(inMonth);

  // cmDailyDevice
  const days = [...new Set(dailyDeviceRowsFiltered.map((r) => r.day))].sort((a, b) => a - b);
  const dayLabels = days.map(dayLabel);
  const byDayDevice = (rows, valueKey, deviceKey = "device.type") => {
    const desktop = new Array(days.length).fill(0);
    const mobile = new Array(days.length).fill(0);
    rows.forEach((r) => {
      const idx = days.indexOf(r.day);
      if (idx === -1) return;
      if (r[deviceKey] === "desktop") desktop[idx] = r[valueKey];
      else if (r[deviceKey] === "mobile") mobile[idx] = r[valueKey];
    });
    return { desktop, mobile };
  };
  const cmDailyDevice = { labels: dayLabels, ...byDayDevice(dailyDeviceRowsFiltered, "sessions") };

  // deviceCompareRows
  const deviceCompare = deviceCompareRows.map((r) => ({
    deviceType: r.device_type ? r.device_type[0].toUpperCase() + r.device_type.slice(1) : "—",
    sessions: r.sessions,
    pageLoads: r.page_loads,
    lcpP75: r.lcp_p75,
    inpP75: r.inp_p75,
    clsP75: r.cls_p75 == null ? null : r.cls_p75 / 10000,
  }));

  // blended p75s (weighted by page_loads) for KPIs + distribution p75 labels
  const totalPageLoads = deviceCompareRows.reduce((s, r) => s + (r.page_loads || 0), 0);
  const blended = (key) =>
    totalPageLoads > 0
      ? deviceCompareRows.reduce((s, r) => s + (r[key] || 0) * (r.page_loads || 0), 0) / totalPageLoads
      : null;
  const totalSessions = deviceCompareRows.reduce((s, r) => s + (r.sessions || 0), 0);

  // cmCwvTier (percentages)
  const tierPct = (good, ni, poor, total) =>
    total > 0
      ? { good: Math.round((good / total) * 100), ni: Math.round((ni / total) * 100), poor: Math.round((poor / total) * 100) }
      : { good: 0, ni: 0, poor: 0 };
  const cmCwvTier = {
    lcp: tierPct(cwvTierRow.lcp_good, cwvTierRow.lcp_ni, cwvTierRow.lcp_poor, cwvTierRow.lcp_total),
    inp: tierPct(cwvTierRow.inp_good, cwvTierRow.inp_ni, cwvTierRow.inp_poor, cwvTierRow.inp_total),
    cls: tierPct(cwvTierRow.cls_good, cwvTierRow.cls_ni, cwvTierRow.cls_poor, cwvTierRow.cls_total),
  };

  // cmCwvDistribution
  const LCP_BUCKETS = ["0-1s", "1-2s", "2-3s", "3-4s", "4-5s", "5-6s", "6-7s", "7-8s", "8-9s", "9-10s", "10s+"];
  // INP's own scale, not LCP's 1000ms-wide one: good/poor sit at 200ms/500ms,
  // two orders of magnitude below LCP's thresholds, so LCP's buckets put
  // essentially every real INP sample in bucket 0 and nothing else — a
  // histogram that is structurally incapable of showing a distribution. 100ms
  // steps to 1s (+ a tail) land both thresholds exactly on a bucket edge
  // (200ms is the b1/b2 edge, 500ms is the b4/b5 edge) — matches the
  // cm-cwv-distribution.dql bucket boundaries above.
  const INP_BUCKETS = ["0-100ms", "100-200ms", "200-300ms", "300-400ms", "400-500ms", "500-600ms", "600-700ms", "700-800ms", "800-900ms", "900ms-1s", "1s+"];
  const CLS_BUCKETS = ["0-0.1", "0.1-0.2", "0.2-0.3", "0.3-0.4", "0.4-0.5", "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0", "1.0+"];
  const bucketCounts = (row, prefix) => Array.from({ length: 11 }, (_, i) => row[`${prefix}_b${i}`] || 0);
  const cmCwvDistribution = {
    lcp: { buckets: LCP_BUCKETS, counts: bucketCounts(distRow, "lcp"), p75: blended("lcp_p75") },
    inp: { buckets: INP_BUCKETS, counts: bucketCounts(distRow, "inp"), p75: blended("inp_p75") },
    cls: { buckets: CLS_BUCKETS, counts: bucketCounts(distRow, "cls"), p75: blended("cls_p75") == null ? null : blended("cls_p75") / 10000 },
  };

  // cmDailyCwv
  const cmDailyCwv = {
    labels: dayLabels,
    lcp: byDayDevice(dailyCwvRowsFiltered, "lcp"),
    inp: byDayDevice(dailyCwvRowsFiltered, "inp"),
    cls: (() => {
      const c = byDayDevice(dailyCwvRowsFiltered, "cls");
      return { desktop: c.desktop.map((v) => (v == null ? null : v / 10000)), mobile: c.mobile.map((v) => (v == null ? null : v / 10000)) };
    })(),
  };

  // topPagesRows
  const topPagesOut = topPagesRows.map((r) => ({
    name: r["page.name"],
    count: r.count,
    lcp: r.lcp,
    inp: r.inp,
    cls: r.cls,
    exceptions: r.exceptions,
    requestErrors: r.request_errors,
  }));

  // cmErrorRates: sum across devices per day
  const errByDay = new Map();
  errorRows.forEach((r) => {
    const cur = errByDay.get(r.day) || { total: 0, js: 0, req: 0 };
    cur.total += r.total_sessions || 0;
    cur.js += r.js_error_sessions || 0;
    cur.req += r.req_error_sessions || 0;
    errByDay.set(r.day, cur);
  });
  const errDays = [...errByDay.keys()].sort((a, b) => a - b);
  const cmErrorRates = {
    labels: errDays.map(dayLabel),
    jsErrorRate: errDays.map((d) => { const v = errByDay.get(d); return v.total > 0 ? Number(((v.js / v.total) * 100).toFixed(2)) : 0; }),
    reqErrorRate: errDays.map((d) => { const v = errByDay.get(d); return v.total > 0 ? Number(((v.req / v.total) * 100).toFixed(2)) : 0; }),
  };

  // cmErrorCounts: pivot by day x error.type, summed across device
  const errCountDays = [...new Set(errorCountRowsFiltered.map((r) => r.day))].sort((a, b) => a - b);
  const errorTypes = [...new Set(errorCountRowsFiltered.map((r) => r["error.type"]).filter((t) => t != null))];
  const byType = {};
  errorTypes.forEach((t) => { byType[t] = new Array(errCountDays.length).fill(0); });
  errorCountRowsFiltered.forEach((r) => {
    const type = r["error.type"];
    if (type == null) return;
    const idx = errCountDays.indexOf(r.day);
    if (idx === -1) return;
    byType[type][idx] += r.error_count || 0;
  });
  const cmErrorCounts = { labels: errCountDays.map(dayLabel), byType };

  const topExceptionsOut = topExceptionsRows.map((r) => ({
    count: r.count,
    type: r["exception.type"],
    message: r["exception.message"],
    source: r["error.source"],
  }));
  const topRequestErrorsOut = topRequestErrorsRows.map((r) => ({
    count: r.count,
    method: r["http.request.method"],
    status: r["http.response.status_code"],
    host: r["url.host"],
    path: r["url.path"],
  }));

  const kpis = [
    { label: "Sessions", value: compact(totalSessions), change: null, color: "#7B61FF", lowerIsBetter: false },
    { label: "Page Loads", value: compact(totalPageLoads), change: null, color: "#1D8AB7", lowerIsBetter: false },
    { label: "LCP p75", value: fmtMs(blended("lcp_p75")), change: null, color: "#F5A623", lowerIsBetter: true },
    { label: "INP p75", value: fmtMs(blended("inp_p75")), change: null, color: "#1496ff", lowerIsBetter: true },
  ];

  return {
    kpis,
    cmDailyDevice,
    deviceCompareRows: deviceCompare,
    cmCwvTier,
    cmCwvDistribution,
    cmDailyCwv,
    topPagesRows: topPagesOut,
    cmErrorRates,
    cmErrorCounts,
    topExceptionRows: topExceptionsOut,
    topRequestErrorRows: topRequestErrorsOut,
  };
}

// ── demo (hardcoded) data ────────────────────────────────────────────────
function demoCurrentMonthData() {
  const dayLabels = Array.from({ length: 30 }, (_, i) => String(i + 1));
  return {
    kpis: [
      { label: "Sessions", value: "71K", change: null, color: "#7B61FF", lowerIsBetter: false },
      { label: "Page Loads", value: "89K", change: null, color: "#1D8AB7", lowerIsBetter: false },
      { label: "LCP p75", value: "2.6s", change: null, color: "#F5A623", lowerIsBetter: true },
      { label: "INP p75", value: "210ms", change: null, color: "#1496ff", lowerIsBetter: true },
    ],
    cmDailyDevice: {
      labels: dayLabels,
      desktop: dayLabels.map((_, i) => 1200 + (i % 5) * 40),
      mobile: dayLabels.map((_, i) => 900 + (i % 7) * 30),
    },
    deviceCompareRows: [
      { deviceType: "Desktop", sessions: 40200, pageLoads: 38900, lcpP75: 2200, inpP75: 180, clsP75: 0.04 },
      { deviceType: "Mobile", sessions: 31000, pageLoads: 29800, lcpP75: 3100, inpP75: 260, clsP75: 0.09 },
    ],
    cmCwvTier: {
      lcp: { good: 72, ni: 18, poor: 10 },
      inp: { good: 81, ni: 12, poor: 7 },
      cls: { good: 90, ni: 7, poor: 3 },
    },
    cmCwvDistribution: {
      lcp: { buckets: ["0-1s", "1-2s", "2-3s", "3-4s", "4-5s", "5-6s", "6-7s", "7-8s", "8-9s", "9-10s", "10s+"], counts: [500, 4200, 5100, 2300, 900, 400, 200, 100, 50, 30, 20], p75: 2600 },
      inp: { buckets: ["0-100ms", "100-200ms", "200-300ms", "300-400ms", "400-500ms", "500-600ms", "600-700ms", "700-800ms", "800-900ms", "900ms-1s", "1s+"], counts: [500, 4200, 5100, 2300, 900, 400, 200, 100, 50, 30, 20], p75: 210 },
      cls: { buckets: ["0-0.1", "0.1-0.2", "0.2-0.3", "0.3-0.4", "0.4-0.5", "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0", "1.0+"], counts: [8000, 900, 300, 100, 50, 20, 10, 5, 3, 1, 0], p75: 0.06 },
    },
    cmDailyCwv: {
      labels: dayLabels,
      lcp: { desktop: dayLabels.map(() => 2200 + Math.round(Math.random() * 200)), mobile: dayLabels.map(() => 3000 + Math.round(Math.random() * 300)) },
      inp: { desktop: dayLabels.map(() => 170 + Math.round(Math.random() * 30)), mobile: dayLabels.map(() => 240 + Math.round(Math.random() * 40)) },
      cls: { desktop: dayLabels.map(() => 0.04), mobile: dayLabels.map(() => 0.09) },
    },
    topPagesRows: [
      { name: "/checkout", count: 9200, lcp: 2100, inp: 150, cls: 0.03, exceptions: 4, requestErrors: 2 },
      { name: "/home", count: 8100, lcp: 1900, inp: 130, cls: 0.02, exceptions: 1, requestErrors: 0 },
      { name: "/product/123", count: 6400, lcp: 2600, inp: 210, cls: 0.07, exceptions: 6, requestErrors: 3 },
    ],
    cmErrorRates: { labels: dayLabels, jsErrorRate: dayLabels.map(() => 0.4), reqErrorRate: dayLabels.map(() => 1.1) },
    cmErrorCounts: { labels: dayLabels, byType: { "JS Error": dayLabels.map(() => 3), "Timeout": dayLabels.map(() => 1) } },
    topExceptionRows: [
      { count: 120, type: "TypeError", message: "Cannot read properties of undefined", source: "app.bundle.js" },
      { count: 45, type: "ReferenceError", message: "x is not defined", source: "vendor.bundle.js" },
    ],
    topRequestErrorRows: [
      { count: 80, method: "GET", status: 500, host: "api.acme.com", path: "/v1/cart" },
      { count: 22, method: "POST", status: 404, host: "api.acme.com", path: "/v1/checkout" },
    ],
  };
}

function demoFindings(sections) {
  const out = {};
  for (const placeholder of Object.keys(sections)) {
    out[placeholder] = "<ul><li>Demo finding one for this section.</li><li>Demo finding two for this section.</li><li>Demo finding three for this section.</li></ul>";
  }
  return out;
}

// ── render ───────────────────────────────────────────────────────────────
// 5-page layout: Page 1 = Executive Summary (all findings), Pages 2-5 = chart detail pages (no findings panels)
const CM_SECTIONS = { FINDINGS_TRAFFIC_HTML: "Traffic", FINDINGS_CWV_HTML: "Core Web Vitals", FINDINGS_PAGES_HTML: "Pages", FINDINGS_ERRORS_HTML: "Error" };

// Placeholder substitution + Chart.js inlining + contenteditable/save-bar
// injection — everything that turns (data, findings, meta) into the final
// HTML string, independent of *where* data/findings came from (a dtctl data
// dir + findings.txt for a real run, or a fixture for scripts/preview.mjs).
// Exported so preview.mjs can reuse it instead of re-implementing template
// substitution against a second copy of report-cm.html.tmpl's placeholder set.
export function assembleHtml({ data, findings, frontend, environment, dateRangeLabel, generatedAt, outPath }) {
  const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report-cm.html.tmpl"), "utf8");

  const replacements = {
    "{{REPORT_TITLE}}": `${frontend} — ${dateRangeLabel} Review`,
    "{{FRONTEND_NAME}}": frontend || "",
    "{{ENVIRONMENT_NAME}}": environment || "",
    "{{DATE_RANGE_LABEL}}": dateRangeLabel,
    "{{GENERATED_AT}}": generatedAt,
  };
  for (const [key, value] of Object.entries(findings)) {
    replacements[`{{${key}}}`] = value;
  }

  // The top-of-file contract comment cites every placeholder token verbatim
  // as documentation prose (e.g. "{{FRONTEND_NAME}} - shown top-right...").
  // A blind global replace would corrupt that comment with rendered values
  // (and, for {{DATA_JSON}}, hit the comment's mention instead of the real
  // `const DATA = {{DATA_JSON}};` in <script>). The comment isn't
  // necessarily a prefix of the template (e.g. <title>{{REPORT_TITLE}}</title>
  // can precede it), so cut it out by position, substitute everywhere else,
  // then splice the untouched original comment back in.
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

  // Inline Chart.js so the HTML is self-contained — works from any location
  // (e.g. ~/Downloads after the user saves edits via the in-browser save bar).
  const chartJs = fs.readFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), "utf8")
    .replace(/\/\/# sourceMappingURL=\S+/g, "");
  html = html.replace('<script src="chart.umd.min.js"></script>', `<script>${chartJs}</script>`);

  // Make findings panels editable in the browser preview. The v2 template
  // renamed these panels' class from "exec-body" to "notes-body" (the shared
  // deck-base.css idiom, also used by report-trending.html.tmpl) — this regex
  // was updated in the same change, per the contract in report-cm.html.tmpl's
  // header comment.
  html = html.replace(/class="notes-body"/g, 'class="notes-body" contenteditable="true" spellcheck="false"');

  // Inject a floating save bar. The save button downloads the current DOM as
  // an HTML file to ~/Downloads — the PDF step uses that file if it exists.
  // Hidden at print time so it never appears in the PDF.
  const reportFilename = path.basename(outPath);
  // Colours here are var() onto the same Strato tokens the template's own
  // <style> block declares (this snippet lands inside that same document, so
  // the custom properties are in scope) rather than new raw hex — the save
  // bar is chrome, not report content, but "no new hex outside :root" still
  // holds for anything the reader can see.
  html = html.replace("</body>", `<style>
  #dt-save-bar{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;align-items:center;gap:12px;background:var(--bg-container);border:1px solid var(--dt-primary);border-radius:var(--dt-radius);padding:10px 18px;box-shadow:0 4px 20px color-mix(in srgb, var(--dt-bg-base) 70%, transparent);font-family:var(--dt-font-sans);font-size:var(--rp-text-small);color:var(--text-default)}
  #dt-save-bar button{background:var(--dt-primary);color:var(--dt-bg-base);border:none;border-radius:6px;padding:7px 16px;cursor:pointer;font-size:var(--rp-text-small);font-weight:600}
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
  btn.textContent='✓ Saved to Downloads';btn.style.background='var(--good)';
  setTimeout(function(){btn.textContent='Save changes';btn.style.background=''},3000);
}
</script>
</body>`);

  const outDir = path.dirname(path.resolve(outPath));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${outPath}`);
}

// ── CLI entry (real or --demo run) ──────────────────────────────────────
function renderReport(outPath) {
  const data = args.demo ? demoCurrentMonthData() : buildCurrentMonthData(args.data);
  const findings = args.demo ? demoFindings(CM_SECTIONS) : loadFindings(args.findings, CM_SECTIONS);

  const frontend = args.demo ? "demo-frontend" : args.frontend;
  const now = new Date();
  const generatedAt = `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const dateRangeLabel = prevMonth.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  assembleHtml({ data, findings, frontend, environment: args.environment, dateRangeLabel, generatedAt, outPath });
}

if (isMain) renderReport(args.out);
