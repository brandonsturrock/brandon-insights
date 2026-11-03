# Trending Report — Queries

The `.dql` files in `references/queries/` are the source of truth; this file is the map. Each uses `{{.frontend}}` as its only template variable (Go-template syntax, filled by `--set frontend=<name>`). Window: the last 6 full calendar months, `from: now()@M - 6M, to: now()@M` (starts on the 1st, no partial first month). Monthly queries sum/weight daily points into calendar-month buckets.

## Running

```bash
node scripts/run-queries.mjs --frontend "<name>" --out <dir> [--context <ctx>]
```

Runs every `references/queries/*.dql` concurrently through `dtctl query -f <file> --set frontend=<name> -o json --agent --spill=never`, writes each raw envelope to `<dir>/<query>.json`, and prints `<query>: N rows` or `<query>: FAILED <error>`. Exit 1 if any query failed, 2 if `dtctl` is missing.

`node scripts/run-queries.mjs --list-frontends [--context <ctx>]` runs `references/frontends.dql` (7-day page loads per frontend, top 30) and prints `<page_loads>` TAB `<frontend.name>`.

## Filename map

`build-report.mjs --data <dir>` reads these exact names (`<query>.dql` -> `<query>.json`):

`metrics-monthly`, `cwv-monthly`, `cwv-weekly`, `browser-perf-monthly`, `traffic-weekly` (optional: the build tolerates it being absent).

## Unit conversions

- All five are timeseries queries: LCP/INP already **ms**; CLS is stored **x10000**, so `build-report.mjs` divides by `10000`.
- LCP/INP of `0` = not measured (INP needs an interaction); the build turns it into null / "—". CLS `0` is a real value.
- Thresholds: LCP good `<2500ms` / poor `>=4000ms`; INP good `<200ms` / poor `>=500ms`; CLS good `<0.1` / poor `>=0.25`.

## Queries

- `metrics-monthly` — monthly traffic and device split (page 1 KPI cards, page 2 traffic table). Columns: `Sessions`, `XHR Requests`, `Navigations`, `% Desktop`, `% Mobile`, `month`. ~6 rows.
- `cwv-monthly` — monthly LCP/INP/CLS p75, page-load-weighted (page 1 CWV KPI tiles, page 3 status row). Columns: `Largest Contentful Paint`, `Interaction to Next Paint`, `Cumulative Layout Shift` (x10000), `month`. ~6 rows.
- `cwv-weekly` — weekly LCP/INP/CLS p75 (page 3 trend charts). Columns: `week`, `lcp`, `inp`, `cls` (x10000). ~26 rows.
- `browser-perf-monthly` — monthly visits and CWV by device and browser (page 4 panels; the build keeps the top `--max-browsers`, default 6, ranked by latest-month visits). Columns: `Visits`, `Largest Contentful Paint`, `Interaction to Next Paint`, `Cumulative Layout Shift` (x10000), `device.type`, `browser.name`, `month`.
- `traffic-weekly` — weekly traffic (page 2 weekly sessions chart; only `sessions` is plotted). Columns: `week`, `sessions`, `xhr`, `navigations`. ~26 rows, same 7d bucketing as `cwv-weekly` so the x-axes line up.

## `union: true`

All five queries are multi-metric `timeseries` and set `union: true`. Without it the metrics are inner-joined on dimensions, so when one metric (e.g. INP) has no `device.type` split the query returns 0 rows and the report shows blank CWV and browser pages. Keep it on any new multi-metric `timeseries`.
