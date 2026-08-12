---
name: user-journeys
description: Generate a self-contained interactive HTML Sankey diagram from Dynatrace RUM session path data. Use when the user asks to visualize user journeys, session paths, or navigation flows from Dynatrace. Requires dtctl with user.events read access.
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
2. **Time range** — picked interactively in Step 0b (default: last 2h)
3. **Mode** — picked interactively in Step 1b (Common User Journeys or Pick a Journey)
4. **Output path** — default: `~/Downloads/session-sankey-<appname>-<date>.html`
5. **Max depth** — Common User Journeys only, default: 6 steps. Accept 3–10.

## Steps

### Step 0 — Confirm dtctl context

```bash
dtctl config current-context
```

If the command fails or returns empty, tell the user no context is configured and stop — they need to run `dtctl auth login` first.

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

### Step 0b — Pick a timeframe

Use `AskUserQuestion`:

> "What time range should we fetch session data for?"

Options:
- `Last 2 hours` (default)
- `Last 24 hours`
- `Last 7 days`

Map to DQL timeframe expressions:
- Last 2 hours → `now()-2h`
- Last 24 hours → `now()-24h`
- Last 7 days → `now()-7d`

Set `TF` to the chosen expression. Use `| timeframe from:TF` in all subsequent queries.

### Step 1 — Pick a frontend

Fetch all apps with session counts, sorted descending:

```bash
dtctl query "fetch user.events, from: TF | summarize sessions=count(), by: {frontend.name} | filterOut isNull(frontend.name) | sort sessions desc" -o json --plain
```

Show the first 10 results as a numbered list with session counts. Use `AskUserQuestion` with those 10 as options plus a **"Show more"** option.

If the user picks **Show more**, show the next 10 (offset 10), again with a Show more option at the bottom. Repeat until the list is exhausted or the user picks an app.

Once an app is selected, set `APP_NAME`.

### Step 1b — Pick a mode

Use `AskUserQuestion`:

> "Which visualization mode?"

Options:
- **Common User Journeys** — shows all session paths as a Sankey, top routes surfaced automatically
- **Pick a Journey** — define up to 6 specific steps; shows funnel dropout at each transition

If **Common User Journeys** → skip to Step 2.
If **Pick a Journey** → continue to Step 1c.

### Step 1c — Collect journey steps (Pick a Journey only)

**Ask the user to provide their funnel steps** — between 2 and 8 `view.name` values in order, one per message or all at once. Collect them into `FUNNEL_STEPS = ["step0", "step1", ...]`.

**Silently fetch the top 100 view names** for validation (do not display this list):

```bash
dtctl query "fetch user.events, from: TF | filter frontend.name == \"<APP_NAME>\" | filter characteristics.has_navigation == true | summarize count=count(), by: {view.name} | filterOut isNull(view.name) | sort count desc | limit 100" -o json --plain
```

**Validate each step against the top 100:**
- If it appears in the top 100 list → confirmed silently, continue.
- If it does not appear → run a targeted spot-check:
  ```bash
  dtctl query "fetch user.events, from: TF | filter frontend.name == \"<APP_NAME>\" | filter view.name == \"<STEP>\" | limit 1 | fields view.name" -o json --plain
  ```
  If this returns a record → confirmed (niche view, low volume), continue silently.
  If this returns empty → warn the user that this view name wasn't found in the data, and ask whether to correct it or proceed anyway.

Once all steps are validated, set `FUNNEL_STEPS` and continue to Step 2b.

### Step 2 — Fetch session events

Same query regardless of mode. Escape any double quotes in the app name with `\"`.

```bash
dtctl query "fetch user.events, from: TF | filter frontend.name == \"<APP_NAME>\" | filter characteristics.has_navigation == true | fields dt.rum.session.id, start_time, view.name | sort dt.rum.session.id, start_time asc" -o json --plain --max-result-records 50000 > /tmp/uj_records.json
```

Check if the result spilled to an external file:

```bash
node -e "const r=JSON.parse(require('fs').readFileSync('/tmp/uj_records.json','utf8')); console.log(r.result&&r.result.kind||'records')"
```

**If output is `result-file`:** overwrite with the spilled records:

```bash
RESULT_PATH=$(node -e "const r=JSON.parse(require('fs').readFileSync('/tmp/uj_records.json','utf8')); console.log(r.result.path)")
dtctl inspect "$RESULT_PATH" --head 50000 --fields "dt.rum.session.id,start_time,view.name" > /tmp/uj_records.json
```

If the file has more rows than `--head` allows, increase `--head` or note the truncation in the HTML subtitle.

Then go to Step 3 (Common User Journeys) or Step 3b (Pick a Journey).

### Step 3 — Generate the HTML file (Common User Journeys)

_Skip this step if mode is Pick a Journey — go to Step 3b._

Replace `SKILL_ROOT` with the absolute path to this skill's directory (the folder containing `scripts/` and `assets/`), `APP_NAME` with the selected app name, `MAX_DEPTH` with the chosen max depth (default 6), and `OUTPUT_PATH` with the output file path.

```bash
node SKILL_ROOT/scripts/build-sankey.mjs \
  --mode common \
  --records /tmp/uj_records.json \
  --app "APP_NAME" \
  --max-depth MAX_DEPTH \
  --out OUTPUT_PATH
```

The script downloads and caches d3 libs to `/tmp/brandon-insights-d3/` on first run. Template source: `assets/sankey-common.html.tmpl`.

### Step 3b — Generate the HTML file (Pick a Journey)

_Only used when mode is Pick a Journey._

Replace `SKILL_ROOT` with the absolute path to this skill's directory, `APP_NAME` with the selected app name, `FUNNEL_STEPS_JSON` with the validated funnel steps as a JSON array (e.g. `["/","/login","/home"]`), and `OUTPUT_PATH` with the output file path (default: `~/Downloads/session-journey-<appname>-<date>.html`).

```bash
node SKILL_ROOT/scripts/build-sankey.mjs \
  --mode journey \
  --records /tmp/uj_records.json \
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
- Time range used
- Whether data was truncated (spill hit row limit)
