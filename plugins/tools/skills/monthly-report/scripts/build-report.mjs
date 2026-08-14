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

const args = parseArgs(process.argv.slice(2));
if (args.type !== "current-month") {
  console.error('Missing/invalid --type (must be "current-month")');
  process.exit(1);
}
if (!args.out) {
  console.error("Missing --out <report.html>");
  process.exit(1);
}
if (!args.demo && !args.data) {
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
  const LCP_INP_BUCKETS = ["0-1s", "1-2s", "2-3s", "3-4s", "4-5s", "5-6s", "6-7s", "7-8s", "8-9s", "9-10s", "10s+"];
  const CLS_BUCKETS = ["0-0.1", "0.1-0.2", "0.2-0.3", "0.3-0.4", "0.4-0.5", "0.5-0.6", "0.6-0.7", "0.7-0.8", "0.8-0.9", "0.9-1.0", "1.0+"];
  const bucketCounts = (row, prefix) => Array.from({ length: 11 }, (_, i) => row[`${prefix}_b${i}`] || 0);
  const cmCwvDistribution = {
    lcp: { buckets: LCP_INP_BUCKETS, counts: bucketCounts(distRow, "lcp"), p75: blended("lcp_p75") },
    inp: { buckets: LCP_INP_BUCKETS, counts: bucketCounts(distRow, "inp"), p75: blended("inp_p75") },
    cls: { buckets: CLS_BUCKETS, counts: bucketCounts(distRow, "cls"), p75: blended("cls_p75") == null ? null : blended("cls_p75") },
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
      inp: { buckets: ["0-1s", "1-2s", "2-3s", "3-4s", "4-5s", "5-6s", "6-7s", "7-8s", "8-9s", "9-10s", "10s+"], counts: [9000, 2000, 400, 100, 50, 20, 10, 5, 3, 2, 1], p75: 210 },
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

function renderReport(outPath) {
  const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report-cm.html.tmpl"), "utf8");

  const data = args.demo ? demoCurrentMonthData() : buildCurrentMonthData(args.data);
  const findings = args.demo ? demoFindings(CM_SECTIONS) : loadFindings(args.findings, CM_SECTIONS);

  const frontend = args.demo ? "demo-frontend" : args.frontend;
  const now = new Date();
  const generatedAt = `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const dateRangeLabel = prevMonth.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const replacements = {
    "{{REPORT_TITLE}}": `${frontend} — ${dateRangeLabel} Review`,
    "{{FRONTEND_NAME}}": frontend || "",
    "{{ENVIRONMENT_NAME}}": args.environment || "",
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

  // Make findings panels editable in the browser preview.
  html = html.replace(/class="exec-body"/g, 'class="exec-body" contenteditable="true" spellcheck="false"');

  // Inject a floating save bar. The save button downloads the current DOM as
  // an HTML file to ~/Downloads — the PDF step uses that file if it exists.
  // Hidden at print time so it never appears in the PDF.
  const reportFilename = path.basename(outPath);
  html = html.replace("</body>", `<style>
  #dt-save-bar{position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;align-items:center;gap:12px;background:#12122a;border:1px solid #7B61FF;border-radius:10px;padding:10px 18px;box-shadow:0 4px 20px rgba(0,0,0,.6);font-family:sans-serif;font-size:13px;color:#ccc}
  #dt-save-bar button{background:#7B61FF;color:#fff;border:none;border-radius:6px;padding:7px 16px;cursor:pointer;font-size:13px;font-weight:600}
  #dt-save-bar button:hover{background:#9b85ff}
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
  btn.textContent='✓ Saved to Downloads';btn.style.background='#00A98F';
  setTimeout(function(){btn.textContent='Save changes';btn.style.background=''},3000);
}
</script>
</body>`);

  const outDir = path.dirname(path.resolve(outPath));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${outPath}`);
}

renderReport(args.out);
