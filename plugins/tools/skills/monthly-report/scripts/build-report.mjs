#!/usr/bin/env node
// Glue script for the monthly-report skill.
// Reads dtctl query JSON output (+ a findings markdown file) and fills
// the current-month report HTML template (report-cm.html.tmpl).
//
// Usage:
//   node build-report.mjs --data <dir> --print-tables
//   node build-report.mjs --frontend "NAME" --data <dir> --findings <findings.md> --out <report.html>
//   node build-report.mjs --demo --out <demo.html>
// (--type is accepted and ignored, for callers that still pass it.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

// ── CLI args ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    // A flag whose next token is another flag (or which ends the line) is a
    // boolean (--demo, --print-tables).
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out[a.slice(2)] = true; }
    else { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

// CLI arg parsing/validation and the renderReport(args.out) call at the
// bottom of this file only run when the script is invoked directly (`node
// build-report.mjs ...`) — guarded so `scripts/preview.mjs` can `import
// { assembleHtml }` from here (to reuse the placeholder-substitution /
// Chart.js-inlining / contenteditable logic) without tripping the "Missing
// --out" exit this file's own CLI entry requires.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = isMain ? parseArgs(process.argv.slice(2)) : {};
if (isMain && !args["print-tables"] && !args.out) {
  console.error("Missing --out <report.html>");
  process.exit(1);
}
if (isMain && !args.data && (args["print-tables"] || !args.demo)) {
  console.error("Missing --data <dir>" + (args["print-tables"] ? "" : " (or pass --demo)"));
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
function dayLabel(ms) {
  return String(new Date(ms).getUTCDate());
}

// ── dtctl JSON envelope parsing ─────────────────────────────────────────
// dtctl's `-o json --agent --spill=never` output shape (see dtctl SKILL.md /
// references/queries.md): rows inline under `result.records` when
// `result.kind === "records"`. Be defensive about the exact envelope nesting
// since it isn't pinned down 1:1 anywhere — accept a bare array too.
//
// dtctl hoists columns that are identical in every row into `result.constant`
// and drops null keys from each record — merge the constants back so a
// desktop-only frontend still has `device.type` on every row.
export function loadRecords(dataDir, filename) {
  const p = path.join(dataDir, filename);
  const raw = fs.readFileSync(p, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  const result = parsed.result ?? parsed;
  if (result && Array.isArray(result.records)) {
    const constant = result.constant && typeof result.constant === "object" ? result.constant : null;
    return constant ? result.records.map((r) => ({ ...constant, ...r })) : result.records;
  }
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
export function buildCurrentMonthData(dataDir) {
  const dailyDeviceRows = loadRecords(dataDir, "cm-daily-device.json");
  const deviceCompareRows = loadRecords(dataDir, "cm-device-compare.json");
  const cwvTierRow = loadRecords(dataDir, "cm-cwv-tier.json")[0] || {};
  const dailyCwvRows = loadRecords(dataDir, "cm-daily-cwv.json");
  const topPagesRows = loadRecords(dataDir, "cm-top-pages.json");
  const errorRows = loadRecords(dataDir, "cm-errors.json");
  const errorCountRows = loadRecords(dataDir, "cm-error-count.json");
  const topExceptionsRows = loadRecords(dataDir, "cm-top-exceptions.json");
  const topRequestErrorsRows = loadRecords(dataDir, "cm-top-request-errors.json");

  // Strip warm-up days (queries start 2d before month start to avoid timeseries
  // artifacts on day 1). The report month is the month of the newest day in the
  // data, not the wall clock — a run that straddles a month boundary would
  // otherwise filter out every row. ISO day strings sort lexicographically.
  const newestDay = dailyDeviceRows.map((r) => r.day).sort().pop();
  const now = new Date();
  const anchor = newestDay ? new Date(newestDay) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); // no data: previous month by clock
  const monthStartDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const monthStart = monthStartDate.toISOString().slice(0, 10);
  const monthLabel = monthStartDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const inMonth = (r) => r.day.slice(0, 10) >= monthStart;
  const dailyDeviceRowsFiltered = dailyDeviceRows.filter(inMonth);
  const dailyCwvRowsFiltered = dailyCwvRows.filter(inMonth);
  const errorCountRowsFiltered = errorCountRows.filter(inMonth);

  // cmDailyDevice
  const days = [...new Set(dailyDeviceRowsFiltered.map((r) => r.day))].sort();
  const dayLabels = days.map(dayLabel);
  const byDayDevice = (rows, valueKey, deviceKey = "device.type") => {
    // null, not 0: a day with no row is "not measured" — 0 would plot as a
    // perfect "0ms — good" score (or a traffic collapse).
    const desktop = new Array(days.length).fill(null);
    const mobile = new Array(days.length).fill(null);
    rows.forEach((r) => {
      const idx = days.indexOf(r.day);
      if (idx === -1) return;
      if (r[deviceKey] === "desktop") desktop[idx] = r[valueKey];
      else if (r[deviceKey] === "mobile") mobile[idx] = r[valueKey];
    });
    return { desktop, mobile };
  };
  // Whether this frontend has a mobile audience worth drawing at all. Decided
  // ONCE here, from the device totals, and applied to every device-split
  // series below — otherwise a frontend with 3 mobile sessions against 477k
  // desktop gets a flat zero line and a "Mobile" legend entry on four separate
  // charts, each claiming a series the reader cannot see. A null series is the
  // signal to the template to omit both the line and its legend entry.
  const mobileSessions = deviceCompareRows
    .filter((r) => r.device_type === "mobile")
    .reduce((s, r) => s + (r.sessions || 0), 0);
  const allSessions = deviceCompareRows.reduce((s, r) => s + (r.sessions || 0), 0);
  const hasMobile = allSessions > 0 && mobileSessions / allSessions >= 0.005;
  const splitByDevice = (rows, valueKey) => {
    const { desktop, mobile } = byDayDevice(rows, valueKey);
    return { desktop, mobile: hasMobile ? mobile : null };
  };

  const cmDailyDevice = { labels: dayLabels, ...splitByDevice(dailyDeviceRowsFiltered, "sessions") };

  // A 0 for LCP or INP is an ABSENT measurement, not a perfect one. INP only
  // exists once a page has been interacted with, so crawler and asset paths
  // (/robots.txt, /sitemap.xml) come back as 0 — and rendered as a figure
  // those grade "good" green, i.e. the report claiming a flawless score for a
  // page that was never measured. Map them to null so the template's own
  // null handling (msRating -> "none", the em-dash) takes over.
  //
  // CLS is deliberately NOT included: zero layout shift is a real, achievable
  // measurement, so 0 there is a value rather than a gap.
  const absentIfZero = (v) => (v == null || v <= 0 ? null : v);
  const dcRows = deviceCompareRows.map((r) => ({ ...r, lcp_p75: absentIfZero(r.lcp_p75), inp_p75: absentIfZero(r.inp_p75) }));
  const deviceCompare = dcRows.map((r) => ({
    deviceType: r.device_type ? r.device_type[0].toUpperCase() + r.device_type.slice(1) : "—",
    sessions: r.sessions,
    pageLoads: r.page_loads,
    lcpP75: r.lcp_p75,
    inpP75: r.inp_p75,
    clsP75: r.cls_p75 == null ? null : r.cls_p75 / 10000,
  }));

  // blended p75s (weighted by page_loads) for KPIs + distribution p75 labels.
  // Rows with no measurement (null/0 LCP/INP) are skipped, not averaged in as 0;
  // no measured row at all -> null.
  const totalPageLoads = deviceCompareRows.reduce((s, r) => s + (r.page_loads || 0), 0);
  const blended = (key) => {
    const rows = dcRows.filter((r) => r[key] != null && r.page_loads > 0);
    const w = rows.reduce((s, r) => s + r.page_loads, 0);
    return w > 0 ? rows.reduce((s, r) => s + r[key] * r.page_loads, 0) / w : null;
  };
  const totalSessions = deviceCompareRows.reduce((s, r) => s + (r.sessions || 0), 0);

  // cmCwvTier (percentages)
  const tierPct = (good, ni, poor, total) =>
    total > 0
      ? { good: Math.round((good / total) * 100), ni: Math.round((ni / total) * 100), poor: Math.round((poor / total) * 100) }
      : null; // no measurements: null (no tier bar), not 0/0/0
  const cmCwvTier = {
    lcp: tierPct(cwvTierRow.lcp_good, cwvTierRow.lcp_ni, cwvTierRow.lcp_poor, cwvTierRow.lcp_total),
    inp: tierPct(cwvTierRow.inp_good, cwvTierRow.inp_ni, cwvTierRow.inp_poor, cwvTierRow.inp_total),
    cls: tierPct(cwvTierRow.cls_good, cwvTierRow.cls_ni, cwvTierRow.cls_poor, cwvTierRow.cls_total),
  };

  // cmCwvDistribution: p75 only (the template's metric-tiles read nothing else)
  const cmCwvDistribution = {
    lcp: { p75: blended("lcp_p75") },
    inp: { p75: blended("inp_p75") },
    cls: { p75: blended("cls_p75") == null ? null : blended("cls_p75") / 10000 },
  };

  // cmDailyCwv
  const dailyCwv = dailyCwvRowsFiltered.map((r) => ({ ...r, lcp: absentIfZero(r.lcp), inp: absentIfZero(r.inp) }));
  const cmDailyCwv = {
    labels: dayLabels,
    lcp: splitByDevice(dailyCwv, "lcp"),
    inp: splitByDevice(dailyCwv, "inp"),
    cls: (() => {
      const c = splitByDevice(dailyCwv, "cls");
      const scale = (arr) => (arr == null ? null : arr.map((v) => (v == null ? null : v / 10000)));
      return { desktop: scale(c.desktop), mobile: scale(c.mobile) };
    })(),
  };

  // topPagesRows (absentIfZero: see above)
  const topPagesAll = topPagesRows.map((r) => ({
    name: r["page.name"],
    count: Number(r.count) || 0,
    lcp: absentIfZero(r.lcp),
    inp: absentIfZero(r.inp),
    cls: r.cls,
    exceptions: r.exceptions,
    requestErrors: r.request_errors,
  }));
  // Long-tail floor, same shape as the trending deck's BP_MIN_VISITS: a page
  // with a handful of visits contributes a row whose bar is an empty track
  // next to a leader three orders of magnitude bigger. Falls back to the
  // unfiltered set so a genuinely low-traffic frontend still gets a table
  // instead of an empty panel.
  const TOP_PAGES_MIN_VISITS = 10;
  const topPagesFiltered = topPagesAll.filter((r) => r.count >= TOP_PAGES_MIN_VISITS);
  const topPagesOut = topPagesFiltered.length ? topPagesFiltered : topPagesAll;

  // cmErrorRates: sum across devices per day
  const errByDay = new Map();
  errorRows.forEach((r) => {
    const cur = errByDay.get(r.day) || { total: 0, js: 0, req: 0 };
    // dtctl returns these counts as strings; `+=` on a string concatenates.
    cur.total += Number(r.total_sessions) || 0;
    cur.js += Number(r.js_error_sessions) || 0;
    cur.req += Number(r.req_error_sessions) || 0;
    errByDay.set(r.day, cur);
  });
  // Plotted across the WHOLE month (the same `days` axis every other daily
  // chart uses), not just the days this query happened to return. cm-errors
  // reads user.events, whose retention is shorter than the metrics the other
  // daily charts read, so on a real tenant it comes back covering only the
  // tail of the month — Aug 13-31 against Aug 1-31 when this was written.
  // Rendered on its own axis that silently became a different date range from
  // the error-count chart directly beneath it on the same page. Days with no
  // data are null (a gap in the line), which reads as "not measured" rather
  // than as a zero error rate.
  const rateOn = (day, pick) => {
    const v = errByDay.get(day);
    if (!v || !(v.total > 0)) return null;
    return Number(((pick(v) / v.total) * 100).toFixed(2));
  };
  const cmErrorRates = {
    labels: dayLabels,
    jsErrorRate: days.map((d) => rateOn(d, (v) => v.js)),
    reqErrorRate: days.map((d) => rateOn(d, (v) => v.req)),
  };

  // cmErrorCounts: JS (error.type "exception") and Request only, per day,
  // summed across device. Other types (csp, ...) are dropped — the stacked
  // chart has no room for a long tail of series.
  const ERROR_SERIES = { exception: "JS Error", request: "Request" };
  const errCountDays = [...new Set(errorCountRowsFiltered.map((r) => r.day))].sort();
  const byType = Object.fromEntries(Object.values(ERROR_SERIES).map((n) => [n, new Array(errCountDays.length).fill(0)]));
  errorCountRowsFiltered.forEach((r) => {
    const name = ERROR_SERIES[r["error.type"]];
    const idx = errCountDays.indexOf(r.day);
    if (!name || idx === -1) return;
    byType[name][idx] += r.error_count || 0;
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

  // Traffic counters only. LCP/INP/CLS are NOT listed here: a bare "863ms"
  // beside a session count carries no verdict, so the template renders the
  // three vitals as rated metric-tiles read straight off cmCwvDistribution's
  // p75 (see renderKpis). Per-KPI `color` is gone with them — it was a raw
  // hex assigned per metric rather than per state, so it said nothing.
  const hasDeviceData = deviceCompareRows.length > 0;
  const kpis = [
    { label: "Sessions", value: hasDeviceData ? compact(totalSessions) : "—", change: null, lowerIsBetter: false },
    { label: "Page Loads", value: hasDeviceData ? compact(totalPageLoads) : "—", change: null, lowerIsBetter: false },
  ];

  return {
    monthLabel,
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

// ── findings tables ──────────────────────────────────────────────────────
// Pipe tables with units already converted, for findings-prompt.md: Claude
// analyses these instead of raw query JSON. "—" = not measured, never zero.
const NA = "—";
const fmtWith = (f) => (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? NA : f(Number(v))); // counts can arrive as "295"
const fmtN = fmtWith((n) => n.toLocaleString("en-US"));
const fmt3 = fmtWith((n) => n.toFixed(3)); // CLS and per-session averages
const fmtPct = fmtWith((n) => n.toFixed(1) + "%");
const fmtDur = (v) => (Number(v) > 0 ? fmtMs(v) : NA); // 0ms LCP/INP is an absent measurement (INP needs an interaction)
const txt = (v) => (v == null || v === "" ? NA : String(v).replace(/\s+/g, " ").replace(/\|/g, "\\|"));
const table = (title, header, rows) => [`### ${title}`, header.join(" | "), ...rows.map((r) => r.join(" | "))].join("\n");

export function renderTables(data) {
  const { monthLabel, cmDailyDevice: dd, cmDailyCwv: cwv, cmCwvTier: tier, cmErrorRates: er, cmErrorCounts: ec } = data;
  const sessionCols = [["Desktop", dd.desktop], ["Mobile", dd.mobile]].filter(([, s]) => s);
  const devices = ["desktop", "mobile"].filter((d) => cwv.lcp[d]);
  const types = Object.keys(ec.byType);
  return [
    table(`Daily Sessions (${monthLabel})`, ["Day", ...sessionCols.map(([n]) => n)],
      dd.labels.map((d, i) => [d, ...sessionCols.map(([, s]) => fmtN(s[i]))])),
    table(`Daily CWV p75 (${monthLabel})`, ["Day", "Device", "LCP", "INP", "CLS"],
      cwv.labels.flatMap((d, i) => devices.map((v) =>
        [d, v[0].toUpperCase() + v.slice(1), fmtDur(cwv.lcp[v][i]), fmtDur(cwv.inp[v][i]), fmt3(cwv.cls[v][i])]))),
    table("Device Comparison", ["Device", "Sessions", "Page Loads", "LCP p75", "INP p75", "CLS p75"],
      data.deviceCompareRows.map((r) => [r.deviceType, fmtN(r.sessions), fmtN(r.pageLoads), fmtDur(r.lcpP75), fmtDur(r.inpP75), fmt3(r.clsP75)])),
    table("CWV Tiers", ["Metric", "Good", "Needs Improvement", "Poor"],
      ["lcp", "inp", "cls"].map((k) => {
        const t = tier[k]; // null = no measurements
        return [k.toUpperCase(), ...(t && t.good + t.ni + t.poor ? [t.good, t.ni, t.poor].map(fmtPct) : [NA, NA, NA])];
      })),
    table("Top Pages", ["Page", "Visits", "LCP p75", "INP p75", "CLS p75", "Avg Exceptions", "Avg Req Errors"],
      data.topPagesRows.map((r) => [txt(r.name), fmtN(r.count), fmtDur(r.lcp), fmtDur(r.inp), fmt3(r.cls), fmt3(r.exceptions), fmt3(r.requestErrors)])),
    table("Daily Error Rates (% of sessions)", ["Day", "JS Error %", "Request Error %"],
      er.labels.map((d, i) => [d, fmtPct(er.jsErrorRate[i]), fmtPct(er.reqErrorRate[i])])),
    table("Daily Error Counts", ["Day", ...types],
      ec.labels.map((d, i) => [d, ...types.map((t) => fmtN(ec.byType[t][i]))])),
    table("Top Exceptions", ["Count", "Type", "Message", "Source"],
      data.topExceptionRows.map((r) => [fmtN(r.count), txt(r.type), txt(r.message), txt(r.source)])),
    table("Top Request Errors", ["Count", "Method", "Status", "Host", "Path"],
      data.topRequestErrorRows.map((r) => [fmtN(r.count), txt(r.method), txt(r.status), txt(r.host), txt(r.path)])),
  ].join("\n\n");
}

// ── demo (hardcoded) data ────────────────────────────────────────────────
function demoCurrentMonthData() {
  const dayLabels = Array.from({ length: 30 }, (_, i) => String(i + 1));
  return {
    kpis: [
      { label: "Sessions", value: "71K", change: null, lowerIsBetter: false },
      { label: "Page Loads", value: "89K", change: null, lowerIsBetter: false },
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
      lcp: { p75: 2600 },
      inp: { p75: 210 },
      cls: { p75: 0.06 },
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
// 4-page layout: Page 1 = Executive Summary (all findings), Pages 2-4 = chart detail pages (no findings panels)
const CM_SECTIONS = { FINDINGS_TRAFFIC_HTML: "Traffic", FINDINGS_CWV_HTML: "Core Web Vitals", FINDINGS_PAGES_HTML: "Pages", FINDINGS_ERRORS_HTML: "Error" };

// Review bar, injected before </body>. Identical in monthly- and trending-report.
// Hidden unless review.mjs served the page (it injects window.DT_REVIEW), so a
// static file or a headless render never shows it; @media print hides it too.
// Autosaves the whole document to review.mjs; "Create PDF" and "Rewrite
// analysis" hand the same HTML over and let the server finish. html() serializes
// a clone with the bar reset so a reload of the saved file starts clean.
// Colours are var() onto the template's own Strato tokens (no new hex).
const REVIEW_BAR = `<style>
  /* Bottom-centre: the bar is viewport-fixed, so it sits over whichever page is
     in view, and the middle of the footer strip is the only band that is empty
     on every page. */
  #dt-review-bar{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:12px;background:var(--bg-container);border:1px solid var(--dt-primary);border-radius:var(--dt-radius);padding:10px 18px;box-shadow:0 4px 20px color-mix(in srgb, var(--dt-bg-base) 70%, transparent);font-family:var(--dt-font-sans);font-size:var(--rp-text-small);color:var(--text-default)}
  #dt-review-bar[hidden]{display:none}
  #dt-review-status{max-width:min(60ch,40vw);white-space:pre-line;overflow-wrap:anywhere}
  #dt-review-bar button{background:var(--dt-primary);color:var(--dt-bg-base);border:1px solid var(--dt-primary);border-radius:6px;padding:7px 16px;cursor:pointer;font-family:inherit;font-size:var(--rp-text-small);font-weight:600}
  #dt-review-bar button:hover:not(:disabled){background:color-mix(in srgb, var(--dt-primary) 85%, white)}
  #dt-review-bar button.dt-sec{background:transparent;color:var(--text-default)}
  #dt-review-bar button.dt-sec:hover:not(:disabled){background:color-mix(in srgb, var(--dt-primary) 20%, transparent)}
  #dt-review-bar button:disabled{opacity:.5;cursor:default}
  @media print{#dt-review-bar{display:none!important}}
</style>
<div id="dt-review-bar" hidden>
  <span id="dt-review-status"></span>
  <button id="dt-theme-btn" class="dt-sec" onclick="dtSetTheme(document.documentElement.dataset.theme==='light'?'dark':'light')">Theme: Dark</button>
  <button id="dt-pdf-btn">Create PDF</button>
  <button id="dt-rewrite-btn" class="dt-sec">Rewrite analysis</button>
</div>
<script>
window.addEventListener('dt-theme',function(e){document.getElementById('dt-theme-btn').textContent='Theme: '+(e.detail==='light'?'Light':'Dark')});
document.addEventListener('DOMContentLoaded',function(){document.getElementById('dt-theme-btn').textContent='Theme: '+(document.documentElement.dataset.theme==='light'?'Light':'Dark')});
(function(){
  var R=window.DT_REVIEW,bar=document.getElementById('dt-review-bar');
  if(!R||!bar)return;
  var st=document.getElementById('dt-review-status'),pdf=document.getElementById('dt-pdf-btn'),rw=document.getElementById('dt-rewrite-btn'),timer,q=Promise.resolve(),over=false;
  function say(t){st.textContent=t}
  function lock(on){pdf.disabled=on;rw.disabled=on}
  function finish(t){over=true;say(t);[].forEach.call(bar.querySelectorAll('button'),function(b){b.hidden=true})}
  function html(){
    var c=document.documentElement.cloneNode(true),b=c.querySelector('#dt-review-bar');
    b.hidden=true;b.querySelector('#dt-review-status').textContent='';
    [].forEach.call(b.querySelectorAll('button'),function(x){x.disabled=false;x.hidden=false});
    return '<!DOCTYPE html>\\n'+c.outerHTML;
  }
  // one request at a time, in order, so a late autosave can never overwrite the final HTML
  function post(route,query,body){
    var r=q.catch(function(){}).then(function(){return fetch(route+'?t='+R.token+query,{method:'POST',body:body})});
    q=r;return r;
  }
  function save(){
    say('Saving…');
    post('/save','',html()).then(function(r){if(!r.ok)throw 0;if(!over)say('All changes saved')})
      .catch(function(){if(!over){say("Couldn't save — will retry");timer=setTimeout(save,5000)}});
  }
  bar.hidden=false;say('Edit the findings above, then create the PDF');
  document.addEventListener('input',function(e){
    if(over||!e.target.closest||!e.target.closest('[contenteditable]'))return;
    clearTimeout(timer);timer=setTimeout(save,800);
  });
  pdf.addEventListener('click',function(){
    clearTimeout(timer);lock(true);say('Creating PDF…');
    post('/finish','&theme='+(document.documentElement.dataset.theme==='light'?'light':'dark'),html())
      .then(function(r){return r.json()})
      .then(function(j){if(!j.ok)throw new Error(j.error);finish('PDF saved to '+j.pdf+' — you can close this tab.')})
      .catch(function(e){lock(false);say((e&&e.message)||'Could not create the PDF')});
  });
  rw.addEventListener('click',function(){
    if(!confirm("Discard your edits and ask Claude to rewrite the findings?"))return;
    clearTimeout(timer);lock(true);
    post('/rewrite','',html())
      .then(function(r){if(!r.ok)throw 0;finish('Claude is rewriting the analysis — a new tab will open.')})
      .catch(function(){lock(false);say("Couldn't reach the review server")});
  });
})();
</script>
`;

// Placeholder substitution + Chart.js inlining + contenteditable/review-bar
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
  // (it is served and rendered from the work dir).
  const chartJs = fs.readFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), "utf8")
    .replace(/\/\/# sourceMappingURL=\S+/g, "");
  html = html.replace('<script src="chart.umd.min.js"></script>', `<script>${chartJs}</script>`);

  // Make findings panels editable in the browser preview. The v2 template
  // renamed these panels' class from "exec-body" to "notes-body" (the shared
  // deck-base.css idiom, also used by report-trending.html.tmpl) — this regex
  // was updated in the same change, per the contract in report-cm.html.tmpl's
  // header comment.
  html = html.replace(/class="notes-body"/g, 'class="notes-body" contenteditable="true" spellcheck="false"');

  html = html.replace("</body>", () => REVIEW_BAR + "</body>");

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
  // Bare timestamp, no "Generated " prefix — the template's footer supplies
  // that word (report-cm.html.tmpl: `<span>Generated {{GENERATED_AT}}</span>`),
  // and the fixture's own generatedAt is bare for the same reason. Prefixing
  // here too rendered "Generated Generated ..." on the live path only, which
  // is exactly why fixture-only verification never caught it.
  const generatedAt = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  // A real run labels the report with the month its data covers; the demo has no data, so it keeps the clock.
  const dateRangeLabel = args.demo ? prevMonth.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : data.monthLabel;

  assembleHtml({ data, findings, frontend, environment: args.environment, dateRangeLabel, generatedAt, outPath });
}

if (isMain) {
  if (args["print-tables"]) console.log(renderTables(buildCurrentMonthData(args.data)));
  else renderReport(args.out);
}
