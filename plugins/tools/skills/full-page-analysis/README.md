# Full Page Analysis

End-to-end RUM page performance diagnosis for a single Dynatrace-monitored page. Produces a prioritized markdown report and an interactive resource waterfall HTML file.

## What it does

1. Lets you pick a frontend and page (or supply a known instance ID directly)
2. Finds a representative session near the p75 LCP
3. Diagnoses that session across LCP, TTFB, render-blocking resources, slow/heavy resources, third-party scripts, long tasks, and errors
4. Saves a markdown report and an interactive waterfall to `~/Downloads/`

## Outputs

| File | Contents |
|---|---|
| `full-page-analysis-{page}-{date}.md` | Structured diagnosis + prioritized recommendations |
| `full-page-analysis-{page}-{date}.html` | Interactive resource waterfall with W3C timings |

## Prerequisites

- [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with at least one context
- Node.js (for waterfall HTML generation)

Run `/tools:full-page-analysis --install` to set up all dependencies and authenticate.

## Usage

```
/tools:full-page-analysis
```

Two entry points:

- **Find one for me** — browse frontends filtered to those with hard navigation events, pick a page, auto-select a representative instance near p75 LCP
- **I have an instance ID** — provide a `user_action.instance_id` directly; skill validates it's a hard navigation and resolves metadata automatically

## Report sections

- **LCP Summary** — p50 / p75 / p95 with status labels, LCP element tag + URL
- **TTFB Breakdown** — DNS, connection, waiting, request, cache phases
- **Render-Blocking Resources** — all blocking resources sorted by duration
- **Top Slow Resources** — top 10 by duration
- **Top Heavy Resources** — top 10 by transfer size, flags uncompressed responses
- **Third-Party Resources** — grouped by domain, total duration + size
- **Long Tasks** — count, avg duration, overlap with LCP window
- **Errors** — HTTP 4xx/5xx counts, failed requests, JS exceptions
- **Recommendations** — prioritized, evidence-backed, impact-labelled
