# Monthly RUM Review — Queries

16 DQL queries that reproduce the dt-app's monthly RUM review PDF. Each is a
`.dql` file with `{{.frontend}}` as the only template variable (Go-template
syntax, matching `dtctl query -f <file> --set frontend="NAME"`). Run each
with:

```bash
dtctl query -f <query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never > <output>.json
```

`--spill=never` keeps rows inline in the JSON envelope (branch on
`result.kind == "records"`, read `result.records`) — these are all small,
pre-aggregated result sets (≤ ~200 rows), so forcing inline avoids the
spill-file indirection. If a query ever returns `summary-only` or
`result-file` unexpectedly, fall back to `dtctl inspect` per the dtctl skill.

## Filename map (contract for the report-builder script)

| # | Query file | Canonical output filename | Report tab |
|---|-----------|---------------------------|------------|
| 0 | `frontends.dql` | `frontends.json` | picker (both tabs) |
| 1 | `metrics-monthly.dql` | `metrics-monthly.json` | Trending |
| 2 | `cwv-monthly.dql` | `cwv-monthly.json` | Trending |
| 3 | `cwv-weekly.dql` | `cwv-weekly.json` | Trending |
| 4 | `device-dist-monthly.dql` | `device-dist-monthly.json` | Trending |
| 5 | `browser-perf-monthly.dql` | `browser-perf-monthly.json` | Trending |
| 6 | `cm-daily-device.dql` | `cm-daily-device.json` | Current-Month |
| 7 | `cm-daily-cwv.dql` | `cm-daily-cwv.json` | Current-Month |
| 8 | `cm-cwv-distribution.dql` | `cm-cwv-distribution.json` | Current-Month |
| 9 | `cm-top-pages.dql` | `cm-top-pages.json` | Current-Month |
| 10 | `cm-top-exceptions.dql` | `cm-top-exceptions.json` | Current-Month |
| 11 | `cm-top-request-errors.dql` | `cm-top-request-errors.json` | Current-Month |
| 12 | `cm-error-count.dql` | `cm-error-count.json` | Current-Month |
| 13 | `cm-errors.dql` | `cm-errors.json` | Current-Month |
| 14 | `cm-device-compare.dql` | `cm-device-compare.json` | Current-Month |
| 15 | `cm-cwv-tier.dql` | `cm-cwv-tier.json` | Current-Month |

Write each query's raw `-o json --agent` output to `<data-dir>/<canonical filename>`
verbatim (the whole envelope, not just `result.records`) — `build-report.mjs`
and the findings-prompt both read from that directory using these exact names.

## Unit conversions (apply once, at ingestion — don't push to the render step)

- `timeseries` metrics for LCP/INP (`dt.frontend.web.page.largest_contentful_paint`,
  `dt.frontend.web.page.interaction_to_next_paint`) → already **milliseconds**, no conversion.
- `timeseries` metric for CLS (`dt.frontend.web.page.cumulative_layout_shift`) →
  stored **×10000**; divide by `10000` for the real decimal value.
- Raw `user.events` fields (queries 8, 9, 15 which `fetch user.events` directly):
  - `web_vitals.largest_contentful_paint`, `web_vitals.interaction_to_next_paint` →
    **nanoseconds**; divide by `1e6` for ms. (The queries below already do this
    conversion in DQL via `toLong(...) / 1000000`, so the JSON output is
    already in ms — no further conversion needed downstream.)
  - `web_vitals.cumulative_layout_shift` → divide by `1e4` for the real decimal
    value. (Also already done in-query below via `toDouble(...) / 10000`.)
- CWV thresholds (used for Good/Needs-Improvement/Poor coloring and query 15's
  bucket counts): LCP good `< 2500ms` / poor `>= 4000ms`; INP good `< 200ms` /
  poor `>= 500ms`; CLS good `< 0.1` / poor `>= 0.25`.

---

## 0. `frontends.dql` — frontend picker

**Tab:** n/a (used to resolve the `--set frontend=` value before running
anything else). No frontend filter — this query finds the list of frontends.

```dql
fetch user.events, from: -1M
| fields frontend.name
| dedup frontend.name
| sort frontend.name asc
```

**Output columns:** `frontend.name` (string). No units/conversions.

---

## 1. `metrics-monthly.dql` — 6-month monthly Sessions / User Actions / Page Loads / device split

**Tab:** Trending. **Feeds:** page 1 KPI cards (latest month vs prior month)
and the User Traffic monthly chart.

```dql
timeseries {
    x=countDistinct(dt.frontend.session.active.estimated_count),
    y = count(dt.frontend.user_action.count),
    z = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    z2 = count(dt.frontend.web.page.largest_contentful_paint),
    t=start()
  }, from: -6M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by:device.type
| fieldsAdd d = record(d = x[], t = t[], y=y[], z=z[], z2=z2[])
| expand d
| summarize
    Sessions = sum(d[d]),
    `User Actions` = sum(d[y]),
    `Page Loads` = sum(d[z2]),
    Desktop_Sessions = sum(if(device.type == "desktop", d[d], else: 0)),
    Mobile_Sessions  = sum(if(device.type == "mobile",  d[d], else: 0)),
    Total_NonNull    = sum(if(isNotNull(device.type),   d[d], else: 0)),
  by: { t = timeframe(from: (d[t]+interval/2)@M, to: (d[t]+interval/2)@M + 1M) }
| fieldsAdd month = t[start]
| fieldsRemove t
| fieldsAdd
    `% Desktop` = if(Total_NonNull > 0, round(toDouble(Desktop_Sessions) / toDouble(Total_NonNull) * 100, decimals: 2), else: null),
    `% Mobile`  = if(Total_NonNull > 0, round(toDouble(Mobile_Sessions)  / toDouble(Total_NonNull) * 100, decimals: 2), else: null)
| fieldsRemove Desktop_Sessions, Mobile_Sessions, Total_NonNull
| sort month asc
```

**Output columns:** `Sessions`, `User Actions`, `Page Loads`, `% Desktop`,
`% Mobile`, `month` (calendar-month bucket start, ms epoch). ~6 rows (one per
month). No unit conversion needed (all are counts or pre-computed percentages).

---

## 2. `cwv-monthly.dql` — 6-month monthly LCP/INP/CLS p75 (weighted)

**Tab:** Trending. **Feeds:** page 2 Core Web Vitals monthly chart.

```dql
timeseries {
    x=countDistinct(dt.frontend.session.active.estimated_count),
    lcp = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    lcp2 = count(dt.frontend.web.page.largest_contentful_paint),
    inp = percentile(dt.frontend.web.page.interaction_to_next_paint, 75),
    inp2 = count(dt.frontend.web.page.interaction_to_next_paint),
    cls = percentile(dt.frontend.web.page.cumulative_layout_shift, 75),
    cls2 = count(dt.frontend.web.page.cumulative_layout_shift),
    t=start()
  }, from: -6M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}"
| fieldsAdd d = record(d = x[], t = t[], inp=inp[], inp2=inp2[], lcp=lcp[], lcp2=lcp2[], cls=cls[], cls2=cls2[])
| expand d
| summarize
    `Largest Contentful Paint` = sum(d[lcp] * d[lcp2]) / sum(d[lcp2]),
    `Interaction to Next Paint` = sum(d[inp] * d[inp2]) / sum(d[inp2]),
    `Cumulative Layout Shift` = sum(d[cls] * d[cls2]) / sum(d[cls2]),
  by: { t = timeframe(from: (d[t]+interval/2)@M, to: (d[t]+interval/2)@M + 1M) }
| fieldsAdd month = t[start]
| fieldsRemove t
| sort month asc
```

**Output columns:** `Largest Contentful Paint` (ms, no conversion),
`Interaction to Next Paint` (ms, no conversion), `Cumulative Layout Shift`
(**divide by 10000** for display), `month`. ~6 rows.

---

## 3. `cwv-weekly.dql` — 6-month weekly LCP/INP/CLS p75

**Tab:** Trending. **Feeds:** page 2 CWV weekly trend chart (finer-grain trend
line alongside the monthly bars).

```dql
timeseries {
    lcp = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    inp = percentile(dt.frontend.web.page.interaction_to_next_paint, 75),
    cls = percentile(dt.frontend.web.page.cumulative_layout_shift, 75),
    t = start()
  }, from: -6M, to: now(), interval: 7d, filter: frontend.name == "{{.frontend}}"
| fieldsAdd d = record(t=t[], lcp=lcp[], inp=inp[], cls=cls[])
| expand d
| fieldsAdd week = d[t], lcp = d[lcp], inp = d[inp], cls = d[cls]
| fieldsRemove d
| filterOut isNull(lcp) and isNull(inp) and isNull(cls)
| sort week asc
```

**Output columns:** `week` (bucket start, ms epoch), `lcp` (ms), `inp` (ms),
`cls` (**divide by 10000**). ~26 rows.

---

## 4. `device-dist-monthly.dql` — 6-month monthly sessions by device type

**Tab:** Trending. **Feeds:** page 2 Device Distribution chart.

```dql
timeseries {
    sessions=countDistinct(dt.frontend.session.active.estimated_count),
    t=start()
  }, from: -6M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by: {device.type}
| fieldsAdd d = record(sessions = sessions[], t = t[])
| expand d
| summarize
    Sessions = sum(d[sessions]),
  by: { t = timeframe(from: (d[t]+interval/2)@M, to: (d[t]+interval/2)@M + 1M), device.type }
| fieldsAdd month = t[start]
| fieldsRemove t
| filterOut isNull(device.type)
| sort month asc
```

**Output columns:** `Sessions` (count), `device.type` (string), `month`. One
row per month × device type. No unit conversion.

---

## 5. `browser-perf-monthly.dql` — 6-month monthly sessions + CWV by device × browser

**Tab:** Trending. **Feeds:** page 3 Browser Performance chart/table.

```dql
timeseries {
    sessions=countDistinct(dt.frontend.session.active.estimated_count),
    lcp = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    lcp2 = count(dt.frontend.web.page.largest_contentful_paint),
    inp = percentile(dt.frontend.web.page.interaction_to_next_paint, 75),
    inp2 = count(dt.frontend.web.page.interaction_to_next_paint),
    cls = percentile(dt.frontend.web.page.cumulative_layout_shift, 75),
    cls2 = count(dt.frontend.web.page.cumulative_layout_shift),
    t=start()
  }, from: -6M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by: {device.type, browser.name}
| fieldsAdd d = record(sessions = sessions[], t = t[], inp=inp[], inp2=inp2[], lcp=lcp[], lcp2=lcp2[], cls=cls[], cls2=cls2[])
| expand d
| summarize
  `Visits` = sum(d[sessions]),
  `Largest Contentful Paint` = sum(d[lcp] * d[lcp2]) / sum(d[lcp2]),
  `Interaction to Next Paint` = sum(d[inp] * d[inp2]) / sum(d[inp2]),
  `Cumulative Layout Shift` = sum(d[cls] * d[cls2]) / sum(d[cls2]),
  by: { t = timeframe(from: (d[t]+interval/2)@M, to: (d[t]+interval/2)@M + 1M), device.type, browser.name }
| fieldsAdd month = t[start]
| fieldsRemove t
| filterOut isNull(device.type)
```

**Output columns:** `Visits` (count), `Largest Contentful Paint` (ms),
`Interaction to Next Paint` (ms), `Cumulative Layout Shift` (**divide by
10000**), `device.type`, `browser.name`, `month`. All 6 months are kept —
the report shows one panel per browser×device combo trending across the
full period, not a single latest-month snapshot.

**Browser selection policy:** group rows by `{browser.name, device.type}` and
rank groups by total `Visits` summed across all 6 months, keeping only the
top N (default 4, a 2×2 panel grid — see `build-report.mjs --max-browsers`).
Real tenants can report 10+ browser/device combos; a landscape A4 page can't
fit that many panels at a legible size, and long-tail browsers with
negligible traffic don't add anything to the analysis. Ranking by total
visits over the period (rather than just the
latest month) avoids one anomalous month skewing which browsers "matter."

---

## 6. `cm-daily-device.dql` — last full calendar month, daily sessions by device

**Tab:** Current-Month. **Feeds:** page 1 Daily Device Traffic chart.

```dql
timeseries {
    sessions=countDistinct(dt.frontend.session.active.estimated_count),
    t=start()
  }, from: (now()-1M)@M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by: {device.type}
| fieldsAdd d = record(sessions = sessions[], t = t[])
| expand d
| fieldsAdd day = d[t], sessions = d[sessions]
| fields day, sessions, device.type
| filterOut isNull(device.type)
| sort day asc
```

**Output columns:** `day` (ms epoch), `sessions` (count), `device.type`
(string). ~28-31 rows × device types. No unit conversion.

---

## 7. `cm-daily-cwv.dql` — last full calendar month, daily LCP/INP/CLS p75 by device

**Tab:** Current-Month. **Feeds:** page 2 daily CWV trend chart.

```dql
timeseries {
    lcp = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    inp = percentile(dt.frontend.web.page.interaction_to_next_paint, 75),
    cls = percentile(dt.frontend.web.page.cumulative_layout_shift, 75),
    t = start()
  }, from: (now()-1M)@M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by: {device.type}
| fieldsAdd d = record(t=t[], lcp=lcp[], inp=inp[], cls=cls[])
| expand d
| fieldsAdd day = d[t], lcp = d[lcp], inp = d[inp], cls = d[cls]
| fields day, lcp, inp, cls, device.type
| filterOut isNull(device.type)
| sort day asc
```

**Output columns:** `day` (ms epoch), `lcp` (ms), `inp` (ms), `cls` (**divide
by 10000**), `device.type`.

---

## 8. `cm-cwv-distribution.dql` — last calendar month, LCP/INP/CLS histogram buckets

**Tab:** Current-Month. **Feeds:** page 2 CWV distribution histograms (one
per metric, 11 buckets each).

```dql
fetch user.events, from: (now()-1M)@M, to: now()@M
| filter frontend.name == "{{.frontend}}"
| filter dt.rum.user_type == "real_user"
| filter characteristics.classifier == "page_summary"
| fieldsAdd
    lcp_ms = toLong(web_vitals.largest_contentful_paint) / 1000000,
    inp_ms = toLong(web_vitals.interaction_to_next_paint) / 1000000,
    cls_val = toDouble(web_vitals.cumulative_layout_shift) / 10000
| summarize
    lcp_b0  = countIf(lcp_ms < 1000),
    lcp_b1  = countIf(lcp_ms >= 1000  and lcp_ms < 2000),
    lcp_b2  = countIf(lcp_ms >= 2000  and lcp_ms < 3000),
    lcp_b3  = countIf(lcp_ms >= 3000  and lcp_ms < 4000),
    lcp_b4  = countIf(lcp_ms >= 4000  and lcp_ms < 5000),
    lcp_b5  = countIf(lcp_ms >= 5000  and lcp_ms < 6000),
    lcp_b6  = countIf(lcp_ms >= 6000  and lcp_ms < 7000),
    lcp_b7  = countIf(lcp_ms >= 7000  and lcp_ms < 8000),
    lcp_b8  = countIf(lcp_ms >= 8000  and lcp_ms < 9000),
    lcp_b9  = countIf(lcp_ms >= 9000  and lcp_ms < 10000),
    lcp_b10 = countIf(lcp_ms >= 10000),
    lcp_total = countIf(isNotNull(lcp_ms)),
    inp_b0  = countIf(inp_ms < 1000),
    inp_b1  = countIf(inp_ms >= 1000  and inp_ms < 2000),
    inp_b2  = countIf(inp_ms >= 2000  and inp_ms < 3000),
    inp_b3  = countIf(inp_ms >= 3000  and inp_ms < 4000),
    inp_b4  = countIf(inp_ms >= 4000  and inp_ms < 5000),
    inp_b5  = countIf(inp_ms >= 5000  and inp_ms < 6000),
    inp_b6  = countIf(inp_ms >= 6000  and inp_ms < 7000),
    inp_b7  = countIf(inp_ms >= 7000  and inp_ms < 8000),
    inp_b8  = countIf(inp_ms >= 8000  and inp_ms < 9000),
    inp_b9  = countIf(inp_ms >= 9000  and inp_ms < 10000),
    inp_b10 = countIf(inp_ms >= 10000),
    inp_total = countIf(isNotNull(inp_ms)),
    cls_b0  = countIf(cls_val < 0.1),
    cls_b1  = countIf(cls_val >= 0.1 and cls_val < 0.2),
    cls_b2  = countIf(cls_val >= 0.2 and cls_val < 0.3),
    cls_b3  = countIf(cls_val >= 0.3 and cls_val < 0.4),
    cls_b4  = countIf(cls_val >= 0.4 and cls_val < 0.5),
    cls_b5  = countIf(cls_val >= 0.5 and cls_val < 0.6),
    cls_b6  = countIf(cls_val >= 0.6 and cls_val < 0.7),
    cls_b7  = countIf(cls_val >= 0.7 and cls_val < 0.8),
    cls_b8  = countIf(cls_val >= 0.8 and cls_val < 0.9),
    cls_b9  = countIf(cls_val >= 0.9 and cls_val < 1.0),
    cls_b10 = countIf(cls_val >= 1.0),
    cls_total = countIf(isNotNull(cls_val))
```

**Output columns:** single row with `lcp_b0`..`lcp_b10` + `lcp_total`,
`inp_b0`..`inp_b10` + `inp_total`, `cls_b0`..`cls_b10` + `cls_total` (all raw
counts). Buckets are already in real units (the `lcp_ms`/`inp_ms`/`cls_val`
fields divide out ns/×10000 in-query) — bucket boundaries: LCP/INP 1000ms-wide
buckets 0–10s+; CLS 0.1-wide buckets 0–1.0+. No further conversion needed;
just compute `% = bucket / total` per metric for the histogram.

---

## 9. `cm-top-pages.dql` — top 10 pages by traffic, last calendar month

**Tab:** Current-Month. **Feeds:** page 3 Page Performance table. **Do not**
pad short result sets with placeholder rows — only emit the real rows
returned (the source app pads to 10 with a hardcoded demo array; this skill
must not replicate that).

```dql
fetch user.events, from: (now()-1M)@M, to: now()@M
| filter frontend.name == "{{.frontend}}"
| filter dt.rum.user_type == "real_user"
| filter characteristics.classifier == "page_summary" and isNotNull(page.name)
| fieldsAdd
    lcp_ms = toLong(web_vitals.largest_contentful_paint) / 1000000,
    inp_ms = toLong(web_vitals.interaction_to_next_paint) / 1000000,
    cls_dec = toDouble(web_vitals.cumulative_layout_shift) / 10000
| summarize
    count = count(),
    lcp = percentile(lcp_ms, 75),
    inp = percentile(inp_ms, 75),
    cls = percentile(cls_dec, 75),
    exceptions = avg(error.exception_count),
    request_errors = avg(error.http_4xx_count + error.http_5xx_count),
    by: page.name
| sort count desc
| limit 10
```

**Output columns:** `page.name` (string), `count` (page-load count), `lcp`
(ms), `inp` (ms), `cls` (decimal, already divided in-query — **no further
conversion**), `exceptions` (avg exception count per page load),
`request_errors` (avg 4xx+5xx count per page load). Up to 10 rows.

---

## 10. `cm-top-exceptions.dql` — top 10 exceptions, last calendar month

**Tab:** Current-Month. **Feeds:** page 4 Top Exceptions table.

```dql
fetch user.events, from: (now()-1M)@M, to: now()@M
| filter frontend.name == "{{.frontend}}"
| filter dt.rum.user_type == "real_user"
| filter characteristics.has_exception == true
| filterOut isNull(exception.type)
| summarize count = count(), by: {exception.type, exception.message, error.source}
| sort count desc
| limit 10
```

**Output columns:** `count`, `exception.type`, `exception.message`,
`error.source`. Up to 10 rows. No unit conversion.

---

## 11. `cm-top-request-errors.dql` — top 10 failed requests, last calendar month

**Tab:** Current-Month. **Feeds:** page 4 Top Request Errors table.

```dql
fetch user.events, from: (now()-1M)@M, to: now()@M
| filter frontend.name == "{{.frontend}}"
| filter dt.rum.user_type == "real_user"
| filter characteristics.classifier == "error"
| filter characteristics.has_failed_request == true
| filter http.response.status_code > 0
| filterOut isNull(url.path)
| summarize count = count(), by: {http.request.method, http.response.status_code, url.host, url.path}
| sort count desc
| limit 10
```

**Output columns:** `count`, `http.request.method`, `http.response.status_code`,
`url.host`, `url.path`. Up to 10 rows. No unit conversion.

---

## 12. `cm-error-count.dql` — daily error counts by device × error type, last calendar month

**Tab:** Current-Month. **Feeds:** page 4 daily error trend chart (secondary
series: error type breakdown).

```dql
timeseries {
    errors = count(dt.frontend.error.count),
    t = start()
  }, by: {device.type, error.type}, interval: 1d, from: (now()-1M)@M, to: now()@M, filter: frontend.name == "{{.frontend}}"
| fieldsAdd d = record(t=t[], e=errors[])
| expand d
| fieldsAdd day = d[t], error_count = d[e]
| fields day, error_count, device.type, error.type
| filterOut isNull(device.type)
| sort day asc
```

**Output columns:** `day` (ms epoch), `error_count` (count), `device.type`,
`error.type`. No unit conversion.

---

## 13. `cm-errors.dql` — daily session-level error rates by device, last calendar month

**Tab:** Current-Month. **Feeds:** page 4 primary daily error chart (total
sessions vs JS-error sessions vs request-error sessions).

```dql
fetch user.events, from: (now()-1M)@M, to: now()@M
| filter frontend.name == "{{.frontend}}"
| filter dt.rum.user_type == "real_user"
| summarize
    total_sessions = countDistinct(dt.rum.session.id),
    js_error_sessions = countDistinct(if(characteristics.has_exception == true, dt.rum.session.id, else: null)),
    req_error_sessions = countDistinct(if(characteristics.has_failed_request == true, dt.rum.session.id, else: null)),
  by: { day = bin(start_time, 1d), device.type }
| filterOut isNull(device.type)
| sort day asc
```

**Output columns:** `day` (ms epoch), `device.type`, `total_sessions`,
`js_error_sessions`, `req_error_sessions` (all session counts). No unit
conversion.

---

## 14. `cm-device-compare.dql` — device-level rollup, last calendar month

**Tab:** Current-Month. **Feeds:** page 1 Mobile-vs-Desktop comparison table
(also used to compute the overall/blended KPI numbers for the current-month
report header).

```dql
timeseries {
    sessions=countDistinct(dt.frontend.session.active.estimated_count),
    lcp = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    lcp2 = count(dt.frontend.web.page.largest_contentful_paint),
    inp = percentile(dt.frontend.web.page.interaction_to_next_paint, 75),
    inp2 = count(dt.frontend.web.page.interaction_to_next_paint),
    cls = percentile(dt.frontend.web.page.cumulative_layout_shift, 75),
    cls2 = count(dt.frontend.web.page.cumulative_layout_shift)
  }, from: (now()-1M)@M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by: {device.type}
| fieldsAdd d = record(d=sessions[], lcp=lcp[], lcp2=lcp2[], inp=inp[], inp2=inp2[], cls=cls[], cls2=cls2[])
| expand d
| filterOut isNull(device.type)
| summarize
    sessions = sum(d[d]),
    page_loads = sum(d[lcp2]),
    lcp_p75 = sum(d[lcp] * d[lcp2]) / sum(d[lcp2]),
    inp_p75 = sum(d[inp] * d[inp2]) / sum(d[inp2]),
    cls_p75 = sum(d[cls] * d[cls2]) / sum(d[cls2]),
  by: { device_type = device.type }
```

**Output columns:** `device_type` (string, one row per device type — usually
`mobile`/`desktop`), `sessions`, `page_loads` (counts), `lcp_p75` (ms),
`inp_p75` (ms), `cls_p75` (**divide by 10000**). Blended/overall KPI values
(sessions, page loads, LCP/INP/CLS) can be derived by weighting each device
row by `page_loads` across all rows.

---

## 15. `cm-cwv-tier.dql` — Good/Needs-Improvement/Poor tier counts, last calendar month

**Tab:** Current-Month. **Feeds:** page 2 CWV Tier chart (stacked
good/needs-improvement/poor bars per metric).

```dql
fetch user.events, from: (now()-1M)@M, to: now()@M
| filter frontend.name == "{{.frontend}}"
| filter characteristics.classifier == "page_summary"
| filter dt.rum.user_type == "real_user"
| fieldsAdd
    lcp_ms = toLong(web_vitals.largest_contentful_paint) / 1000000,
    inp_ms = toLong(web_vitals.interaction_to_next_paint) / 1000000,
    cls_val = toDouble(web_vitals.cumulative_layout_shift) / 10000
| summarize
    lcp_good = countIf(lcp_ms < 2500),
    lcp_ni = countIf(lcp_ms >= 2500 and lcp_ms < 4000),
    lcp_poor = countIf(lcp_ms >= 4000),
    lcp_total = countIf(isNotNull(lcp_ms)),
    inp_good = countIf(inp_ms < 200),
    inp_ni = countIf(inp_ms >= 200 and inp_ms < 500),
    inp_poor = countIf(inp_ms >= 500),
    inp_total = countIf(isNotNull(inp_ms)),
    cls_good = countIf(cls_val < 0.1),
    cls_ni = countIf(cls_val >= 0.1 and cls_val < 0.25),
    cls_poor = countIf(cls_val >= 0.25),
    cls_total = countIf(isNotNull(cls_val))
```

**Output columns:** single row with `lcp_good`/`lcp_ni`/`lcp_poor`/`lcp_total`,
`inp_good`/`inp_ni`/`inp_poor`/`inp_total`,
`cls_good`/`cls_ni`/`cls_poor`/`cls_total` — all raw counts, already
thresholded in real units in-query. No further conversion; compute
`% = tier_count / *_total` per metric for the chart.
