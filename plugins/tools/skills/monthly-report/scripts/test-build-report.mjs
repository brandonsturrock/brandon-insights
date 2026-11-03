#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCurrentMonthData, loadRecords } from "./build-report.mjs";

const FILES = [
  "cm-daily-device", "cm-daily-cwv", "cm-top-pages", "cm-top-exceptions",
  "cm-top-request-errors", "cm-error-count", "cm-errors", "cm-device-compare", "cm-cwv-tier",
];

// Writes every required file as a dtctl envelope; `overrides[name]` = { records, constant }.
function makeDataDir(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-"));
  for (const name of FILES) {
    const { records = [], constant } = overrides[name] || {};
    const result = { kind: "records", records, ...(constant && { constant }) };
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ ok: true, result }));
  }
  return dir;
}

const day = (d) => `${d}T00:00:00.000000000Z`;

const dir = makeDataDir({
  // D2: device.type hoisted into constant; D6: rows out of order; D10: warm-up rows from September
  "cm-daily-device": {
    constant: { "device.type": "desktop" },
    records: [
      { day: day("2026-10-02"), sessions: 1290 },
      { day: day("2026-09-29"), sessions: 1000 },
      { day: day("2026-10-01"), sessions: 1303 },
      { day: day("2026-09-30"), sessions: 1100 },
    ],
  },
  // D5: no row for 2026-10-02
  "cm-daily-cwv": {
    records: [{ day: day("2026-10-01"), "device.type": "desktop", lcp: 2000, inp: 150, cls: 500 }],
  },
  "cm-device-compare": {
    records: [{ device_type: "desktop", sessions: 2593, page_loads: 3000, lcp_p75: 2000, inp_p75: 150, cls_p75: 500 }],
  },
  // D3: counts arrive as strings
  "cm-errors": {
    records: [
      { day: day("2026-10-01"), "device.type": "desktop", total_sessions: "1275", js_error_sessions: "5" },
      { day: day("2026-10-01"), "device.type": "mobile", total_sessions: "800", js_error_sessions: "2" },
    ],
  },
});
const data = buildCurrentMonthData(dir);

assert.deepEqual(data.cmDailyDevice.desktop, [1303, 1290]);
assert.deepEqual(data.cmDailyDevice.labels, ["1", "2"]);
assert.equal(data.cmErrorRates.jsErrorRate[0], 0.34);
assert.equal(data.cmErrorRates.jsErrorRate[1], null);
assert.equal(data.cmDailyCwv.lcp.desktop[0], 2000);
assert.equal(data.cmDailyCwv.lcp.desktop[1], null);
assert.equal(data.monthLabel, "October 2026");
assert.deepEqual(Object.keys(data.cmCwvDistribution.lcp), ["p75"]);
assert.equal(data.kpis[0].value, "2.6K");
assert.equal(data.kpis[1].value, "3.0K");

// loadRecords: a record's own key wins over the hoisted constant
const dir2 = makeDataDir({
  "cm-top-pages": { constant: { "page.name": "/a" }, records: [{ count: "3" }, { "page.name": "/b", count: "4" }] },
});
assert.deepEqual(loadRecords(dir2, "cm-top-pages.json").map((r) => r["page.name"]), ["/a", "/b"]);

// empty everything: no throw, KPIs show an em dash rather than 0
const emptyData = buildCurrentMonthData(makeDataDir());
assert.equal(emptyData.kpis[0].value, "—");
assert.equal(emptyData.kpis[1].value, "—");
assert.equal(typeof emptyData.monthLabel, "string");
