#!/usr/bin/env node
// Glue script for the trending-report skill.
// Reads dtctl query JSON output (+ a findings markdown file) and fills
// the trending report HTML template (report-trending.html.tmpl).
//
// Usage:
//   node build-report.mjs --type trending --frontend "NAME" --data <dir> --findings <findings.md> --out <report.html>
//   node build-report.mjs --type trending --demo --out /tmp/demo-trending.html

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
if (args.type !== "trending") {
  console.error('Missing/invalid --type (must be "trending")');
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
// How many browser×device combos to show on the Browser Performance page.
// Real apps can report 10+ browsers; showing all of them doesn't fit the
// page and dilutes the analysis. See references/queries.md for the
// selection policy (top N by total visits over the period). Default is 6
// (a 2-column, 3-row grid, matching the live app's panel layout).
const MAX_BROWSERS = parseInt(args["max-browsers"] || "6", 10);

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

// ── data transforms: trending ───────────────────────────────────────────
function buildTrendingData(dataDir) {
  const metricsRows = loadRecords(dataDir, "metrics-monthly.json")
    .sort((a, b) => a.month - b.month);
  const cwvRows = loadRecords(dataDir, "cwv-monthly.json")
    .sort((a, b) => a.month - b.month);
  // Filter weekly rows to the completed 6-month window (exclude current partial month).
  const cutoffMs = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const weeklyRows = loadRecords(dataDir, "cwv-weekly.json")
    .filter(r => new Date(r.week).getTime() < cutoffMs)
    .sort((a, b) => new Date(a.week).getTime() - new Date(b.week).getTime());
  const browserRows = loadRecords(dataDir, "browser-perf-monthly.json");

  const trafficMonthly = {
    labels: metricsRows.map((r) => monthYearLabel(r.month)),
    sessions: metricsRows.map((r) => r.Sessions),
    userActions: metricsRows.map((r) => r["User Actions"]),
    pageLoads: metricsRows.map((r) => r["Page Loads"]),
    pctDesktop: metricsRows.map((r) => (r["% Desktop"] == null ? null : r["% Desktop"])),
  };

  const cwvMonthly = {
    labels: cwvRows.map((r) => monthYearLabel(r.month)),
    lcp: cwvRows.map((r) => r["Largest Contentful Paint"]),
    inp: cwvRows.map((r) => r["Interaction to Next Paint"]),
    cls: cwvRows.map((r) => r["Cumulative Layout Shift"] / 10000),
  };

  const cwvWeekly = {
    labels: weeklyRows.map((r) => new Date(r.week).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })),
    lcp: weeklyRows.map((r) => r.lcp),
    inp: weeklyRows.map((r) => r.inp),
    cls: weeklyRows.map((r) => (r.cls == null ? null : r.cls / 10000)),
  };

  // Browser selection policy: group by browser×device, rank by total visits
  // summed across the whole 6-month window (not just the latest month, to
  // avoid a one-month spike skewing which browsers "matter"), keep only the
  // top MAX_BROWSERS. Real tenants can report 10+ browser/device combos —
  // showing all of them doesn't fit the page and buries the ones that
  // actually carry traffic.
  const browserGroups = new Map();
  browserRows.forEach((r) => {
    const browser = r["browser.name"] || "Unknown";
    const device = r["device.type"] || "unknown";
    const key = `${browser}||${device}`;
    if (!browserGroups.has(key)) {
      browserGroups.set(key, {
        label: `${browser} · ${device.charAt(0).toUpperCase()}${device.slice(1)}`,
        totalVisits: 0,
        byMonth: new Map(),
      });
    }
    const g = browserGroups.get(key);
    g.totalVisits += r.Visits || 0;
    g.byMonth.set(r.month, r);
  });
  const allMonths = [...new Set(browserRows.map((r) => r.month))].sort((a, b) => a - b);
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
          lcp: r ? r["Largest Contentful Paint"] : null,
          inp: r ? r["Interaction to Next Paint"] : null,
          cls: r && r["Cumulative Layout Shift"] != null ? r["Cumulative Layout Shift"] / 10000 : null,
        };
      }),
    })),
  };

  const last = metricsRows[metricsRows.length - 1];
  const prev = metricsRows[metricsRows.length - 2];
  const lastCwv = cwvRows[cwvRows.length - 1];
  const prevCwv = cwvRows[cwvRows.length - 2];
  const kpis = [
    { label: "Sessions", value: compact(last?.Sessions), change: pctChange(last?.Sessions, prev?.Sessions), color: "#7B61FF", lowerIsBetter: false },
    { label: "User Actions", value: compact(last?.["User Actions"]), change: pctChange(last?.["User Actions"], prev?.["User Actions"]), color: "#00A98F", lowerIsBetter: false },
    { label: "Page Loads", value: compact(last?.["Page Loads"]), change: pctChange(last?.["Page Loads"], prev?.["Page Loads"]), color: "#1D8AB7", lowerIsBetter: false },
    { label: "LCP p75", value: fmtMs(lastCwv?.["Largest Contentful Paint"]), change: pctChange(lastCwv?.["Largest Contentful Paint"], prevCwv?.["Largest Contentful Paint"]), color: "#F5A623", lowerIsBetter: true },
  ];

  return { kpis, trafficMonthly, cwvMonthly, cwvWeekly, browserPerf };
}

// ── demo (hardcoded) data ────────────────────────────────────────────────
function demoTrendingData() {
  const labels = ["Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026"];
  return {
    kpis: [
      { label: "Sessions", value: "482K", change: 6.4, color: "#7B61FF", lowerIsBetter: false },
      { label: "User Actions", value: "1.3M", change: 3.1, color: "#00A98F", lowerIsBetter: false },
      { label: "Page Loads", value: "610K", change: 4.8, color: "#1D8AB7", lowerIsBetter: false },
      { label: "LCP p75", value: "2.4s", change: -5.2, color: "#F5A623", lowerIsBetter: true },
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

function renderReport(outPath) {
  const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report-trending.html.tmpl"), "utf8");

  const data = args.demo ? demoTrendingData() : buildTrendingData(args.data);
  const findings = args.demo ? demoFindings(TRENDING_SECTIONS) : loadFindings(args.findings, TRENDING_SECTIONS);

  const frontend = args.demo ? "demo-frontend" : args.frontend;
  const now = new Date();
  const generatedAt = `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const dateRangeLabel = (() => {
    const labels = data.trafficMonthly.labels;
    return labels.length ? `${labels[0]} – ${labels[labels.length - 1]}` : "";
  })();

  const replacements = {
    "{{REPORT_TITLE}}": `${frontend} — Trending Report`,
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

  const outDir = path.dirname(path.resolve(outPath));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, html);
  // The template loads Chart.js via a relative <script src="chart.umd.min.js">,
  // so it must sit next to the rendered HTML, not just in assets/.
  fs.copyFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), path.join(outDir, "chart.umd.min.js"));
  console.log(`Wrote ${outPath}`);
}

renderReport(args.out);
