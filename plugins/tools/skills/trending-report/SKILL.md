---
name: trending-report
description: Generate a Dynatrace RUM 6-month trending PDF for a web frontend/application — traffic trends, Core Web Vitals over time, and device/browser breakdown. Use when the user asks for a "trending report", "6-month report", "traffic trends", "CWV trends", "browser trends", "device trends", or a frontend/application's 6-month performance trend. Uses the dtctl CLI to query Grail and a local build script to assemble the PDF — no dt-app deployment needed.
---

# Dynatrace RUM Monthly Review

Reproduces the trending section of the RUM monthly review PDF from a dt-app's
live pipeline using `dtctl query` + Claude-authored findings instead of the
app's React/Davis CoPilot stack.

**Trending** (3 pages): 6-month traffic, Core Web Vitals, device and browser
trends.

For the current-month deep-dive (daily traffic, CWV tiers, top pages, top
errors), use the `monthly-report` skill instead.

**Precondition:** `dtctl` must be configured with an active context. On every
normal run, check the current context and offer the user a chance to switch or
add one before proceeding (see **Context check** below).

---

## --install flag

If the user invokes this skill with `--install`, run the following checks and
fixes **before** proceeding to the normal workflow. Skip this section entirely
on normal runs.

### 1. Check dtctl binary

```bash
dtctl version
```

If the command fails (not found or exits non-zero), install using the first
applicable method:

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

After install, verify with `dtctl version`. On Windows, if not found, open a new PowerShell session first — the installer may need a fresh session for PATH to take effect. If it still fails, tell the user
and stop.

### 2. Check Node.js

```bash
node --version
```

If missing:
- **Mac/Linux (Homebrew):** `brew install node`
- **Windows:** `winget install OpenJS.NodeJS`

### 3. Check Google Chrome

Chrome is required for PDF rendering.

- **macOS:** `[ -d "/Applications/Google Chrome.app" ]`
  If missing: `brew install --cask google-chrome`
- **Windows:** `Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"`
  If missing: `winget install Google.Chrome`

### 4. Add environment context

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

This opens the browser-based OAuth login flow. Tell the user to complete it and
confirm when done.

### 5. Run doctor

```bash
dtctl doctor
```

Show the output. If any check fails, surface the error and tell the user to
resolve it before proceeding.

### 6. Report

Tell the user: `dtctl` version installed, Node.js version, Chrome status, context
name, and environment URL. Then stop — do not continue to the normal workflow.

---

## Context check (normal runs only)

```bash
dtctl config current-context
```

If the command fails or returns empty, tell the user no context is configured
and stop — they should run with `--install` first.

Otherwise, tell the user the current context name and ask what they'd like to do
using `AskUserQuestion` with three options:
- **Continue** — proceed with the current context
- **Switch context** — list available contexts and let them pick one
- **Add new context** — prompt for a name and environment URL, authenticate, then proceed

**If switching:**

```bash
dtctl config get-contexts
```

Show the list. Use `AskUserQuestion` to let the user pick one, then:

```bash
dtctl config use-context "CHOSEN_CONTEXT"
```

**If adding new context:**

Ask for:
- A **context name** (e.g. `production`, `staging`)
- Their **Dynatrace environment URL** (e.g. `https://abc12345.live.dynatrace.com`)

Then run:

```bash
dtctl auth login --environment "ENV_URL" --context-name "CONTEXT_NAME"
```

Tell the user to complete the browser OAuth flow and confirm when done.

After switch or add, confirm the active context with `dtctl config current-context`
before continuing.

---

## Workflow

### 1. Resolve the frontend

If the user already named a frontend (e.g. "trending report for checkout-web"),
use it directly and skip this step.

Otherwise run:

```bash
dtctl query --agent --spill=never -o json -f - <<'EOF'
fetch user.events, from: now()-7d
| filter isNotNull(frontend.name)
| summarize sessions = count(), by: {frontend.name}
| sort sessions desc
| limit 30
EOF
```

Present the returned `frontend.name` values with `AskUserQuestion`. Show **at
most 3 at a time** plus a 4th option `"Show more..."`. If the user picks "Show
more...", advance the window by 3 and ask again. Highest sessions first. Set
`FRONTEND`.

### 2. Run the queries

For each query needed for the chosen report type (see the tab column in
`references/queries.md`), write the query body to a temp `.dql` file, then
run:

```bash
dtctl query -f <query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never | grep '^{' > <data-dir>/<canonical-filename>.json
```

- **Output location:** always write to `~/Downloads/` — never create output
  directories inside the project repo. Use
  `~/Downloads/<frontend>-trending-<YYYY-MM>/` as the data directory (query
  JSONs and findings.md) and `~/Downloads/<frontend>-trending-<YYYY-MM>.html`
  / `~/Downloads/<frontend>-trending-<YYYY-MM>.pdf` for the rendered files.
- Use the exact canonical filenames from the table at the top of
  `references/queries.md` (`metrics-monthly.json`, `cwv-monthly.json`, etc.)
  — the report-builder script and findings prompt both key off these names.
- `--spill=never` forces rows inline (`result.kind == "records"`); these are
  all small pre-aggregated result sets. If `dtctl` ever spills anyway,
  branch on `result.kind` per the dtctl skill and `dtctl inspect` the file
  instead of re-querying.
- The `| grep '^{'` strips any warning lines dtctl emits on stdout before the
  JSON envelope (e.g. field-override warnings from timeseries queries). The
  JSON envelope is always a single line starting with `{`.
- Run all 4 queries from `references/queries.md` (queries 1–4).

### 4. Generate findings

Follow `references/findings-prompt.md` (in this skill directory) for exact
instructions on reading the query JSON files and authoring the markdown
findings/narrative for the report. Write the result to a findings markdown
file in the same data directory (e.g. `<data-dir>/findings.md`).

### 5. Assemble the report

```bash
node scripts/build-report.mjs --type trending --frontend "NAME" \
  --data ~/Downloads/<frontend>-trending-<YYYY-MM> \
  --findings ~/Downloads/<frontend>-trending-<YYYY-MM>/findings.md \
  --out ~/Downloads/<frontend>-trending-<YYYY-MM>.html &>/dev/null
```

This reads the canonical JSON filenames from the data directory, applies the unit
conversions documented per-query in `references/queries.md`, and renders the
standalone HTML report (charts, tables, KPI cards) with the findings
narrative woven in.

**Browser selection (Trending report only):** the Browser Performance page
shows one panel per browser×device combo, 2 per row. `build-report.mjs`
always renders exactly 6 panel slots (default), ranked by the latest
month's visit count descending — empty slots render as blank cards. Pass
`--max-browsers <N>` to change the slot count. Don't try to fit every
browser the tenant has ever seen; long-tail browsers with negligible
traffic add noise, not signal.

### 6. Convert to PDF

**macOS:**
```bash
bash assets/render-pdf.sh ~/Downloads/<frontend>-trending-<YYYY-MM>.html \
  ~/Downloads/<frontend>-trending-<YYYY-MM>.pdf &>/dev/null
```

**Windows** (PowerShell):
```powershell
pwsh assets/render-pdf.ps1 ~/Downloads/<frontend>-trending-<YYYY-MM>.html `
  ~/Downloads/<frontend>-trending-<YYYY-MM>.pdf *> $null
```

### 7. Report back

Tell the user the absolute path to the PDF in `~/Downloads/`.
