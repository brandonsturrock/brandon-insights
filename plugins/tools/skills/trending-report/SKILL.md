---
name: trending-report
description: Generate a Dynatrace RUM monthly review PDF for a web frontend/application — Core Web Vitals, traffic trends, device/browser breakdown, and error analysis. Use when the user asks for a "monthly review", "RUM monthly report", "web performance PDF report", "trending report", "current month report", "Core Web Vitals report/PDF", or a frontend/application's monthly performance review. Uses the dtctl CLI to query Grail and a local build script to assemble the PDF — no dt-app deployment needed.
---

# Dynatrace RUM Monthly Review

Reproduces the monthly RUM review PDF from a dt-app's live pipeline using
`dtctl query` + Claude-authored findings instead of the app's React/Davis
CoPilot stack. Two report types:

- **Trending** (3 pages): 6-month traffic, Core Web Vitals, device and
  browser trends.
- **Current-Month** (4 pages): last full calendar month deep-dive — daily
  traffic, CWV distribution/tiers, top pages, top errors.

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

After install, verify with `dtctl version`. If it still fails, tell the user
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
fetch user.events, from: now()-6M
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

### 2. Resolve the report type

Ask (if not specified) whether the user wants `trending`, `current-month`, or
`both`.

### 3. Run the queries

For each query needed for the chosen report type (see the tab column in
`references/queries.md`), write the query body to a temp `.dql` file, then
run:

```bash
dtctl query -f <query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never > <data-dir>/<canonical-filename>.json
```

- Use a scratch/output directory convention consistent with dtctl's own
  spill/output conventions (e.g. `./trending-report-output/<frontend>/<date>/`).
- Use the exact canonical filenames from the table at the top of
  `references/queries.md` (`metrics-monthly.json`, `cwv-monthly.json`, etc.)
  — the report-builder script and findings prompt both key off these names.
- `--spill=never` forces rows inline (`result.kind == "records"`); these are
  all small pre-aggregated result sets. If `dtctl` ever spills anyway,
  branch on `result.kind` per the dtctl skill and `dtctl inspect` the file
  instead of re-querying.
- Trending report → queries 1–5 in `references/queries.md`. Current-Month
  report → queries 6–15. `both` → all 16 (query 0 always, once).

### 4. Generate findings

Follow `references/findings-prompt.md` (in this skill directory) for exact
instructions on reading the query JSON files and authoring the markdown
findings/narrative for the report. Write the result to a findings markdown
file in the same data directory (e.g. `<data-dir>/findings.md`).

### 5. Assemble the report

```bash
node scripts/build-report.mjs --type <trending|current-month|both> --frontend "NAME" --data <data-dir> --findings <data-dir>/findings.md --out <report.html>
```

This reads the canonical JSON filenames from `<data-dir>`, applies the unit
conversions documented per-query in `references/queries.md`, and renders the
standalone HTML report (charts, tables, KPI cards) with the findings
narrative woven in.

**Browser selection (Trending report only):** the Browser Performance page
shows one panel per browser×device combo, 2 per row (matching the live
app's layout). Real tenants can report 10+ distinct browsers/devices —
showing all of them doesn't fit a landscape A4 page and buries the ones
that actually matter. `build-report.mjs` ranks browser×device combos by
total visits summed across the whole period and keeps only the top N
(default 4, a 2×2 grid — measured to be the largest count that keeps each
panel's fonts/bars comfortably legible in one page). Pass `--max-browsers
<N>` to change it, but be aware raising it packs more, smaller panels into
the same fixed page area — verify the render still looks legible rather
than assuming a bigger number is strictly better. Don't try to fit every
browser the tenant has ever seen; a couple of long-tail browsers with
negligible traffic add noise, not signal.

### 6. Convert to PDF

**macOS:**
```bash
bash assets/render-pdf.sh <report.html> <report.pdf>
```

**Windows** (PowerShell):
```powershell
pwsh assets/render-pdf.ps1 <report.html> <report.pdf>
```

### 7. Report back

Tell the user the final absolute path(s) to the generated PDF(s) (one per
report type if `both` was requested).
