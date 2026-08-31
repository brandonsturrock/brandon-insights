# Query file → output filename contract

<!--
Data-model probes resolved against `demo live` on 2026-08-31 (do not re-probe):
- CLS on `user.events` is UNSCALED — `percentile(toDouble(web_vitals.cumulative_layout_shift), 75)`
  over 41,917 easyTravel page summaries returned p75 = 0.0001, max = 0.9971, already a 0-1 score.
  Do not divide by 10000. (Note: sibling skill `monthly-report` divides this same field by 10000
  in `cm-cwv-tier.dql` and `cm-top-pages.dql` — that understates every CLS figure there by four
  orders of magnitude. Out of scope for this branch; flagged for the maintainer.)
- `duration` on `user.events` is NANOSECONDS — user action instance `552c90689fb8da5e` reports
  `duration = 1439000000`, matching Dynatrace's built-in waterfall rendering of `1.44 s` for the
  same action. The `/ 1000000` divisor used throughout these queries is correct.

All eight aggregate queries (load-count, cwv-percentiles, ttfb-phases, resources-agg,
thirdparty-agg, longtasks-agg, errors-agg, browser-device) filter
`dt.rum.user_type == "real_user"`, on the outer fetch and, where present, the inner
nav-join subquery too. Request events on `www.easytravel.com` carry substantial
robot/synthetic traffic (111,562 `robot` request events vs 2,591,562 `real_user` over
24h) — leaving it unfiltered inflates the resource-prevalence denominator with
synthetic loads and produces an unexplained mismatch between request-scoped and
page-summary-scoped `loads` figures in the same report. The five selection queries
(`fpa-frontends`, `fpa-pages`, `fpa-lcp-baseline`, `fpa-top-browser`,
`fpa-select-instance`) do NOT filter on `dt.rum.user_type` — they mirror v1's behavior
exactly, and the instance-selection path is already validated against the built-in
waterfall, so their population was left untouched.
-->

`build-report.mjs` reads the `--data` directory by these exact filenames.
Run each query as:

    dtctl query -f references/queries/<file>.dql --set <params> -o json --agent --spill=never | grep '^{' > <data-dir>/<output>.json

## Instance-scoped

| Query file | Parameters | Output filename |
|---|---|---|
| `fpa-instance-summary.dql` | `timeframe`, `view_instance` | `instance-summary.json` |
| `fpa-instance-requests.dql` | `timeframe`, `ua_instance` | `instance-requests.json` |
| `fpa-instance-exceptions.dql` | `timeframe`, `ua_instance` | `instance-exceptions.json` |
| `fpa-instance-action.dql` | `timeframe`, `ua_instance` | `instance-action.json` |

## Selection (run interactively by SKILL.md, not consumed by build-report.mjs)

| Query file | Parameters |
|---|---|
| `fpa-frontends.dql` | `timeframe` |
| `fpa-pages.dql` | `timeframe`, `frontend` |
| `fpa-lcp-baseline.dql` | `timeframe`, `frontend`, `page` |
| `fpa-top-browser.dql` | `timeframe`, `frontend`, `page` |
| `fpa-select-instance.dql` | `timeframe`, `frontend`, `page`, `browser`, `low_bound`, `high_bound` |
| `fpa-resolve-instance.dql` | `timeframe`, `ua_instance` |
| `fpa-resolve-instance-type.dql` | `timeframe`, `ua_instance` |

`fpa-resolve-instance.dql` and `fpa-resolve-instance-type.dql` are used only
by the "I have an instance ID" entry point (added in the SKILL.md rewrite
that added Task 9's end-to-end run, to keep that path DQL-free too): the
former resolves `view.instance_id`, `frontend.name`, `page.detected_name`,
and browser/device metadata from a known `user_action.instance_id`; the
latter is the fallback wrong-type check when the first returns no rows in
either the 7-day or 30-day window.

## Aggregate

| Query file | Parameters | Output filename |
|---|---|---|
| `fpa-load-count.dql` | `timeframe`, `frontend`, `page` | `load-count.json` |
| `fpa-cwv-percentiles.dql` | `timeframe`, `frontend`, `page` | `cwv-percentiles.json` |
| `fpa-ttfb-phases.dql` | `timeframe`, `frontend`, `page` | `ttfb-phases.json` |
| `fpa-resources-agg.dql` | `timeframe`, `frontend`, `page` | `resources-agg.json` |
| `fpa-thirdparty-agg.dql` | `timeframe`, `frontend`, `page` | `thirdparty-agg.json` |
| `fpa-longtasks-agg.dql` | `timeframe`, `frontend`, `page` | `longtasks-agg.json` |
| `fpa-errors-agg.dql` | `timeframe`, `frontend`, `page` | `errors-agg.json` |
| `fpa-browser-device.dql` | `timeframe`, `frontend`, `page` | `browser-device.json` |
