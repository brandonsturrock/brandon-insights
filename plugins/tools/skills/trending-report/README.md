# Trending Report

Generates a Dynatrace RUM monthly review report for a web frontend. Produces an HTML file (renderable to PDF) covering Core Web Vitals, traffic trends, device/browser breakdown, and error analysis — without requiring a dt-app deployment.

## Report types

| Type | Pages | Timeframe | Contents |
|---|---|---|---|
| **Trending** | 3 | Last 6 months | Traffic trends, CWV trends, device/browser breakdown |
| **Current-Month** | 4 | Last full calendar month | Daily traffic, CWV distribution/tiers, top pages, top errors |

Both can be generated in one run.

## Prerequisites

- [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with at least one context
- Node.js
- Google Chrome (for PDF rendering)

Run `/tools:trending-report --install` to set up all dependencies and authenticate.

## Usage

```
/tools:trending-report
```

The skill will:
1. Ask which frontend to analyze (or accept a name directly)
2. Ask whether to generate `trending`, `current-month`, or `both`
3. Run all required DQL queries via `dtctl`
4. Build the HTML report and open it in your browser

## Output

Saved to `~/Downloads/` as an HTML file. Open in Chrome and print to PDF for sharing.
