export function normalizeRaw(raw) {
  function parseIso(s) {
    if (!s) return null;
    try { return new Date(s.replace(/(\.\d{6})\d+/, '$1')).getTime(); } catch { return null; }
  }
  function nsToMs(v, status) {
    if (!status || status === 'not_reported') return null;
    const n = Number(v);
    return (!isNaN(n) && n !== 0) ? n / 1e6 : null;
  }
  const s = raw.summary;
  const timeOriginMs = parseIso(s['performance.time_origin']) || parseIso(s['client_start_time']);
  const ltOccs = (s['long_task.all.slowest_occurrences'] || [])
    .map(o => { const p = typeof o === 'string' ? JSON.parse(o) : o; return { startMs: p.start_time, durationMs: p.duration }; })
    .sort((a, b) => a.startMs - b.startMs);
  const summary = {
    performanceTimeOriginMs: timeOriginMs,
    clientStartTimeMs: parseIso(s['client_start_time']),
    ttfbMs: s['ttfb.status'] !== 'not_reported' ? Number(s['ttfb.value']) : null,
    fcpMs: nsToMs(s['web_vitals.first_contentful_paint'], s['fcp.status']),
    lcpMs: nsToMs(s['web_vitals.largest_contentful_paint'], s['lcp.status']),
    fpMs: nsToMs(s['web_vitals.first_paint'], s['fp.status']),
    fcpStatus: s['fcp.status'], lcpStatus: s['lcp.status'], fpStatus: s['fp.status'], clsStatus: s['cls.status'],
    clsScore: s['cls.status'] !== 'not_reported' ? s['web_vitals.cumulative_layout_shift'] : null,
    inpMs: nsToMs(s['web_vitals.interaction_to_next_paint'], s['inp.status']),
    ttfbDnsMs: Number(s['ttfb.dns_duration'] || 0),
    ttfbConnectionMs: s['ttfb.connection_duration'] != null ? Number(s['ttfb.connection_duration']) : null,
    ttfbWaitingMs: s['ttfb.waiting_duration'] != null ? Number(s['ttfb.waiting_duration']) : null,
    ttfbRequestMs: s['ttfb.request_duration'] != null ? Number(s['ttfb.request_duration']) : null,
    ttfbCacheMs: s['ttfb.cache_duration'] != null ? Number(s['ttfb.cache_duration']) : null,
    pageUrl: s['page.url.full'], pageTitle: s['page.title'],
    browserName: s['browser.name'], browserVersion: s['browser.version'],
    deviceType: s['device.type'], osName: s['os.name'],
    navigationType: s['navigation.type'], frontendName: s['frontend.name'],
    longTaskCount: Number(s['long_task.all.count'] || 0),
    longTaskAvgMs: s['long_task.all.avg_duration'] != null ? Number(s['long_task.all.avg_duration']) : null,
    longTaskOccurrences: ltOccs,
    exceptionCount: Number(s['error.exception_count'] || 0),
    http4xxCount: Number(s['error.http_4xx_count'] || 0),
    http5xxCount: Number(s['error.http_5xx_count'] || 0),
    lcpElementType: s['lcp.ui_element.tag_name'] || null,
    lcpElementUrl: s['lcp.url'] || null,
  };
  const TIMING_KEYS = [
    ['performance.worker_start','workerStartNs'],['performance.redirect_start','redirectStartNs'],
    ['performance.redirect_end','redirectEndNs'],['performance.domain_lookup_start','domainLookupStartNs'],
    ['performance.domain_lookup_end','domainLookupEndNs'],['performance.connect_start','connectStartNs'],
    ['performance.connect_end','connectEndNs'],['performance.secure_connection_start','secureConnectionStartNs'],
    ['performance.request_start','requestStartNs'],['performance.response_start','responseStartNs'],
    ['performance.response_end','responseEndNs'],['performance.fetch_start','fetchStartNs'],
    ['performance.start_time','startTimeNs'],
  ];
  const requests = (raw.requests || []).map(r => {
    const startMs = parseIso(r['start_time']), endMs = parseIso(r['end_time']);
    const startNs = r['performance.start_time'] != null ? Number(r['performance.start_time']) : null;
    const fetchRaw = r['performance.fetch_start'] != null ? Number(r['performance.fetch_start']) : null;
    const isAbs = startNs != null && fetchRaw != null && fetchRaw > 0 && fetchRaw >= startNs - 1_000_000;
    function norm(v) {
      if (v == null) return null;
      const n = Number(v); if (isNaN(n)) return null; if (n === 0) return 0;
      if (isAbs) { const res = n - startNs; return res >= 0 ? res : null; }
      return n;
    }
    const out = {
      urlPath: r['url.path'], urlDomain: r['url.domain'], urlFull: r['url.full'],
      urlProvider: r['url.provider'] || null, startAbsoluteMs: startMs, endAbsoluteMs: endMs,
      durationMs: startMs && endMs ? endMs - startMs : null,
      transferSize: r['performance.transfer_size'] != null ? Number(r['performance.transfer_size']) : null,
      encodedBodySize: r['performance.encoded_body_size'] != null ? Number(r['performance.encoded_body_size']) : null,
      decodedBodySize: r['performance.decoded_body_size'] != null ? Number(r['performance.decoded_body_size']) : null,
      performanceInitiatorType: r['performance.initiator_type'] || null,
      httpStatusCode: r['http.response.status_code'], httpMethod: r['http.request.method'] || null,
      hasW3cTimings: r['characteristics.has_w3c_resource_timings'] === true || r['characteristics.has_w3c_navigation_timings'] === true,
      renderBlockingStatus: r['performance.render_blocking_status'] || null,
      deliveryType: r['performance.delivery_type'] || null, protocol: r['performance.next_hop_protocol'] || null,
      incompleteReason: r['performance.incomplete_reason'] || null,
      hasFailed: r['characteristics.has_failed_request'] === true,
      hasCspViolation: r['characteristics.has_csp_violation'] === true,
      hasPending: r['characteristics.has_pending_request'] === true,
    };
    for (const [field, key] of TIMING_KEYS) out[key] = norm(r[field]);
    return out;
  });
  const exceptions = (raw.exceptions || []).map(e => ({
    startAbsoluteMs: parseIso(e['start_time']),
    displayName: e['error.display_name'] || 'Exception',
  }));
  return { summary, requests, exceptions };
}
