#!/usr/bin/env node
import assert from "node:assert/strict";
import { computeFindings, THRESHOLDS } from "./lib/findings.mjs";

const base = {
  instance: { summary: { pageUrl: "https://example.com/", lcpElementType: "IMG", lcpElementUrl: "https://example.com/hero.jpg" }, requests: [], exceptions: [] },
  loadCount: 1000,
  cwv: { loads: 1000, lcpP75: 1800, inpP75: 100, clsP75: 0.02, ttfbP75: 300 },
  ttfbPhases: { loads: 1000, dnsP75: 10, connectionP75: 20, waitingP75: 200, requestP75: 50, cacheP75: 20 },
  resources: [],
  thirdParty: [],
  longTasks: { loads: 1000, loadsWithLongTasks: 0, countP75: 0, avgDurationP75: null },
  errors: { loads: 1000, loadsWithAnyError: 0, loadsWithException: 0, loadsWith4xx: 0, loadsWith5xx: 0, exceptionTotal: 0, http4xxTotal: 0, http5xxTotal: 0 },
  browserDevice: [{ browser: "Chrome", device: "desktop", loads: 1000, lcpP75: 1800 }],
};
const ids = (d) => computeFindings(d).map((f) => f.id);

// a healthy page produces no findings
assert.deepEqual(ids(base), []);

// thresholds are the documented Core Web Vitals values
assert.equal(THRESHOLDS.lcp.poor, 4000);
assert.equal(THRESHOLDS.ttfb.good, 800);

// TTFB over 800ms fires
assert.ok(ids({ ...base, cwv: { ...base.cwv, ttfbP75: 950 } }).includes("slow-ttfb"));

// a resource blocking on most loads fires; one blocking on a handful does not
const blocking = (loads) => ({
  ...base,
  resources: [{ path: "/a.css", domain: "example.com", initiatorType: "link",
                loads, requests: loads, durationP75: 600, transferP75: 20000, blocking: loads, failures: 0 }],
});
assert.ok(ids(blocking(900)).includes("render-blocking"));
assert.ok(!ids(blocking(5)).includes("render-blocking"));

// the near-universal slow resource is named in the evidence with its numbers
const f = computeFindings(blocking(900)).find((x) => x.id === "render-blocking");
assert.match(f.evidence, /a\.css/);
assert.match(f.evidence, /900/);
assert.equal(f.severity, "high");

// a browser whose LCP p75 is far worse than the blended figure fires
assert.ok(
  ids({
    ...base,
    browserDevice: [
      { browser: "Chrome", device: "desktop", loads: 900, lcpP75: 1700 },
      { browser: "Safari", device: "mobile", loads: 300, lcpP75: 5200 },
    ],
  }).includes("segment-outlier")
);

// nulls never fire a threshold rule
assert.deepEqual(ids({ ...base, cwv: { ...base.cwv, ttfbP75: null, lcpP75: null } }), []);

console.log("test-findings: all assertions passed");
