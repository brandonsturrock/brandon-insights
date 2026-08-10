# Session Path Analysis (Sankey)

Interactive HTML Sankey diagram of user journeys from Dynatrace RUM session data.

## What it does

1. Picks a Dynatrace context and frontend app
2. Fetches session navigation events for a chosen time range
3. Generates a self-contained HTML file with an interactive Sankey diagram

## Modes

| Mode | Description |
|---|---|
| **Common User Journeys** | All session paths as a Sankey; top routes surfaced automatically |
| **Pick a Journey** | Define up to 8 specific steps; shows funnel dropout at each transition |

## Outputs

`session-sankey-{appname}-{date}.html` — self-contained HTML (no external dependencies, all d3 inlined)

## Features

- Hover any node to highlight all upstream paths that lead to it
- Session count + percentage overlay on hover
- Step breakdown table below the chart
- "Left Funnel" nodes show dropout at each Pick a Journey step

## Prerequisites

- [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with at least one context

## Usage

```
/tools:sankey-html
```
