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

## --no-preview flag

If the user invokes this skill with `--no-preview`, skip step 5 entirely —
do not open the browser and do not ask the `AskUserQuestion`. Proceed directly
from step 4 to step 6 using `/tmp/<frontend>-monthly-<YYYY-MM>.html` as the
source. The findings panels are still editable in the HTML (they are always
`contenteditable`), but the PDF is built immediately without waiting for review.

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
brew install dynatrace-oss/tap/dtctl > /dev/null 2>&1
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
dtctl config use-context "CHOSEN_CONTEXT" > /dev/null 2>&1
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

The 10 pre-written `.dql` files live in `references/queries/` inside the skill
base directory. Run each directly — no temp file needed:

```bash
dtctl query -f <SKILL_BASE_DIR>/references/queries/<query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never | grep '^{' > /tmp/<frontend>-monthly-<YYYY-MM>/<canonical-filename>.json
```

Files and their canonical output names (contract for `build-report.mjs`):

| Query file | Output filename |
|---|---|
| `cm-daily-device.dql` | `cm-daily-device.json` |
| `cm-daily-cwv.dql` | `cm-daily-cwv.json` |
| `cm-cwv-distribution.dql` | `cm-cwv-distribution.json` |
| `cm-top-pages.dql` | `cm-top-pages.json` |
| `cm-top-exceptions.dql` | `cm-top-exceptions.json` |
| `cm-top-request-errors.dql` | `cm-top-request-errors.json` |
| `cm-error-count.dql` | `cm-error-count.json` |
| `cm-errors.dql` | `cm-errors.json` |
| `cm-device-compare.dql` | `cm-device-compare.json` |
| `cm-cwv-tier.dql` | `cm-cwv-tier.json` |

- **Output location:** use `/tmp/<frontend>-monthly-<YYYY-MM>/` as the data
  directory (query JSONs and findings.txt) and
  `/tmp/<frontend>-monthly-<YYYY-MM>.html` for the intermediate HTML. Only
  the final PDF goes to `~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf`.
- `--spill=never` forces rows inline (`result.kind == "records"`); these are
  all small pre-aggregated result sets. If `dtctl` ever spills anyway,
  branch on `result.kind` per the dtctl skill and `dtctl inspect` the file
  instead of re-querying.
- The `| grep '^{'` strips any warning lines dtctl emits on stdout before the
  JSON envelope (e.g. field-override warnings from timeseries queries). The
  JSON envelope is always a single line starting with `{`.
- **Parallelism:** background all 10 `dtctl query` invocations with `&`, then
  `wait` for them all before proceeding.

### 3. Generate findings

Follow `references/findings-prompt.md` (in this skill directory) for exact
instructions on reading the query JSON files and authoring the findings
narrative for the report. Write the result to:

```
/tmp/<frontend>-monthly-<YYYY-MM>/findings.txt
```

### 4. Assemble the report

```bash
node scripts/build-report.mjs --type current-month --frontend "NAME" \
  --data /tmp/<frontend>-monthly-<YYYY-MM> \
  --findings /tmp/<frontend>-monthly-<YYYY-MM>/findings.txt \
  --out /tmp/<frontend>-monthly-<YYYY-MM>.html &>/dev/null
```

This reads the canonical JSON filenames from the data directory, applies the unit
conversions documented per-query in `references/queries.md`, and renders the
standalone HTML report (charts, tables, KPI cards) with the findings
narrative woven in.

The rendered HTML is self-contained (Chart.js inlined) and includes:
- `contenteditable` findings panels so the user can edit analysis text directly in the browser
- A floating **Save changes** button that downloads the edited HTML to `~/Downloads/<frontend>-monthly-<YYYY-MM>.html`

### 5. Preview in browser

**Skip this entire step if `--no-preview` was passed.** Proceed directly to
step 6 with `SOURCE=/tmp/<frontend>-monthly-<YYYY-MM>.html`.

Open the HTML for the user to review and edit findings in-place:

**macOS:**
```bash
open /tmp/<frontend>-monthly-<YYYY-MM>.html > /dev/null 2>&1
```

**Windows:**
```powershell
Start-Process /tmp/<frontend>-monthly-<YYYY-MM>.html
```

Then use `AskUserQuestion` with the following options, including this prompt text:
"The report is open in your browser. The findings panels are editable — click into any panel and type. When you're done, click **Save changes** (bottom-right) to save your edits to ~/Downloads. Then come back here and confirm."

- **Looks good — build the PDF** — proceed to step 6 using `/tmp/<frontend>-monthly-<YYYY-MM>.html`
- **I edited and saved** — proceed to step 6 using `~/Downloads/<frontend>-monthly-<YYYY-MM>.html`
- **Regenerate analysis** — rewrite the findings (step 3) and rebuild the HTML (step 4), then reopen

### 6. Convert to PDF

Determine the source HTML based on the user's choice in step 5:
- **Looks good** or **`--no-preview`**: `SOURCE=/tmp/<frontend>-monthly-<YYYY-MM>.html`
- **I edited and saved**: `SOURCE=~/Downloads/<frontend>-monthly-<YYYY-MM>.html`

**macOS:**
```bash
bash assets/render-pdf.sh "$SOURCE" \
  ~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf &>/dev/null
```

**Windows** (PowerShell):
```powershell
pwsh assets/render-pdf.ps1 $SOURCE `
  ~/Downloads/<frontend>-monthly-<YYYY-MM>.pdf *> $null
```

### 7. Clean up and report back

Delete the data directory, the /tmp HTML, and the edited HTML from ~/Downloads (if it exists):

**macOS / Linux:**
```bash
rm -rf /tmp/<frontend>-monthly-<YYYY-MM>/ > /dev/null 2>&1
rm -f /tmp/<frontend>-monthly-<YYYY-MM>.html > /dev/null 2>&1
rm -f ~/Downloads/<frontend>-monthly-<YYYY-MM>.html > /dev/null 2>&1
```

**Windows:**
```powershell
Remove-Item -Recurse -Force /tmp/<frontend>-monthly-<YYYY-MM>/ -ErrorAction SilentlyContinue
Remove-Item -Force /tmp/<frontend>-monthly-<YYYY-MM>.html -ErrorAction SilentlyContinue
Remove-Item -Force ~/Downloads/<frontend>-monthly-<YYYY-MM>.html -ErrorAction SilentlyContinue
```

Then tell the user the absolute path to the PDF in `~/Downloads/`.
