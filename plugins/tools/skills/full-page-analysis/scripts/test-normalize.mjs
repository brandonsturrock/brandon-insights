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

console.log("test-normalize: all assertions passed");
