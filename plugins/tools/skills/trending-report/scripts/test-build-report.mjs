#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTrendingData, loadRecords } from "./build-report.mjs";

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
} finally {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
}
