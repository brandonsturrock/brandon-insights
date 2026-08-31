#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRaw } from "./lib/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "assets", "fixtures", name), "utf8"));

const raw = fixture("instance-synthetic.json");
const out = normalizeRaw(raw);

// time_origin is an ISO string; normalized to epoch ms
assert.equal(out.summary.performanceTimeOriginMs, Date.parse("2026-08-01T10:00:00.000Z"));

// web vitals arrive in nanoseconds and are divided by 1e6
assert.equal(out.summary.lcpMs, 2400);
assert.equal(out.summary.fcpMs, 900);

// a "not_reported" status yields null, never 0
assert.equal(out.summary.inpMs, null);

// ttfb phase fields pass through as plain numbers
assert.equal(out.summary.ttfbMs, 420);
assert.equal(out.summary.ttfbDnsMs, 12);

// RELATIVE timings: fetch_start (5) is far below start_time (2e9), so isAbs is
// false and the values pass through untouched. This branch is the whole reason
// the Phase 1 gate exists — do not let both fixture requests take the same path.
const rel = out.requests.find((r) => r.urlPath === "/relative.js");
assert.equal(rel.fetchStartNs, 5);
assert.equal(rel.responseEndNs, 180);

// ABSOLUTE timings: fetch_start >= start_time - 1ms, so all are rebased onto start_time
const abs = out.requests.find((r) => r.urlPath === "/absolute.js");
assert.equal(abs.fetchStartNs, 0);
assert.equal(abs.responseEndNs, 1_000_000);

// duration comes from the ISO start/end pair, not the W3C fields
assert.equal(rel.durationMs, 250);

// exceptions keep their absolute timestamp and display name
assert.equal(out.exceptions.length, 1);
assert.equal(out.exceptions[0].displayName, "TypeError: x is undefined");
assert.equal(out.exceptions[0].startAbsoluteMs, Date.parse("2026-08-01T10:00:03.000Z"));

// --- Ground truth: real captured instance 552c90689fb8da5e, verified
// against Dynatrace's built-in waterfall (no discrepancies reported). ---
const realRaw = fixture("instance-real.json");
const real = normalizeRaw(realRaw);

assert.equal(real.requests.length, 25);
assert.equal(real.exceptions.length, 0);

// First request (index 0, the navigation record): start_time is 0 and
// fetch_start (699996) is > 0 and >= start_time - 1ms, so isAbs is true and
// startTimeNs/fetchStartNs are rebased onto start_time.
assert.equal(real.requests[0].fetchStartNs, 699996);
assert.equal(real.requests[0].responseEndNs, 24099990);

// LCP reported at 1209899000 ns -> 1209.899 ms; TTFB is already in ms.
assert.equal(real.summary.lcpMs, 1209.899);
assert.equal(real.summary.ttfbMs, 19.79998779296875);

// isAbs branch coverage against real data, not just the synthetic
// approximation: index 0 is the only absolute-branch request in this
// capture (fetch_start > 0 and >= start_time - 1ms, so startTimeNs is
// rebased to 0); index 1 is a relative request (fetch_start 0, start_time
// 674399993, both pass through untouched).
assert.equal(real.requests[0].startTimeNs, 0); // absolute branch: rebased to 0
assert.equal(real.requests[1].startTimeNs, 674399993); // relative branch: untouched
assert.equal(real.requests[1].fetchStartNs, 0);

// Processing / DOMContentLoaded / Load event fields (fix round: selected by
// fpa-instance-requests.dql and read by the template, but missing from
// TIMING_KEYS so the tooltip rows could never render). Index 0's start_time
// is 0, so the absolute rebase is a no-op here.
assert.equal(real.requests[0].domCompleteNs, 1420500000);
assert.equal(real.requests[0].domContentLoadedEventStartNs, 1259500000);
assert.equal(real.requests[0].domContentLoadedEventEndNs, 1314399993);
assert.equal(real.requests[0].loadEventStartNs, 1437799987);
assert.equal(real.requests[0].loadEventEndNs, 1439099990);

console.log("test-normalize: all assertions passed");
