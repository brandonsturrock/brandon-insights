---
name: full-page-analysis
version: 2.0.0
description: Full page performance analysis for a Dynatrace RUM page — p75 LCP stats, TTFB breakdown, render-blocking resources, slow/heavy resources, third-party audit, long tasks, errors, and a self-contained HTML/PDF report with an interactive resource waterfall. Use when the user wants a complete picture of a page's load performance.
---

# Full Page Analysis

End-to-end RUM page performance analysis: LCP percentiles → representative instance
selection → full CWV/TTFB/request diagnosis → self-contained HTML report (with
interactive resource waterfall) → optional PDF export.

Uses `dtctl query` for all data access.

**Precondition:** `dtctl` must be configured with an active context. On every
normal run, check the current context and offer the user a chance to switch or
add one before proceeding (see **Context check** below).

---

## --install flag

If the user invokes this skill with `--install`, run the following checks and
fixes **before** proceeding to Step 0. Skip this section entirely on normal runs.

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

This opens the browser-based OAuth login flow. Tell the user to complete it and
confirm when done.

### 4. Check Node.js

```bash
node --version 2>/dev/null
```

If Node.js is not found, install it:

**Mac/Linux (Homebrew):**
```bash
brew install node
```

**Mac/Linux (no Homebrew):**
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs
```

**Windows:**
```powershell
winget install OpenJS.NodeJS
```

After install, verify with `node --version`. If it still fails, direct the user
to https://nodejs.org and stop.

### 5. Run doctor

```bash
dtctl doctor
```

Show the output. If any check fails, surface the error and tell the user to
resolve it before proceeding. Do not continue to Step 0 until `dtctl doctor`
passes cleanly.

### 6. Report

Tell the user: `dtctl` version installed, Node.js version, context name, and
environment URL. Then continue to Step 0.

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
## --no-preview flag

If the user invokes this skill with `--no-preview`, skip Step 7 entirely —
do not open the browser and do not ask the `AskUserQuestion`. Proceed
directly from Step 6 to Step 8 using the HTML built in Step 6 (in `/tmp`) as
the source; no user-saved copy will exist, so Step 8's Downloads-copy step
runs unconditionally.

---

## Data model

Anchor: **hard navigation user action**. Two IDs flow from the selected
instance: `user_action.instance_id` (`ua_instance`) scopes requests,
exceptions, and the action-duration query; `view.instance_id`
(`view_instance`) scopes the page summary (CWV metrics).

All query files live in `references/queries/` inside the skill base
directory (`<SKILL_BASE_DIR>`). `references/queries.md` is the authoritative
contract for every parameter name and output filename — consult it if
anything below is unclear or out of date.

---

## Step 0 — Mode selection

After the context check, use `AskUserQuestion` to ask how to proceed:

- **I have an instance ID** — user provides a known `user_action.instance_id`;
  skip to Step 1
- **Find one for me** — run the normal frontend → page → representative
  instance flow; continue to Step 2

---

## Step 1 — Instance ID path (skip if "Find one for me" chosen)

Ask the user for their `user_action.instance_id`. Set `UA_INSTANCE_ID`.

Run `fpa-resolve-instance.dql` with `timeframe=now()-7d`,
`ua_instance=UA_INSTANCE_ID`. If 0 records returned, retry with
`timeframe=now()-30d`.

If still 0 records, run `fpa-resolve-instance-type.dql` with the same
params to check whether the instance exists at all but is the wrong type:

- If this returns a record: tell the user **"This instance is a
  `{user_action.type}` event, not a hard navigation. This skill only
  supports hard navigation instances."** Then return to Step 0.
- If this also returns 0 records: tell the user the instance ID was not
  found in the last 30 days, then return to Step 0.

Set `TF` to whichever window returned results. Extract and set from the
returned record: `VIEW_INSTANCE_ID` (`view.instance_id`), `FRONTEND`
(`frontend.name`), `PAGE` (`page.detected_name`), and browser/device
metadata for later use in the report.

Tell the user: instance found, timeframe used, frontend, page name, and
instance LCP value.

**Continue directly to Step 4.** Skip Steps 2 and 3.

---

## Step 2 — Selection path: frontend and page (skip if instance ID given)

Use **last 7 days** (`timeframe=now()-7d`) unless the user specifies
otherwise. Set `TF` to the chosen value and use it for every query below.

Run `fpa-frontends.dql` with `timeframe=TF`. Use `AskUserQuestion` to let the
user pick one `frontend.name`. Show **at most 3 results at a time** plus a
4th option `"Show more..."`. If the user picks "Show more...", advance the
window by 3 and ask again (results 4–6 + "Show more..." if more remain, or
the remainder without "Show more..." if ≤ 3 left). Pass options in **exactly
the order the query returned them** (highest `hard_navs` first). Include the
count in each option label, e.g. `"My Frontend (12,450 hard navigations)"`.
Set `FRONTEND`.

Run `fpa-pages.dql` with `timeframe=TF`, `frontend=FRONTEND`. Same paging
rules (3 + "Show more...", exact query order, counts in labels, e.g.
`"/ (3,210 hard navigations)"`). Set `PAGE`.

---

## Step 3 — Selection path: representative instance

Run `fpa-lcp-baseline.dql` with `timeframe=TF`, `frontend=FRONTEND`,
`page=PAGE`. This returns `p50_lcp`, `p75_lcp`, `p95_lcp`, `hard_navs`. State
these to the user with status labels (LCP thresholds: ≤2500ms good,
2501–4000ms needs improvement, >4000ms poor).

Run `fpa-top-browser.dql` with the same params. Set `BROWSER` to the
returned `browser.name`.

Compute the selection window from `p75_lcp`:
- `low_bound = round(p75_lcp * 0.85)`
- `high_bound = round(p75_lcp * 1.15)`

Run `fpa-select-instance.dql` with `timeframe=TF`, `frontend=FRONTEND`,
`page=PAGE`, `browser=BROWSER`, `low_bound`, `high_bound`. The joins only
return instances that have a linked page_summary, at least one request, and a
navigation document request that returned under 400 — no separate validation
step needed. That last condition is what keeps error pages (a 403/500 served
as the document) out of the sample; such a load has a real LCP and would
otherwise be selectable, but its waterfall describes the error page, not the
page under analysis.

- If 0 rows returned: widen to `low_bound = round(p75_lcp * 0.75)`,
  `high_bound = round(p75_lcp * 1.25)` and retry once.
- If still 0: tell the user no instance with a linked page_summary, requests,
  and a successful document request was found near p75 for this browser. Ask whether to try a
  different browser or continue without a representative instance.

Set `UA_INSTANCE_ID` from `user_action.instance_id` and `VIEW_INSTANCE_ID`
from `view.instance_id`.

---

## Step 4 — Run the data queries

Derive `SLUG` from `PAGE` (replace `/`, `.`, spaces with `-`, strip leading
dashes; use `home` if `PAGE` is `/`). Create the data directory:

```bash
mkdir -p /tmp/fpa-SLUG
```

Run each of the 12 queries below (the four "Instance-scoped" plus eight
"Aggregate" rows in `references/queries.md` — that file is authoritative
for parameter names and output filenames; the list here is a pointer, not a
copy) as:

```bash
dtctl query -f <SKILL_BASE_DIR>/references/queries/<file>.dql --set <params> -o json --agent --spill=never | grep '^{' > /tmp/fpa-SLUG/<output>.json
```

The four instance-scoped queries take `timeframe=TF` plus `view_instance` or
`ua_instance` as `queries.md` specifies per file. The eight aggregate
queries all take `timeframe=TF`, `frontend=FRONTEND`, `page=PAGE`.

Background all 12 `dtctl query` invocations with `&`, then `wait` for them
all before proceeding.

- `--spill=never` forces rows inline (`result.kind == "records"`). If
  `dtctl` ever spills anyway, branch on `result.kind` per the dtctl skill
  and `dtctl inspect` the file instead of re-querying.
- `| grep '^{'` strips any warning lines `dtctl` emits on stdout before the
  JSON envelope — the envelope is always a single line starting with `{`.

---

## Step 5 — Author findings

Follow `<SKILL_BASE_DIR>/references/findings-prompt.md` for exact
instructions on reading the computed findings and writing analyst-notes
prose. Write the result to:

```
/tmp/fpa-SLUG/findings.md
```

The required heading is `## Analyst notes`. Note that `findings-prompt.md`
expects you to read the computed findings from the **rendered HTML** (Step
6), not from the raw query JSON — the raw counters are unparsed strings
until `build-report.mjs` coerces them. Run Step 6 once with an empty or
placeholder findings file first if you need to see `DATA.findings` before
writing prose, then rerun Step 6 after writing `findings.md`.

---

## Step 6 — Build the report

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs \
  --data /tmp/fpa-SLUG \
  --findings /tmp/fpa-SLUG/findings.md \
  --page-title "PAGE" \
  --out /tmp/full-page-analysis-SLUG-YYYY-MM-DD.html
```

This reads the canonical JSON filenames from the data directory, applies
the unit conversions and finding rules in `scripts/lib/normalize.mjs` and
`scripts/lib/findings.mjs`, and renders the standalone HTML report (KPI
cards, Core Web Vitals, resource waterfall, computed findings, analyst notes,
then the supporting resource/third-party/long-task/browser tables) with
the Strato tokens inlined. If `--findings` is omitted the
analyst-notes panel is left blank; do not omit it once Step 5 is done.

**The analyst-notes panel is directly editable in the browser.** The build
script injects `contenteditable` on every `exec-body` block plus a floating
**Save changes** button; clicking it downloads the current DOM — edits
included — to `~/Downloads/` under the exact filename passed to `--out`
(here, `full-page-analysis-SLUG-YYYY-MM-DD.html`, not the `/tmp` path). The
build output itself stays in `/tmp` specifically so that filename is free
in `~/Downloads` for the save button to use without colliding.

---

## Step 7 — Preview

**Skip this entire step if `--no-preview` was passed.** Proceed directly to
Step 8.

Open the HTML built in Step 6 for the user to review and edit:

**macOS:**
```bash
open /tmp/full-page-analysis-SLUG-YYYY-MM-DD.html
```

**Windows:**
```powershell
Start-Process /tmp/full-page-analysis-SLUG-YYYY-MM-DD.html
```

Then use `AskUserQuestion` with this prompt text: "The report is open in
your browser. The analyst notes panel is directly editable — click into it
and type. When you're done, click **Save changes** (bottom-right) to save
your edited copy to ~/Downloads. Then come back here and confirm."

- **Looks good — build the PDF** — proceed to Step 8; no edited copy exists,
  Step 8 will copy the `/tmp` build to `~/Downloads` itself
- **I edited and saved** — proceed to Step 8; the edited copy is already in
  `~/Downloads`
- **Regenerate analysis** — revise `/tmp/fpa-SLUG/findings.md`, rerun Step 6,
  and reopen

---

## Step 8 — Convert to PDF

Determine `SOURCE`: if `~/Downloads/full-page-analysis-SLUG-YYYY-MM-DD.html`
already exists (the user clicked **Save changes** in Step 7), that is the
edited copy — use it as-is. Otherwise no edited copy exists yet; copy the
`/tmp` build there first so the HTML artifact contract still holds:

```bash
[ -f ~/Downloads/full-page-analysis-SLUG-YYYY-MM-DD.html ] || \
  cp /tmp/full-page-analysis-SLUG-YYYY-MM-DD.html ~/Downloads/full-page-analysis-SLUG-YYYY-MM-DD.html
```

Then render the PDF from that `~/Downloads` copy — never from `/tmp` — so
an edit made in the browser is guaranteed to reach the PDF:

```bash
bash <SKILL_BASE_DIR>/assets/render-pdf.sh \
  ~/Downloads/full-page-analysis-SLUG-YYYY-MM-DD.html \
  ~/Downloads/full-page-analysis-SLUG-YYYY-MM-DD.pdf
```

**Windows** (PowerShell): use `assets/render-pdf.ps1` with the same two
arguments.

Tell the user the absolute paths to both files in `~/Downloads/`.
