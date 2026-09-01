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

// a resource blocking on most loads fires; one blocking on a handful does not.
// (fix round 2: render-blocking has no duration floor — a fast universal
// blocker still fires, at medium severity, not high and not invisible)
const blocking = (loads, durationP75) => ({
  ...base,
  resources: [{ path: "/a.css", domain: "example.com", initiatorType: "link",
                loads, requests: loads, durationP75, transferP75: 20000, blocking: loads, failures: 0 }],
});
assert.ok(ids(blocking(900, 60)).includes("render-blocking"));
assert.ok(!ids(blocking(5, 60)).includes("render-blocking"));

// the near-universal blocking resource is named in the evidence with its numbers
const f = computeFindings(blocking(900, 60)).find((x) => x.id === "render-blocking");
assert.match(f.evidence, /a\.css/);
assert.match(f.evidence, /900/);

// severity scales with duration instead of gating on it: fast blocker is
// medium, slow blocker is high
assert.equal(computeFindings(blocking(900, 60)).find((x) => x.id === "render-blocking").severity, "medium");
assert.equal(computeFindings(blocking(900, 600)).find((x) => x.id === "render-blocking").severity, "high");

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

// a resource present on most loads that blocked once ever is not render-blocking
// (fix round 1: `blocking` is a request count, not a per-load boolean)
assert.ok(!ids({
  ...base,
  resources: [{ path: "/a.css", domain: "example.com", initiatorType: "link",
                loads: 69300, requests: 300000, durationP75: 120, blocking: 1, failures: 0 }],
}).includes("render-blocking"));

// LCP over 2500ms fires
assert.ok(ids({ ...base, cwv: { ...base.cwv, lcpP75: 3000 } }).includes("slow-lcp"));

// INP over 200ms fires
assert.ok(ids({ ...base, cwv: { ...base.cwv, inpP75: 300 } }).includes("slow-inp"));

// CLS over 0.1 fires
assert.ok(ids({ ...base, cwv: { ...base.cwv, clsP75: 0.2 } }).includes("layout-shift"));

// a widespread, slow, non-blocking resource fires slow-resources
assert.ok(ids({
  ...base,
  resources: [{ path: "/big.js", domain: "example.com", initiatorType: "script",
                loads: 900, requests: 900, durationP75: 800, transferP75: 200000, blocking: 0, failures: 0 }],
}).includes("slow-resources"));

// a slow, widespread third-party domain fires; a slow but rare one does not
// (fix round 1: slow-third-party had no prevalence gate at all)
const thirdParty = (loads) => ({
  ...base,
  thirdParty: [{ domain: "cdn.example.net", loads, requests: loads, durationP75: 5000, transferP75: 90000 }],
});
assert.ok(ids(thirdParty(900)).includes("slow-third-party"));
assert.ok(!ids(thirdParty(3)).includes("slow-third-party"));

// first/third party is no longer decided here — fpa-thirdparty-agg.dql filters
// on url.provider upstream, so a row reaching this rule is third-party by
// construction and needs no origin comparison. What must still hold is that a
// row with no domain at all cannot fire the rule.
assert.ok(!ids({
  ...base,
  thirdParty: [{ domain: null, loads: 900, requests: 900, durationP75: 5000, transferP75: 90000 }],
}).includes("slow-third-party"));

// long tasks on most loads fires
assert.ok(ids({
  ...base,
  longTasks: { loads: 1000, loadsWithLongTasks: 400, countP75: 3, avgDurationP75: 150 },
}).includes("long-tasks"));

// errors on a meaningful share of loads fires
assert.ok(ids({
  ...base,
  errors: { loads: 1000, loadsWithAnyError: 100, loadsWithException: 80, loadsWith4xx: 20, loadsWith5xx: 0,
            exceptionTotal: 90, http4xxTotal: 22, http5xxTotal: 0 },
}).includes("errors"));

// a 5xx share under 1% of loads does not promote errors to high severity
// (fix round 1: a single 5xx in 77,000 loads used to promote to high)
{
  const e = computeFindings({
    ...base,
    errors: { loads: 1000, loadsWithAnyError: 100, loadsWithException: 90, loadsWith4xx: 9, loadsWith5xx: 1,
              exceptionTotal: 90, http4xxTotal: 9, http5xxTotal: 1 },
  }).find((x) => x.id === "errors");
  assert.equal(e.severity, "medium");
}

console.log("test-findings: all assertions passed");
