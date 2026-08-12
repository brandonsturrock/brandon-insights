---
name: monthly-report
description: Generate a Dynatrace RUM current-month review PDF for a web frontend/application — daily traffic, Core Web Vitals distribution/tiers, top pages, and top errors for the last full calendar month. Use when the user asks for a "monthly report", "current month report", "monthly RUM review", "last month performance", "monthly review PDF", or a frontend/application's current-month deep-dive. Uses the dtctl CLI to query Grail and a local build script to assemble the PDF — no dt-app deployment needed.
---

# Dynatrace RUM Monthly Report

Reproduces the current-month page of the RUM monthly review PDF from a
dt-app's live pipeline using `dtctl query` + Claude-authored findings instead
of the app's React/Davis CoPilot stack.

**Current-Month** (4 pages): last full calendar month deep-dive — daily
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

If the user already named a frontend (e.g. "monthly report for checkout-web"),
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

### 2. Run the queries

Write all query bodies to temp `.dql` files, then **fire all 11 queries in
parallel** (they are fully independent):

```bash
dtctl query -f <query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never \
  | grep -m1 '^{' > <data-dir>/<canonical-filename>.json
```

- **Output location:** always write to `~/Downloads/` — never create output
  directories inside the project repo. Use
  `~/Downloads/<frontend>-monthly-<YYYY-MM>/` as the data directory (query
  JSONs and findings.md) and `~/Downloads/<frontend>-monthly-<YYYY-MM>.html`
  / `~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf` for the rendered files.
- Use the exact canonical filenames from the table at the top of
  `references/queries.md` (`metrics-monthly.json`, `cwv-monthly.json`, etc.)
  — the report-builder script and findings prompt both key off these names.
- `--spill=never` forces rows inline (`result.kind == "records"`); these are
  all small pre-aggregated result sets. If `dtctl` ever spills anyway,
  branch on `result.kind` per the dtctl skill and `dtctl inspect` the file
  instead of re-querying.
- **Warning line stripping:** `dtctl` may print one or more `Warning: ...`
  lines to stdout before the JSON envelope (e.g. scan-limit warnings, field
  override notices). Pipe through `grep -m1 '^{'` to extract only the JSON
  line. Without this, downstream JSON parsers will fail on the leading text.
- **Parallelism:** background all 11 `dtctl query` invocations with `&`, then
  `wait` for them all before proceeding. This cuts wall time roughly in half
  compared to sequential execution.

### 3. Generate findings

Follow `references/findings-prompt.md` (in this skill directory) for exact
instructions on reading the query JSON files and authoring the markdown
findings/narrative for the report. Write the result to a findings markdown
file in the same data directory (e.g. `<data-dir>/findings.md`).

### 4. Assemble the report

```bash
node scripts/build-report.mjs --type current-month --frontend "NAME" \
  --data ~/Downloads/<frontend>-monthly-<YYYY-MM> \
  --findings ~/Downloads/<frontend>-monthly-<YYYY-MM>/findings.md \
  --out ~/Downloads/<frontend>-monthly-<YYYY-MM>.html
```

This reads the canonical JSON filenames from the data directory, applies the unit
conversions documented per-query in `references/queries.md`, and renders the
standalone HTML report (charts, tables, KPI cards) with the findings
narrative woven in.

### 5. Convert to PDF

**macOS:**
```bash
bash assets/render-pdf.sh ~/Downloads/<frontend>-monthly-<YYYY-MM>.html \
  ~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf
```

**Windows** (PowerShell):
```powershell
pwsh assets/render-pdf.ps1 ~/Downloads/<frontend>-monthly-<YYYY-MM>.html `
  ~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf
```

### 6. Report back

Tell the user the absolute path to the PDF in `~/Downloads/`.
