#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTrendingData, loadRecords, renderTables } from "./build-report.mjs";

const FILES = ["metrics-monthly", "cwv-monthly", "cwv-weekly", "browser-perf-monthly", "traffic-weekly"];
const tmpDirs = [];

// Writes every required file as a dtctl envelope; `overrides[name]` = { records, constant }.
function makeDataDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-"));
  tmpDirs.push(dir);
  for (const name of FILES) {
    const { records = [], constant } = overrides[name] || {};
    const result = { kind: "records", records, ...(constant && { constant }) };
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ ok: true, result }));
  }
  return dir;
}

const ts = (d) => `${d}T00:00:00.000000000Z`;
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const browserRow = (browser, m, visits) => ({
  "browser.name": browser, month: ts(`${m}-01`), Visits: visits,
  "Largest Contentful Paint": 2000, "Interaction to Next Paint": 150, "Cumulative Layout Shift": 500,
});

try {
  const dir = makeDataDir({
    // D6: rows out of order; D5: May has no data yet (Sessions 0)
    "metrics-monthly": {
      records: MONTHS.slice().reverse().map((m) => ({
        month: ts(`${m}-01`), Sessions: m === "2026-05" ? 0 : 1000, "XHR Requests": m === "2026-05" ? 0 : 5000, Navigations: m === "2026-05" ? 0 : 2000,
      })),
    },
    "cwv-monthly": {
      records: MONTHS.slice().reverse().map((m) => ({
        month: ts(`${m}-01`), "Largest Contentful Paint": 2000, "Interaction to Next Paint": 150, "Cumulative Layout Shift": 500,
      })),
    },
    // 2026-04-26 is a leading partial week (before the first month, 2026-05-01)
    "cwv-weekly": {
      records: ["2026-05-10", "2026-04-26", "2026-05-03"].map((w) => ({ week: ts(w), lcp: 2000, inp: 150, cls: 500 })),
    },
    "traffic-weekly": {
      records: ["2026-05-10", "2026-04-26", "2026-05-03"].map((w) => ({ week: ts(w), sessions: 300 })),
    },
    // D2: device.type hoisted into constant; D6: shuffled across months — Safari leads
    // the window total, Chrome leads the latest month and so ranks first.
    "browser-perf-monthly": {
      constant: { "device.type": "desktop" },
      records: [
        browserRow("Safari", "2026-10", 40), browserRow("Chrome", "2026-07", 100),
        browserRow("Chrome", "2026-10", 90), browserRow("Safari", "2026-05", 900),
        browserRow("Chrome", "2026-05", 10), browserRow("Chrome", "2026-06", 50),
        browserRow("Safari", "2026-09", 80), browserRow("Chrome", "2026-09", 95),
        browserRow("Chrome", "2026-08", 99),
      ],
    },
  });
  const data = buildTrendingData(dir);

  assert.equal(data.browserPerf.panels[0].label, "Chrome · Desktop");
  assert.equal(data.browserPerf.panels[1].label, "Safari · Desktop");
  assert.deepEqual(data.browserPerf.panels[0].months.map((m) => m.label).slice(0, 2), ["May 2026", "Jun 2026"]);
  assert.equal(data.browserPerf.panels.length, 6);
  assert.equal(data.trafficMonthly.sessions[0], null);
  assert.equal(data.trafficMonthly.userActions[0], null);
  assert.equal(data.trafficMonthly.pageLoads[0], null);
  assert.equal(data.trafficMonthly.sessions[5], 1000);
  assert.deepEqual(data.trafficMonthly.labels.slice(0, 2), ["May 2026", "Jun 2026"]);
  assert.equal(data.kpis[0].value, "1.0K");
  assert.equal(data.cwvWeekly.labels[0], "May 3");
  assert.equal(data.cwvWeekly.labels.length, 2);
  assert.equal(data.trafficWeekly.labels[0], "May 3");
  assert.equal(data.trafficWeekly.labels.length, 2);

  // loadRecords: a record's own key wins over the hoisted constant
  const dir2 = makeDataDir({
    "browser-perf-monthly": { constant: { "browser.name": "Chrome" }, records: [{ Visits: 3 }, { "browser.name": "Edge", Visits: 4 }] },
  });
  assert.deepEqual(loadRecords(dir2, "browser-perf-monthly.json").map((r) => r["browser.name"]), ["Chrome", "Edge"]);

  // empty everything: no throw, 6 blank panels, KPIs show an em dash rather than 0
  const emptyData = buildTrendingData(makeDataDir());
  assert.equal(emptyData.browserPerf.panels.length, 6);
  assert.equal(emptyData.browserPerf.panels[0], null);
  assert.equal(emptyData.kpis[0].value, "—");

  // renderTables: ready-formatted findings input (units converted, null -> em dash, string counts coerced)
  const tt = renderTables(buildTrendingData(makeDataDir({
    "metrics-monthly": {
      records: [
        { month: ts("2026-09-01"), Sessions: "38472", "XHR Requests": 1285, Navigations: 3261, "% Desktop": 99.93 },
        { month: ts("2026-10-01"), Sessions: 41828, "XHR Requests": 4052, Navigations: 10363 },
      ],
    },
    "cwv-monthly": {
      records: [
        { month: ts("2026-09-01"), "Largest Contentful Paint": 1600, "Interaction to Next Paint": 0, "Cumulative Layout Shift": 0 },
        { month: ts("2026-10-01"), "Largest Contentful Paint": 1547, "Interaction to Next Paint": 180, "Cumulative Layout Shift": 690 },
      ],
    },
    "cwv-weekly": { records: [{ week: ts("2026-10-04"), lcp: 2600, cls: 0 }] },
    "browser-perf-monthly": {
      constant: { "device.type": "desktop" },
      records: [browserRow("Chrome", "2026-09", 1500), browserRow("Chrome", "2026-10", 90)],
    },
  })));
  assert.match(tt, /^### Monthly Traffic$/m);
  assert.match(tt, /^Month \| Sessions \| XHR Requests \| Navigations \| % Desktop$/m);
  assert.match(tt, /^Sep 2026 \| 38,472 \| 1,285 \| 3,261 \| 99\.9%$/m);
  assert.match(tt, /^Oct 2026 \| 41,828 \| 4,052 \| 10,363 \| —$/m);
  assert.match(tt, /^### Monthly CWV p75$/m);
  assert.match(tt, /^Month \| LCP \| INP \| CLS$/m);
  assert.match(tt, /^Oct 2026 \| 1\.55s \| 180ms \| 0\.069$/m);
  assert.match(tt, /^Sep 2026 \| 1\.60s \| — \| 0\.000$/m); // INP 0ms = not measured
  assert.match(tt, /^### Weekly CWV p75$/m);
  assert.match(tt, /^Week \| LCP \| INP \| CLS$/m);
  assert.match(tt, /^Oct 4 \| 2\.60s \| — \| 0\.000$/m);
  assert.match(tt, /^### Browser & Device \(shown panels\)$/m);
  assert.match(tt, /^Panel \| Month \| Visits \| LCP \| INP \| CLS$/m);
  assert.match(tt, /^Chrome · Desktop \| Sep 2026 \| 1,500 \| 2\.00s \| 150ms \| 0\.050$/m);
  assert.match(tt, /^Chrome · Desktop \| Oct 2026 \| 90 \|/m);
  assert.equal(tt.match(/^Chrome · Desktop/gm).length, 2); // blank slots are not printed
  assert.doesNotMatch(tt, /NaN|undefined|null/);
  assert.doesNotMatch(renderTables(emptyData), /NaN|undefined|null/);
} finally {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
}
