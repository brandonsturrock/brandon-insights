# Tools Plugin

Claude Code skills for Dynatrace RUM analysis workflows.

## Skills

| Skill | Description |
|---|---|
| [full-page-analysis](skills/full-page-analysis/README.md) | End-to-end page load diagnosis — LCP, TTFB, waterfall, recommendations |
| [trending-report](skills/trending-report/README.md) | Monthly RUM review report — Core Web Vitals, traffic trends, errors |

## Prerequisites

All skills require [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with a Dynatrace environment context. Run any skill with `--install` to set up dependencies and authenticate.

## Installation

```
/plugin marketplace add brandonsturrock/brandon-insights
/plugin install tools@brandon-insights
```
