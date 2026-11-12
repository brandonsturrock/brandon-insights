# Session Path Analysis (Sankey)

Interactive HTML Sankey diagram of completed Dynatrace RUM session journeys.

## What it does

1. Picks a Dynatrace context, completed Eastern-time window, and frontend app
2. Selects sessions that started and ended inside that window
3. Fetches one timestamped array of navigation user actions per session (hard page loads + soft SPA route changes), labelled by `page.name` for hard navigations and `view.name` for soft navigations
4. Sorts each path locally and generates a self-contained interactive Sankey

## Modes

| Mode | Description |
|---|---|
| **Common User Journeys** | Completed session paths as a Sankey (6 steps by default, adjustable 3–10 in the page); top pages per step, the rest grouped as Other |
| **Pick a Journey** | Define up to 8 specific steps; shows where sessions stop at each step (exited vs. went elsewhere). Steps match in order with detours allowed, or strictly consecutive |

## Outputs

`session-sankey-{appname}-{date}.html` — self-contained HTML (no external dependencies, all d3 inlined). Embeds grouped session paths rather than raw events, so files stay small on large apps.

## Features

- Hover or click any node or link to trace only the sessions that pass through it, upstream and downstream, at their true width
- Hover panel: session count, share, where those sessions went next, and what an Other node contains
- Live controls: pages per step and steps (common), step matching (journey)
- ID-like URL segments grouped as `{id}` so real-world URLs don't splinter into thousands of pages (`--raw-views` to disable)
- Time window, coverage and partial-sample warnings printed on the page
- Step breakdown table below the chart
- Historical defaults exclude active and boundary-crossing sessions

## Prerequisites

- [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with at least one context

## Usage

```
/tools:user-journeys
```
