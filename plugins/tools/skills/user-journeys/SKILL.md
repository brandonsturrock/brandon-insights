---
name: user-journeys
description: Generate a self-contained interactive HTML Sankey diagram from completed Dynatrace RUM session paths. Use when the user asks to visualize user journeys, session paths, or navigation flows from Dynatrace. Requires dtctl with user.events read access.
---

# Sankey HTML — Session Path Analysis

Generate a self-contained interactive HTML Sankey diagram from Dynatrace RUM session data.

## --install flag

If the user invokes this skill with `--install`, run the following checks and fixes **before** proceeding to Step 0. Skip this section entirely on normal runs.

### 1. Check dtctl binary

```bash
dtctl version
```

If the command fails (not found or exits non-zero), install using the first applicable method:

**Homebrew (Mac/Linux — check first):**
```bash
brew install dynatrace-oss/tap/dtctl
```

**Mac/Linux (no Homebrew):**
```bash
curl -fsSL https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.ps1 | iex
```

After install, verify with `dtctl version`. On Windows, if not found, open a new PowerShell session first — the installer may need a fresh session for PATH to take effect. If it still fails, tell the user and stop.

### 2. Install Claude skills

```bash
dtctl skills install --for claude
```

This registers dtctl's built-in Claude skills. Run unconditionally on `--install`.

### 3. Add environment context

Check if any contexts already exist:

```bash
dtctl config get-contexts
```

If contexts exist, skip this step — setup is complete.

If no contexts exist, ask the user for:
- A **context name** for this environment (e.g. `production`, `my-env`)
- Their **Dynatrace environment URL** (e.g. `https://abc12345.live.dynatrace.com`)

Then run:

```bash
dtctl auth login --environment "ENV_URL" --context-name "CONTEXT_NAME"
```

This opens the browser-based OAuth login flow. Tell the user to complete it and confirm when done.

### 4. Run doctor

```bash
dtctl doctor
```

Show the output. If any check fails, surface the error and tell the user to resolve it before proceeding. Do not continue to Step 0 until `dtctl doctor` passes cleanly.

### 5. Report

Tell the user: `dtctl` version installed, context name, and environment URL. Then continue to Step 0.

---

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
5. **Max depth** — Common User Journeys only, default: 8 steps. Accept 3–10.

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
dtctl auth login --environment "ENV_URL" --context-name "CONTEXT_NAME"
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

Use `from: TF_FROM, to: TF_TO` in all subsequent queries. Step 2 selects only sessions whose `start_time` and `end_time` both fall inside these bounds, so active and boundary-crossing sessions are excluded.

### Step 1 — Pick a frontend

Fetch all apps with eligible completed-session counts, sorted descending. `frontend.name` is an array on `user.sessions`, so expand it before grouping:

```bash
dtctl query "fetch user.sessions, from: TF_FROM, to: TF_TO | filter start_time >= TF_FROM and end_time <= TF_TO | expand frontend.name | filterOut isNull(frontend.name) | summarize sessions=count(), by: {frontend.name} | sort sessions desc" --timezone "America/New_York" -o json --plain
```

Show the first 10 results as a numbered list with session counts. Use `AskUserQuestion` with those 10 as options plus a **"Show more"** option.

If the user picks **Show more**, show the next 10 (offset 10), again with a Show more option at the bottom. Repeat until the list is exhausted or the user picks an app.

Once an app is selected, set `APP_NAME`.

### Step 1b — Pick a mode

Use `AskUserQuestion`:

> "Which visualization mode?"

Options:
- **Common User Journeys** — shows all session paths as a Sankey, top routes surfaced automatically
- **Pick a Journey** — define up to 8 specific steps; shows funnel dropout at each transition

If **Common User Journeys** → skip to Step 2.
If **Pick a Journey** → continue to Step 1c.

### Step 1c — Collect journey steps (Pick a Journey only)

**Ask the user to provide their funnel steps** — between 2 and 8 `view.name` values in order, one per message or all at once. Collect them into `FUNNEL_STEPS = ["step0", "step1", ...]`.

**Silently fetch the top 100 view names** for validation (do not display this list):

```bash
dtctl query "fetch user.events, from: TF_FROM, to: TF_TO | filter frontend.name == \"<APP_NAME>\" | filter characteristics.has_navigation == true | filter dt.rum.session.id in [fetch user.sessions, from: TF_FROM, to: TF_TO | filter in(frontend.name, \"<APP_NAME>\") | filter start_time >= TF_FROM and end_time <= TF_TO | fields dt.rum.session.id] | summarize count=count(), by: {view.name} | filterOut isNull(view.name) | sort count desc | limit 100" --timezone "America/New_York" -o json --plain
```

**Validate each step against the top 100:**
- If it appears in the top 100 list → confirmed silently, continue.
- If it does not appear → run a targeted spot-check:
  ```bash
  dtctl query "fetch user.events, from: TF_FROM, to: TF_TO | filter frontend.name == \"<APP_NAME>\" | filter view.name == \"<STEP>\" | filter dt.rum.session.id in [fetch user.sessions, from: TF_FROM, to: TF_TO | filter in(frontend.name, \"<APP_NAME>\") | filter start_time >= TF_FROM and end_time <= TF_TO | fields dt.rum.session.id] | limit 1 | fields view.name" --timezone "America/New_York" -o json --plain
  ```
  If this returns a record → confirmed (niche view, low volume), continue silently.
  If this returns empty → warn the user that this view name wasn't found in the data, and ask whether to correct it or proceed anyway.

Once all steps are validated, set `FUNNEL_STEPS` and continue to Step 2.

### Step 2 — Fetch timestamped paths by session

Same query regardless of mode. Escape any double quotes in the app name with `\"`. Select only completed sessions that both started and ended in the chosen window, then fetch their paths from that same window. `frontend.name` is an array on `user.sessions`, so use `in(frontend.name, "<APP_NAME>")` in the subquery. The result has one record per session: `session_id` and an unordered `views` array of `{view.name, timestamp}` records.

```bash
dtctl query "fetch user.events, from: TF_FROM, to: TF_TO | filter frontend.name == \"<APP_NAME>\" | filter characteristics.has_navigation == true | filter dt.rum.session.id in [fetch user.sessions, from: TF_FROM, to: TF_TO | filter in(frontend.name, \"<APP_NAME>\") | filter start_time >= TF_FROM and end_time <= TF_TO | fields dt.rum.session.id] | fields dt.rum.session.id, start_time, view.name | sort dt.rum.session.id asc, start_time asc | fieldsAdd view_time = record(view.name = view.name, timestamp = start_time) | summarize views = collectArray(view_time), by: {session_id = dt.rum.session.id}" --timezone "America/New_York" -o json --plain --max-result-records 50000 > /tmp/uj_sessions.json
```

`collectArray` order is not guaranteed. The builder sorts each session's `views` array by `timestamp` and converts it to the existing event-record format before rendering. The Sankey displays the chosen depth (eight by default) and marks paths that extend beyond it as continuing. Because the result is aggregated first, `--max-result-records 50000` caps session rows rather than individual navigation events.

Check if the result spilled to an external file:

```bash
node -e "const r=JSON.parse(require('fs').readFileSync('/tmp/uj_sessions.json','utf8')); console.log(r.result&&r.result.kind||'records')"
```

**If output is `result-file`:** overwrite with the spilled session rows:

```bash
RESULT_PATH=$(node -e "const r=JSON.parse(require('fs').readFileSync('/tmp/uj_sessions.json','utf8')); console.log(r.result.path)")
dtctl inspect "$RESULT_PATH" --head 50000 --fields "session_id,views" > /tmp/uj_sessions.json
```

If the result reaches 50,000 session rows, report that it may be truncated.

Then go to Step 3 (Common User Journeys) or Step 3b (Pick a Journey).

### Step 3 — Generate the HTML file (Common User Journeys)

_Skip this step if mode is Pick a Journey — go to Step 3b._

Replace `SKILL_ROOT` with the absolute path to this skill's directory (the folder containing `scripts/` and `assets/`), `APP_NAME` with the selected app name, `MAX_DEPTH` with the chosen max depth (default 8), and `OUTPUT_PATH` with the output file path.

```bash
node SKILL_ROOT/scripts/build-sankey.mjs \
  --mode common \
  --records /tmp/uj_sessions.json \
  --app "APP_NAME" \
  --max-depth MAX_DEPTH \
  --out OUTPUT_PATH
```

The default `MAX_DEPTH` is 8. The script downloads and caches d3 libs to `/tmp/brandon-insights-d3/` on first run. Template source: `assets/sankey-common.html.tmpl`.

### Step 3b — Generate the HTML file (Pick a Journey)

_Only used when mode is Pick a Journey._

Replace `SKILL_ROOT` with the absolute path to this skill's directory, `APP_NAME` with the selected app name, `FUNNEL_STEPS_JSON` with the validated funnel steps as a JSON array (e.g. `["/","/login","/home"]`), and `OUTPUT_PATH` with the output file path (default: `~/Downloads/session-journey-<appname>-<date>.html`).

```bash
node SKILL_ROOT/scripts/build-sankey.mjs \
  --mode journey \
  --records /tmp/uj_sessions.json \
  --app "APP_NAME" \
  --funnel-steps 'FUNNEL_STEPS_JSON' \
  --out OUTPUT_PATH
```

Template source: `assets/sankey-journey.html.tmpl`.

### Step 4 — Report

Tell the user:
- Path to the generated HTML file
- Mode used (Common User Journeys or Pick a Journey)
- Total sessions included (Pick a Journey: sessions that entered the funnel)
- Total navigations and average navigations per included session
- Time range used
- Whether data was truncated at the 50,000-session result limit
