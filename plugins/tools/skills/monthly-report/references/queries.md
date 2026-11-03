# Monthly Report — Queries

The `.dql` files in `references/queries/` are the source of truth; this file is the map. Each uses `{{.frontend}}` as its only template variable (Go-template syntax, filled by `--set frontend=<name>`). Window: the last full calendar month, `from: (now()-1M)@M, to: now()@M`; daily timeseries start 2 days earlier as warm-up and `build-report.mjs` strips those days.

## Running

```bash
node scripts/run-queries.mjs --frontend "<name>" --out <dir> [--context <ctx>]
```

Runs every `references/queries/*.dql` concurrently through `dtctl query -f <file> --set frontend=<name> -o json --agent --spill=never`, writes each raw envelope to `<dir>/<query>.json`, and prints `<query>: N rows` or `<query>: FAILED <error>`. Exit 1 if any query failed, 2 if `dtctl` is missing.

`node scripts/run-queries.mjs --list-frontends [--context <ctx>]` runs `references/frontends.dql` (7-day page loads per frontend, top 30) and prints `<page_loads>` TAB `<frontend.name>`.

## Filename map

`build-report.mjs --data <dir>` reads these exact names (`<query>.dql` -> `<query>.json`):

`cm-daily-device`, `cm-daily-cwv`, `cm-device-compare`, `cm-cwv-tier`, `cm-top-pages`, `cm-top-exceptions`, `cm-top-request-errors`, `cm-error-count`, `cm-errors`.

## Unit conversions

- Timeseries metrics (`dt.frontend.web.page.*`): LCP/INP already **ms**; CLS is stored **x10000**, so `build-report.mjs` divides by `10000`.
- `fetch user.events` queries (`cm-cwv-tier`, `cm-top-pages`): LCP/INP are converted ns -> ms inside the DQL; CLS is already a real decimal, no scaling.
- LCP/INP of `0` = not measured (INP needs an interaction); the build turns it into null / "—". CLS `0` is a real value.
- Thresholds: LCP good `<2500ms` / poor `>=4000ms`; INP good `<200ms` / poor `>=500ms`; CLS good `<0.1` / poor `>=0.25`.

## Queries

- `cm-daily-device` — daily sessions by device (page 2 chart). Columns: `day`, `sessions`, `device.type`.
- `cm-daily-cwv` — daily LCP/INP/CLS p75 by device (page 3 trend charts). Columns: `day`, `lcp`, `inp`, `cls` (x10000), `device.type`.
- `cm-device-compare` — one row per device (page 2 device table; page-load-weighted blend feeds the KPIs and p75 tiles). Columns: `device_type`, `sessions`, `page_loads`, `lcp_p75`, `inp_p75`, `cls_p75` (x10000).
- `cm-cwv-tier` — single row of good / needs-improvement / poor counts (foot of each page 3 tile). Columns: `lcp_good`, `lcp_ni`, `lcp_poor`, `lcp_total`, and the same four for `inp_` and `cls_`.
- `cm-top-pages` — top 10 pages by page loads (page 2 scorecard). Columns: `page.name`, `count`, `lcp`, `inp`, `cls`, `exceptions` (avg per load), `request_errors` (avg 4xx+5xx per load).
- `cm-top-exceptions` — top 10 exceptions (page 4 table). Columns: `count`, `exception.type`, `exception.message`, `error.source`.
- `cm-top-request-errors` — top 10 failed requests (page 4 table). Columns: `count`, `http.request.method`, `http.response.status_code`, `url.host`, `url.path`.
- `cm-error-count` — daily error counts by device and error type (page 4 stacked chart; JS = `exception`, Request = `request`). Columns: `day`, `error_count`, `device.type`, `error.type`.
- `cm-errors` — daily session-level error rates by device (page 4 error-rate chart; counts arrive as strings). Columns: `day`, `device.type`, `total_sessions`, `js_error_sessions`, `req_error_sessions`.

## `union: true`

Multi-metric `timeseries` queries (`cm-daily-cwv`, `cm-device-compare`) set `union: true`. Without it the metrics are inner-joined on dimensions, so when one metric (e.g. INP) has no `device.type` split the query returns 0 rows and the report shows "0 sessions / 0 page loads" and blank CWV tiles. Keep it on any new multi-metric `timeseries`.
