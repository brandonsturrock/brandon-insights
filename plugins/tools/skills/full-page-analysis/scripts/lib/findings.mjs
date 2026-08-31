// Shared thresholds for the full-page-analysis report.
//
// One source of truth, deliberately: the aggregate template colours the Core
// Web Vitals table from these, and computeFindings (appended by a later task)
// derives its rules from the same numbers. Hardcoding either copy would let
// the report's colours and its findings disagree.
//
// The web-vitals entries are the published good / poor boundaries
// (https://web.dev/articles/vitals): at or below `good` is good, above `poor`
// is poor, between them is needs-improvement. The template feeds the pair to
// the ported `msRating` as [good, poor]; computeFindings reads the named
// fields directly, which is why this is an object and not a bare pair.
export const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  fcp: { good: 1800, poor: 3000 },
  inp: { good: 200, poor: 500 },
  ttfb: { good: 800, poor: 1800 },
  cls: { good: 0.1, poor: 0.25 },

  // Share of page loads a resource must appear in before a per-resource number
  // describes the page rather than a handful of unlucky loads. This is the
  // distinction v2 exists to make: a p75 of 820 ms over 1,190 of 1,200 loads
  // is a page problem, the same figure over 3 loads is noise.
  prevalence: {
    widespread: 0.5, // at or above: the finding applies to the page
    rare: 0.05,      // below: too few loads to generalise from
  },

  // Rule-only thresholds (Task 7). Not consumed by the template.
  resourceSlowMs: 500,
  thirdPartySlowMs: 200,
  // A browser/device segment is an outlier if its LCP p75 exceeds the blended
  // p75 by this factor and it carries at least this share of loads.
  segmentRatio: 1.5,
  segmentMinShare: 0.05,
};

// Deterministic finding rules. Pure functions, no I/O.
// Every rule must cite the numbers it fired on in `evidence` — a finding
// without numbers is not actionable and does not belong here.

const num = (v) => (typeof v === "number" && !Number.isNaN(v) ? v : null);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export function computeFindings(data) {
  const out = [];
  // Three different populations, three different denominators. Mixing them
  // produces ratios above 1 and silently wrong percentages.
  const cwvLoads = num(data.cwv?.loads) || 0;        // page-summary events
  const pageLoads = num(data.loadCount) || 0;        // distinct hard navigations
  const loads = cwvLoads;                            // CWV rules only

  const ttfb = num(data.cwv?.ttfbP75);
  if (ttfb != null && ttfb > THRESHOLDS.ttfb.good) {
    const p = data.ttfbPhases || {};
    out.push({
      id: "slow-ttfb",
      severity: ttfb > THRESHOLDS.ttfb.poor ? "high" : "medium",
      title: "Slow time to first byte",
      evidence: `TTFB p75 is ${Math.round(ttfb)}ms across ${loads} loads. Phases at p75 — DNS ${Math.round(num(p.dnsP75) ?? 0)}ms, connect ${Math.round(num(p.connectionP75) ?? 0)}ms, waiting ${Math.round(num(p.waitingP75) ?? 0)}ms, request ${Math.round(num(p.requestP75) ?? 0)}ms.`,
    });
  }

  const lcp = num(data.cwv?.lcpP75);
  if (lcp != null && lcp > THRESHOLDS.lcp.good) {
    const el = data.instance?.summary?.lcpElementType;
    const url = data.instance?.summary?.lcpElementUrl;
    out.push({
      id: "slow-lcp",
      severity: lcp > THRESHOLDS.lcp.poor ? "high" : "medium",
      title: "LCP above the good threshold",
      evidence: `LCP p75 is ${Math.round(lcp)}ms across ${loads} loads (good is under ${THRESHOLDS.lcp.good}ms).` +
        (el ? ` LCP element in the sampled load was <${el.toLowerCase()}>${url ? ` (${url})` : ""}.` : ""),
    });
  }

  const inp = num(data.cwv?.inpP75);
  if (inp != null && inp > THRESHOLDS.inp.good) {
    out.push({
      id: "slow-inp",
      severity: inp > THRESHOLDS.inp.poor ? "high" : "medium",
      title: "Interaction latency above the good threshold",
      evidence: `INP p75 is ${Math.round(inp)}ms across ${loads} loads (good is under ${THRESHOLDS.inp.good}ms).`,
    });
  }

  const cls = num(data.cwv?.clsP75);
  if (cls != null && cls > THRESHOLDS.cls.good) {
    out.push({
      id: "layout-shift",
      severity: cls > THRESHOLDS.cls.poor ? "high" : "medium",
      title: "Cumulative layout shift above the good threshold",
      evidence: `CLS p75 is ${cls.toFixed(3)} across ${loads} loads (good is under ${THRESHOLDS.cls.good}).`,
    });
  }

  const prevalent = (r) => pageLoads > 0 && r.loads / pageLoads >= THRESHOLDS.prevalence.widespread;

  // `blocking` is a REQUEST count in the same population as `requests` (see
  // fpa-resources-agg.dql), not a per-load boolean — a resource present on
  // 90% of loads that blocked once ever is not "blocking on most loads".
  // Gate on the blocking *share of requests*, not mere presence, and require
  // the same duration floor as slow-resources: a fast blocker is not a high
  // severity finding regardless of how often it blocks.
  const isBlocker = (r) => r.requests > 0 && r.blocking / r.requests >= THRESHOLDS.prevalence.widespread &&
    (num(r.durationP75) ?? 0) > THRESHOLDS.resourceSlowMs && prevalent(r);
  const blockers = (data.resources || [])
    .filter(isBlocker)
    .sort((a, b) => (num(b.durationP75) ?? 0) - (num(a.durationP75) ?? 0));
  if (blockers.length) {
    const top = blockers.slice(0, 5);
    out.push({
      id: "render-blocking",
      severity: "high",
      title: "Render-blocking resources on most loads",
      evidence: `${blockers.length} render-blocking resource(s) block on at least ${Math.round(THRESHOLDS.prevalence.widespread * 100)}% of their own requests and are slow enough to matter. Worst: ` +
        top.map((r) => `${r.domain}${r.path} (p75 ${Math.round(num(r.durationP75) ?? 0)}ms, blocking ${r.blocking} of ${r.requests} requests, ${r.loads} loads)`).join("; ") + ".",
    });
  }

  const slow = (data.resources || [])
    .filter((r) => (num(r.durationP75) ?? 0) > THRESHOLDS.resourceSlowMs && prevalent(r) && !isBlocker(r))
    .sort((a, b) => (num(b.durationP75) ?? 0) - (num(a.durationP75) ?? 0));
  if (slow.length) {
    out.push({
      id: "slow-resources",
      severity: "medium",
      title: "Consistently slow resources",
      evidence: `${slow.length} resource(s) exceed ${THRESHOLDS.resourceSlowMs}ms at p75 on most loads. Slowest: ` +
        slow.slice(0, 5).map((r) => `${r.domain}${r.path} (p75 ${Math.round(num(r.durationP75) ?? 0)}ms, ${r.loads} loads)`).join("; ") + ".",
    });
  }

  const origin = (() => {
    try { return new URL(data.instance?.summary?.pageUrl || "").hostname; } catch { return null; }
  })();
  // Without an origin, "third party" cannot be told apart from "first party" —
  // suppress the whole rule rather than let a null origin make every domain
  // (including the page's own) look third-party. Also gate on prevalence:
  // `thirdParty[].loads` exists for exactly this, and a domain hit on 3 of
  // 77,000 loads is noise, not a page-wide dependency.
  const thirdParty = origin
    ? (data.thirdParty || [])
        .filter((d) => d.domain && d.domain !== origin && (num(d.durationP75) ?? 0) > THRESHOLDS.thirdPartySlowMs &&
          pageLoads > 0 && d.loads / pageLoads >= THRESHOLDS.prevalence.widespread)
        .sort((a, b) => (num(b.durationP75) ?? 0) - (num(a.durationP75) ?? 0))
    : [];
  if (thirdParty.length) {
    out.push({
      id: "slow-third-party",
      severity: "medium",
      title: "Slow third-party domains",
      evidence: thirdParty.slice(0, 5)
        .map((d) => `${d.domain} (p75 ${Math.round(num(d.durationP75) ?? 0)}ms, ${d.loads} of ${pageLoads} loads)`)
        .join("; ") + ".",
    });
  }

  const lt = data.longTasks || {};
  const ltLoads = num(lt.loads) || 0;
  if (num(lt.loadsWithLongTasks) && ltLoads > 0 && lt.loadsWithLongTasks / ltLoads > 0.25) {
    out.push({
      id: "long-tasks",
      severity: "medium",
      title: "Main thread blocked by long tasks",
      evidence: `${lt.loadsWithLongTasks} of ${ltLoads} loads (${pct(lt.loadsWithLongTasks, ltLoads)}%) had long tasks; p75 count ${num(lt.countP75) ?? 0}, p75 average duration ${Math.round(num(lt.avgDurationP75) ?? 0)}ms.`,
    });
  }

  const err = data.errors || {};
  const errLoads = num(err.loads) || 0;
  // loads_with_any_error, not the sum of the three counters — a load with both a
  // JS exception and a 4xx would otherwise be counted twice.
  const failing = num(err.loadsWithAnyError) ?? 0;
  if (failing > 0 && errLoads > 0 && failing / errLoads > 0.05) {
    // A single 5xx in 77,000 loads is not a high-severity signal — require the
    // same 1% share used nowhere else as a magic number, chosen because it is
    // an order of magnitude below the 5% gate that fires this rule at all, so
    // "high" means "the 5xx share is itself already a meaningful fraction of
    // the failing loads," not "at least one request 500'd."
    out.push({
      id: "errors",
      severity: (num(err.loadsWith5xx) ?? 0) / errLoads > 0.01 ? "high" : "medium",
      title: "Errors on a meaningful share of loads",
      evidence: `${pct(failing, errLoads)}% of ${errLoads} loads had at least one error — ${pct(num(err.loadsWithException) ?? 0, errLoads)}% a JS exception, ${pct(num(err.loadsWith4xx) ?? 0, errLoads)}% a 4xx, ${pct(num(err.loadsWith5xx) ?? 0, errLoads)}% a 5xx.`,
    });
  }

  const segs = (data.browserDevice || []).filter((s) => num(s.lcpP75) != null && s.loads > 0);
  const totalSegLoads = segs.reduce((s, x) => s + x.loads, 0);
  if (totalSegLoads > 0 && lcp != null) {
    const outliers = segs.filter(
      (s) => s.lcpP75 > lcp * THRESHOLDS.segmentRatio && s.loads / totalSegLoads >= THRESHOLDS.segmentMinShare
    );
    if (outliers.length) {
      out.push({
        id: "segment-outlier",
        severity: "medium",
        title: "One or more segments are much slower than the blend",
        evidence: outliers
          .map((s) => `${s.browser} on ${s.device}: LCP p75 ${Math.round(s.lcpP75)}ms over ${s.loads} loads, versus a blended p75 of ${Math.round(lcp)}ms`)
          .join("; ") + ".",
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
