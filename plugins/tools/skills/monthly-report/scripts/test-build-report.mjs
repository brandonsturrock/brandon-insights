#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleHtml, buildCurrentMonthData, loadRecords, renderTables } from "./build-report.mjs";

const SAMPLE = JSON.parse(fs.readFileSync(new URL("../assets/fixtures/sample.json", import.meta.url), "utf8"));
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

// renderTables: ready-formatted findings input (units converted, null -> em dash, string counts coerced)
{
  const tdir = makeDataDir({
    "cm-daily-device": {
      records: [
        { day: day("2026-10-01"), "device.type": "desktop", sessions: 1303 },
        { day: day("2026-10-01"), "device.type": "mobile", sessions: 12 },
      ],
    },
    "cm-daily-cwv": { records: [{ day: day("2026-10-01"), "device.type": "desktop", lcp: 1547, inp: 180, cls: 690 }] },
    "cm-device-compare": {
      records: [
        { device_type: "desktop", sessions: 4200, page_loads: 5000, lcp_p75: 1547, inp_p75: 180, cls_p75: 690 },
        { device_type: "mobile", sessions: 1300, page_loads: 400, lcp_p75: 2300 },
      ],
    },
    "cm-cwv-tier": { records: [{ lcp_good: 80, lcp_ni: 15, lcp_poor: 5, lcp_total: 100 }] },
    "cm-top-pages": { records: [{ "page.name": "/home", count: "5883", lcp: 1760, inp: 0, cls: 0, exceptions: 0.0123, request_errors: 0 }] },
    "cm-errors": { records: [{ day: day("2026-10-01"), "device.type": "desktop", total_sessions: "1000", js_error_sessions: "4" }] },
    "cm-error-count": { records: [{ day: day("2026-10-01"), "error.type": "exception", error_count: 1234 }] },
    "cm-top-exceptions": { records: [{ count: "295", "exception.type": "Error", "exception.message": "bad | thing\nline2", "error.source": "console" }] },
    "cm-top-request-errors": { records: [{ count: "295", "http.request.method": "POST", "http.response.status_code": "403", "url.path": "/login" }] },
  });
  const t = renderTables(buildCurrentMonthData(tdir));
  assert.match(t, /^### Device Comparison$/m);
  assert.match(t, /^Device \| Sessions \| Page Loads \| LCP p75 \| INP p75 \| CLS p75$/m);
  assert.match(t, /^Desktop \| 4,200 \| 5,000 \| 1\.55s \| 180ms \| 0\.069$/m);
  assert.match(t, /^Mobile \| 1,300 \| 400 \| 2\.30s \| — \| —$/m);
  assert.match(t, /\| — \|/);
  assert.match(t, /^### Daily Sessions \(October 2026\)$/m);
  assert.match(t, /^Day \| Desktop \| Mobile$/m);
  assert.match(t, /^Day \| Device \| LCP \| INP \| CLS$/m);
  assert.match(t, /^1 \| Desktop \| 1\.55s \| 180ms \| 0\.069$/m);
  assert.match(t, /^LCP \| 80\.0% \| 15\.0% \| 5\.0%$/m);
  assert.match(t, /^INP \| — \| — \| —$/m);
  assert.match(t, /^\/home \| 5,883 \| 1\.76s \| — \| 0\.000 \| 0\.012 \| 0\.000$/m);
  assert.match(t, /^1 \| 0\.4% \| 0\.0%$/m);
  assert.match(t, /^Day \| JS Error \| Request$/m);
  assert.match(t, /^295 \| Error \| bad \\\| thing line2 \| console$/m);
  assert.match(t, /^295 \| POST \| 403 \| — \| \/login$/m);
  assert.doesNotMatch(t, /NaN|undefined/);
}

// renderTables: a desktop-only frontend drops the Mobile column and rows; empty data stays clean
{
  const t = renderTables(buildCurrentMonthData(makeDataDir({
    "cm-daily-device": { records: [{ day: day("2026-10-01"), "device.type": "desktop", sessions: 5000 }] },
    "cm-device-compare": { records: [{ device_type: "desktop", sessions: 5000, page_loads: 1, lcp_p75: 100 }] },
  })));
  assert.match(t, /^Day \| Desktop$/m);
  assert.doesNotMatch(t, /Mobile/);
  const empty = renderTables(buildCurrentMonthData(makeDataDir()));
  assert.match(empty, /^### Top Exceptions$/m);
  assert.doesNotMatch(empty, /NaN|undefined/);
}

// The review bar (autosave / Create PDF / Rewrite) replaces the old Downloads "Save changes" bar
{
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-html-"));
  const outPath = path.join(outDir, "r.html");
  const log = console.log;
  console.log = () => {}; // assembleHtml announces the file it wrote
  try {
    assembleHtml({ data: SAMPLE.data, findings: {}, frontend: "x", environment: "", dateRangeLabel: "October 2026", generatedAt: "now", outPath });
  } finally {
    console.log = log;
  }
  const html = fs.readFileSync(outPath, "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const s of ['id="dt-review-bar"', 'id="dt-review-status"', 'id="dt-pdf-btn"', 'id="dt-rewrite-btn"', "Create PDF", "Rewrite analysis", "/finish", "/save", "/rewrite"])
    assert.ok(html.includes(s), s);
  for (const s of ["dtSave(", "dt-save-bar", "Save changes"]) assert.ok(!html.includes(s), s);
  assert.match(html, /@media print\{#dt-review-bar\{display:none!important\}\}/);
  assert.match(html, /class="notes-body" contenteditable="true" spellcheck="false"/);
}

// Footer: page 1 carries the generation timestamp; no placeholder survives outside the contract comment
{
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cm-footer-"));
  const outPath = path.join(outDir, "r.html");
  const log = console.log;
  console.log = () => {};
  try {
    const findings = Object.fromEntries(["TRAFFIC", "CWV", "PAGES", "ERRORS"].map((k) => [`FINDINGS_${k}_HTML`, "<p>x</p>"]));
    assembleHtml({ data: SAMPLE.data, findings, frontend: "f", environment: "env", dateRangeLabel: "x", generatedAt: "2026-11-03 10:00 UTC", outPath });
  } finally {
    console.log = log;
  }
  const html = fs.readFileSync(outPath, "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  assert.ok(html.includes("Generated 2026-11-03 10:00 UTC"));
  assert.equal(html.slice(html.indexOf("-->")).match(/\{\{[A-Z_]+\}\}/), null);
}

// A metric with no tier measurements is null (no tier bar), not 0/0/0
{
  const d = buildCurrentMonthData(makeDataDir({
    "cm-cwv-tier": { records: [{ lcp_good: 80, lcp_ni: 15, lcp_poor: 5, lcp_total: 100, inp_total: 0 }] },
  }));
  assert.deepEqual(d.cmCwvTier.lcp, { good: 80, ni: 15, poor: 5 });
  assert.equal(d.cmCwvTier.inp, null);
  assert.match(renderTables(d), /^INP \| — \| — \| —$/m);
}

// Visitor-controlled strings (exception messages, URL paths) must not close the <script> that carries DATA
{
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "month-xss-"));
  const outPath = path.join(outDir, "r.html");
  const log = console.log;
  console.log = () => {};
  try {
    assembleHtml({ data: { ...SAMPLE.data, evil: "</script><b>x" }, findings: {}, frontend: "f", environment: "", dateRangeLabel: "x", generatedAt: "now", outPath });
  } finally {
    console.log = log;
  }
  const html = fs.readFileSync(outPath, "utf8");
  fs.rmSync(outDir, { recursive: true, force: true });
  assert.ok(!html.includes("</script><b>"));
  assert.equal(JSON.parse(html.match(/^const DATA = (.*);$/m)[1]).evil, "</script><b>x");
}

// LCP/INP of 0 = not measured (null), never "0ms good"; CLS 0 is a real value; blended p75 skips null rows
{
  const d = buildCurrentMonthData(makeDataDir({
    "cm-daily-device": { records: [{ day: day("2026-10-01"), "device.type": "desktop", sessions: 5000 }] },
    "cm-daily-cwv": { records: [
      { day: day("2026-10-01"), "device.type": "desktop", lcp: 1763, inp: 0, cls: 0 },
      { day: day("2026-10-01"), "device.type": "mobile", lcp: 0, inp: 0, cls: 0 },
    ] },
    "cm-device-compare": { records: [
      { device_type: "desktop", sessions: 4000, page_loads: 3000, lcp_p75: 1763, inp_p75: 0, cls_p75: 0 },
      { device_type: "mobile", sessions: 1000, page_loads: 1000, lcp_p75: 0, inp_p75: 0, cls_p75: 0 },
    ] },
  }));
  assert.equal(d.deviceCompareRows[0].lcpP75, 1763);
  assert.equal(d.deviceCompareRows[0].inpP75, null);
  assert.equal(d.deviceCompareRows[1].lcpP75, null);
  assert.equal(d.cmCwvDistribution.lcp.p75, 1763); // mobile's 0 is skipped, not averaged in
  assert.equal(d.cmCwvDistribution.inp.p75, null); // all rows absent
  assert.equal(d.cmCwvDistribution.cls.p75, 0);
  assert.deepEqual([d.cmDailyCwv.lcp.desktop[0], d.cmDailyCwv.lcp.mobile[0]], [1763, null]);
  assert.deepEqual([d.cmDailyCwv.inp.desktop[0], d.cmDailyCwv.inp.mobile[0]], [null, null]);
  assert.equal(d.cmDailyCwv.cls.desktop[0], 0);
  assert.match(renderTables(d), /^Desktop \| 4,000 \| 3,000 \| 1\.76s \| — \| 0\.000$/m);
}
