---
name: full-page-analysis
version: 1.0.0
description: Full page performance analysis for a Dynatrace RUM page — p75 LCP stats, TTFB breakdown, render-blocking resources, slow/heavy resources, third-party audit, long tasks, errors, prioritized recommendations, saved markdown report, and an interactive resource waterfall HTML. Combines rum-lcp-analysis and dt-waterfall into a single end-to-end flow. Use when the user wants a complete picture of a page's load performance.
---

# Full Page Analysis

End-to-end RUM page performance analysis: LCP percentiles → representative instance
selection → full CWV/TTFB/request diagnosis → saved markdown report → interactive
waterfall HTML.

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

After install, verify with `dtctl version`. If it still fails, tell the user
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

## Data model

Anchor: **hard navigation user action** (`characteristics.has_user_action == true`,
`user_action.type == "hard_navigation"`). Two IDs flow from the selected instance:

- `user_action.instance_id` → scope all **requests**, exceptions — filter as plain string (`== "ID"`)
- `view.instance_id` → scope the **page summary** (CWV metrics) — filter with `toUid()` (`== toUid("ID")`)

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

## Step 0 — Timeframe

Use **last 7 days** (`from: now()-7d`) unless the user specifies otherwise.
Substitute `TF` for the chosen `from:` expression throughout.

---

## Step 1 — Pick a frontend

```dql
fetch user.events, from: TF
| filter isNotNull(frontend.name)
| summarize sessions = count(), by: {frontend.name}
| sort sessions desc
| limit 30
```

Show results. Use `AskUserQuestion` to let the user pick one `frontend.name`.
Set `FRONTEND`.

### 1b — Agent version check

```dql
fetch user.events, from: TF
| filter frontend.name == "FRONTEND"
| filter isNotNull(dt.rum.agent.version)
| summarize count(), by: {dt.rum.agent.version}
| sort `count()` desc
| limit 10
```

Parse each `dt.rum.agent.version` as a number. If **no version ≥ 1.339 exists**,
warn the user: hard navigation events require agent ≥ 1.339 and may not be
present. Ask whether to continue anyway or pick a different frontend.

---

## Step 2 — Pick a page

```dql
fetch user.events, from: TF
| filter frontend.name == "FRONTEND"
| filter characteristics.has_user_action == true
| filter user_action.type == "hard_navigation"
| filter lcp.status == "reported"
| summarize hard_navs = count(), by: {page.detected_name}
| filterOut isNull(page.detected_name)
| sort hard_navs desc
| limit 20
```

Use `AskUserQuestion` to let the user pick one `page.detected_name`. Set `PAGE`.

---

## Step 3 — p75 LCP + volume baseline

```dql
fetch user.events, from: TF
| filter frontend.name == "FRONTEND"
| filter page.detected_name == "PAGE"
| filter characteristics.has_user_action == true
| filter user_action.type == "hard_navigation"
| filter lcp.status == "reported"
| summarize
    p75_lcp = percentile(lcp.render_time, 75),
    p50_lcp = percentile(lcp.render_time, 50),
    p95_lcp = percentile(lcp.render_time, 95),
    count   = count()
```

`lcp.render_time` is in milliseconds. LCP thresholds:
- ≤ 2500 ms → good
- 2501–4000 ms → needs improvement
- > 4000 ms → poor

State p75/p50/p95 and status before continuing.

---

## Step 4 — Select a representative instance

### 4a — Most common browser

```dql
fetch user.events, from: TF
| filter frontend.name == "FRONTEND"
| filter page.detected_name == "PAGE"
| filter characteristics.has_user_action == true
| filter user_action.type == "hard_navigation"
| filter lcp.status == "reported"
| summarize count(), by: {browser.name}
| sort `count()` desc
| limit 1
```

Set `BROWSER` to the top `browser.name`.

### 4b — Instance closest to p75 LCP

**Do NOT use `abs()`** — DQL returns null for arithmetic on string-typed numeric
fields. Use a ±15% range filter; widen to ±25% if no rows return.

```dql
fetch user.events, from: TF
| filter frontend.name == "FRONTEND"
| filter page.detected_name == "PAGE"
| filter characteristics.has_user_action == true
| filter user_action.type == "hard_navigation"
| filter browser.name == "BROWSER"
| filter lcp.status == "reported"
| fieldsAdd lcp_ms = toLong(lcp.render_time)
| filter lcp_ms >= LOW_BOUND AND lcp_ms <= HIGH_BOUND
| sort lcp_ms asc
| fields user_action.instance_id, view.instance_id, lcp_ms,
         lcp.url, lcp.ui_element.tag_name,
         ttfb.value, browser.name, browser.version,
         device.type, os.name, timestamp
| limit 1
```

Replace `LOW_BOUND` with `round(P75_LCP_MS * 0.85)` and `HIGH_BOUND` with
`round(P75_LCP_MS * 1.15)`.

Set `UA_INSTANCE_ID` and `VIEW_INSTANCE_ID`.

### 4c — Validate instance linkage

Confirm the selected instance has both a page_summary and at least one request.
Run both queries in parallel:

```dql
fetch user.events, from: TF
| filter view.instance_id == toUid("VIEW_INSTANCE_ID")
| filter characteristics.has_page_summary == true
| summarize count()
```

```dql
fetch user.events, from: TF
| filter user_action.instance_id == "UA_INSTANCE_ID"
| filter characteristics.has_request == true
| summarize count()
```

- If page_summary count = 0: warn the user — CWV metrics will be unavailable for
  this instance. Ask whether to pick a different instance or continue without metrics.
- If request count = 0: warn the user — no resource waterfall data exists for this
  instance. Ask whether to pick a different instance or continue without waterfall.
- If both = 0: this instance is unusable — go back to Step 4b and widen the LCP
  range to ±25%, then repeat 4c.

---

## Step 5 — Page summary details

```dql
fetch user.events, from: TF
| filter view.instance_id == toUid("VIEW_INSTANCE_ID")
| filter characteristics.has_page_summary == true
| fields
    performance.time_origin, client_start_time,
    ttfb.value, ttfb.status,
    ttfb.dns_duration, ttfb.connection_duration,
    ttfb.waiting_duration, ttfb.request_duration, ttfb.cache_duration,
    web_vitals.largest_contentful_paint, lcp.status,
    web_vitals.first_contentful_paint, fcp.status,
    web_vitals.first_paint, fp.status,
    web_vitals.cumulative_layout_shift, cls.status,
    web_vitals.interaction_to_next_paint, inp.status,
    fid.status,
    lcp.url, lcp.ui_element.tag_name,
    page.url.full, page.title, browser.name, browser.version,
    device.type, os.name, navigation.type, frontend.name,
    long_task.all.count, long_task.all.avg_duration, long_task.all.slowest_occurrences,
    error.exception_count, error.http_4xx_count, error.http_5xx_count
| limit 1
```

If `performance.time_origin` and `client_start_time` are both missing, tell the
user the page summary is incomplete and ask them to pick a different instance.

---

## Step 6 — Request waterfall

`sort` must come **before** `fields` — otherwise `start_time` is dropped and sort
fails with FIELD_DOES_NOT_EXIST.

```dql
fetch user.events, from: TF
| filter user_action.instance_id == "UA_INSTANCE_ID"
| filter characteristics.has_request == true
| sort start_time asc
| limit 500
| fields
    url.full, url.domain, url.path, url.provider,
    performance.initiator_type,
    start_time, end_time, duration,
    performance.transfer_size, performance.encoded_body_size, performance.decoded_body_size,
    http.response.status_code, http.request.method,
    performance.render_blocking_status,
    performance.delivery_type,
    performance.next_hop_protocol,
    performance.worker_start,
    performance.redirect_start, performance.redirect_end,
    performance.domain_lookup_start, performance.domain_lookup_end,
    performance.connect_start, performance.connect_end,
    performance.secure_connection_start,
    performance.request_start,
    performance.response_start, performance.response_end,
    performance.load_event_start, performance.load_event_end,
    performance.dom_complete,
    performance.dom_content_loaded_event_start, performance.dom_content_loaded_event_end,
    performance.fetch_start, performance.start_time,
    performance.incomplete_reason,
    characteristics.has_w3c_resource_timings,
    characteristics.has_w3c_navigation_timings,
    characteristics.has_failed_request,
    characteristics.has_csp_violation,
    characteristics.has_pending_request
```

---

## Step 7 — Exception events

```dql
fetch user.events, from: TF
| filter user_action.instance_id == "UA_INSTANCE_ID"
| filter characteristics.has_exception == true
| fields start_time, error.display_name
| limit 200
```

---

## Step 8 — Analysis

Using data from Steps 3–7, produce a structured diagnosis.

### LCP Summary
- p75 / p50 / p95 in ms, each with status label
- LCP element: tag name + URL (`lcp.ui_element.tag_name`, `lcp.url`)
- Instance LCP value and proximity to p75

### TTFB Breakdown
| Phase | ms |
|---|---|
| DNS | `ttfb.dns_duration` |
| Connection | `ttfb.connection_duration` |
| Waiting (TTFB) | `ttfb.waiting_duration` |
| Request | `ttfb.request_duration` |
| Cache | `ttfb.cache_duration` |

Flag if TTFB > 800 ms.

### Render-Blocking Resources
All resources where `performance.render_blocking_status == "blocking"`, sorted by
duration desc. Total blocking ms.

### Top Slow Resources (by duration)
Top 10 by duration. Columns: URL (60 chars), initiator type, duration ms, transfer
size KB, status code. Flag any > 500 ms.

### Top Heavy Resources (by transfer size)
Top 10 by transfer size KB. Flag uncompressed responses where `encoded_body_size ≈
decoded_body_size` on resources > 50 KB.

### Third-Party Resources
Group by `url.domain`. For each non-origin domain: domain, request count, total
duration ms, total transfer size KB. Sort by total duration desc. Flag > 200 ms.

### Long Tasks
If `long_task.all.count > 0`: count, avg duration, slowest occurrences. Flag any
overlapping with the LCP window (0 → LCP ms).

### Errors
- HTTP 4xx / 5xx / exception counts from Step 5
- List failed requests (`characteristics.has_failed_request == true`)

### Recommendations
Prioritized list, each tied to a specific finding:

1. **TTFB > 800 ms** → "Reduce server response time. DNS: Xms, wait: Xms. Investigate CDN, server processing, DB latency."
2. **Render-blocking resources** → "Defer N render-blocking resources (Xms total). Use `<link rel=preload>` for late-discovered LCP resource."
3. **LCP element is `<img>` or `<image>`** → "Add `fetchpriority='high'`. Ensure not lazy-loaded."
4. **LCP element is background CSS image** → "Move to `<img>` for earlier browser discovery."
5. **LCP element > 200 KB** → "Compress/resize LCP resource. Current: X KB."
6. **Large uncompressed resources** → "Enable gzip/Brotli for [list]."
7. **Slow third-party domains > 200 ms** → "Audit scripts from [domains]. Use `async`/`defer` or load after LCP."
8. **Long tasks during LCP window** → "Reduce main-thread blocking. N tasks, avg Xms. Consider code-splitting."
9. **High 4xx/5xx count** → "N failed requests may delay interactivity. Check: [URLs]."

Only include recommendations with evidence from the data. Add impact label (High / Medium / Low).

---

## Step 9 — Save markdown report

Derive slug from `PAGE` (replace `/`, `.`, spaces with `-`, strip leading dashes).

Write Step 8 output to:

```
~/Downloads/full-page-analysis-{slug}-{YYYY-MM-DD}.md
```

Front-matter block:

```markdown
# Full Page Analysis — {PAGE}
**Frontend:** {FRONTEND}
**UA Instance:** {UA_INSTANCE_ID}
**Browser:** {browser.name} {browser.version}, {device.type}, {os.name}
**Analyzed:** {YYYY-MM-DD}
**p75 LCP:** {value} ms ({status})
```

Append full Step 8 output below it. Tell the user the file path.

---

## Step 10 — Build interactive waterfall HTML

**No field mapping required.** Pass raw DQL records directly with `__raw: true` —
the template's `normalizeRaw()` function handles all field conversion, W3C timing
normalization, and unit translations at render time.

### Save query outputs to temp files

Run Steps 5, 6, and 7 queries saving output to temp files (skip if already done
during those steps):

```bash
dtctl query -f - -o json <<'DQL' > /tmp/wf_summary.json
# paste Step 5 query here
DQL

dtctl query -f - -o json <<'DQL' > /tmp/wf_requests.json
# paste Step 6 query here
DQL

dtctl query -f - -o json <<'DQL' > /tmp/wf_exceptions.json
# paste Step 7 query here
DQL
```

Replace `TEMPLATE_PATH` with the skill's `assets/template.html` absolute path,
`PAGE_TITLE` with the page name, and `OUTPUT_PATH` with the desired output file path.

```bash
node -e "
const fs = require('fs');
const summary = JSON.parse(fs.readFileSync('/tmp/wf_summary.json')).records[0] || {};
const requests = JSON.parse(fs.readFileSync('/tmp/wf_requests.json')).records;
const exceptions = JSON.parse(fs.readFileSync('/tmp/wf_exceptions.json')).records;
const payload = JSON.stringify({__raw: true, summary, requests, exceptions})
  .replace(/<\/script>/g, '<\\/script>');
let html = fs.readFileSync('TEMPLATE_PATH', 'utf8');
html = html.replace('__DATA_JSON__', payload).replace('__PAGE_TITLE__', 'PAGE_TITLE');
fs.writeFileSync('OUTPUT_PATH', html);
console.log('Written: OUTPUT_PATH');
"
```

If Node.js is not available, tell the user to run this skill with `--install`
first to set up the required dependencies.

---

Write output to:

```
~/Downloads/full-page-analysis-{slug}-{YYYY-MM-DD}.html
```

Open: `open ~/Downloads/full-page-analysis-{slug}-{YYYY-MM-DD}.html`

Tell the user both output file paths when done.
