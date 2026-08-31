# Full Page Analysis

End-to-end RUM page performance diagnosis for a single Dynatrace-monitored page. Produces a standalone HTML report and a PDF, both saved to `~/Downloads/`.

## What it does

1. Lets you pick a frontend and page (or supply a known instance ID directly)
2. Finds a representative session near the p75 LCP
3. Runs a batch of cross-session aggregate queries (load volume, Core Web Vitals, TTFB phases, resources, third-party domains, long tasks, errors, browser/device) plus the instance-scoped queries for that one representative session
4. Computes deterministic findings from the aggregates, adds analyst-written prose, and renders both artifacts

## Outputs

| File | Contents |
|---|---|
| `full-page-analysis-{page}-{date}.html` | Standalone interactive report: findings, analyst notes, Core Web Vitals, TTFB phases, slowest/heaviest resources, third-party domains, long tasks and errors, browser/device breakdown, and a resource waterfall |
| `full-page-analysis-{page}-{date}.pdf` | Print rendering of the same report |

**All statistics in the report are cross-session aggregates** (p50/p75/p95 over every hard-navigation load matching the selected frontend and page in the chosen timeframe) — **except the resource waterfall**, which renders a single sampled page load. The waterfall shows the shape of one real timeline; it is not a page-wide measurement, and the report is explicit about not generalizing from it.

## Prerequisites

- [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with at least one context
- Node.js (bare `node`, no npm install required)
- Google Chrome (for PDF rendering)

Run `/tools:full-page-analysis --install` to set up all dependencies and authenticate.

## Usage

```
/tools:full-page-analysis
```

Two entry points:

- **Find one for me** — browse frontends filtered to those with hard navigation events, pick a page, auto-select a representative instance near p75 LCP
- **I have an instance ID** — provide a `user_action.instance_id` directly; skill validates it's a hard navigation and resolves metadata automatically

## Report sections

- **Findings** — deterministic rules fired against the aggregate data, plus analyst notes in prose
- **Core Web Vitals** — p50/p75/p95 LCP, FCP, INP, CLS, TTFB across all loads
- **Time to first byte phases** — DNS, connection, waiting, request, cache, at p75
- **Slowest resources** — resources ranked by p75 duration, with load-share and blocking counts
- **Heaviest resources** — resources ranked by p75 transfer size
- **Third-party domains** — grouped by domain, p75 duration and transfer size
- **Long tasks and errors** — long-task prevalence and duration, exception/4xx/5xx counts
- **Browser and device** — LCP p75 broken out by browser and device segment, flags outlier segments
- **Resource waterfall** — one representative sampled load, W3C timings, LCP marker, long-task overlay
