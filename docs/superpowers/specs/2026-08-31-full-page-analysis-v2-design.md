# Full Page Analysis v2 — Design

**Date:** 2026-08-31
**Branch:** `feat/full-page-analysis-v2`
**Skill:** `plugins/tools/skills/full-page-analysis`
**Supersedes:** v1.1.1

## Problem

v1 works but has four defects:

1. **Single-instance sampling is weak.** The entire diagnosis rests on one
   session picked near p75 LCP. A resource that was slow in that one load is
   reported as a page-wide problem with no evidence it is.
2. **Too much prompt, too little code.** A 19 KB `SKILL.md` carries every DQL
   query and every analysis rule as instructions. It is token-heavy, slow, and
   fragile — the agent re-derives the same analysis on every run.
3. **Output format is wrong.** A markdown file plus a separate waterfall HTML
   is two artifacts, neither of which is shareable with a stakeholder.
4. **Timing correctness is unverified.** Nobody has diffed the rendered
   resource timings against Dynatrace's own built-in waterfall for the same
   instance. The waterfall also does not follow Dynatrace visual standards.

## Goals

- Aggregate analysis across all sessions for a page, with a single instance
  retained only as a labelled illustrative example.
- Query and analysis logic in versioned files and scripts, not in prompt text.
- Two artifacts from one pipeline: an interactive HTML report and a shareable
  PDF.
- Resource timings verified against the built-in Dynatrace waterfall, with the
  verification locked in as a test.
- Waterfall restyled to Dynatrace Strato visual standards.

## Non-goals

- Synthesized aggregate waterfall (cross-session resource p75s rendered as
  bars). Deferred — see *Deferred work*.
- Deploying results into the tenant as a notebook or dashboard.
- Supporting user action types other than hard navigation.

## Approach

Rewrite the skill into the structure already used by the sibling
`monthly-report` and `trending-report` skills in this plugin: `.dql` files
under `references/queries/`, a `build-report.mjs` glue script, an HTML
template in `assets/`, and the existing `render-pdf.sh` / `render-pdf.ps1`
Chrome-headless PDF path.

The W3C resource-timing normalization from v1 (`normalizeRaw()`, lines
275–530 of `assets/template.html`) is ported rather than rewritten, then
validated against ground truth before anything is built on top of it. This
turns the correctness risk into a gate instead of a rewrite.

Alternatives considered:

- **Rebuild timing normalization from scratch against the W3C spec.** Cleaner
  slate for the correctness question, but re-derives logic v1 already gets
  right, and the spec alone will not surface Dynatrace-specific quirks.
- **Keep v1's template and bolt on aggregate sections plus PDF.** Smallest
  diff, but addresses neither the prompt-weight problem nor the visual
  revamp. Rejected.

## Structure

```
full-page-analysis/
  SKILL.md                  ~300 lines, orchestration only
  README.md
  references/
    queries/*.dql           one file per query, placeholder-substituted
    findings-prompt.md      how the agent writes prose around computed flags
  scripts/
    build-report.mjs        data dir -> HTML; findings rules live here
    lib/normalize.mjs       ported normalizeRaw + W3C timing; the unit under test
    test-normalize.mjs      assert-based, runs against a checked-in fixture
  assets/
    report.html.tmpl        Strato-styled; aggregate sections + waterfall section
    chart.umd.min.js
    render-pdf.sh
    render-pdf.ps1
```

Findings rules stay inside `build-report.mjs` rather than a separate module
until that file becomes unwieldy. `normalize.mjs` is split out because it is
the unit under test and must be runnable headless.

## Data flow

1. `SKILL.md` resolves context, frontend, page, and timeframe.
2. Each `references/queries/*.dql` is run via `dtctl query -o json` into
   `/tmp/fpa-<slug>/<name>.json`.
3. `build-report.mjs` reads that directory, computes deterministic finding
   flags, and emits `report.html` from `report.html.tmpl`.
4. The agent reads the computed flags and writes narrative prose into
   `findings.md`, guided by `references/findings-prompt.md`; the script folds
   it into the template. Findings panels remain `contenteditable` in the HTML,
   matching `monthly-report`.
5. Optional browser preview and edit.
6. `render-pdf.sh` (or `.ps1` on Windows) produces the PDF.
7. Both artifacts are written to `~/Downloads/`.

## Queries

Per-instance queries carried over from v1, largely unchanged:

- page summary for the selected `view.instance_id`
- request waterfall for the selected `user_action.instance_id`
- exception events for the same instance

New aggregate queries, scoped to the page and timeframe rather than one
instance:

- **All Core Web Vitals percentiles** — p50/p75/p95 for LCP, FCP, CLS, INP,
  and TTFB. v1 reported percentiles for LCP only.
- **TTFB phase percentiles** — DNS, connection, waiting, request, and cache
  durations across sessions.
- **Resource-level aggregate**, grouped by `url.full` — session count, p75
  duration, p75 transfer size, and render-blocking status. This is the
  section that distinguishes a genuinely slow resource from one unlucky load,
  and it is the core of the aggregate work.
- **Third-party aggregate** by `url.domain` — request count, p75 total
  duration, p75 total transfer size.
- **Long tasks aggregate** — count and duration percentiles across sessions.
- **Errors aggregate** — HTTP 4xx/5xx and exception rates across sessions.
- **Browser and device split** — so a p75 driven by one browser is visible.

A representative instance near p75 LCP is still selected using v1's ±15%
range filter with a ±25% fallback. Its waterfall is labelled explicitly in
the report as a single example load, not a page-wide measurement.

## Timing correctness gate

`lib/normalize.mjs` is extracted from the v1 template so it runs headless
against a JSON fixture. Phase 1 ends with one instance rendered in the new
template. The maintainer diffs that render against the built-in Dynatrace
waterfall for the same instance, supplying query data and screenshots as
ground truth. Every discrepancy found is fixed and locked in as an assertion
in `test-normalize.mjs`.

No later phase begins until this gate passes. Building the aggregate sections
or a second renderer on unvalidated normalization would bake the same wrong
offsets into two places.

## Visual design

Strato design tokens are hand-written into the template as CSS custom
properties — colors, typography, and spacing. No npm dependency; only the
token values. Conventions are cross-checked against the `development:dt-ui-wizard`
skill in this repo. The maintainer finetunes the result.

## PDF constraints

The waterfall is interactive and wide, and does not survive a page break
cleanly. The HTML report carries the full interactive waterfall. The PDF
carries the aggregate sections plus a static print-CSS waterfall clipped to
the top N resources by duration. Rendering the full waterfall in the PDF
would require a landscape fold-out page and was rejected on appearance.

## Testing

- `scripts/test-normalize.mjs` — assert-based, no framework. Runs against a
  checked-in fixture captured from a real instance. Every timing discrepancy
  found during the Phase 1 gate becomes an assertion here.
- Manual verification of the rendered HTML and PDF at the end of each phase.

## Phases

0. Create the `feat/full-page-analysis-v2` worktree.
1. Port `normalize.mjs`, build the Strato-styled template, render one
   instance. **Validation gate** — maintainer diffs against the built-in
   waterfall; fixes are locked in as assertions.
2. Aggregate queries and the report sections they feed.
3. Deterministic findings rules plus `findings-prompt.md`.
4. PDF rendering path.
5. Rewrite `SKILL.md` as thin orchestration; bump the plugin version.

## Deferred work

**Synthesized aggregate waterfall.** Bars rendered from cross-session
resource p75 start times and durations rather than from one real session.
Deferred deliberately: it reuses the bar-layout and timing-normalization code
paths, so building it before the Phase 1 gate passes would duplicate any
error. Per-resource p75 figures delivered in Phase 2 carry most of the
analytical value on their own — the synthesized waterfall mainly adds visual
sequencing — so it may prove unnecessary.
