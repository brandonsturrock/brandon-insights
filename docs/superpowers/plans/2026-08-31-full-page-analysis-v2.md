# Full Page Analysis v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `full-page-analysis` skill so page diagnosis rests on cross-session aggregates rather than one sampled session, with query and analysis logic in versioned files instead of prompt text, emitting one interactive HTML report and one shareable PDF.

**Architecture:** Adopt the structure the sibling `monthly-report` and `trending-report` skills already use in this plugin: parameterized `.dql` files under `references/queries/`, a `build-report.mjs` glue script that reads a directory of dtctl JSON outputs and fills an HTML template, and the Chrome-headless `render-pdf.sh` / `render-pdf.ps1` PDF path. The v1 W3C resource-timing normalizer is extracted into a headless-runnable module and validated against the built-in Dynatrace waterfall before anything is layered on top of it.

**Tech Stack:** Node.js (ESM, no runtime dependencies), `node:assert` for tests, `dtctl` CLI for Grail queries, Chart.js (vendored, inlined at build time), Chrome headless for PDF.

**Spec:** `docs/superpowers/specs/2026-08-31-full-page-analysis-v2-design.md`

**Worktree:** `/Users/brandon.sturrock/Library/CloudStorage/OneDrive-Dynatrace/Documents/Projects/fpa-v2`, branch `feat/full-page-analysis-v2`. All paths below are relative to `plugins/tools/skills/full-page-analysis/` inside that worktree unless stated otherwise.

## Global Constraints

- **No runtime npm dependencies.** Scripts run under bare `node`. Chart.js is vendored as `assets/chart.umd.min.js` and inlined into the HTML at build time. Strato token *values* are copied in as CSS custom properties; the `@dynatrace/strato-design-tokens` package is only ever consulted at development time.
- **Node ESM only.** All scripts use `.mjs` and `import`, matching `monthly-report/scripts/build-report.mjs`.
- **Tests are `node:assert` based.** No test framework, no fixtures directory beyond the checked-in JSON files named in this plan.
- **dtctl invocation form is fixed:**
  `dtctl query -f <path>.dql --set key=value -o json --agent --spill=never | grep '^{' > <dir>/<name>.json`
  The `| grep '^{'` strips warning lines dtctl emits before the JSON envelope.
- **DQL placeholder syntax is `{{.name}}`** — e.g. `{{.frontend}}` — matching `monthly-report/references/queries/*.dql`.
- **HTML template placeholder syntax is `{{NAME}}`** — e.g. `{{FRONTEND_NAME}}`, `{{DATA_JSON}}` — matching `monthly-report/assets/report-cm.html.tmpl`.
- **Anchor event type:** hard navigation only. `characteristics.has_user_action == true` and `user_action.type == "hard_navigation"`.
- **Two ID scopes, do not mix them:** `user_action.instance_id` filters as a plain string and scopes requests and exceptions; `view.instance_id` filters via `toUid()` and scopes the page summary.
- **Commit after every task.** Conventional commit prefixes (`feat:`, `test:`, `refactor:`, `docs:`, `chore:`).

---

## File Structure

| Path | Responsibility |
|---|---|
| `SKILL.md` | Orchestration prose only: context check, frontend/page selection, running the `.dql` files, invoking the scripts. Target ~300 lines. |
| `README.md` | User-facing description of inputs and outputs. |
| `references/queries/*.dql` | One query per file, parameterized with `{{.name}}`. The only place DQL lives. |
| `references/queries.md` | Table mapping each `.dql` file to its canonical output JSON filename. This table is the contract `build-report.mjs` reads against. |
| `references/findings-prompt.md` | Instructions for the agent authoring narrative prose around the computed flags. |
| `scripts/lib/normalize.mjs` | W3C resource-timing normalization, ported from v1. The unit under test. No DOM access. |
| `scripts/lib/findings.mjs` | Deterministic finding rules: data in, flag objects out. Pure functions, no I/O. |
| `scripts/build-report.mjs` | Glue: read data dir, call `normalize` and `findings`, fill the template, write HTML. |
| `scripts/test-normalize.mjs` | Assertions over `normalize.mjs` against checked-in fixtures. |
| `scripts/test-findings.mjs` | Assertions over `findings.mjs` rule thresholds. |
| `assets/report.html.tmpl` | Single template: aggregate sections plus the waterfall section. Strato-styled. |
| `assets/strato-tokens.css` | Strato token values as CSS custom properties. |
| `assets/chart.umd.min.js` | Vendored Chart.js, copied from `monthly-report`. |
| `assets/render-pdf.sh`, `assets/render-pdf.ps1` | Chrome-headless PDF, copied from `monthly-report`. |
| `assets/fixtures/instance-real.json` | Real captured instance, ground truth for the Phase 1 gate. |
| `assets/fixtures/instance-synthetic.json` | Hand-written minimal payload with known-correct expected values, so tests run without tenant access. |

`findings.mjs` is split out from `build-report.mjs` — contrary to the spec's initial guess that rules could live inline — because it needs its own test file and `build-report.mjs` is I/O-bound glue that is awkward to unit test. The spec's stated reason for keeping them together was "until that file becomes unwieldy"; having a second test target makes the split worth taking now.

The spec cites the v1 normalizer as `assets/template.html` lines 275–530. The actual function spans **lines 275–363**; line 530 is inside `renderMetricsPanel`. Use 275–363.

---

## Phase 1 — Timing correctness gate

### Task 1: Extract the normalizer into a testable module

**Files:**
- Create: `scripts/lib/normalize.mjs`
- Create: `assets/fixtures/instance-synthetic.json`
- Create: `scripts/test-normalize.mjs`
- Read for reference: `assets/template.html:275-363`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function normalizeRaw(raw)` taking `{ summary, requests, exceptions }` of raw DQL records and returning `{ summary, requests, exceptions }` in camelCase normalized form. Every later task imports this one function.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-normalize.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRaw } from "./lib/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);
const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, "assets", "fixtures", name), "utf8"));

const raw = fixture("instance-synthetic.json");
const out = normalizeRaw(raw);

// time_origin is an ISO string; normalized to epoch ms
assert.equal(out.summary.performanceTimeOriginMs, Date.parse("2026-08-01T10:00:00.000Z"));

// web vitals arrive in nanoseconds and are divided by 1e6
assert.equal(out.summary.lcpMs, 2400);
assert.equal(out.summary.fcpMs, 900);

// a "not_reported" status yields null, never 0
assert.equal(out.summary.inpMs, null);

// ttfb phase fields pass through as plain numbers
assert.equal(out.summary.ttfbMs, 420);
assert.equal(out.summary.ttfbDnsMs, 12);

// RELATIVE timings: fetch_start is small relative to start_time, left as-is
const rel = out.requests.find((r) => r.urlPath === "/relative.js");
assert.equal(rel.fetchStartNs, 5);
assert.equal(rel.responseEndNs, 180);

// ABSOLUTE timings: fetch_start >= start_time - 1ms, so all are rebased onto start_time
const abs = out.requests.find((r) => r.urlPath === "/absolute.js");
assert.equal(abs.fetchStartNs, 0);
assert.equal(abs.responseEndNs, 1_000_000);

// duration comes from the ISO start/end pair, not the W3C fields
assert.equal(rel.durationMs, 250);

// exceptions keep their absolute timestamp and display name
assert.equal(out.exceptions.length, 1);
assert.equal(out.exceptions[0].displayName, "TypeError: x is undefined");
assert.equal(out.exceptions[0].startAbsoluteMs, Date.parse("2026-08-01T10:00:03.000Z"));

console.log("test-normalize: all assertions passed");
```

Create `assets/fixtures/instance-synthetic.json`:

```json
{
  "__raw": true,
  "summary": {
    "performance.time_origin": "2026-08-01T10:00:00.000Z",
    "client_start_time": "2026-08-01T10:00:00.000Z",
    "ttfb.value": "420",
    "ttfb.status": "reported",
    "ttfb.dns_duration": "12",
    "ttfb.connection_duration": "30",
    "ttfb.waiting_duration": "300",
    "ttfb.request_duration": "70",
    "ttfb.cache_duration": "8",
    "web_vitals.largest_contentful_paint": "2400000000",
    "lcp.status": "reported",
    "web_vitals.first_contentful_paint": "900000000",
    "fcp.status": "reported",
    "web_vitals.first_paint": "800000000",
    "fp.status": "reported",
    "web_vitals.cumulative_layout_shift": "0.05",
    "cls.status": "reported",
    "web_vitals.interaction_to_next_paint": "0",
    "inp.status": "not_reported",
    "lcp.url": "https://example.com/hero.jpg",
    "lcp.ui_element.tag_name": "IMG",
    "page.url.full": "https://example.com/",
    "page.title": "Example",
    "browser.name": "Chrome",
    "browser.version": "140",
    "device.type": "desktop",
    "os.name": "macOS",
    "navigation.type": "navigate",
    "frontend.name": "Example Frontend",
    "long_task.all.count": "2",
    "long_task.all.avg_duration": "120",
    "long_task.all.slowest_occurrences": ["{\"start_time\":1500,\"duration\":180}"],
    "error.exception_count": "1",
    "error.http_4xx_count": "0",
    "error.http_5xx_count": "0"
  },
  "requests": [
    {
      "url.full": "https://example.com/relative.js",
      "url.domain": "example.com",
      "url.path": "/relative.js",
      "performance.initiator_type": "script",
      "start_time": "2026-08-01T10:00:01.000Z",
      "end_time": "2026-08-01T10:00:01.250Z",
      "performance.transfer_size": "51200",
      "performance.encoded_body_size": "51000",
      "performance.decoded_body_size": "150000",
      "http.response.status_code": 200,
      "http.request.method": "GET",
      "performance.render_blocking_status": "blocking",
      "performance.start_time": "0",
      "performance.fetch_start": "5",
      "performance.response_end": "180",
      "characteristics.has_w3c_resource_timings": true
    },
    {
      "url.full": "https://cdn.example.net/absolute.js",
      "url.domain": "cdn.example.net",
      "url.path": "/absolute.js",
      "performance.initiator_type": "script",
      "start_time": "2026-08-01T10:00:02.000Z",
      "end_time": "2026-08-01T10:00:02.100Z",
      "performance.transfer_size": "8000",
      "performance.encoded_body_size": "8000",
      "performance.decoded_body_size": "8000",
      "http.response.status_code": 200,
      "http.request.method": "GET",
      "performance.render_blocking_status": "non-blocking",
      "performance.start_time": "2000000000",
      "performance.fetch_start": "2000000000",
      "performance.response_end": "2001000000",
      "characteristics.has_w3c_resource_timings": true
    }
  ],
  "exceptions": [
    { "start_time": "2026-08-01T10:00:03.000Z", "error.display_name": "TypeError: x is undefined" }
  ]
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/test-normalize.mjs
```

Expected: FAIL — `Cannot find module '.../scripts/lib/normalize.mjs'`.

- [ ] **Step 3: Create the module by porting the v1 function**

```bash
mkdir -p scripts/lib
```

Copy lines 275–363 of `assets/template.html` — the whole `function normalizeRaw(raw) { ... }` body, from `function normalizeRaw` through its closing `}` — into `scripts/lib/normalize.mjs`. Make exactly three changes and nothing else:

1. Prefix the function with `export`, so the first line reads `export function normalizeRaw(raw) {`.
2. Add `"use strict";` is unnecessary in ESM — omit it if you copied it in.
3. Change `raw.requests.map(...)` to `(raw.requests || []).map(...)` so a missing key throws a clear assertion failure rather than a TypeError.

Do not rename variables, reorder fields, or "clean up" the logic. This is a verbatim port; behavioural changes come only from the Phase 1 gate, and they arrive as tested fixes.

- [ ] **Step 4: Run the test to verify it passes**

```bash
node scripts/test-normalize.mjs
```

Expected: `test-normalize: all assertions passed`.

If the absolute/relative assertions fail, do **not** adjust the assertions to match the code. The `isAbs` heuristic in the ported code is `fetchRaw > 0 && fetchRaw >= startNs - 1_000_000`; verify the fixture exercises both branches as written and fix the fixture if it does not. Only a genuine port error justifies touching `normalize.mjs`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/normalize.mjs scripts/test-normalize.mjs assets/fixtures/instance-synthetic.json
git commit -m "refactor(full-page-analysis): extract W3C timing normalizer into tested module"
```

---

### Task 2: Strato token stylesheet

**Files:**
- Create: `assets/strato-tokens.css`
- Read for reference: `../../../development/skills/dt-ui-wizard/references/foundations.md`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties on `:root`, consumed by `report.html.tmpl` in Task 3. Names are fixed by this task: `--dt-bg-base`, `--dt-bg-container`, `--dt-bg-container-subtle`, `--dt-text-primary`, `--dt-text-secondary`, `--dt-border-default`, `--dt-critical`, `--dt-warning`, `--dt-success`, `--dt-primary`, `--dt-font-sans`, `--dt-font-mono`, `--dt-radius`, `--dt-space-8`, `--dt-space-16`, `--dt-space-32`.

- [ ] **Step 1: Extract real token values at development time**

The token values are not documented as hex anywhere in this repo — `dt-ui-wizard/references/foundations.md` only names the npm package. Pull the package into a scratch directory, read the values out, and throw the package away. It must not become a dependency.

```bash
cd "$(mktemp -d)" && npm pack @dynatrace/strato-design-tokens 2>&1 | tail -1
tar xzf dynatrace-strato-design-tokens-*.tgz
find package -name '*.css' -o -name '*.json' | head -20
```

Read the light-theme and dark-theme values for these Strato roles:

| Strato role | CSS custom property |
|---|---|
| `Colors.Background.Base.Default` | `--dt-bg-base` |
| `Colors.Background.Container.Neutral.Default` | `--dt-bg-container` |
| `Colors.Background.Container.Neutral.Subdued` | `--dt-bg-container-subtle` |
| `Colors.Text.Primary.Default` | `--dt-text-primary` |
| `Colors.Text.Neutral.Default` | `--dt-text-secondary` |
| `Colors.Border.Neutral.Default` | `--dt-border-default` |
| `Colors.Text.Critical.Default` | `--dt-critical` |
| `Colors.Text.Warning.Default` | `--dt-warning` |
| `Colors.Text.Success.Default` | `--dt-success` |
| `Colors.Text.Primary.Accent` | `--dt-primary` |

If a role name has drifted in the installed package version, pick the nearest equivalent and record the substitution in a comment in the CSS file. Do not invent hex values — every value in this file must be traceable to the package.

- [ ] **Step 2: Write the stylesheet**

Create `assets/strato-tokens.css` with the extracted values. Structure it exactly like this, substituting the real values for the `/* from: ... */` comments:

```css
/* Dynatrace Strato design tokens, extracted from @dynatrace/strato-design-tokens.
   Development-time extraction only — the package is NOT a dependency of this skill.
   Each value below cites the Strato role it came from. */
:root {
  --dt-bg-base:            /* Colors.Background.Base.Default */;
  --dt-bg-container:       /* Colors.Background.Container.Neutral.Default */;
  --dt-bg-container-subtle:/* Colors.Background.Container.Neutral.Subdued */;
  --dt-text-primary:       /* Colors.Text.Primary.Default */;
  --dt-text-secondary:     /* Colors.Text.Neutral.Default */;
  --dt-border-default:     /* Colors.Border.Neutral.Default */;
  --dt-critical:           /* Colors.Text.Critical.Default */;
  --dt-warning:            /* Colors.Text.Warning.Default */;
  --dt-success:            /* Colors.Text.Success.Default */;
  --dt-primary:            /* Colors.Text.Primary.Accent */;

  --dt-font-sans: "Bitstream Vera Sans", "DejaVu Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --dt-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;

  --dt-radius: 4px;
  --dt-space-8: 8px;
  --dt-space-16: 16px;
  --dt-space-32: 32px;
}
```

The spacing scale mirrors `Spacings.Size8` / `Size16` / `Size32` as named in `foundations.md`.

- [ ] **Step 3: Verify no stray dependency was added**

```bash
git status --porcelain
```

Expected: only `assets/strato-tokens.css` as untracked. No `package.json`, no `node_modules`, no lockfile.

- [ ] **Step 4: Commit**

```bash
git add assets/strato-tokens.css
git commit -m "feat(full-page-analysis): add Strato design token stylesheet"
```

---

### Task 3: Instance queries, build script, and waterfall render

**Files:**
- Create: `references/queries/fpa-instance-summary.dql`
- Create: `references/queries/fpa-instance-requests.dql`
- Create: `references/queries/fpa-instance-exceptions.dql`
- Create: `references/queries.md`
- Create: `assets/report.html.tmpl`
- Create: `scripts/build-report.mjs`
- Copy: `assets/chart.umd.min.js` from `../monthly-report/assets/chart.umd.min.js`
- Read for reference: `assets/template.html` (waterfall rendering, lines 364–1317), `../monthly-report/scripts/build-report.mjs`

**Interfaces:**
- Consumes: `normalizeRaw` from `scripts/lib/normalize.mjs` (Task 1); CSS custom properties from `assets/strato-tokens.css` (Task 2).
- Produces: `node scripts/build-report.mjs --data <dir> --page-title "<title>" --out <file.html>`. The `--data` directory contract is the filename table in `references/queries.md`. Later tasks add `--findings <file.md>` and more data files; the flag names established here do not change.

- [ ] **Step 1: Write the three instance queries**

`references/queries/fpa-instance-summary.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter view.instance_id == toUid("{{.view_instance}}")
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

`references/queries/fpa-instance-requests.dql` — note that `sort` must precede `fields`, otherwise `start_time` is dropped and the sort fails with `FIELD_DOES_NOT_EXIST`:

```
fetch user.events, from: {{.timeframe}}
| filter user_action.instance_id == "{{.ua_instance}}"
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

`references/queries/fpa-instance-exceptions.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter user_action.instance_id == "{{.ua_instance}}"
| filter characteristics.has_exception == true
| fields start_time, error.display_name
| limit 200
```

- [ ] **Step 2: Write the filename contract**

Create `references/queries.md`:

```markdown
# Query file → output filename contract

`build-report.mjs` reads the `--data` directory by these exact filenames.
Run each query as:

    dtctl query -f references/queries/<file>.dql --set <params> -o json --agent --spill=never | grep '^{' > <data-dir>/<output>.json

## Instance-scoped

| Query file | Parameters | Output filename |
|---|---|---|
| `fpa-instance-summary.dql` | `timeframe`, `view_instance` | `instance-summary.json` |
| `fpa-instance-requests.dql` | `timeframe`, `ua_instance` | `instance-requests.json` |
| `fpa-instance-exceptions.dql` | `timeframe`, `ua_instance` | `instance-exceptions.json` |
```

Phase 2 appends the aggregate rows to this table.

- [ ] **Step 3: Write the build script**

Create `scripts/build-report.mjs`:

```js
#!/usr/bin/env node
// Glue script for the full-page-analysis skill.
// Reads a directory of dtctl query JSON outputs (filenames per
// references/queries.md) and fills assets/report.html.tmpl.
//
// Usage:
//   node build-report.mjs --data /tmp/fpa-home --page-title "/" --out ~/Downloads/report.html

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRaw } from "./lib/normalize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.dirname(__dirname);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { out[a.slice(2)] = argv[++i]; }
  }
  return out;
}

// dtctl -o json --agent --spill=never emits rows under result.records when
// result.kind === "records". Accept a bare array too — the envelope shape is
// not pinned 1:1 anywhere. Same defensive parse as monthly-report.
function loadRecords(dataDir, filename) {
  const p = path.join(dataDir, filename);
  const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  const result = parsed.result ?? parsed;
  if (result && Array.isArray(result.records)) return result.records;
  if (Array.isArray(result)) return result;
  throw new Error(`Unexpected JSON envelope shape in ${filename} (kind=${result && result.kind})`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.data) { console.error("Missing --data <dir>"); process.exit(1); }
if (!args.out) { console.error("Missing --out <report.html>"); process.exit(1); }
if (!args["page-title"]) { console.error("Missing --page-title <title>"); process.exit(1); }

const raw = {
  summary: loadRecords(args.data, "instance-summary.json")[0] || {},
  requests: loadRecords(args.data, "instance-requests.json"),
  exceptions: loadRecords(args.data, "instance-exceptions.json"),
};
const data = { instance: normalizeRaw(raw) };

const template = fs.readFileSync(path.join(SKILL_ROOT, "assets", "report.html.tmpl"), "utf8");
const tokens = fs.readFileSync(path.join(SKILL_ROOT, "assets", "strato-tokens.css"), "utf8");
const chartJs = fs
  .readFileSync(path.join(SKILL_ROOT, "assets", "chart.umd.min.js"), "utf8")
  .replace(/\/\/# sourceMappingURL=\S+/g, "");

let html = template
  .split("{{PAGE_TITLE}}").join(args["page-title"])
  .split("{{GENERATED_AT}}").join(new Date().toISOString().slice(0, 10))
  .split("{{STRATO_TOKENS}}").join(tokens)
  .replace("{{DATA_JSON}}", () =>
    JSON.stringify(data).replace(/<\/script>/g, "<\\/script>"))
  .replace('<script src="chart.umd.min.js"></script>', `<script>${chartJs}</script>`);

const outPath = args.out.replace(/^~/, process.env.HOME || "");
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
```

`{{DATA_JSON}}` uses `.replace` with a function replacement rather than `.split().join()` because a JSON payload can contain `$&` and other `$`-patterns that string replacement would expand. The others are safe and use `split/join` so they substitute every occurrence.

- [ ] **Step 4: Write the template**

Create `assets/report.html.tmpl`. Its head is:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Full Page Analysis — {{PAGE_TITLE}}</title>
<style>{{STRATO_TOKENS}}</style>
<style>
  body { background: var(--dt-bg-base); color: var(--dt-text-primary);
         font-family: var(--dt-font-sans); margin: 0; padding: var(--dt-space-32); }
  .panel { background: var(--dt-bg-container); border: 1px solid var(--dt-border-default);
           border-radius: var(--dt-radius); padding: var(--dt-space-16);
           margin-bottom: var(--dt-space-32); }
  h1, h2 { font-weight: 600; margin: 0 0 var(--dt-space-16); }
  .example-note { color: var(--dt-warning); font-size: 13px; }
</style>
</head>
<body>
<h1>Full Page Analysis — {{PAGE_TITLE}}</h1>
<p>Generated {{GENERATED_AT}}</p>

<section class="panel" id="waterfall-panel">
  <h2>Resource waterfall</h2>
  <p class="example-note">Single example load — not a page-wide measurement.</p>
  <div id="waterfall"></div>
</section>

<script src="chart.umd.min.js"></script>
<script>
const DATA = {{DATA_JSON}};
const { summary, requests, exceptions } = DATA.instance;
</script>
</body>
</html>
```

Then port the waterfall rendering from `assets/template.html` lines 364–1317 into the second `<script>` block, below the `DATA` destructure. Port these top-level units, in this order, unchanged apart from what is listed below: the formatting helpers (`formatMs`, `formatBytes`, `escHtml`), the resource type and colour resolution (`RESOURCE_COLORS`, `EXT_TYPE_MAP`, `typeFromExtension`, `resolveType`), `positionTooltip`, `hideTooltip`, `buildResourceTooltipHtml`, `attachBarHover`, `attachLineHover`, `attachExceptionHover`, `renderControls`, `renderWaterfall`, `updateStickyPills`, and `renderAll`. Skip `renderMetricsPanel` and `renderFindings` — Phase 2 and Phase 3 replace both with aggregate-driven equivalents.

Two required changes during the port:

1. Delete the `const _RAW = JSON.parse(document.getElementById("wf-data").textContent); const DATA = _RAW.__raw ? normalizeRaw(...) : _RAW;` lines. Normalization now happens in Node, and the template receives already-normalized data.
2. Replace the hardcoded hex colours in the *chrome* — panel backgrounds, borders, body text, gridlines — with the `var(--dt-*)` properties from Task 2. Leave `RESOURCE_COLORS` and `STALL_COLOR` as literal hex: they are a categorical data palette, not UI chrome, and changing them is a separate visual decision for the maintainer at the gate.

Copy Chart.js in:

```bash
cp ../monthly-report/assets/chart.umd.min.js assets/chart.umd.min.js
```

- [ ] **Step 5: Render against the synthetic fixture and verify it opens**

The synthetic fixture is shaped as a single `__raw` payload, not as three dtctl envelopes, so split it into a temp data directory first:

```bash
mkdir -p /tmp/fpa-synthetic
node -e '
const fs=require("fs");
const f=JSON.parse(fs.readFileSync("assets/fixtures/instance-synthetic.json","utf8"));
const w=(n,v)=>fs.writeFileSync("/tmp/fpa-synthetic/"+n,JSON.stringify({result:{kind:"records",records:v}}));
w("instance-summary.json",[f.summary]);
w("instance-requests.json",f.requests);
w("instance-exceptions.json",f.exceptions);
'
node scripts/build-report.mjs --data /tmp/fpa-synthetic --page-title "/" --out /tmp/fpa-synthetic/report.html
```

Expected: `Wrote /tmp/fpa-synthetic/report.html`. Then:

```bash
grep -c "chart.umd.min.js" /tmp/fpa-synthetic/report.html
```

Expected: `0` — the `<script src=...>` tag was replaced by the inlined library, so no external reference remains.

```bash
open /tmp/fpa-synthetic/report.html
```

Expected: two resource bars render, the page has no console errors, and the "Single example load" note is visible.

- [ ] **Step 6: Commit**

```bash
git add references/queries scripts/build-report.mjs assets/report.html.tmpl assets/chart.umd.min.js
git commit -m "feat(full-page-analysis): render instance waterfall from Node-normalized data"
```

---

### Task 4: Capture ground truth and run the validation gate

**Files:**
- Create: `assets/fixtures/instance-real.json`
- Modify: `scripts/test-normalize.mjs`
- Modify: `scripts/lib/normalize.mjs` (only if the diff finds a defect)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a validated `normalize.mjs`. **No later task may begin until this task's gate passes.**

- [ ] **Step 1: Capture a real instance**

Ask the maintainer for a `user_action.instance_id` for a hard navigation they can also open in the built-in Dynatrace waterfall UI, plus the matching `view.instance_id` and timeframe. Then:

```bash
mkdir -p /tmp/fpa-real
dtctl query -f references/queries/fpa-instance-summary.dql \
  --set timeframe='now()-7d' --set view_instance='VIEW_ID' \
  -o json --agent --spill=never | grep '^{' > /tmp/fpa-real/instance-summary.json
dtctl query -f references/queries/fpa-instance-requests.dql \
  --set timeframe='now()-7d' --set ua_instance='UA_ID' \
  -o json --agent --spill=never | grep '^{' > /tmp/fpa-real/instance-requests.json
dtctl query -f references/queries/fpa-instance-exceptions.dql \
  --set timeframe='now()-7d' --set ua_instance='UA_ID' \
  -o json --agent --spill=never | grep '^{' > /tmp/fpa-real/instance-exceptions.json
```

Verify each file is non-empty and contains records before continuing.

- [ ] **Step 2: Render it**

```bash
node scripts/build-report.mjs --data /tmp/fpa-real --page-title "PAGE" --out /tmp/fpa-real/report.html
open /tmp/fpa-real/report.html
```

- [ ] **Step 3: Hand the gate to the maintainer**

Tell the maintainer: the rendered waterfall is at `/tmp/fpa-real/report.html`, for instance `UA_ID`. Ask them to open the same instance in the built-in Dynatrace waterfall and report, per resource, any disagreement in: bar start offset, bar total width, and the widths of the DNS / connect / TLS / request / response segments within the bar. **Stop and wait.** Do not proceed on the assumption that it matches.

- [ ] **Step 4: Turn each reported discrepancy into a failing test**

For every discrepancy the maintainer reports, add an assertion to `scripts/test-normalize.mjs` describing the *correct* value, sourced from the built-in waterfall. Sanitize and check in the captured payload as `assets/fixtures/instance-real.json` in the same `{ summary, requests, exceptions }` shape as the synthetic fixture — strip any hostnames, URLs, or query strings the maintainer flags as sensitive, keeping the timing fields untouched.

```bash
node scripts/test-normalize.mjs
```

Expected: FAIL on the new assertions.

- [ ] **Step 5: Fix `normalize.mjs` until the tests pass**

```bash
node scripts/test-normalize.mjs
```

Expected: all assertions pass, synthetic and real.

If the maintainer reports no discrepancies, add one assertion anyway pinning the real fixture's first request's `fetchStartNs` and `responseEndNs` to their observed values, so the ground truth is captured rather than merely remembered.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-normalize.mjs scripts/lib/normalize.mjs assets/fixtures/instance-real.json
git commit -m "fix(full-page-analysis): validate resource timings against built-in waterfall"
```

---

## Phase 2 — Aggregate analysis

### Task 5: Aggregate queries

**Files:**
- Create: `references/queries/fpa-frontends.dql`
- Create: `references/queries/fpa-pages.dql`
- Create: `references/queries/fpa-select-instance.dql`
- Create: `references/queries/fpa-cwv-percentiles.dql`
- Create: `references/queries/fpa-ttfb-phases.dql`
- Create: `references/queries/fpa-resources-agg.dql`
- Create: `references/queries/fpa-thirdparty-agg.dql`
- Create: `references/queries/fpa-longtasks-agg.dql`
- Create: `references/queries/fpa-errors-agg.dql`
- Create: `references/queries/fpa-browser-device.dql`
- Modify: `references/queries.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the output filenames listed in the table below; Task 6 reads exactly those names.

- [ ] **Step 1: Write the selection queries**

`references/queries/fpa-frontends.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter isNotNull(frontend.name)
| summarize hard_navs = countIf(user_action.type == "hard_navigation"), by: {frontend.name}
| filter hard_navs > 0
| sort hard_navs desc
| limit 30
```

`references/queries/fpa-pages.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter characteristics.has_user_action == true
| filter user_action.type == "hard_navigation"
| filter lcp.status == "reported"
| summarize hard_navs = count(), by: {page.detected_name}
| filterOut isNull(page.detected_name)
| sort hard_navs desc
| limit 20
```

`references/queries/fpa-select-instance.dql` — `abs()` is not usable here: DQL returns null for arithmetic on string-typed numeric fields, so the near-p75 window is expressed as an explicit range. The two joins guarantee the returned instance has both a linked page summary and at least one request, which removes the need for a separate validation query.

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_user_action == true
| filter user_action.type == "hard_navigation"
| filter browser.name == "{{.browser}}"
| filter lcp.status == "reported"
| fieldsAdd lcp_ms = toLong(lcp.render_time)
| filter lcp_ms >= {{.low_bound}} AND lcp_ms <= {{.high_bound}}
| fields user_action.instance_id, view.instance_id, dt.rum.session.id, lcp_ms,
         lcp.url, lcp.ui_element.tag_name,
         ttfb.value, browser.name, browser.version,
         device.type, os.name, timestamp
| join [
    fetch user.events, from: {{.timeframe}}
    | filter frontend.name == "{{.frontend}}"
    | filter characteristics.has_page_summary == true
    | summarize count(), by: {view.instance_id, dt.rum.session.id}
  ], on: {view.instance_id, dt.rum.session.id}, prefix: "page_summary."
| join [
    fetch user.events, from: {{.timeframe}}
    | filter frontend.name == "{{.frontend}}"
    | filter characteristics.has_request == true
    | summarize count(), by: {user_action.instance_id, dt.rum.session.id}
  ], on: {user_action.instance_id, dt.rum.session.id}, prefix: "requests."
| sort lcp_ms asc
| limit 1
```

- [ ] **Step 2: Write the aggregate queries**

`fpa-cwv-percentiles.dql` — nanosecond web vitals are divided by 1e6; CLS is divided by 10000, matching `monthly-report/references/queries/cm-cwv-tier.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_page_summary == true
| filter dt.rum.user_type == "real_user"
| fieldsAdd
    lcp_ms = toLong(web_vitals.largest_contentful_paint) / 1000000,
    fcp_ms = toLong(web_vitals.first_contentful_paint) / 1000000,
    inp_ms = toLong(web_vitals.interaction_to_next_paint) / 1000000,
    cls_val = toDouble(web_vitals.cumulative_layout_shift) / 10000,
    ttfb_ms = toLong(ttfb.value)
| summarize
    loads = count(),
    lcp_p50 = percentile(lcp_ms, 50), lcp_p75 = percentile(lcp_ms, 75), lcp_p95 = percentile(lcp_ms, 95),
    fcp_p50 = percentile(fcp_ms, 50), fcp_p75 = percentile(fcp_ms, 75), fcp_p95 = percentile(fcp_ms, 95),
    inp_p50 = percentile(inp_ms, 50), inp_p75 = percentile(inp_ms, 75), inp_p95 = percentile(inp_ms, 95),
    cls_p50 = percentile(cls_val, 50), cls_p75 = percentile(cls_val, 75), cls_p95 = percentile(cls_val, 95),
    ttfb_p50 = percentile(ttfb_ms, 50), ttfb_p75 = percentile(ttfb_ms, 75), ttfb_p95 = percentile(ttfb_ms, 95)
```

`fpa-ttfb-phases.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_page_summary == true
| filter ttfb.status == "reported"
| summarize
    loads = count(),
    dns_p75 = percentile(toLong(ttfb.dns_duration), 75),
    connection_p75 = percentile(toLong(ttfb.connection_duration), 75),
    waiting_p75 = percentile(toLong(ttfb.waiting_duration), 75),
    request_p75 = percentile(toLong(ttfb.request_duration), 75),
    cache_p75 = percentile(toLong(ttfb.cache_duration), 75)
```

`fpa-resources-agg.dql` — this is the core of the aggregate work. `sessions` is the count of distinct page loads that fetched the URL, which is what makes "slow in one unlucky load" distinguishable from "slow for everyone":

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_request == true
| summarize
    sessions = countDistinctExact(user_action.instance_id),
    requests = count(),
    duration_p50 = percentile(toLong(duration), 50),
    duration_p75 = percentile(toLong(duration), 75),
    duration_p95 = percentile(toLong(duration), 95),
    transfer_p75 = percentile(toLong(performance.transfer_size), 75),
    blocking = countIf(performance.render_blocking_status == "blocking"),
    failures = countIf(characteristics.has_failed_request == true),
    by: {url.full, url.domain, performance.initiator_type}
| sort duration_p75 desc
| limit 100
```

`fpa-thirdparty-agg.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_request == true
| summarize
    sessions = countDistinctExact(user_action.instance_id),
    requests = count(),
    duration_p75 = percentile(toLong(duration), 75),
    transfer_p75 = percentile(toLong(performance.transfer_size), 75),
    by: {url.domain}
| sort duration_p75 desc
| limit 40
```

`fpa-longtasks-agg.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_page_summary == true
| summarize
    loads = count(),
    loads_with_long_tasks = countIf(toLong(long_task.all.count) > 0),
    count_p75 = percentile(toLong(long_task.all.count), 75),
    avg_duration_p75 = percentile(toLong(long_task.all.avg_duration), 75)
```

`fpa-errors-agg.dql`:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_page_summary == true
| summarize
    loads = count(),
    loads_with_exception = countIf(toLong(error.exception_count) > 0),
    loads_with_4xx = countIf(toLong(error.http_4xx_count) > 0),
    loads_with_5xx = countIf(toLong(error.http_5xx_count) > 0),
    exception_total = sum(toLong(error.exception_count)),
    http_4xx_total = sum(toLong(error.http_4xx_count)),
    http_5xx_total = sum(toLong(error.http_5xx_count))
```

`fpa-browser-device.dql` — this exists so a p75 driven by one browser is visible rather than hidden in the blend:

```
fetch user.events, from: {{.timeframe}}
| filter frontend.name == "{{.frontend}}"
| filter page.detected_name == "{{.page}}"
| filter characteristics.has_page_summary == true
| fieldsAdd lcp_ms = toLong(web_vitals.largest_contentful_paint) / 1000000
| summarize
    loads = count(),
    lcp_p75 = percentile(lcp_ms, 75),
    by: {browser.name, device.type}
| sort loads desc
| limit 20
```

- [ ] **Step 3: Extend the filename contract**

Append to `references/queries.md`:

```markdown
## Selection (run interactively by SKILL.md, not consumed by build-report.mjs)

| Query file | Parameters |
|---|---|
| `fpa-frontends.dql` | `timeframe` |
| `fpa-pages.dql` | `timeframe`, `frontend` |
| `fpa-select-instance.dql` | `timeframe`, `frontend`, `page`, `browser`, `low_bound`, `high_bound` |

## Aggregate

| Query file | Parameters | Output filename |
|---|---|---|
| `fpa-cwv-percentiles.dql` | `timeframe`, `frontend`, `page` | `cwv-percentiles.json` |
| `fpa-ttfb-phases.dql` | `timeframe`, `frontend`, `page` | `ttfb-phases.json` |
| `fpa-resources-agg.dql` | `timeframe`, `frontend`, `page` | `resources-agg.json` |
| `fpa-thirdparty-agg.dql` | `timeframe`, `frontend`, `page` | `thirdparty-agg.json` |
| `fpa-longtasks-agg.dql` | `timeframe`, `frontend`, `page` | `longtasks-agg.json` |
| `fpa-errors-agg.dql` | `timeframe`, `frontend`, `page` | `errors-agg.json` |
| `fpa-browser-device.dql` | `timeframe`, `frontend`, `page` | `browser-device.json` |
```

- [ ] **Step 4: Verify each query parses against a live tenant**

For each of the seven aggregate queries, using a frontend and page the maintainer names:

```bash
for q in cwv-percentiles ttfb-phases resources-agg thirdparty-agg longtasks-agg errors-agg browser-device; do
  echo "--- $q"
  dtctl query -f "references/queries/fpa-$q.dql" \
    --set timeframe='now()-7d' --set frontend='FRONTEND' --set page='PAGE' \
    -o json --agent --spill=never | grep '^{' | head -c 300
  echo
done
```

Expected: each prints a JSON envelope, none prints a DQL parse error. Fix any query that errors before committing. If `countDistinctExact` is rejected on the tenant's DQL version, substitute `countDistinct` and note the change in `references/queries.md`.

- [ ] **Step 5: Commit**

```bash
git add references/queries references/queries.md
git commit -m "feat(full-page-analysis): add aggregate and selection queries"
```

---

### Task 6: Aggregate report sections

**Files:**
- Modify: `scripts/build-report.mjs`
- Modify: `assets/report.html.tmpl`

**Interfaces:**
- Consumes: output filenames from Task 5's contract table; `normalizeRaw` from Task 1.
- Produces: a `DATA` object in the rendered HTML with this exact shape, which Task 7's findings rules and Task 8's print CSS both depend on:

```js
DATA = {
  instance: { summary, requests, exceptions },   // from normalizeRaw
  cwv: { loads, lcpP50, lcpP75, lcpP95, fcpP50, fcpP75, fcpP95,
         inpP50, inpP75, inpP95, clsP50, clsP75, clsP95,
         ttfbP50, ttfbP75, ttfbP95 },
  ttfbPhases: { loads, dnsP75, connectionP75, waitingP75, requestP75, cacheP75 },
  resources: [{ url, domain, initiatorType, sessions, requests,
                durationP50, durationP75, durationP95, transferP75,
                blocking, failures }],
  thirdParty: [{ domain, sessions, requests, durationP75, transferP75 }],
  longTasks: { loads, loadsWithLongTasks, countP75, avgDurationP75 },
  errors: { loads, loadsWithException, loadsWith4xx, loadsWith5xx,
            exceptionTotal, http4xxTotal, http5xxTotal },
  browserDevice: [{ browser, device, loads, lcpP75 }],
}
```

- [ ] **Step 1: Add the aggregate loaders to the build script**

In `scripts/build-report.mjs`, replace the `const data = { instance: normalizeRaw(raw) };` line with:

```js
const first = (rows) => rows[0] || {};

const cwvRow = first(loadRecords(args.data, "cwv-percentiles.json"));
const ttfbRow = first(loadRecords(args.data, "ttfb-phases.json"));
const longTaskRow = first(loadRecords(args.data, "longtasks-agg.json"));
const errorRow = first(loadRecords(args.data, "errors-agg.json"));

const data = {
  instance: normalizeRaw(raw),
  cwv: {
    loads: cwvRow.loads ?? null,
    lcpP50: cwvRow.lcp_p50 ?? null, lcpP75: cwvRow.lcp_p75 ?? null, lcpP95: cwvRow.lcp_p95 ?? null,
    fcpP50: cwvRow.fcp_p50 ?? null, fcpP75: cwvRow.fcp_p75 ?? null, fcpP95: cwvRow.fcp_p95 ?? null,
    inpP50: cwvRow.inp_p50 ?? null, inpP75: cwvRow.inp_p75 ?? null, inpP95: cwvRow.inp_p95 ?? null,
    clsP50: cwvRow.cls_p50 ?? null, clsP75: cwvRow.cls_p75 ?? null, clsP95: cwvRow.cls_p95 ?? null,
    ttfbP50: cwvRow.ttfb_p50 ?? null, ttfbP75: cwvRow.ttfb_p75 ?? null, ttfbP95: cwvRow.ttfb_p95 ?? null,
  },
  ttfbPhases: {
    loads: ttfbRow.loads ?? null,
    dnsP75: ttfbRow.dns_p75 ?? null,
    connectionP75: ttfbRow.connection_p75 ?? null,
    waitingP75: ttfbRow.waiting_p75 ?? null,
    requestP75: ttfbRow.request_p75 ?? null,
    cacheP75: ttfbRow.cache_p75 ?? null,
  },
  resources: loadRecords(args.data, "resources-agg.json").map((r) => ({
    url: r["url.full"],
    domain: r["url.domain"],
    initiatorType: r["performance.initiator_type"],
    sessions: r.sessions ?? 0,
    requests: r.requests ?? 0,
    durationP50: r.duration_p50 ?? null,
    durationP75: r.duration_p75 ?? null,
    durationP95: r.duration_p95 ?? null,
    transferP75: r.transfer_p75 ?? null,
    blocking: r.blocking ?? 0,
    failures: r.failures ?? 0,
  })),
  thirdParty: loadRecords(args.data, "thirdparty-agg.json").map((r) => ({
    domain: r["url.domain"],
    sessions: r.sessions ?? 0,
    requests: r.requests ?? 0,
    durationP75: r.duration_p75 ?? null,
    transferP75: r.transfer_p75 ?? null,
  })),
  longTasks: {
    loads: longTaskRow.loads ?? null,
    loadsWithLongTasks: longTaskRow.loads_with_long_tasks ?? null,
    countP75: longTaskRow.count_p75 ?? null,
    avgDurationP75: longTaskRow.avg_duration_p75 ?? null,
  },
  errors: {
    loads: errorRow.loads ?? null,
    loadsWithException: errorRow.loads_with_exception ?? null,
    loadsWith4xx: errorRow.loads_with_4xx ?? null,
    loadsWith5xx: errorRow.loads_with_5xx ?? null,
    exceptionTotal: errorRow.exception_total ?? null,
    http4xxTotal: errorRow.http_4xx_total ?? null,
    http5xxTotal: errorRow.http_5xx_total ?? null,
  },
  browserDevice: loadRecords(args.data, "browser-device.json").map((r) => ({
    browser: r["browser.name"],
    device: r["device.type"],
    loads: r.loads ?? 0,
    lcpP75: r.lcp_p75 ?? null,
  })),
};
```

`??` is used rather than `||` throughout so a legitimate zero is not coerced to null.

- [ ] **Step 2: Add the aggregate sections to the template**

In `assets/report.html.tmpl`, insert these sections above `#waterfall-panel`, and add a render function for each at the bottom of the script block. The sections, in order:

1. **Core Web Vitals** — a table of LCP / FCP / INP / CLS / TTFB rows with p50, p75, p95 columns. Colour the p75 cell with `var(--dt-success)`, `var(--dt-warning)`, or `var(--dt-critical)` per the thresholds in Task 7's `THRESHOLDS` constant. Show `DATA.cwv.loads` as the sample size in the heading.
2. **TTFB phases** — a horizontal stacked bar of `dnsP75`, `connectionP75`, `waitingP75`, `requestP75`, `cacheP75`, with a labelled legend and the total.
3. **Slowest resources** — `DATA.resources` sorted by `durationP75` desc, first 20 rows. Columns: URL (truncated to 60 chars, full URL in the `title` attribute), type, sessions, p50 / p75 / p95 duration, p75 transfer. Render `sessions` prominently — it is what separates a page-wide problem from one unlucky load.
4. **Heaviest resources** — the same array sorted by `transferP75` desc, first 20 rows.
5. **Third parties** — `DATA.thirdParty` as a table, excluding the row whose domain matches the origin of `DATA.instance.summary.pageUrl`.
6. **Long tasks and errors** — two small stat panels from `DATA.longTasks` and `DATA.errors`, each expressed as a rate over `loads` as well as a raw count.
7. **Browser and device split** — `DATA.browserDevice` as a table sorted by `loads` desc.

Every section renders `—` for a null value and never treats null as zero. Reuse the existing `formatMs`, `formatBytes`, and `escHtml` helpers ported in Task 3 rather than writing new formatters.

- [ ] **Step 3: Build a synthetic aggregate data directory and render**

```bash
mkdir -p /tmp/fpa-agg && cp /tmp/fpa-synthetic/*.json /tmp/fpa-agg/
node -e '
const fs=require("fs");
const w=(n,v)=>fs.writeFileSync("/tmp/fpa-agg/"+n,JSON.stringify({result:{kind:"records",records:v}}));
w("cwv-percentiles.json",[{loads:1200,lcp_p50:1800,lcp_p75:3100,lcp_p95:6200,fcp_p50:900,fcp_p75:1400,fcp_p95:2600,inp_p50:80,inp_p75:190,inp_p95:520,cls_p50:0.01,cls_p75:0.08,cls_p95:0.31,ttfb_p50:300,ttfb_p75:900,ttfb_p95:1800}]);
w("ttfb-phases.json",[{loads:1200,dns_p75:20,connection_p75:60,waiting_p75:700,request_p75:100,cache_p75:20}]);
w("resources-agg.json",[{"url.full":"https://example.com/app.js","url.domain":"example.com","performance.initiator_type":"script",sessions:1190,requests:1190,duration_p50:400,duration_p75:820,duration_p95:1900,transfer_p75:240000,blocking:1190,failures:0}]);
w("thirdparty-agg.json",[{"url.domain":"cdn.example.net",sessions:1100,requests:2200,duration_p75:310,transfer_p75:90000}]);
w("longtasks-agg.json",[{loads:1200,loads_with_long_tasks:840,count_p75:3,avg_duration_p75:140}]);
w("errors-agg.json",[{loads:1200,loads_with_exception:60,loads_with_4xx:12,loads_with_5xx:0,exception_total:75,http_4xx_total:14,http_5xx_total:0}]);
w("browser-device.json",[{"browser.name":"Chrome","device.type":"desktop",loads:900,lcp_p75:2600},{"browser.name":"Safari","device.type":"mobile",loads:300,lcp_p75:5200}]);
'
node scripts/build-report.mjs --data /tmp/fpa-agg --page-title "/" --out /tmp/fpa-agg/report.html
open /tmp/fpa-agg/report.html
```

Expected: all seven aggregate sections render above the waterfall. The LCP p75 of 3100 ms shows in the warning colour; the CLS p95 of 0.31 shows in the critical colour; the Safari-mobile row shows a visibly worse LCP p75 than Chrome-desktop.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-report.mjs assets/report.html.tmpl
git commit -m "feat(full-page-analysis): add aggregate report sections"
```

---

## Phase 3 — Findings

### Task 7: Deterministic finding rules

**Files:**
- Create: `scripts/lib/findings.mjs`
- Create: `scripts/test-findings.mjs`
- Create: `references/findings-prompt.md`
- Modify: `scripts/build-report.mjs`
- Modify: `assets/report.html.tmpl`

**Interfaces:**
- Consumes: the `DATA` shape produced by Task 6.
- Produces: `export function computeFindings(data)` returning `Array<{ id, severity, title, evidence }>` where `severity` is `"high" | "medium" | "low"`, `evidence` is a plain-language string containing the actual numbers, and `id` is a stable kebab-case slug. Also `export const THRESHOLDS`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test-findings.mjs`:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import { computeFindings, THRESHOLDS } from "./lib/findings.mjs";

const base = {
  instance: { summary: { pageUrl: "https://example.com/", lcpElementType: "IMG", lcpElementUrl: "https://example.com/hero.jpg" }, requests: [], exceptions: [] },
  cwv: { loads: 1000, lcpP75: 1800, inpP75: 100, clsP75: 0.02, ttfbP75: 300 },
  ttfbPhases: { loads: 1000, dnsP75: 10, connectionP75: 20, waitingP75: 200, requestP75: 50, cacheP75: 20 },
  resources: [],
  thirdParty: [],
  longTasks: { loads: 1000, loadsWithLongTasks: 0, countP75: 0, avgDurationP75: null },
  errors: { loads: 1000, loadsWithException: 0, loadsWith4xx: 0, loadsWith5xx: 0, exceptionTotal: 0, http4xxTotal: 0, http5xxTotal: 0 },
  browserDevice: [{ browser: "Chrome", device: "desktop", loads: 1000, lcpP75: 1800 }],
};
const ids = (d) => computeFindings(d).map((f) => f.id);

// a healthy page produces no findings
assert.deepEqual(ids(base), []);

// thresholds are the documented Core Web Vitals values
assert.equal(THRESHOLDS.lcp.poor, 4000);
assert.equal(THRESHOLDS.ttfb.poor, 800);

// TTFB over 800ms fires
assert.ok(ids({ ...base, cwv: { ...base.cwv, ttfbP75: 950 } }).includes("slow-ttfb"));

// a resource blocking in most sessions fires; one blocking in a handful does not
const blocking = (sessions) => ({
  ...base,
  resources: [{ url: "https://example.com/a.css", domain: "example.com", initiatorType: "link",
                sessions, requests: sessions, durationP75: 600, transferP75: 20000, blocking: sessions, failures: 0 }],
});
assert.ok(ids(blocking(900)).includes("render-blocking"));
assert.ok(!ids(blocking(5)).includes("render-blocking"));

// the near-universal slow resource is named in the evidence with its numbers
const f = computeFindings(blocking(900)).find((x) => x.id === "render-blocking");
assert.match(f.evidence, /a\.css/);
assert.match(f.evidence, /900/);
assert.equal(f.severity, "high");

// a browser whose LCP p75 is far worse than the blended figure fires
assert.ok(
  ids({
    ...base,
    browserDevice: [
      { browser: "Chrome", device: "desktop", loads: 900, lcpP75: 1700 },
      { browser: "Safari", device: "mobile", loads: 300, lcpP75: 5200 },
    ],
  }).includes("segment-outlier")
);

// nulls never fire a threshold rule
assert.deepEqual(ids({ ...base, cwv: { ...base.cwv, ttfbP75: null, lcpP75: null } }), []);

console.log("test-findings: all assertions passed");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node scripts/test-findings.mjs
```

Expected: FAIL — `Cannot find module '.../scripts/lib/findings.mjs'`.

- [ ] **Step 3: Write the rules module**

Create `scripts/lib/findings.mjs`:

```js
// Deterministic finding rules. Pure functions, no I/O.
// Every rule must cite the numbers it fired on in `evidence` — a finding
// without numbers is not actionable and does not belong here.

export const THRESHOLDS = {
  lcp:  { good: 2500, poor: 4000 },
  fcp:  { good: 1800, poor: 3000 },
  inp:  { good: 200,  poor: 500 },
  cls:  { good: 0.1,  poor: 0.25 },
  ttfb: { good: 800,  poor: 1800 },
  resourceSlowMs: 500,
  thirdPartySlowMs: 200,
  // A resource matters only if it appears in most loads. Below this share of
  // page loads it is noise, not a page-wide problem.
  prevalence: 0.5,
  // A browser/device segment is an outlier if its LCP p75 exceeds the blended
  // p75 by this factor and it carries at least this share of loads.
  segmentRatio: 1.5,
  segmentMinShare: 0.05,
};

const num = (v) => (typeof v === "number" && !Number.isNaN(v) ? v : null);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export function computeFindings(data) {
  const out = [];
  const loads = num(data.cwv?.loads) || 0;

  const ttfb = num(data.cwv?.ttfbP75);
  if (ttfb != null && ttfb > THRESHOLDS.ttfb.good) {
    const p = data.ttfbPhases || {};
    out.push({
      id: "slow-ttfb",
      severity: ttfb > THRESHOLDS.ttfb.poor ? "high" : "medium",
      title: "Slow time to first byte",
      evidence: `TTFB p75 is ${Math.round(ttfb)}ms across ${loads} loads. Phases at p75 — DNS ${Math.round(num(p.dnsP75) ?? 0)}ms, connect ${Math.round(num(p.connectionP75) ?? 0)}ms, waiting ${Math.round(num(p.waitingP75) ?? 0)}ms, request ${Math.round(num(p.requestP75) ?? 0)}ms.`,
    });
  }

  const lcp = num(data.cwv?.lcpP75);
  if (lcp != null && lcp > THRESHOLDS.lcp.good) {
    const el = data.instance?.summary?.lcpElementType;
    const url = data.instance?.summary?.lcpElementUrl;
    out.push({
      id: "slow-lcp",
      severity: lcp > THRESHOLDS.lcp.poor ? "high" : "medium",
      title: "LCP above the good threshold",
      evidence: `LCP p75 is ${Math.round(lcp)}ms across ${loads} loads (good is under ${THRESHOLDS.lcp.good}ms).` +
        (el ? ` LCP element in the sampled load was <${el.toLowerCase()}>${url ? ` (${url})` : ""}.` : ""),
    });
  }

  const inp = num(data.cwv?.inpP75);
  if (inp != null && inp > THRESHOLDS.inp.good) {
    out.push({
      id: "slow-inp",
      severity: inp > THRESHOLDS.inp.poor ? "high" : "medium",
      title: "Interaction latency above the good threshold",
      evidence: `INP p75 is ${Math.round(inp)}ms across ${loads} loads (good is under ${THRESHOLDS.inp.good}ms).`,
    });
  }

  const cls = num(data.cwv?.clsP75);
  if (cls != null && cls > THRESHOLDS.cls.good) {
    out.push({
      id: "layout-shift",
      severity: cls > THRESHOLDS.cls.poor ? "high" : "medium",
      title: "Cumulative layout shift above the good threshold",
      evidence: `CLS p75 is ${cls.toFixed(3)} across ${loads} loads (good is under ${THRESHOLDS.cls.good}).`,
    });
  }

  const prevalent = (r) => loads > 0 && r.sessions / loads >= THRESHOLDS.prevalence;

  const blockers = (data.resources || [])
    .filter((r) => r.blocking > 0 && prevalent(r))
    .sort((a, b) => (num(b.durationP75) ?? 0) - (num(a.durationP75) ?? 0));
  if (blockers.length) {
    const top = blockers.slice(0, 5);
    out.push({
      id: "render-blocking",
      severity: "high",
      title: "Render-blocking resources on most loads",
      evidence: `${blockers.length} render-blocking resource(s) appear in at least ${Math.round(THRESHOLDS.prevalence * 100)}% of loads. Slowest: ` +
        top.map((r) => `${r.url} (p75 ${Math.round(num(r.durationP75) ?? 0)}ms, ${r.sessions} sessions)`).join("; ") + ".",
    });
  }

  const slow = (data.resources || [])
    .filter((r) => (num(r.durationP75) ?? 0) > THRESHOLDS.resourceSlowMs && prevalent(r) && r.blocking === 0)
    .sort((a, b) => (num(b.durationP75) ?? 0) - (num(a.durationP75) ?? 0));
  if (slow.length) {
    out.push({
      id: "slow-resources",
      severity: "medium",
      title: "Consistently slow resources",
      evidence: `${slow.length} resource(s) exceed ${THRESHOLDS.resourceSlowMs}ms at p75 on most loads. Slowest: ` +
        slow.slice(0, 5).map((r) => `${r.url} (p75 ${Math.round(num(r.durationP75) ?? 0)}ms, ${r.sessions} sessions)`).join("; ") + ".",
    });
  }

  const origin = (() => {
    try { return new URL(data.instance?.summary?.pageUrl || "").hostname; } catch { return null; }
  })();
  const thirdParty = (data.thirdParty || [])
    .filter((d) => d.domain && d.domain !== origin && (num(d.durationP75) ?? 0) > THRESHOLDS.thirdPartySlowMs)
    .sort((a, b) => (num(b.durationP75) ?? 0) - (num(a.durationP75) ?? 0));
  if (thirdParty.length) {
    out.push({
      id: "slow-third-party",
      severity: "medium",
      title: "Slow third-party domains",
      evidence: thirdParty.slice(0, 5)
        .map((d) => `${d.domain} (p75 ${Math.round(num(d.durationP75) ?? 0)}ms over ${d.requests} requests)`)
        .join("; ") + ".",
    });
  }

  const lt = data.longTasks || {};
  if (num(lt.loadsWithLongTasks) && loads > 0 && lt.loadsWithLongTasks / loads > 0.25) {
    out.push({
      id: "long-tasks",
      severity: "medium",
      title: "Main thread blocked by long tasks",
      evidence: `${lt.loadsWithLongTasks} of ${loads} loads (${pct(lt.loadsWithLongTasks, loads)}%) had long tasks; p75 count ${num(lt.countP75) ?? 0}, p75 average duration ${Math.round(num(lt.avgDurationP75) ?? 0)}ms.`,
    });
  }

  const err = data.errors || {};
  const failing = (num(err.loadsWithException) ?? 0) + (num(err.loadsWith4xx) ?? 0) + (num(err.loadsWith5xx) ?? 0);
  if (failing > 0 && loads > 0 && failing / loads > 0.05) {
    out.push({
      id: "errors",
      severity: (num(err.loadsWith5xx) ?? 0) > 0 ? "high" : "medium",
      title: "Errors on a meaningful share of loads",
      evidence: `${pct(num(err.loadsWithException) ?? 0, loads)}% of loads had a JS exception, ${pct(num(err.loadsWith4xx) ?? 0, loads)}% a 4xx, ${pct(num(err.loadsWith5xx) ?? 0, loads)}% a 5xx, across ${loads} loads.`,
    });
  }

  const segs = (data.browserDevice || []).filter((s) => num(s.lcpP75) != null && s.loads > 0);
  const totalSegLoads = segs.reduce((s, x) => s + x.loads, 0);
  if (totalSegLoads > 0 && lcp != null) {
    const outliers = segs.filter(
      (s) => s.lcpP75 > lcp * THRESHOLDS.segmentRatio && s.loads / totalSegLoads >= THRESHOLDS.segmentMinShare
    );
    if (outliers.length) {
      out.push({
        id: "segment-outlier",
        severity: "medium",
        title: "One or more segments are much slower than the blend",
        evidence: outliers
          .map((s) => `${s.browser} on ${s.device}: LCP p75 ${Math.round(s.lcpP75)}ms over ${s.loads} loads, versus a blended p75 of ${Math.round(lcp)}ms`)
          .join("; ") + ".",
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node scripts/test-findings.mjs
```

Expected: `test-findings: all assertions passed`.

Note the base fixture has `lcpP75: 1800`, below the good threshold, so `slow-lcp` does not fire and the healthy-page assertion holds. If `deepEqual(ids(base), [])` fails, a rule is firing on healthy data — fix the rule, not the assertion.

- [ ] **Step 5: Wire findings into the build and the template**

In `scripts/build-report.mjs`:

```js
import { computeFindings } from "./lib/findings.mjs";
```

After `data` is assembled, add `data.findings = computeFindings(data);`. Then accept an optional `--findings <file.md>` flag: when present, read the markdown, convert it with the same `extractMarkdownSection` / `markdownToHtml` pair used by `monthly-report/scripts/build-report.mjs` (copy those two functions verbatim), and substitute the result into a `{{ANALYST_NOTES}}` placeholder. When absent, substitute an empty string.

In `assets/report.html.tmpl`, add above the Core Web Vitals section:

```html
<section class="panel" id="findings-panel">
  <h2>Findings</h2>
  <div id="computed-findings"></div>
  <h2>Analyst notes</h2>
  <div class="exec-body">{{ANALYST_NOTES}}</div>
</section>
```

Render `DATA.findings` into `#computed-findings` as one row per finding: a severity chip coloured `var(--dt-critical)` / `var(--dt-warning)` / `var(--dt-text-secondary)`, the title, and the evidence string.

Finally, mirror `monthly-report`'s editability: after building the HTML string, apply

```js
html = html.replace(/class="exec-body"/g, 'class="exec-body" contenteditable="true" spellcheck="false"');
```

- [ ] **Step 6: Write the findings prompt**

Create `references/findings-prompt.md`. It must state:

- The agent writes markdown with `## ` headings; `build-report.mjs` extracts sections by case-insensitive substring match on the heading, exactly as `monthly-report` does.
- The only required heading is `## Analyst notes`.
- The agent reads the computed findings from `DATA.findings` (available in the rendered HTML, and printable by running `node -e` against the same data directory) and writes prose that interprets them. It must not restate the numbers the findings already carry, and must not invent numbers that are not in the query output.
- Core Web Vitals thresholds to cite, copied from `THRESHOLDS` in `scripts/lib/findings.mjs`: LCP good under 2500ms / poor over 4000ms; INP good under 200ms / poor over 500ms; CLS good under 0.1 / poor over 0.25; TTFB good under 800ms; FCP good under 1800ms.
- Formatting: milliseconds under 1000 as `123ms`, 1000 and over as `1.23s`; CLS to three decimals; `—` for null, never zero.
- The waterfall shows one sampled load. Prose must not generalize from it — generalizations come from the aggregate sections only.

- [ ] **Step 7: Re-render and verify**

```bash
node scripts/build-report.mjs --data /tmp/fpa-agg --page-title "/" --out /tmp/fpa-agg/report.html
open /tmp/fpa-agg/report.html
```

Expected: the findings panel lists `slow-ttfb`, `slow-lcp`, `layout-shift`, `render-blocking`, `slow-third-party`, `long-tasks`, `errors`, and `segment-outlier` from the Task 6 synthetic data, high severity first. The analyst notes area is empty and editable.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/findings.mjs scripts/test-findings.mjs references/findings-prompt.md scripts/build-report.mjs assets/report.html.tmpl
git commit -m "feat(full-page-analysis): add deterministic finding rules and analyst notes"
```

---

## Phase 4 — PDF

### Task 8: PDF rendering path

**Files:**
- Copy: `assets/render-pdf.sh`, `assets/render-pdf.ps1` from `../monthly-report/assets/`
- Modify: `assets/report.html.tmpl` (print stylesheet)
- Modify: `scripts/build-report.mjs` (save bar)

**Interfaces:**
- Consumes: the HTML produced by Task 7.
- Produces: `bash assets/render-pdf.sh <in.html> <out.pdf>`.

- [ ] **Step 1: Copy the renderers**

```bash
cp ../monthly-report/assets/render-pdf.sh assets/render-pdf.sh
cp ../monthly-report/assets/render-pdf.ps1 assets/render-pdf.ps1
chmod +x assets/render-pdf.sh
```

- [ ] **Step 2: Add the print stylesheet**

Append to the second `<style>` block in `assets/report.html.tmpl`:

```css
@media print {
  body { padding: 0; background: #fff; color: #000; }
  .panel { break-inside: avoid; page-break-inside: avoid; border-color: #ccc; }
  /* The waterfall is wide and interactive; in print it is clipped to the top
     rows and its controls and tooltips are dropped. See the spec's
     "PDF constraints" section. */
  #waterfall-controls, #waterfall-tooltip, .sticky-pills { display: none !important; }
  #waterfall .wf-row:nth-child(n+21) { display: none; }
  #waterfall-panel::after {
    content: "Waterfall clipped to the 20 slowest resources for print. See the HTML report for the full interactive view.";
    display: block; margin-top: 8px; font-size: 11px; color: #555;
  }
}
```

If the ported waterfall markup does not use `.wf-row` for its per-resource rows, use whatever class it does use, and update the selector rather than the markup.

- [ ] **Step 3: Add the save bar**

Copy the floating save-bar injection block verbatim from `monthly-report/scripts/build-report.mjs` — the `html.replace("</body>", ...)` block including its `@media print{#dt-save-bar{display:none!important}}` rule and the `dtSave()` function — into `scripts/build-report.mjs`, immediately before the file is written. Change only the accent colours to `var(--dt-primary)` where a literal is used.

- [ ] **Step 4: Render a PDF and inspect it**

```bash
bash assets/render-pdf.sh /tmp/fpa-agg/report.html /tmp/fpa-agg/report.pdf
ls -la /tmp/fpa-agg/report.pdf
open /tmp/fpa-agg/report.pdf
```

Expected: a non-zero PDF. Verify by eye that no panel is split across a page boundary, the save bar does not appear, and the waterfall clipping note is present.

- [ ] **Step 5: Commit**

```bash
git add assets/render-pdf.sh assets/render-pdf.ps1 assets/report.html.tmpl scripts/build-report.mjs
git commit -m "feat(full-page-analysis): add PDF rendering path"
```

---

## Phase 5 — Skill rewrite

### Task 9: Rewrite SKILL.md, README, and retire v1 assets

**Files:**
- Rewrite: `SKILL.md`
- Rewrite: `README.md`
- Delete: `assets/template.html`, `scripts/build-waterfall.mjs`
- Modify: `../../.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped skill.

- [ ] **Step 1: Rewrite SKILL.md**

Target roughly 300 lines, matching `monthly-report/SKILL.md` in shape. Carry over verbatim from the current `SKILL.md`: the `--install` section and the context-check section. Replace everything from "Step 0" onward with:

1. **Mode selection** — "I have an instance ID" or "Find one for me", via `AskUserQuestion`, as today.
2. **Instance ID path** — resolve metadata with the 7-day then 30-day expansion, and the wrong-type check that tells the user `"This instance is a {user_action.type} event, not a hard navigation."` Carry the existing prose over.
3. **Selection path** — run `fpa-frontends.dql`, then `fpa-pages.dql`, then compute the p75 bounds and run `fpa-select-instance.dql`. Keep the existing paging behaviour: at most 3 options at a time plus "Show more...", options in the order the query returned them, counts in the labels. Keep the ±15% window widening to ±25% on an empty result.
4. **Run the queries** — one `dtctl query` per file, output filenames from `references/queries.md`, into `/tmp/fpa-<slug>/`. Background all invocations with `&` and `wait` for them, as `monthly-report` does.
5. **Author findings** — follow `references/findings-prompt.md`, write `/tmp/fpa-<slug>/findings.md`.
6. **Build** — `node <SKILL_BASE_DIR>/scripts/build-report.mjs --data /tmp/fpa-<slug> --findings /tmp/fpa-<slug>/findings.md --page-title "<PAGE>" --out ~/Downloads/full-page-analysis-<slug>-<YYYY-MM-DD>.html`
7. **Preview** — open the HTML, let the user edit the analyst notes and save; document the `--no-preview` flag that skips this step, matching `monthly-report`.
8. **PDF** — `bash <SKILL_BASE_DIR>/assets/render-pdf.sh <html> <pdf>`, preferring a user-saved copy in `~/Downloads` if one exists.

No DQL appears in `SKILL.md`. Every query is referenced by filename.

- [ ] **Step 2: Rewrite README.md**

Update the outputs table to the two new artifacts, replace the "Report sections" list with the Task 6 section list plus the findings panel, and state plainly that all statistics are cross-session aggregates while the waterfall is a single sampled load.

- [ ] **Step 3: Delete the v1 assets**

```bash
git rm assets/template.html scripts/build-waterfall.mjs
```

Both are fully superseded: the normalizer moved to `scripts/lib/normalize.mjs` in Task 1 and the rendering moved into `assets/report.html.tmpl` in Task 3.

- [ ] **Step 4: Bump versions**

In `SKILL.md` frontmatter set `version: 2.0.0`. In `../../.claude-plugin/plugin.json` bump `version` from `2.10.6` to `2.11.0`.

- [ ] **Step 5: Full end-to-end run**

Against a real frontend and page, with `dtctl` configured:

```bash
node scripts/test-normalize.mjs && node scripts/test-findings.mjs
```

Expected: both pass. Then run the skill end to end and confirm both `~/Downloads/full-page-analysis-*.html` and `~/Downloads/full-page-analysis-*.pdf` exist and are correct.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(full-page-analysis): v2 — aggregate analysis, Strato waterfall, HTML + PDF"
```

---

## Deferred

**Synthesized aggregate waterfall** — bars from cross-session resource p75 start times and durations rather than one real session. `DATA.resources` already carries the per-resource percentiles it would need. Not built: it reuses the bar-layout and normalization code paths, so it should only follow a passed Phase 1 gate, and the per-resource p75 table from Task 6 may already carry the analytical value on its own.
