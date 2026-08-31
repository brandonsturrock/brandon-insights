# Writing analyst notes for a full-page-analysis report

You are the agent asked to add narrative prose to a full-page-analysis
report after `build-report.mjs` has already computed the deterministic
findings. This file is the contract for that prose.

## Output format

Write plain markdown with `## ` headings. `build-report.mjs` extracts
sections by case-insensitive substring match on the heading text — the same
mechanism `monthly-report` uses (`extractMarkdownSection` in
`scripts/build-report.mjs`) — so a heading only needs to *contain* the
matched words, not equal them exactly.

The only required heading is:

```
## Analyst notes
```

Anything you write under other headings is ignored by this skill; do not
invent additional sections expecting them to render.

Pass the file to the build with `--findings <file.md>`.

## What to read before writing

Read the computed findings from `DATA.findings` in the rendered report
(open the built HTML and inspect the `DATA` object, or run a short Node
script against the same data directory that imports `computeFindings` from
`scripts/lib/findings.mjs` and calls it with the same shape of data
`build-report.mjs` assembles). Each entry is
`{ id, severity, title, evidence }`, and `evidence` already contains every
number that finding fired on.

## The one failure mode this file exists to prevent

Prose that just says the same thing the computed findings already say, in
sentences, is worthless — the reader can already see the finding row. Two
specific mistakes to avoid:

- **Restating.** Do not write "LCP p75 is 4200ms, which is above the 2500ms
  threshold" — that sentence is already in the `evidence` field for
  `slow-lcp`. Write about what to *do* about it, or how findings relate to
  each other (e.g. that `slow-lcp` and `render-blocking` firing on the same
  CSS file are probably the same root cause), not the numbers a second time.
- **Inventing.** Do not cite a number that is not present anywhere in the
  query output. If you want to say "this is worse than last month," you need
  last month's number in the data — if it isn't there, do not say it. A
  plausible-sounding number the report cannot back up is worse than no
  number at all.

If a section of the page has no findings, it is fine — even preferred — to
say nothing about it rather than manufacture a paragraph.

## Core Web Vitals thresholds

Copied from `THRESHOLDS` in `scripts/lib/findings.mjs` so the two documents
cannot drift. Cite these, don't re-derive or approximate them:

| Metric | Good | Poor |
|---|---|---|
| LCP  | under 2500ms | over 4000ms |
| INP  | under 200ms  | over 500ms  |
| CLS  | under 0.1    | over 0.25   |
| TTFB | under 800ms  | — |
| FCP  | under 1800ms | over 3000ms |

TTFB has no published "poor" boundary from web.dev. The report treats
anything over 1800ms as higher severity internally, but that is a report
convention, not a Core Web Vitals figure — do not cite 1800ms as TTFB's
"poor" threshold in prose.

## Formatting numbers in prose

Match the report's own formatting exactly, so a number you write reads as
the same fact as the number in the table above it:

- Milliseconds under 1000: `123ms`.
- Milliseconds 1000 and over: `1.23s`.
- CLS: three decimal places, e.g. `0.083`.
- Null / not measured: an em dash `—`, never `0`. A metric the tenant didn't
  report is not the same claim as a metric that measured zero.

## The waterfall is one load, not the page

The resource waterfall panel renders a single sampled page load. It is
useful for seeing *what* happened in one concrete instance — which resource
blocked which, the shape of one real timeline — but it is one data point.
Never write a sentence that generalizes from what the waterfall shows (for
example, "the hero image loads last" or "there's a long gap before the
third-party script fires") as if it describes the page in general. Every
generalizing claim — "this happens on most loads," "this is typical," "this
is a page-wide problem" — must come from one of the aggregate sections (Core
Web Vitals, resources, third-party, long tasks, errors, browser/device) or
from the computed findings, never from the waterfall alone.
