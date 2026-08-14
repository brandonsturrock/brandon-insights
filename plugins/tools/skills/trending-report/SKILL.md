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
brew install dynatrace-oss/tap/dtctl > /dev/null 2>&1
```

**Mac/Linux (no Homebrew):**
```bash
curl -fsSL https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.sh | sh > /dev/null 2>&1
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

The 4 pre-written `.dql` files live in `references/queries/` inside the skill
base directory. Run each directly — no temp file needed:

```bash
dtctl query -f <SKILL_BASE_DIR>/references/queries/<query>.dql --set frontend="NAME" [--context NAME] -o json --agent --spill=never | grep '^{' > /tmp/<frontend>-trending-<YYYY-MM>/<canonical-filename>.json
```

Files and their canonical output names (contract for `build-report.mjs`):

| Query file | Output filename |
|---|---|
| `metrics-monthly.dql` | `metrics-monthly.json` |
| `cwv-monthly.dql` | `cwv-monthly.json` |
| `cwv-weekly.dql` | `cwv-weekly.json` |
| `browser-perf-monthly.dql` | `browser-perf-monthly.json` |

- **Output location:** use `/tmp/<frontend>-trending-<YYYY-MM>/` as the data
  directory (query JSONs and findings.txt) and
  `/tmp/<frontend>-trending-<YYYY-MM>.html` for the intermediate HTML. Only
  the final PDF goes to `~/Downloads/<frontend>-trending-<YYYY-MM>.pdf`.
- `--spill=never` forces rows inline (`result.kind == "records"`); these are
  all small pre-aggregated result sets. If `dtctl` ever spills anyway,
  branch on `result.kind` per the dtctl skill and `dtctl inspect` the file
  instead of re-querying.
- The `| grep '^{'` strips any warning lines dtctl emits on stdout before the
  JSON envelope (e.g. field-override warnings from timeseries queries). The
  JSON envelope is always a single line starting with `{`.

### 4. Generate findings

Follow `references/findings-prompt.md` (in this skill directory) for exact
instructions on reading the query JSON files and authoring the findings
narrative for the report. Write the result to:

```
/tmp/<frontend>-trending-<YYYY-MM>/findings.txt
```

### 5. Assemble the report

```bash
node scripts/build-report.mjs --type trending --frontend "NAME" \
  --data /tmp/<frontend>-trending-<YYYY-MM> \
  --findings /tmp/<frontend>-trending-<YYYY-MM>/findings.txt \
  --out /tmp/<frontend>-trending-<YYYY-MM>.html &>/dev/null
```

This reads the canonical JSON filenames from the data directory, applies the unit
conversions documented per-query in `references/queries.md`, and renders the
standalone HTML report (charts, tables, KPI cards) with the findings
narrative woven in.

The rendered HTML is self-contained (Chart.js inlined) and includes:
- `contenteditable` findings panels so the user can edit analysis text directly in the browser
- A floating **Save changes** button that downloads the edited HTML to `~/Downloads/<frontend>-trending-<YYYY-MM>.html`

**Browser selection (Trending report only):** the Browser Performance page
shows one panel per browser×device combo, 2 per row. `build-report.mjs`
always renders exactly 6 panel slots (default), ranked by the latest
month's visit count descending — empty slots render as blank cards. Pass
`--max-browsers <N>` to change the slot count. Don't try to fit every
browser the tenant has ever seen; long-tail browsers with negligible
traffic add noise, not signal.

### 6. Preview in browser

Open the HTML for the user to review and edit findings in-place:

**macOS:**
```bash
open /tmp/<frontend>-trending-<YYYY-MM>.html > /dev/null 2>&1
```

**Windows:**
```powershell
Start-Process /tmp/<frontend>-trending-<YYYY-MM>.html
```

Then use `AskUserQuestion` with the following options, including this prompt text:
"The report is open in your browser. The three findings panels on page 1 are editable — click into any panel and type. When you're done, click **Save changes** (bottom-right) to save your edits to ~/Downloads. Then come back here and confirm."

- **Looks good — build the PDF** — proceed to step 7 using `/tmp/<frontend>-trending-<YYYY-MM>.html`
- **I edited and saved** — proceed to step 7 using `~/Downloads/<frontend>-trending-<YYYY-MM>.html`
- **Regenerate analysis** — rewrite the findings (step 4) and rebuild the HTML (step 5), then reopen

### 7. Convert to PDF

Determine the source HTML based on the user's choice in step 6:
- **Looks good**: `SOURCE=/tmp/<frontend>-trending-<YYYY-MM>.html`
- **I edited and saved**: `SOURCE=~/Downloads/<frontend>-trending-<YYYY-MM>.html`

**macOS:**
```bash
bash assets/render-pdf.sh "$SOURCE" \
  ~/Downloads/<frontend>-trending-<YYYY-MM>.pdf &>/dev/null
```

**Windows** (PowerShell):
```powershell
pwsh assets/render-pdf.ps1 $SOURCE `
  ~/Downloads/<frontend>-trending-<YYYY-MM>.pdf *> $null
```

### 8. Clean up and report back

Delete the data directory, the /tmp HTML, and the edited HTML from ~/Downloads (if it exists):

**macOS / Linux:**
```bash
rm -rf /tmp/<frontend>-trending-<YYYY-MM>/ > /dev/null 2>&1
rm -f /tmp/<frontend>-trending-<YYYY-MM>.html > /dev/null 2>&1
rm -f ~/Downloads/<frontend>-trending-<YYYY-MM>.html > /dev/null 2>&1
```

**Windows:**
```powershell
Remove-Item -Recurse -Force /tmp/<frontend>-trending-<YYYY-MM>/ -ErrorAction SilentlyContinue
Remove-Item -Force /tmp/<frontend>-trending-<YYYY-MM>.html -ErrorAction SilentlyContinue
Remove-Item -Force ~/Downloads/<frontend>-trending-<YYYY-MM>.html -ErrorAction SilentlyContinue
```

Then tell the user the absolute path to the PDF in `~/Downloads/`.
