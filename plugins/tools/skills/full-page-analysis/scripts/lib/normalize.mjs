export function normalizeRaw(raw) {
  function parseIso(s) {
    if (!s) return null;
    try { return new Date(s.replace(/(\.\d{6})\d+/, '$1')).getTime(); } catch { return null; }
  }
  // Only a reported value is a measurement. backgrounded / disabled /
  // not_supported can still carry a number, and the aggregates already ignore
  // it, so the sampled load must too. INP additionally counts below_threshold
  // (a real interaction under 40ms, value populated).
  function nsToMs(v, status, ok = ['reported']) {
    if (!ok.includes(status)) return null;
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
    ttfbMs: s['ttfb.status'] === 'reported' ? Number(s['ttfb.value']) : null,
    fcpMs: nsToMs(s['web_vitals.first_contentful_paint'], s['fcp.status']),
    lcpMs: nsToMs(s['web_vitals.largest_contentful_paint'], s['lcp.status']),
    fpMs: nsToMs(s['web_vitals.first_paint'], s['fp.status']),
    lcpStatus: s['lcp.status'],
    ttfbDnsMs: Number(s['ttfb.dns_duration'] || 0),
    ttfbConnectionMs: s['ttfb.connection_duration'] != null ? Number(s['ttfb.connection_duration']) : null,
    ttfbWaitingMs: s['ttfb.waiting_duration'] != null ? Number(s['ttfb.waiting_duration']) : null,
    ttfbRequestMs: s['ttfb.request_duration'] != null ? Number(s['ttfb.request_duration']) : null,
    ttfbCacheMs: s['ttfb.cache_duration'] != null ? Number(s['ttfb.cache_duration']) : null,
    pageUrl: s['page.url.full'], pageTitle: s['page.title'],
    browserName: s['browser.name'], browserVersion: s['browser.version'],
    deviceType: s['device.type'], osName: s['os.name'], frontendName: s['frontend.name'],
    // Identity of the sampled load, for the report header. sessionId and
    // startTime ride on the page-summary event; user_action.instance_id does
    // not (it is null there), so it is picked up off the request rows below,
    // which are scoped to that action by definition.
    sessionId: s['dt.rum.session.id'] || null,
    startTime: s['start_time'] || null,
    longTaskOccurrences: ltOccs,
    lcpElementType: s['lcp.ui_element.tag_name'] || null,
    lcpElementUrl: s['lcp.url'] || null,
  };
  // The hard-navigation user action reports its own LCP / FCP / TTFB (in ms,
  // relative to time origin) and the aggregates are computed from those, so the
  // sampled load uses them too wherever the action reported them. FP stays on
  // the page summary: the action never has it.
  const a = raw.action || {};
  const reported = (k) => a[k + '.status'] === 'reported';
  const ms = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
  // render_time is the paint; when the browser withholds it (seen on whole
  // frontends), start_time falls back to the image's load time — the value
  // Dynatrace's page summary and web-vitals report as LCP.
  const lcpMs = ms(a['lcp.render_time']) ?? ms(a['lcp.start_time']);
  if (reported('lcp') && lcpMs != null) {
    summary.lcpMs = lcpMs;
    summary.lcpElementUrl = a['lcp.url'] || null;
    summary.lcpElementType = a['lcp.ui_element.tag_name'] || null;
    // The four LCP parts sum to LCP. Text LCPs have no resource parts, and not
    // every agent reports render_delay; the remainder is the same quantity.
    const ttfb = reported('ttfb') ? ms(a['ttfb.value']) : null;
    const loadDelay = ms(a['lcp.resource.load_delay']), loadDuration = ms(a['lcp.resource.load_duration']);
    const renderDelay = ms(a['lcp.ui_element.render_delay'])
      ?? (ttfb != null ? lcpMs - ttfb - (loadDelay ?? 0) - (loadDuration ?? 0) : null);
    summary.lcpDetail = {
      xpath: Array.isArray(a['lcp.ui_element.xpath']) ? a['lcp.ui_element.xpath'] : null,
      sizePx: ms(a['lcp.size']), updateCount: ms(a['lcp.update_count']),
      parts: { ttfb, loadDelay, loadDuration, renderDelay },
    };
  }
  if (reported('fcp') && ms(a['fcp.value']) != null) summary.fcpMs = ms(a['fcp.value']);
  if (reported('ttfb') && ms(a['ttfb.value']) != null) summary.ttfbMs = ms(a['ttfb.value']);
  const TIMING_KEYS = [
    ['performance.worker_start','workerStartNs'],['performance.redirect_start','redirectStartNs'],
    ['performance.redirect_end','redirectEndNs'],['performance.domain_lookup_start','domainLookupStartNs'],
    ['performance.domain_lookup_end','domainLookupEndNs'],['performance.connect_start','connectStartNs'],
    ['performance.connect_end','connectEndNs'],['performance.secure_connection_start','secureConnectionStartNs'],
    ['performance.request_start','requestStartNs'],['performance.response_start','responseStartNs'],
    ['performance.response_end','responseEndNs'],['performance.fetch_start','fetchStartNs'],
    ['performance.start_time','startTimeNs'],
    ['performance.dom_complete','domCompleteNs'],
    ['performance.dom_content_loaded_event_start','domContentLoadedEventStartNs'],
    ['performance.dom_content_loaded_event_end','domContentLoadedEventEndNs'],
    ['performance.load_event_start','loadEventStartNs'],
    ['performance.load_event_end','loadEventEndNs'],
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
      uaInstanceId: r['user_action.instance_id'] || null,
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
