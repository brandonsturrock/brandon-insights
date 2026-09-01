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
`dt.rum.user_type == "real_user"` on their own fetch. The five page-summary
aggregates (cwv-percentiles, ttfb-phases, longtasks-agg, errors-agg, browser-device)
used to also join to a hard-navigation subquery on `{view.instance_id,
dt.rum.session.id}` to scope the page-summary population to the given page; that
join was removed (page-summary events already carry `page.detected_name`, and on
some frontends — Astroshop confirmed — the join key mismatches between a page
summary and the hard navigation that produced it, dropping the population to a
near-empty, unrepresentative sample). All five now filter
`page.detected_name == "{{.page}}"` directly, alongside their own
`dt.rum.user_type == "real_user"` filter. resources-agg and thirdparty-agg keep
their join, on `user_action.instance_id`, which does not have this problem.
Request events on `www.easytravel.com` carry substantial robot/synthetic traffic
(111,562 `robot` request events vs 2,591,562 `real_user` over 24h) — leaving it
unfiltered inflates the resource-prevalence denominator with synthetic loads and
produces an unexplained mismatch between request-scoped and page-summary-scoped
`loads` figures in the same report. `fpa-lcp-baseline` and `fpa-top-browser` also
filter `dt.rum.user_type == "real_user"` (added so the quoted baseline and the
representative-browser pick agree with the rest of the report's real-user
population). `fpa-frontends`, `fpa-pages`, and `fpa-select-instance` do NOT filter
on `dt.rum.user_type` — the instance-selection path is already validated against
the built-in waterfall, so their population was left untouched.

thirdparty-agg filters `url.provider == "third_party"`. Without it the query
grouped by `url.domain` alone, so the page's own domain appeared in the
third-party table — and since the table sorts by `duration_p75`, first party
sorted to the top of it on every page (the sum of all first-party requests per
load beats any single third party). `url.provider` is the RUM agent's own
classification, is never null, and takes exactly `first_party` / `third_party`,
so it decides this correctly without the query needing to know the page's
hostname. It also filters `isNotNull(url.domain)`: request events with no
domain do exist and carry a provider (111,981 third-party ones over 7d on
Astroshop), and grouped by a null domain they render as a blank row with a real
load count.
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
in Task 9, to keep that path DQL-free too): the former resolves
`view.instance_id`, `frontend.name`, `page.detected_name`, and
browser/device metadata from a known `user_action.instance_id`; the latter
is the fallback wrong-type check when the first returns no rows in either
the 7-day or 30-day window. Both verified against `demo live`: the former
against a known Astroshop hard-navigation instance (7-day window) and a
30+ day old easyTravel hard-navigation instance (30-day expansion); the
latter against a `soft_navigation` instance, confirming it surfaces
`user_action.type` for the wrong-type message.

`fpa-resolve-instance-type.dql` filters `toString(user_action.instance_id)
== "{{.ua_instance}}"`, not plain `==` like every other instance-scoped
query in this file. Plain string equality against `user_action.instance_id`
returns 0 rows for non-`hard_navigation` action types on `demo live` (e.g.
`soft_navigation`, `same_view`) even when `toString(user_action.instance_id)
== "{{.ua_instance}}"` on the identical row returns 1 — some non-hard-nav
action types apparently store this field as a type plain string equality
doesn't match. Since this query's entire job is identifying non-hard-nav
instances, it needs `toString()` or it would silently report "not found"
instead of "wrong type" for exactly the instances it exists to catch. Every
other query file in this contract only ever matches `hard_navigation`
instances by this field, so they are unaffected and were left as plain
`==`.

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
