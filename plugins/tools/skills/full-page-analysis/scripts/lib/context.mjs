// Compact digest of everything the analyst-notes author may cite, printed by
// `build-report.mjs --print-context`. Every number in the notes must appear
// here. Built from the same coerced `data` the report renders, so the two
// cannot disagree.
import { THRESHOLDS } from "./findings.mjs";

const r0 = (v) => (v == null ? null : Math.round(v));
const share = (n, d) => (n == null || !d ? null : Math.round((n / d) * 1000) / 10); // % to 1dp
const urlKey = (u) => { try { const x = new URL(u); return x.host + x.pathname; } catch { return null; } };

export function buildContext(data) {
  const s = data.instance?.summary || {};
  const reqs = data.instance?.requests || [];
  const c = data.cwv || {};
  const loads = data.loadCount;
  const resByKey = new Map((data.resources || []).map((r) => [(r.domain || "") + (r.path || ""), r]));
  const resourceFor = (url) => resByKey.get(urlKey(url)) || null;

  // Example action: the LCP request, and the render-blocking requests around it.
  const nav = reqs.find((r) => r.performanceInitiatorType === "navigation");
  const t0 = nav?.startAbsoluteMs ?? null;
  const rel = (ms) => (ms == null || t0 == null ? null : r0(ms - t0));
  const lcpUrl = s.lcpElementUrl || null;
  const lcpReq = lcpUrl ? reqs.find((r) => r.urlFull === lcpUrl || (r.urlPath?.length > 3 && lcpUrl.includes(r.urlPath))) : null;
  const d = s.lcpDetail;

  return {
    page: data.page ?? null,
    frontend: s.frontendName ?? null,
    pageLoads: loads,
    thresholds: { lcp: THRESHOLDS.lcp, inp: THRESHOLDS.inp, cls: THRESHOLDS.cls, fcp: THRESHOLDS.fcp, ttfb: THRESHOLDS.ttfb },
    findings: data.findings,
    cwv: Object.fromEntries(["lcp", "fcp", "inp", "cls", "ttfb"].map((k) =>
      [k, { p50: c[k + "P50"], p75: c[k + "P75"], p95: c[k + "P95"], n: c[k + "N"] }])),
    lcp: {
      n: data.lcpParts?.n, imageSharePct: share(data.lcpParts?.imageN, data.lcpParts?.n),
      partsP75: { ttfb: r0(data.lcpParts?.ttfbP75), loadDelay: r0(data.lcpParts?.loadDelayP75),
        loadDuration: r0(data.lcpParts?.loadDurationP75), renderDelay: r0(data.lcpParts?.renderDelayP75) },
      topElements: (data.lcpElements || []).map((e) => {
        const res = e.url ? resourceFor(e.url) : null;
        return {
          kind: e.url ? "image" : "text", tag: e.tag, url: e.url, xpath: e.url ? null : e.xpath,
          sharePct: share(e.loads, c.lcpN), lcpP75: r0(e.lcpP75),
          partsP75: { loadDelay: r0(e.loadDelayP75), loadDuration: r0(e.loadDurationP75), renderDelay: r0(e.renderDelayP75) },
          // How the browser fetched it, page-wide: "css" is a CSS background,
          // "img" an <img>, "script"/"xmlhttprequest"/"fetch" inserted by code.
          resource: res && { initiatorType: res.initiatorType, durationP75: r0(res.durationP75), transferP75: r0(res.transferP75) },
        };
      }),
    },
    ttfbPhasesP75: data.ttfbPhases,
    renderBlocking: (data.resources || [])
      .filter((r) => r.blocking > 0 && r.blocking / (r.blockingKnown ?? r.requests) >= THRESHOLDS.prevalence.widespread)
      .map((r) => ({ url: r.domain + r.path, type: r.initiatorType, loadSharePct: share(r.loads, loads), durationP75: r0(r.durationP75) })),
    slowestResources: (data.resources || [])
      .filter((r) => r.loads / (loads || 1) >= THRESHOLDS.prevalence.widespread && r.durationP75 != null)
      .sort((a, b) => b.durationP75 - a.durationP75).slice(0, 8)
      .map((r) => ({ url: r.domain + r.path, type: r.initiatorType, loadSharePct: share(r.loads, loads), durationP75: r0(r.durationP75), transferP75: r0(r.transferP75) })),
    heaviestResources: (data.resources || [])
      .filter((r) => r.loads / (loads || 1) >= THRESHOLDS.prevalence.widespread && r.transferP75 != null)
      .sort((a, b) => b.transferP75 - a.transferP75).slice(0, 8)
      .map((r) => ({ url: r.domain + r.path, type: r.initiatorType, loadSharePct: share(r.loads, loads), transferP75: r0(r.transferP75), durationP75: r0(r.durationP75),
        blockingPct: r.blocking > 0 ? share(r.blocking, r.blockingKnown ?? r.requests) : 0, failures: r.failures })),
    // Rare domains (bots, extensions, typo'd hosts) sort to the top by time and describe no real load.
    thirdParty: (data.thirdParty || []).filter((t) => t.loads / (loads || 1) >= THRESHOLDS.prevalence.rare).sort((a, b) => (b.durationP75 ?? 0) - (a.durationP75 ?? 0)).slice(0, 10)
      .map((t) => ({ domain: t.domain, loadSharePct: share(t.loads, loads), requestsPerLoad: t.loads ? Math.round((t.requests / t.loads) * 10) / 10 : null,
        summedRequestTimeP75: r0(t.durationP75), transferP75: r0(t.transferP75) })),
    longTasks: { loadSharePct: share(data.longTasks?.loadsWithLongTasks, data.longTasks?.loads), countP75: data.longTasks?.countP75, avgDurationP75: r0(data.longTasks?.avgDurationP75) },
    errors: (() => {
      const e = data.errors || {};
      return { loads: e.loads, anyPct: share(e.loadsWithAnyError, e.loads), exceptionPct: share(e.loadsWithException, e.loads),
        http4xxPct: share(e.loadsWith4xx, e.loads), http5xxPct: share(e.loadsWith5xx, e.loads),
        otherFailedPct: share(e.loadsWithHttpOther, e.loads), cspPct: share(e.loadsWithCsp, e.loads),
        topExceptions: (data.topExceptions || []).map((x) => ({ type: x.type, message: x.message, loadSharePct: share(x.loads, e.loads), occurrences: x.occurrences })) };
    })(),
    segments: [...(data.browserDevice || [])].sort((a, b) => b.loads - a.loads).slice(0, 8),
    exampleAction: {
      note: "ONE load, picked near the LCP p75 with the page's most common LCP element. Label any claim from it as one load.",
      completeReason: data.instance?.action?.completeReason ?? null,
      browser: [s.browserName, s.browserVersion].filter(Boolean).join(" ") || null, device: s.deviceType ?? null,
      lcp: r0(s.lcpMs), fcp: r0(s.fcpMs), ttfb: r0(s.ttfbMs),
      lcpElement: { tag: s.lcpElementType, url: lcpUrl, xpath: d?.xpath ?? null, sizePx: d?.sizePx ?? null, updateCount: d?.updateCount ?? null },
      lcpParts: d ? Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, r0(v)])) : null,
      lcpRequest: lcpReq && { initiatorType: lcpReq.performanceInitiatorType, startMs: rel(lcpReq.startAbsoluteMs), endMs: rel(lcpReq.endAbsoluteMs) },
      renderBlockingRequests: reqs.filter((r) => r.renderBlockingStatus === "blocking")
        .map((r) => ({ url: (r.urlDomain || "") + (r.urlPath || ""), type: r.performanceInitiatorType, startMs: rel(r.startAbsoluteMs), endMs: rel(r.endAbsoluteMs) })),
      longTasks: (s.longTaskOccurrences || []).map((o) => ({ startMs: r0(o.startMs), durationMs: r0(o.durationMs) })),
      exceptions: (data.instance?.exceptions || []).map((x) => ({ message: x.displayName, atMs: rel(x.startAbsoluteMs) })),
    },
  };
}
