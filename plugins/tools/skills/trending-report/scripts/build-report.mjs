#!/usr/bin/env node
// Glue script for the trending-report skill.
// Reads dtctl query JSON output (+ a findings markdown file) and fills
// the trending report HTML template (report-trending.html.tmpl).
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
// build-report.mjs ...`) — guarded so `scripts/preview.mjs` and the tests can
// import from here without tripping the "Missing --out" exit.
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
const args = isMain ? parseArgs(process.argv.slice(2)) : {};
if (isMain && !args["print-tables"] && !args.out) {
  console.error("Missing --out <report.html>");
  process.exit(1);
}
if (isMain && !args.data && (args["print-tables"] || !args.demo)) {
  console.error("Missing --data <dir>" + (args["print-tables"] ? "" : " (or pass --demo)"));
  process.exit(1);
}
// How many browser×device combos to show on the Browser Performance page.
// Real apps can report 10+ browsers; showing all of them doesn't fit the
// page and dilutes the analysis. Ranked by the latest month's visits (see
// the selection comment in buildTrendingData). Default is 6
// (a 2-column, 3-row grid, matching the live app's panel layout).
const MAX_BROWSERS = parseInt(args["max-browsers"] || "6", 10);

// ── shared formatting helpers ──────────────────────────────────────────────
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

// traffic-weekly.json postdates the original four-query contract, so a data
// directory captured before it existed is still valid — the panel is dropped
// rather than the build failing.
function loadRecordsOptional(dataDir, filename) {
  if (!fs.existsSync(path.join(dataDir, filename))) return null;
  return loadRecords(dataDir, filename);
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

// Escaping first (so a literal < or & inside **bold** or `code` can't break
// out) then applying inline formatting on the escaped text is safe: neither
// regex below matches &, < or > and escapeHtml never touches * or `.
function inlineMarkdown(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

// Minimal markdown -> HTML: bullet lists, plain paragraphs, and inline
// **bold**/`code` — findings-prompt.md's own output uses both, and prose
// findings that skip inline formatting are unaffected (neither regex
// matches without the marker characters).
function markdownToHtml(body) {
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

// ── data transforms: trending ───────────────────────────────────────────
export function buildTrendingData(dataDir) {
  // month/week are ISO strings, so subtraction sorts nothing — compare as strings.
  // A month with no Sessions yet has no measurements at all: null its traffic
  // figures so charts show a gap (and the KPI an em dash) rather than 0.
  const metricsRows = loadRecords(dataDir, "metrics-monthly.json")
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => (r.Sessions ? r : { ...r, Sessions: null, "XHR Requests": null, Navigations: null }));
  const cwvRows = loadRecords(dataDir, "cwv-monthly.json")
    .sort((a, b) => a.month.localeCompare(b.month));
  // Weekly rows: only the completed window — nothing from the current partial
  // month, nothing from a leading week that starts before the first month.
  const nowDate = new Date();
  const cutoffMs = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1);
  const firstMonthMs = metricsRows.length ? new Date(metricsRows[0].month).getTime() : -Infinity;
  const inWindow = (r) => { const t = new Date(r.week).getTime(); return t >= firstMonthMs && t < cutoffMs; };
  const byWeek = (a, b) => a.week.localeCompare(b.week);
  const weeklyRows = loadRecords(dataDir, "cwv-weekly.json").filter(inWindow).sort(byWeek);
  const trafficWeeklyRows = (loadRecordsOptional(dataDir, "traffic-weekly.json") ?? []).filter(inWindow).sort(byWeek);
  const browserRows = loadRecords(dataDir, "browser-perf-monthly.json");

  const trafficMonthly = {
    labels: metricsRows.map((r) => monthYearLabel(r.month)),
    sessions: metricsRows.map((r) => r.Sessions),
    userActions: metricsRows.map((r) => r["XHR Requests"]),
    pageLoads: metricsRows.map((r) => r["Navigations"]),
    pctDesktop: metricsRows.map((r) => (r["% Desktop"] == null ? null : r["% Desktop"])),
  };

  // A 0 LCP/INP is "not measured" (INP needs an interaction), never a perfect score; CLS 0 is real.
  const absentIfZero = (v) => (v == null || v <= 0 ? null : v);
  const cwvMonthly = {
    labels: cwvRows.map((r) => monthYearLabel(r.month)),
    lcp: cwvRows.map((r) => absentIfZero(r["Largest Contentful Paint"])),
    inp: cwvRows.map((r) => absentIfZero(r["Interaction to Next Paint"])),
    cls: cwvRows.map((r) => (r["Cumulative Layout Shift"] == null ? null : r["Cumulative Layout Shift"] / 10000)),
  };

  const cwvWeekly = {
    labels: weeklyRows.map((r) => new Date(r.week).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })),
    lcp: weeklyRows.map((r) => absentIfZero(r.lcp)),
    inp: weeklyRows.map((r) => absentIfZero(r.inp)),
    cls: weeklyRows.map((r) => (r.cls == null ? null : r.cls / 10000)),
  };

  // Sessions only. This tenant reports navigations/XHR as null for most of the
  // window and the monthly table alongside already carries both, so a
  // three-series weekly chart would be two mostly-empty lines.
  // ponytail: add the other two series here if a tenant turns up that
  // populates them weekly and the extra lines earn their ink.
  const trafficWeekly = trafficWeeklyRows.length ? {
    labels: trafficWeeklyRows.map((r) => new Date(r.week).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })),
    sessions: trafficWeeklyRows.map((r) => r.sessions),
  } : null;

  // Browser selection policy: group by browser×device, rank by the latest
  // month's visits, keep only the top MAX_BROWSERS. Real tenants can report
  // 10+ browser/device combos — showing all of them doesn't fit the page and
  // buries the ones that actually carry traffic.
  const browserGroups = new Map();
  browserRows.forEach((r) => {
    const browser = r["browser.name"] || "Unknown";
    const device = r["device.type"] || "unknown";
    const key = `${browser}||${device}`;
    if (!browserGroups.has(key)) {
      browserGroups.set(key, {
        label: `${browser} · ${device.charAt(0).toUpperCase()}${device.slice(1)}`,
        byMonth: new Map(),
      });
    }
    const g = browserGroups.get(key);
    g.byMonth.set(r.month, r);
  });
  const allMonths = [...new Set(browserRows.map((r) => r.month))].sort();
  const latestMonth = allMonths[allMonths.length - 1];
  const prevMonth = allMonths[allMonths.length - 2];
  const topGroups = [...browserGroups.values()]
    .filter((g) => {
      const cur = g.byMonth.get(latestMonth)?.Visits || 0;
      const prev = g.byMonth.get(prevMonth)?.Visits || 0;
      // Exclude if both current and previous month have negligible traffic
      return cur > 0 || prev > 10;
    })
    .sort((a, b) => (b.byMonth.get(latestMonth)?.Visits || 0) - (a.byMonth.get(latestMonth)?.Visits || 0))
    .slice(0, MAX_BROWSERS);
  // Always emit exactly MAX_BROWSERS panel slots; null = render as empty/blank card.
  const paddedGroups = [...topGroups, ...Array(Math.max(0, MAX_BROWSERS - topGroups.length)).fill(null)];
  const browserPerf = {
    panels: paddedGroups.map((g) => g === null ? null : ({
      label: g.label,
      months: allMonths.map((m) => {
        const r = g.byMonth.get(m);
        return {
          label: monthYearLabel(m),
          visits: r ? r.Visits : null,
          lcp: r ? absentIfZero(r["Largest Contentful Paint"]) : null,
          inp: r ? absentIfZero(r["Interaction to Next Paint"]) : null,
          cls: r && r["Cumulative Layout Shift"] != null ? r["Cumulative Layout Shift"] / 10000 : null,
        };
      }),
    })),
  };

  const last = metricsRows[metricsRows.length - 1];
  const prev = metricsRows[metricsRows.length - 2];
  // LCP/INP/CLS are deliberately not KPI entries: the template derives them
  // straight from cwvMonthly's latest point and renders them as
  // threshold-scale metric-tiles (see report-trending.html.tmpl's "Page 1:
  // KPI row" comment), which a plain value+delta figure here can't express.
  const kpis = [
    { label: "Sessions", value: compact(last?.Sessions), change: pctChange(last?.Sessions, prev?.Sessions), lowerIsBetter: false },
    { label: "XHR Requests", value: compact(last?.["XHR Requests"]), change: pctChange(last?.["XHR Requests"], prev?.["XHR Requests"]), lowerIsBetter: false },
    { label: "Navigations", value: compact(last?.["Navigations"]), change: pctChange(last?.["Navigations"], prev?.["Navigations"]), lowerIsBetter: false },
  ];

  return { kpis, trafficMonthly, trafficWeekly, cwvMonthly, cwvWeekly, browserPerf };
}

// ── findings tables ──────────────────────────────────────────────────────
// Pipe tables with units already converted, for findings-prompt.md: Claude
// analyses these instead of raw query JSON. "—" = not measured, never zero.
const NA = "—";
const fmtWith = (f) => (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? NA : f(Number(v))); // counts can arrive as "295"
const fmtN = fmtWith((n) => n.toLocaleString("en-US"));
// 0ms LCP/INP is an absent measurement (INP needs an interaction), not a perfect one.
const fmtMs = fmtWith((ms) => (ms <= 0 ? NA : ms >= 1000 ? (ms / 1000).toFixed(2) + "s" : Math.round(ms) + "ms"));
const fmtCls = fmtWith((n) => n.toFixed(3));
const fmtPct = fmtWith((n) => n.toFixed(1) + "%");
const table = (title, header, rows) => [`### ${title}`, header.join(" | "), ...rows.map((r) => r.join(" | "))].join("\n");

export function renderTables(data) {
  const { trafficMonthly: tm, cwvMonthly: cm, cwvWeekly: cw, browserPerf } = data;
  return [
    table("Monthly Traffic", ["Month", "Sessions", "XHR Requests", "Navigations", "% Desktop"],
      tm.labels.map((m, i) => [m, fmtN(tm.sessions[i]), fmtN(tm.userActions[i]), fmtN(tm.pageLoads[i]), fmtPct(tm.pctDesktop[i])])),
    table("Monthly CWV p75", ["Month", "LCP", "INP", "CLS"],
      cm.labels.map((m, i) => [m, fmtMs(cm.lcp[i]), fmtMs(cm.inp[i]), fmtCls(cm.cls[i])])),
    table("Weekly CWV p75", ["Week", "LCP", "INP", "CLS"],
      cw.labels.map((w, i) => [w, fmtMs(cw.lcp[i]), fmtMs(cw.inp[i]), fmtCls(cw.cls[i])])),
    table("Browser & Device (shown panels)", ["Panel", "Month", "Visits", "LCP", "INP", "CLS"],
      browserPerf.panels.filter(Boolean).flatMap((p) =>
        p.months.map((m) => [p.label, m.label, fmtN(m.visits), fmtMs(m.lcp), fmtMs(m.inp), fmtCls(m.cls)]))),
  ].join("\n\n");
}

// ── demo (hardcoded) data ────────────────────────────────────────────────
function demoTrendingData() {
  const labels = ["Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026"];
  return {
    kpis: [
      { label: "Sessions", value: "482K", change: 6.4, lowerIsBetter: false },
      { label: "XHR Requests", value: "1.3M", change: 3.1, lowerIsBetter: false },
      { label: "Navigations", value: "610K", change: 4.8, lowerIsBetter: false },
    ],
    trafficMonthly: {
      labels,
      sessions: [420000, 435000, 448000, 461000, 453000, 482000],
      userActions: [1150000, 1180000, 1210000, 1260000, 1240000, 1300000],
      pageLoads: [540000, 555000, 570000, 585000, 582000, 610000],
      pctDesktop: [62, 61, 60, 59, 58, 57],
    },
    cwvMonthly: {
      labels,
      lcp: [2650, 2600, 2550, 2500, 2480, 2400],
      inp: [220, 215, 205, 200, 195, 190],
      cls: [0.09, 0.085, 0.08, 0.078, 0.075, 0.07],
    },
    cwvWeekly: {
      labels: ["Jun 2", "Jun 9", "Jun 16", "Jun 23", "Jun 30", "Jul 7"],
      lcp: [2500, 2480, 2460, 2440, 2420, 2400],
      inp: [200, 198, 196, 194, 192, 190],
      cls: [0.08, 0.079, 0.077, 0.075, 0.073, 0.07],
    },
    browserPerf: {
      panels: ["Chrome · Desktop", "Safari · Mobile", "Chrome · Mobile", "Firefox · Desktop"].map((label, i) => ({
        label,
        months: labels.map((m, j) => ({
          label: m,
          visits: 20000 - i * 2000 + j * 500,
          lcp: 2200 + i * 150 + j * 10,
          inp: 170 + i * 15 + j * 2,
          cls: 0.05 + i * 0.015,
        })),
      })),
    },
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
const TRENDING_SECTIONS = { FINDINGS_TRAFFIC_HTML: "Traffic", FINDINGS_CWV_HTML: "Core Web Vitals", FINDINGS_BROWSER_HTML: "Browser" };

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
// Exported so preview.mjs reuses it instead of keeping a second copy of the
// template's placeholder contract.
export function assembleHtml({ data, findings, frontend, environment, dateRangeLabel, generatedAt, outPath }) {
  const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report-trending.html.tmpl"), "utf8");

  const replacements = {
    "{{REPORT_TITLE}}": `${frontend} — Trending Report`,
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
  // "<" escaped so visitor-controlled strings (exception messages, URL paths) cannot close the <script>.
  after = after.replace("{{DATA_JSON}}", () => JSON.stringify(data).replace(/</g, "\\u003c"));
  let html = head + comment + after;

  // Inline Chart.js so the HTML is self-contained — works from any location
  // (it is served and rendered from the work dir).
  const chartJs = fs.readFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), "utf8")
    .replace(/\/\/# sourceMappingURL=\S+/g, "");
  html = html.replace('<script src="chart.umd.min.js"></script>', `<script>${chartJs}</script>`);

  // Make findings panels editable in the browser preview.
  html = html.replace(/class="findings-body"/g, 'class="findings-body" contenteditable="true" spellcheck="false"');

  html = html.replace("</body>", () => REVIEW_BAR + "</body>");

  const outDir = path.dirname(path.resolve(outPath));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, html);
  console.log(`Wrote ${outPath}`);
}

// ── CLI entry (real or --demo run) ──────────────────────────────────────
function renderReport(outPath) {
  const data = args.demo ? demoTrendingData() : buildTrendingData(args.data);
  const findings = args.demo ? demoFindings(TRENDING_SECTIONS) : loadFindings(args.findings, TRENDING_SECTIONS);

  const frontend = args.demo ? "demo-frontend" : args.frontend;
  const labels = data.trafficMonthly.labels;
  const dateRangeLabel = labels.length ? `${labels[0]} – ${labels[labels.length - 1]}` : "";

  // Bare timestamp: the template's footer supplies the word "Generated".
  const generatedAt = `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;

  assembleHtml({ data, findings, frontend, environment: args.environment, dateRangeLabel, generatedAt, outPath });
}

if (isMain) {
  if (args["print-tables"]) console.log(renderTables(buildTrendingData(args.data)));
  else renderReport(args.out);
}
