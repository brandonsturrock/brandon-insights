#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildContext } from "./lib/context.mjs";

// The LCP image is matched to its page-wide resource row by host + path (query
// string ignored), and the example action's LCP request is timed from the
// navigation request's start.
const ctx = buildContext({
  loadCount: 1000,
  cwv: { lcpN: 800 },
  lcpParts: { n: 800, imageN: 600 },
  lcpElements: [{ tag: "DIV", url: "https://x.com/hero.jpg?v=2", loads: 400, lcpP75: 3000 }],
  resources: [{ domain: "x.com", path: "/hero.jpg", initiatorType: "css", loads: 900, requests: 900, durationP75: 700, transferP75: 50000, blocking: 0 }],
  instance: {
    summary: { lcpElementUrl: "https://x.com/hero.jpg?v=2", lcpMs: 3000 },
    requests: [
      { performanceInitiatorType: "navigation", startAbsoluteMs: 10_000, endAbsoluteMs: 10_300 },
      { performanceInitiatorType: "css", urlFull: "https://x.com/hero.jpg?v=2", urlPath: "/hero.jpg", startAbsoluteMs: 12_000, endAbsoluteMs: 12_500 },
    ],
  },
});
assert.equal(ctx.lcp.imageSharePct, 75);
assert.equal(ctx.lcp.topElements[0].sharePct, 50);
assert.equal(ctx.lcp.topElements[0].resource.initiatorType, "css");
assert.deepEqual(ctx.exampleAction.lcpRequest, { initiatorType: "css", startMs: 2000, endMs: 2500 });

console.log("test-context: all assertions passed");
