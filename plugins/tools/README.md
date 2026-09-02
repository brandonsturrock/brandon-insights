# Tools Plugin

Claude Code skills for Dynatrace RUM analysis workflows.

## Skills

| Skill | Description |
|---|---|
| [full-page-analysis](skills/full-page-analysis/README.md) | End-to-end page load diagnosis — LCP, TTFB, waterfall, recommendations |
| [monthly-report](skills/monthly-report/SKILL.md) | Current-month RUM review PDF — daily traffic, Core Web Vitals, top pages, top errors |
| [trending-report](skills/trending-report/README.md) | 6-month RUM trending PDF — traffic trends, Core Web Vitals over time, device/browser breakdown |
| [user-journeys](skills/user-journeys/README.md) | Interactive Sankey diagram of session paths from Dynatrace RUM |
| [setup](skills/setup/SKILL.md) | One-time dependency setup — installs dtctl, registers skills, authenticates environment |

## Prerequisites

All skills require [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with a Dynatrace environment context. Run any skill with `--install` to set up dependencies and authenticate.

## Installation

```
claude /plugin marketplace add brandonsturrock/brandon-insights
claude /plugin install tools@brandon-insights
```
Make sure to reload plugins after installation 

```
claude /reload-plugins
```

