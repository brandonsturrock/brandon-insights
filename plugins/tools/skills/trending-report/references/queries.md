# Trending Report — Queries

Four DQL queries for the trending report. Each uses `{{.frontend}}` as the
only template variable (Go-template syntax). Run each with:

```bash
dtctl query -f <query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never | grep '^{' > <data-dir>/<canonical-filename>.json
```

`--spill=never` keeps rows inline (`result.kind == "records"`). If a query
spills anyway, use `dtctl inspect` per the dtctl skill.

The `| grep '^{'` strips any warning lines dtctl emits before the JSON
envelope (e.g. field-override warnings from timeseries queries).

## Filename map (contract for build-report.mjs)

| # | Query file | Canonical output filename |
|---|-----------|---------------------------|
| 1 | `metrics-monthly.dql` | `metrics-monthly.json` |
| 2 | `cwv-monthly.dql` | `cwv-monthly.json` |
| 3 | `cwv-weekly.dql` | `cwv-weekly.json` |
| 4 | `browser-perf-monthly.dql` | `browser-perf-monthly.json` |

## Unit conversions

- LCP / INP timeseries metrics → already **milliseconds**, no conversion.
- CLS timeseries metric → stored **×10000**; divide by `10000` for the real value.
- CWV thresholds: LCP good `<2500ms` / poor `≥4000ms`; INP good `<200ms` / poor `≥500ms`; CLS good `<0.1` / poor `≥0.25`.

---

## 1. `metrics-monthly.dql` — 6-month monthly Sessions / User Actions / Page Loads / device split

**Feeds:** KPI cards (latest month vs prior month) and the User Traffic monthly chart.

```dql
timeseries {
    x=countDistinct(dt.frontend.session.active.estimated_count),
    y = count(dt.frontend.user_action.count, filter: user_action.type == "same_view"),
    z = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    z2 = count(dt.frontend.user_action.count, filter: user_action.type != "same_view"),
    t=start()
  }, from: -6M, to: now()@M, interval: 1d, filter: frontend.name == "{{.frontend}}", by:device.type
| fieldsAdd d = record(d = x[], t = t[], y=y[], z=z[], z2=z2[])
| expand d
| summarize
    Sessions = sum(d[d]),
    `XHR Requests` = sum(d[y]),
    `Navigations` = sum(d[z2]),
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

**Output columns:** `Sessions`, `XHR Requests`, `Navigations`, `% Desktop`, `% Mobile`, `month`. ~6 rows.

---

## 2. `cwv-monthly.dql` — 6-month monthly LCP/INP/CLS p75 (weighted)

**Feeds:** Core Web Vitals monthly chart.

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

**Output columns:** `Largest Contentful Paint` (ms), `Interaction to Next Paint` (ms), `Cumulative Layout Shift` (**÷10000**), `month`. ~6 rows.

---

## 3. `cwv-weekly.dql` — 6-month weekly LCP/INP/CLS p75

**Feeds:** Core Web Vitals Historical trend chart.

```dql
timeseries {
    lcp = percentile(dt.frontend.web.page.largest_contentful_paint, 75),
    inp = percentile(dt.frontend.web.page.interaction_to_next_paint, 75),
    cls = percentile(dt.frontend.web.page.cumulative_layout_shift, 75),
    t = start()
  }, from: -6M, to: now()@M, interval: 7d, filter: frontend.name == "{{.frontend}}"
| fieldsAdd d = record(t=t[], lcp=lcp[], inp=inp[], cls=cls[])
| expand d
| fieldsAdd week = d[t], lcp = d[lcp], inp = d[inp], cls = d[cls]
| fieldsRemove d
| filterOut isNull(lcp) and isNull(inp) and isNull(cls)
| sort week asc
```

**Output columns:** `week` (bucket start), `lcp` (ms), `inp` (ms), `cls` (**÷10000**). ~26 rows.

---

## 4. `browser-perf-monthly.dql` — 6-month monthly sessions + CWV by device × browser

**Feeds:** Browser Performance panel grid.

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

**Output columns:** `Visits`, `Largest Contentful Paint` (ms), `Interaction to Next Paint` (ms), `Cumulative Layout Shift` (**÷10000**), `device.type`, `browser.name`, `month`. All 6 months kept — panels trend the full period.

**Selection policy:** group by `{browser.name, device.type}`, rank by latest-month visits descending, keep top N (default 6). Exclude combos where current and previous month both have negligible visits (≤10). Remaining slots pad to N as blank cards.
