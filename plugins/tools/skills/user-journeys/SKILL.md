---
name: user-journeys
description: Generate a self-contained interactive HTML Sankey diagram from completed Dynatrace RUM session paths. Use when the user asks to visualize user journeys, session paths, or navigation flows from Dynatrace. Requires dtctl with user.events read access.
---

# Sankey HTML — Session Path Analysis

Generate a self-contained interactive HTML Sankey diagram from Dynatrace RUM session data.

**Prerequisites:** dtctl with a configured context. Missing dependencies: run `/tools:setup` (or `/setup` if installed standalone) and stop.

## OAuth failure handling

If **any** `dtctl` command in this skill returns an error containing `"token"` and `"not found"` or any other authentication error, notify the user their token has expired, run `dtctl auth login`, wait for the browser OAuth flow to complete, then retry the failed command before continuing.

## When to use

User asks to "generate a session path/sankey/journey HTML" or "visualize user journeys" from Dynatrace data.

## Inputs

Collect before starting:

1. **App name** — picked interactively in Step 1
2. **Time range** — picked interactively in Step 0b (default: yesterday's 12–2 PM Eastern peak window)
3. **Mode** — picked interactively in Step 1b (Common User Journeys or Pick a Journey)
4. **Output path** — default: `~/Downloads/session-sankey-<appname>-<date>.html`
5. **Max depth** — Common User Journeys only, default: 6 steps. Accept 3–10. The HTML also lets the viewer change steps (3–10) and pages per step (3–15) live.

## Steps

### Step 0 — Confirm dtctl context

```bash
dtctl config current-context
```

If the command fails or returns empty, tell the user no context is configured — they need to run `dtctl auth login` first.

Otherwise, get the environment URL:
```bash
dtctl config describe-context $(dtctl config current-context) --plain
```

Use `AskUserQuestion` with three options, where the first option names the current context and environment:

- **Continue with \<context-name\>** (`\<environment-url\>`) — proceed as-is
- **Switch context** — list available contexts and pick one
- **Add new context** — authenticate a new environment

**If switching:**

```bash
dtctl config get-contexts --plain
```

Use `AskUserQuestion` to let the user pick from the returned context names, then:

```bash
dtctl config use-context "CHOSEN_CONTEXT"
```

**If adding new context:**

Ask for:
- A **context name** (e.g. `production`, `staging`)
- Their **Dynatrace environment URL** (e.g. `https://abc12345.apps.dynatrace.com`)

Then run:

```bash
dtctl auth login --environment "ENV_URL" --context "CONTEXT_NAME"
```

Tell the user to complete the browser OAuth flow and confirm when done.

After switch or add, confirm the active context with `dtctl config current-context` before continuing.

### Step 0b — Pick a closed historical window

Use `AskUserQuestion`:

> "What completed time window should we analyze?"

Options:
- `2-hour peak window yesterday` (default) — 12:00–14:00 Eastern
- `24-hour window yesterday` — the previous completed Eastern calendar day
- `7-day window ending yesterday` — the seven completed Eastern calendar days ending yesterday

Pass `--timezone "America/New_York"` to every `dtctl query` command so calendar-aligned expressions use Eastern time:

- 2-hour peak window yesterday → `TF_FROM=-1d@d+12h`, `TF_TO=-1d@d+14h`
- 24-hour window yesterday → `TF_FROM=-1d@d`, `TF_TO=@d`
- 7-day window ending yesterday → `TF_FROM=-7d@d`, `TF_TO=@d`

Also set `TIME_RANGE_LABEL` to the concrete window in plain words, e.g. `Nov 11, 2026 12:00–14:00 ET` or `Nov 4–10, 2026 ET`. It is printed on the report so readers know what period they are looking at.

Use `from: TF_FROM, to: TF_TO` in all subsequent queries. Step 2 selects only sessions whose `start_time` and `end_time` both fall inside these bounds, so active and boundary-crossing sessions are excluded.

### Step 1 — Pick a frontend

Fetch all apps with eligible completed-session counts, sorted descending. `frontend.name` is an array on `user.sessions`, so expand it before grouping:

```bash
dtctl query "fetch user.sessions, from: TF_FROM, to: TF_TO | filter start_time >= TF_FROM and end_time <= TF_TO | expand frontend.name | filterOut isNull(frontend.name) | summarize sessions=count(), by: {frontend.name} | sort sessions desc" --timezone "America/New_York" -o json --plain
```

Show the first 10 results as a numbered list with session counts. Use `AskUserQuestion` with those 10 as options plus a **"Show more"** option.

If the user picks **Show more**, show the next 10 (offset 10), again with a Show more option at the bottom. Repeat until the list is exhausted or the user picks an app.

Once an app is selected, set `APP_NAME` and `ELIGIBLE_SESSIONS` to its session count from this list. The report uses it to show how many sessions are covered.

### Step 1b — Pick a mode

Use `AskUserQuestion`:

> "Which visualization mode?"

Options:
- **Common User Journeys** — shows all session paths as a Sankey, top routes surfaced automatically
- **Pick a Journey** — define up to 8 specific steps; shows funnel dropout at each transition

If **Common User Journeys** → skip to Step 2.
If **Pick a Journey** → continue to Step 1c.

### Step 1c — Collect journey steps (Pick a Journey only)

**Ask the user to provide their funnel steps** — between 2 and 8 page names in order, one per message or all at once. Collect them into `FUNNEL_STEPS = ["step0", "step1", ...]`. Page names are the `page` values defined in Step 2. Steps match exact raw page names (no ID grouping in this mode). Two identical consecutive steps can never match, because repeat views of the same page collapse into one step.

By default a session progresses when it reaches the steps **in order, with other pages allowed between** (`--funnel-match ordered`). Use `--funnel-match strict` only if the user asks for each step to be the very next page. The HTML can switch between the two either way.

**Silently fetch the top 100 page names** for validation (do not display this list):

```bash
dtctl query "fetch user.events, from: TF_FROM, to: TF_TO | filter frontend.name == \"<APP_NAME>\" | filter in(user_action.type, array(\"hard_navigation\", \"soft_navigation\")) | filter dt.rum.session.id in [fetch user.sessions, from: TF_FROM, to: TF_TO | filter in(frontend.name, \"<APP_NAME>\") | filter start_time >= TF_FROM and end_time <= TF_TO | fields dt.rum.session.id] | fieldsAdd page = if(user_action.type == \"hard_navigation\", coalesce(page.name, view.name), else: view.name) | filterOut isNull(page) | summarize count=count(), by: {page} | sort count desc | limit 100" --timezone "America/New_York" -o json --plain
```

**Validate each step against the top 100:**
- If it appears in the top 100 list → confirmed silently, continue.
- If it does not appear → run a targeted spot-check:
  ```bash
  dtctl query "fetch user.events, from: TF_FROM, to: TF_TO | filter frontend.name == \"<APP_NAME>\" | filter in(user_action.type, array(\"hard_navigation\", \"soft_navigation\")) | filter dt.rum.session.id in [fetch user.sessions, from: TF_FROM, to: TF_TO | filter in(frontend.name, \"<APP_NAME>\") | filter start_time >= TF_FROM and end_time <= TF_TO | fields dt.rum.session.id] | fieldsAdd page = if(user_action.type == \"hard_navigation\", coalesce(page.name, view.name), else: view.name) | filter page == \"<STEP>\" | limit 1 | fields page" --timezone "America/New_York" -o json --plain
  ```
  If this returns a record → confirmed (niche page, low volume), continue silently.
  If this returns empty → warn the user that this page name wasn't found in the data, and ask whether to correct it or proceed anyway.

Once all steps are validated, set `FUNNEL_STEPS` and continue to Step 2.

### Step 2 — Fetch timestamped paths by session

Same query regardless of mode. Escape any double quotes in the app name with `\"`. Select only completed sessions that both started and ended in the chosen window, then fetch their paths from that same window. `frontend.name` is an array on `user.sessions`, so use `in(frontend.name, "<APP_NAME>")` in the subquery. The result has one record per session: `session_id` and an unordered `views` array of `{view.name, timestamp}` records.

Paths are built from **navigation user actions**: `hard_navigation` (full page load) and `soft_navigation` (SPA route change). Apps without soft navigations simply have none, and the query works the same. Each step is labelled with `page`:
- **Hard navigations:** `page.name`, falling back to `view.name` when it is null.
- **Soft navigations:** `view.name`. On a soft navigation, `page.name` stays on the document that loaded the app (often `/` for every route), so `view.name` is the route the user landed on.

`user_action.name` is not used: for soft navigations it names the triggering click and the page it came from (e.g. `click on button on /cart`), not the destination. The `view.name` key inside the record carries `page`, which is the shape the builder expects.

`--no-agent` is required: in agent mode dtctl spills large results to a side file, clips long strings and can restructure the JSON. With it, the full result is written straight to the file.

```bash
dtctl query "fetch user.events, from: TF_FROM, to: TF_TO | filter frontend.name == \"<APP_NAME>\" | filter in(user_action.type, array(\"hard_navigation\", \"soft_navigation\")) | filter dt.rum.session.id in [fetch user.sessions, from: TF_FROM, to: TF_TO | filter in(frontend.name, \"<APP_NAME>\") | filter start_time >= TF_FROM and end_time <= TF_TO | fields dt.rum.session.id] | fieldsAdd page = if(user_action.type == \"hard_navigation\", coalesce(page.name, view.name), else: view.name) | fields dt.rum.session.id, start_time, page | fieldsAdd view_time = record(view.name = page, timestamp = start_time) | summarize views = collectArray(view_time), by: {session_id = dt.rum.session.id}" --timezone "America/New_York" -o json --plain --no-agent --max-result-records 50000 > /tmp/uj_sessions.json
```

`collectArray` order is not guaranteed, so the builder sorts each session's views by timestamp. Because the result is aggregated first, `--max-result-records 50000` caps session rows rather than individual user actions. When the cap is hit, the builder reports `"capped": true` and the HTML shows a partial-sample warning. Suggest a shorter window if the user needs full coverage.

Then go to Step 3 (Common User Journeys) or Step 3b (Pick a Journey).

### Step 3 — Generate the HTML file (Common User Journeys)

_Skip this step if mode is Pick a Journey — go to Step 3b._

Replace `SKILL_ROOT` with the absolute path to this skill's directory (the folder containing `scripts/` and `assets/`), `APP_NAME` with the selected app name, `MAX_DEPTH` with the chosen max depth (default 6), and `OUTPUT_PATH` with the output file path.

```bash
node SKILL_ROOT/scripts/build-sankey.mjs \
  --mode common \
  --records /tmp/uj_sessions.json \
  --app "APP_NAME" \
  --max-depth MAX_DEPTH \
  --time-range "TIME_RANGE_LABEL" \
  --eligible-sessions ELIGIBLE_SESSIONS \
  --out OUTPUT_PATH
```

URL-like view names are grouped by default: query strings, fragments and trailing slashes are dropped, and ID-like path segments (numbers, UUIDs, long hex or tokens, 4+ digit runs) become `{id}`, so `/product/123` and `/product/456` are one page. Add `--raw-views` only if the user wants exact view names. `--top N` (3–15, default 6) sets the starting pages per step.

The script downloads and caches d3 libs to `/tmp/brandon-insights-d3/` on first run, then prints a JSON summary of what was included. Template source: `assets/sankey.html.tmpl`; graph logic: `assets/sankey-core.js`.

### Step 3b — Generate the HTML file (Pick a Journey)

_Only used when mode is Pick a Journey._

Replace `SKILL_ROOT` with the absolute path to this skill's directory, `APP_NAME` with the selected app name, `FUNNEL_STEPS_JSON` with the validated funnel steps as a JSON array (e.g. `["/","/login","/home"]`), and `OUTPUT_PATH` with the output file path (default: `~/Downloads/session-journey-<appname>-<date>.html`).

```bash
node SKILL_ROOT/scripts/build-sankey.mjs \
  --mode journey \
  --records /tmp/uj_sessions.json \
  --app "APP_NAME" \
  --funnel-steps 'FUNNEL_STEPS_JSON' \
  --time-range "TIME_RANGE_LABEL" \
  --eligible-sessions ELIGIBLE_SESSIONS \
  --out OUTPUT_PATH
```

If the summary lists `missingSteps`, tell the user those views never appeared in the included sessions.

### Step 4 — Report

Use the builder's JSON summary. Do not compute these numbers yourself. Tell the user:
- Path to the generated HTML file (`out`)
- Mode used (Common User Journeys or Pick a Journey, and `funnelMatch` for journeys)
- Sessions included (`sessions`, out of `ELIGIBLE_SESSIONS`). For Pick a Journey also give `enteredFunnel` and `reachedPerStep`
- Navigations (`navigations`) and average per session (`avgNavigations`)
- Distinct pages (`distinct`, and `distinctRaw` before ID grouping if they differ)
- Time range used
- Whether the result was capped at the 50,000-session limit (`capped`)
