# Tools Plugin

Claude Code skills for Dynatrace RUM analysis workflows.

## Skills

| Skill | Description |
|---|---|
| [full-page-analysis](skills/full-page-analysis/README.md) | End-to-end page load diagnosis — LCP, TTFB, waterfall, recommendations |
| [monthly-report](skills/monthly-report/README.md) | Current-month RUM review PDF — daily traffic, Core Web Vitals, top pages, top errors |
| [trending-report](skills/trending-report/README.md) | 6-month RUM trending PDF — traffic trends, Core Web Vitals over time, device/browser breakdown |
| [user-journeys](skills/user-journeys/README.md) | Interactive Sankey diagram of session paths from Dynatrace RUM |
| [setup](skills/setup/SKILL.md) | One-time dependency setup — installs dtctl, registers skills, authenticates environment |

## Changes

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version. Releasing: bump `version` in `.claude-plugin/plugin.json` and add a CHANGELOG entry in the same commit.

## Installation

From a shell:

```bash
claude plugin marketplace add brandonsturrock/brandon-insights
claude plugin install tools@brandon-insights
```

Or inside Claude Code:

```
/plugin marketplace add brandonsturrock/brandon-insights
/plugin install tools@brandon-insights
/reload-plugins
```

## Prerequisites

Run `/tools:setup` once. It installs and checks the dependencies the skills need ([`dtctl`](https://github.com/dynatrace-oss/dtctl), Node.js, a Chromium browser, Git for Windows on Windows) and authenticates a Dynatrace environment context.
