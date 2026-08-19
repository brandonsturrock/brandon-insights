# Session Path Analysis (Sankey)

Interactive HTML Sankey diagram of completed Dynatrace RUM session journeys.

## What it does

1. Picks a Dynatrace context, completed Eastern-time window, and frontend app
2. Selects sessions that started and ended inside that window
3. Fetches one timestamped navigation array per session
4. Sorts each path locally and generates a self-contained interactive Sankey

## Modes

| Mode | Description |
|---|---|
| **Common User Journeys** | Completed session paths as an eight-step Sankey; top routes surfaced automatically |
| **Pick a Journey** | Define up to 8 specific steps; shows funnel dropout at each transition |

## Outputs

`session-sankey-{appname}-{date}.html` — self-contained HTML (no external dependencies, all d3 inlined)

## Features

- Hover any node to highlight all upstream paths that lead to it
- Session count + percentage overlay on hover
- Step breakdown table below the chart
- "Left Funnel" nodes show dropout at each Pick a Journey step
- Historical defaults exclude active and boundary-crossing sessions

## Prerequisites

- [`dtctl`](https://github.com/dynatrace-oss/dtctl) configured with at least one context

## Usage

```
/tools:user-journeys
```
