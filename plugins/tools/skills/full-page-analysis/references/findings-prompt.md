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

## Length is a hard constraint, not a guideline

The notes render in a half-width card beside the findings list. Prose written
to fill a page overruns it, and a reader who has to work through six lines to
reach one recommendation stops reading.

- **At most 5 bullets.** Fewer is better. Four findings do not require four
  bullets — if two share a cause, that is one bullet.
- **One claim per bullet, under 30 words.** Two short sentences at the very
  most. If a bullet needs a third, it is carrying two claims: cut one or split
  it.
- **Lead with the verdict or the action, not the setup.** "Fix the retry loop
  first; the long tasks follow from it" beats "The two findings worth acting on
  are errors and long-tasks, and they are likely related, because..."
- **No number that is already in the evidence line above.** The reader has it.
  Cite a figure only when it is the reason two findings connect, and then cite
  the one figure, not the derivation.
- **No hedging clauses.** "worth noting", "it is worth distrusting", "arguably",
  "generally" — cut them all. State the thing or leave it out.
- **Say nothing about sections with no findings.** An absent problem needs no
  paragraph explaining that it is absent. One short bullet is fine when a clean
  result actively changes what someone should do (for example, that the critical
  path is clean, so nobody should spend time there); a tour of everything that
  is fine is not.

## What to read before writing

Read the computed findings from the build script:

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --data <data-dir> --print-findings
```

Each entry is `{ id, severity, title, evidence }`, and `evidence` already
contains every number that finding fired on. The same array is embedded as
`DATA.findings` in a rendered report, if you happen to have one open.

Do not hand-call `computeFindings` yourself against the raw `--data`
directory. Raw dtctl query output carries every counter (`loads`,
`blocking`, `requests`, and the rest) as a JSON *string*, not a number —
`build-report.mjs` coerces every one of them through its own `num()` before
`computeFindings` ever sees them. A hand-rolled call skips that coercion and
can silently produce different findings than the ones actually in the
report. `--print-findings` runs the same coercion the report does, which is
what makes it trustworthy.

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

## Prevalence and the other rule-only thresholds

These also come from `THRESHOLDS` in `scripts/lib/findings.mjs`, and they
are the reason a dramatic per-resource number can legitimately be absent
from `DATA.findings` — the most important thing to understand before
writing prose about resources, because it is the difference between a
page-wide problem and one unlucky load:

- `prevalence.widespread` (**0.5**) — a resource, third-party domain, or
  render-blocker must appear on at least this share of loads (or, for
  blocking, of its own requests) before a rule will fire on it at all. A
  resource with a 10-second p75 that shows up on 11 of 77,000 loads does
  not describe the page and correctly produces **no finding** — if you see
  a striking outlier in the raw resource data that isn't in `DATA.findings`,
  this is almost always why. Do not write it up as if it were a page-wide
  problem; if it's worth a mention at all, say explicitly that it affects a
  small number of loads.
- `prevalence.rare` (**0.05**) — below this share, the report's own tables
  mark a row "rare." Distinct from `widespread`: this is the tables'
  labelling threshold, not a findings gate.
- `resourceSlowMs` (**500**) — the p75 duration a resource must clear, on
  top of being widespread, for `slow-resources`. `render-blocking` has no
  duration floor — a resource blocking on most of its own requests fires
  regardless of how fast it is; this threshold only raises its severity to
  "high" once its p75 duration clears it.
- `thirdPartySlowMs` (**200**) — same idea for `slow-third-party`.
- `errorRate` (**0.05**) — share of loads with at least one error before
  `errors` fires at all.
- `segmentRatio` (**1.5**) / `segmentMinShare` (**0.05**) — a browser/device
  segment fires `segment-outlier` only if its LCP p75 is at least 1.5x the
  blended p75 *and* it carries at least 5% of loads.

## Formatting numbers in prose

Match the report's own formatting exactly, so a number you write reads as
the same fact as the number in the table it refers to:

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
