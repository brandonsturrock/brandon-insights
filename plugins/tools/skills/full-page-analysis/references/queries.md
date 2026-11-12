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
population). `fpa-frontends`, `fpa-pages`, and `fpa-select-instance` filter it too,
so the sampled load can never be a robot or synthetic visit.

LCP on a hard-navigation user action is `coalesce(lcp.render_time, lcp.start_time)`
(ms). There is no `web_vitals.largest_contentful_paint` on user action events.
`render_time` is the paint time and is preferred; the browser withholds it on
some frontends — on `demo live` (2026-11-12, agent 1.349.3) it was set on every
reported LCP for Astroshop and EasyTrade but on ~1% for the easyTravel frontends,
on every browser. `start_time` is the LCP entry's startTime (render time, else
load time): equal to `render_time` wherever both exist (all 147,818 Astroshop
loads), and equal to the page summary's LCP. The fallback slightly understates
LCP (load, not paint) but keeps those frontends at full coverage.

fpa-cwv-percentiles takes LCP / FCP / CLS / TTFB from the hard-navigation user
action (`coalesce(lcp.render_time, lcp.start_time)`, `fcp.value`, `cls.value`, `ttfb.value`, all ms) and
INP from the page summary — the action almost never reports INP, and the page
summary covers the whole visit. INP counts `below_threshold` (an interaction
under 40ms, value populated) as well as `reported`; excluding it biased p75
upward. Each metric returns its own `*_n` sample size. `loads` is the
hard-navigation count. fpa-browser-device uses the same user-action LCP, so a
segment is compared against the same blended p75 the tile shows.
`has_user_action` is null (not false) on page summaries, hence the `coalesce`.

fpa-longtasks-agg drops loads whose `long_task.status` is `disabled` or
`not_supported` — they can never report a long task and only dilute the share.
`not_reported` stays: it means none occurred.

fpa-resources-agg returns `blocking_known`, the requests that reported any
`performance.render_blocking_status` (Chromium only). The render-blocking rule
divides by it rather than by all requests.

fpa-select-instance takes `p75` and sorts by distance from it (it used to sort
`lcp_ms asc`, which always picked ~0.85x p75), and excludes
`user_action.complete_reason == "timeout"`.

fpa-select-instance requires the instance's navigation document request to be
present and not failed (`navs > 0 AND bad_navs == 0`), which keeps error pages —
a 403 or 500 served as the document — out of the sample; such a load has a real
LCP and a linked page_summary, so nothing else rejects it, but its waterfall
describes the error page rather than the page under analysis. The test counts
*failed* navigations and requires zero, rather than counting successful ones and
requiring at least one, because `http.response.status_code` is null on
navigation requests on some frontends (all 52,237 on
`www.angular.easytravel.com`, versus fully populated on Astroshop). Under a
count-the-good-ones test those nulls fail the comparison and the filter empties
the entire frontend; counting failures instead makes null mean "not known to
have failed", which is the safe default. `characteristics.has_failed_request` is
checked alongside the status code: it is null on success and true on failure, and
catches network-level failures that never produce a status code at all.

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
| `fpa-select-instance.dql` | `timeframe`, `frontend`, `page`, `browser`, `low_bound`, `high_bound`, `p75` |
| `fpa-resolve-instance.dql` | `timeframe`, `ua_instance` |
| `fpa-resolve-instance-type.dql` | `timeframe`, `ua_instance` |

`fpa-resolve-instance.dql` and `fpa-resolve-instance-type.dql` are used only
by the "I have an instance ID" entry point (added in the SKILL.md rewrite
in Task 9, to keep that path DQL-free too): the former resolves
`view.instance_id`, `frontend.name`, `page.detected_name`, and
the instance's LCP from a known `user_action.instance_id`; the latter
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
| `fpa-lcp-parts.dql` | `timeframe`, `frontend`, `page` | `lcp-parts.json` |
| `fpa-lcp-elements.dql` | `timeframe`, `frontend`, `page` | `lcp-elements.json` |
| `fpa-exceptions-top.dql` | `timeframe`, `frontend`, `page` | `exceptions-top.json` |

`fpa-exceptions-top.dql` lists the ten exceptions on the most loads, counting
loads as distinct `view.instance_id`. One bug often shows up as several rows:
Chrome, Safari and Firefox word the same `TypeError` differently.

`fpa-select-instance.dql` ranks candidates inside the p75 window by how common
their LCP kind (image or text) is on the page, then how common their LCP element
is (`lcp.url`, or the xpath for text), then distance from p75. Kind comes first
so a page whose image URLs are all distinct still gets an image LCP. Without
that ranking, ALC.ca's homepage, where the LCP is an image on 91% of loads, got
a text LCP. The two frequency joins added ~44 GB to a ~359 GB scan there.

`fpa-lcp-parts.dql` and `fpa-lcp-elements.dql` feed the LCP panel. The user
action carries LCP's four parts, which sum exactly to LCP on each load (verified
on ALC.ca, 2026-11-12): `ttfb.value`, `lcp.resource.load_delay`,
`lcp.resource.load_duration` and `lcp.ui_element.render_delay`. Text LCPs carry no
resource parts. Some agent versions omit `render_delay` (on `demo live` it was
null on every load), so both queries take the remainder, LCP minus the other
three, which is the same quantity where it is reported. `fpa-lcp-elements.dql`
groups images by `lcp.url` and text by the stringified `lcp.ui_element.xpath`.

`fpa-errors-agg.dql` counts `error.http_other_count` (failed requests that are
neither 4xx nor 5xx) and `error.csp_violation_count` alongside exceptions and
4xx/5xx, and both count toward `loads_with_any_error`.

`fpa-frontends.dql` uses `samplingRatio: 100` and scales the count back up. It
only ranks frontends for the picker, and unsampled it hit the 500 GB scan limit
on ALC.ca (7.4 GB sampled). Counts are approximate, and a frontend with under
~100 hard navigations in the window can drop out of the list.

`user_action.instance_id` is a string and `view.instance_id` is a uid, so
queries match the first as a plain string and the second through `toUid()`.
`toUid()` on `user_action.instance_id` returns no rows.

The instance queries fetch only fields the report reads. Check
`scripts/lib/normalize.mjs`, `scripts/build-report.mjs` and
`assets/report.html.tmpl` before adding one back.

`fpa-instance-action.dql` selects `id` alongside the action fields. That is the
user-action *event's* own 32-hex identifier, which the Users & Sessions viewer
takes as its `event` parameter to select this action inside the session — it is
not `user_action.instance_id` (16 hex), which names the action across the data
model rather than the event row. `fpa-instance-summary.dql` supplies the other
two halves of that link, `dt.rum.session.id` and `start_time`.

`ttfb-phases.json` has no panel of its own. It is still queried because the
`slow-ttfb` finding names the DNS / connect / waiting / request split in its
evidence, and that rule only fires when TTFB p75 is already over its threshold —
which is the only time the split says anything. As a standing panel it reported
a breakdown of a number that was usually fine.
