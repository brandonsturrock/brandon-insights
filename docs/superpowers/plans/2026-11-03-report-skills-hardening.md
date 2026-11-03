# Report Skills Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `monthly-report` and `trending-report` install and run unchanged on macOS, Windows and Linux, render correct numbers for every frontend, and cost fewer tokens and less DQL scan per run.

**Architecture:** Move every OS-specific shell step (query fan-out, browser discovery, open, PDF render, cleanup) into two Node scripts that are byte-identical copies in both skills (`run-queries.mjs`, `render-pdf.mjs`). Fix data bugs at their shared root (`loadRecords`, DQL `union: true`). `setup` becomes the single install owner; each report SKILL.md shrinks to a precheck plus a bash-only workflow.

**Tech Stack:** Node ≥ 18 stdlib only (`node:fs`, `node:path`, `node:os`, `node:url`, `node:child_process`, `node:assert/strict`), DQL via dtctl ≥ 0.45.0, headless Chromium-based browser, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-report-skills-review.md` (finding IDs I*, D*, E*, U* referenced per task).

## Global Constraints

- All paths below are relative to `plugins/tools/skills/` unless they start with `.github/`, `docs/` or `plugins/`.
- Node ≥ 18, no npm dependencies, no new files outside the ones listed per task.
- Every command written into a SKILL.md must run unchanged in bash/zsh (macOS, Linux) and Git Bash (Windows — Claude Code's Bash tool). No `/tmp`. Use `$HOME` (valid in bash and PowerShell).
- Windows requires Git for Windows (spec I17): without it Claude Code's shell is PowerShell. `setup` installs it; report skills detect PowerShell in their precheck and send the user to `setup`. The only PowerShell-compatible commands anywhere are setup's Step 0 bootstrap and its `powershell -NoProfile -ExecutionPolicy Bypass -Command "…"` dtctl install.
- Work dir: `$HOME/.dt-reports/<SLUG>-<KIND>-<YYYY-MM>/`. Final PDF: `$HOME/Downloads/<SLUG>-<KIND>-<YYYY-MM>.pdf`. `KIND` ∈ `monthly` | `trending`. `YYYY-MM` = last complete calendar month (UTC) for both kinds.
- `SLUG` = frontend name lowercased, each run of characters outside `[a-z0-9.-]` replaced by `-`, leading/trailing `-` trimmed.
- Files that must stay byte-identical across both skills: `scripts/run-queries.mjs`, `scripts/render-pdf.mjs`, `scripts/test-run-queries.mjs`, `scripts/test-render-pdf.mjs`, `references/frontends.dql`, `assets/chart.umd.min.js`. Edit in `monthly-report/`, then `cp` to `trending-report/`.
- No imports across skill directories (each skill is zipped standalone by `.github/workflows/release-skills.yml`).
- Tests: plain `node scripts/test-<name>.mjs` using `node:assert/strict`; silent on pass, non-zero exit on failure (matches `full-page-analysis/scripts/test-*.mjs`).
- dtctl invocation for report queries: `query -f <file> --set frontend=<name> -o json --agent --spill=never [--context <ctx>]`.
- CWV thresholds unchanged: LCP good `<2500ms` poor `≥4000ms`; INP good `<200ms` poor `≥500ms`; CLS good `<0.1` poor `≥0.25`.
- Commits: conventional (`fix(monthly-report): …`, `feat(tools): …`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Out of scope: `full-page-analysis` and `user-journeys` (same render-pdf.sh/.ps1 pattern — follow-up).

## Review Focus

- **Windows usernames with spaces** (`C:\Users\John Smith`) — browser must get a percent-encoded `file:` URL and an unsplit `--print-to-pdf` arg. Test: Task 6 `chromeArgs` space-in-path assertion; CI Windows job.
- **Frontend names with quotes, spaces, slashes** (`Shop "EU"/web app`) — must reach dtctl verbatim as one argument and never appear in a path. Test: Task 5 verbatim-argv assertion.
- **Browser save naming** — second save is `<stem> (1).html`; the PDF must use the newest saved copy, ignore unrelated files. Test: Task 6 `pickSource` assertions.
- **Frontend with little or no data** (no mobile, no INP, empty months) — build must not throw; show "—", never "0" or "good". Tests: Task 1 and Task 2 empty-input assertions.
- **PDF render failure** (no browser, Chrome crash) — exit non-zero, delete nothing. Test: Task 6 `finalize` empty-PDF assertion.

---

### Task 1: Monthly build — data correctness (D2, D3, D5, D6, D10, E2, E9)

**Files:**
- Modify: `monthly-report/scripts/build-report.mjs`
- Create: `monthly-report/scripts/test-build-report.mjs`

**Interfaces:**
- Produces: `export function loadRecords(dataDir: string, filename: string): object[]`; `export function buildCurrentMonthData(dataDir: string): Data` where `Data` gains `monthLabel: string` (e.g. `"October 2026"`) and `cmCwvDistribution` becomes `{ lcp: { p75 }, inp: { p75 }, cls: { p75 } }` (no `buckets`/`counts`). `assembleHtml` signature unchanged.

- [ ] **Step 1: Write failing tests** in `test-build-report.mjs`. Helper `makeDataDir(overrides)` writes all 9 required files (`cm-daily-device`, `cm-daily-cwv`, `cm-top-pages`, `cm-top-exceptions`, `cm-top-request-errors`, `cm-error-count`, `cm-errors`, `cm-device-compare`, `cm-cwv-tier`) into `fs.mkdtempSync(path.join(os.tmpdir(), "cm-"))` as `{"ok":true,"result":{"kind":"records","records":[…],"constant":{…}}}`, empty records by default. Assertions:

```js
// D2: constant hoisted by dtctl is merged back
// cm-daily-device records lack device.type; constant {"device.type":"desktop"}
// days 2026-10-01, 2026-10-02 sessions 1303, 1290
assert.deepEqual(data.cmDailyDevice.desktop, [1303, 1290]);
// D3: string counts summed, not concatenated (cm-daily-device has rows for the same days — it defines the axis)
// cm-errors 2026-10-01: desktop {total_sessions:"1275", js_error_sessions:"5"}, mobile {total_sessions:"800", js_error_sessions:"2"}
assert.equal(data.cmErrorRates.jsErrorRate[0], 0.34);
// D5: day with no CWV row is null, not 0
assert.equal(data.cmDailyCwv.lcp.desktop[1], null);
// D6: rows supplied out of order are sorted
assert.deepEqual(data.cmDailyDevice.labels, ["1", "2"]);
// D10: warm-up days dropped, month derived from data (rows 2026-09-29, 2026-09-30, 2026-10-01, 2026-10-02)
assert.equal(data.monthLabel, "October 2026");
// empty everything: no throw, KPIs show em dash
assert.equal(emptyData.kpis[0].value, "—");
assert.equal(emptyData.kpis[1].value, "—");
```

- [ ] **Step 2: Run and confirm failure**
Run: `node monthly-report/scripts/test-build-report.mjs`
Expected: non-zero exit (`loadRecords` not exported / assertion errors).

- [ ] **Step 3: Implement in `build-report.mjs`**
  - `loadRecords`: export it; return `records.map(r => ({ ...result.constant, ...r }))` when `result.constant` is an object.
  - `errByDay` sums: `Number(r.total_sessions) || 0` (same for `js_error_sessions`, `req_error_sessions`).
  - `byDayDevice`: `new Array(days.length).fill(null)`.
  - All day sorts: `.sort()` (ISO strings sort lexicographically).
  - Month: `monthStart` = first day (`YYYY-MM-01`) of the month of the max `day` in `cm-daily-device` rows; `monthLabel` from it (`toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })`). `renderReport` uses `data.monthLabel` for `dateRangeLabel` (demo keeps its clock-based label).
  - KPIs: `value: "—"` when `deviceCompareRows` is empty.
  - Stop reading `cm-cwv-distribution.json`; drop `LCP_BUCKETS`/`INP_BUCKETS`/`CLS_BUCKETS`/`bucketCounts`; emit `cmCwvDistribution` with p75 only (demo data likewise).
  - Delete helpers with zero call sites (`grep -n` each): `pctChange`, `monthLabel`, `monthYearLabel`. Keep `fmtMs` (Task 4 uses it).
  - Fix the stale comment `// 5-page layout` → 4-page.

- [ ] **Step 4: Run tests and fixture preview**
Run: `node monthly-report/scripts/test-build-report.mjs && node monthly-report/scripts/preview.mjs "$HOME/.dt-reports/preview-cm.html"`
Expected: exit 0, `Wrote …preview-cm.html`.

- [ ] **Step 5: Commit** — `fix(monthly-report): merge dtctl constants, numeric error sums, null gaps, data-derived month`

---

### Task 2: Trending build — exports + data correctness (D2, D5, D6, D9, U8)

**Files:**
- Modify: `trending-report/scripts/build-report.mjs`, `trending-report/scripts/preview.mjs`
- Create: `trending-report/scripts/test-build-report.mjs`

**Interfaces:**
- Produces: `export function loadRecords(dataDir, filename): object[]` (same constant merge as Task 1); `export function buildTrendingData(dataDir: string): Data`; `export function assembleHtml({ data, findings, frontend, environment, dateRangeLabel, generatedAt, outPath }): void` — same signature as monthly's. CLI parsing/validation guarded by monthly's `isMain` pattern.

- [ ] **Step 1: Write failing tests** (same `makeDataDir` helper shape; files `metrics-monthly`, `cwv-monthly`, `cwv-weekly`, `browser-perf-monthly`, `traffic-weekly`):

```js
// D6: browser rows shuffled across months 2026-05..2026-10; latest month decides rank
assert.equal(data.browserPerf.panels[0].label, "Chrome · Desktop");     // most visits in 2026-10
assert.deepEqual(data.browserPerf.panels[0].months.map(m => m.label).slice(0, 2), ["May 2026", "Jun 2026"]);
// D2: browser rows with constant {"device.type":"desktop"} still produce panels
assert.notEqual(data.browserPerf.panels[0], null);
// D5: month with Sessions 0 (no data yet) is null
assert.equal(data.trafficMonthly.sessions[0], null);
// leading partial week (2026-04-26, before first month 2026-05-01) dropped
assert.equal(data.cwvWeekly.labels[0], "May 3");
// empty everything: no throw, 6 blank panels, KPI em dash
assert.equal(emptyData.browserPerf.panels.length, 6);
assert.equal(emptyData.kpis[0].value, "—");
```

- [ ] **Step 2: Run and confirm failure**
Run: `node trending-report/scripts/test-build-report.mjs` — Expected: non-zero exit.

- [ ] **Step 3: Implement**
  - Wrap arg parsing/validation and the final `renderReport` call in `isMain` (copy monthly lines 39-52 shape). Split `renderReport` into `assembleHtml(...)` (substitution, Chart.js inlining, contenteditable, save bar, write) and a CLI wrapper.
  - `loadRecords` constant merge (identical code to Task 1).
  - Sorts: `metricsRows`/`cwvRows` by `(a, b) => a.month.localeCompare(b.month)`; `allMonths` `.sort()`.
  - `Sessions`, `XHR Requests`, `Navigations` → `null` for a month whose `Sessions` is 0 or null.
  - Weekly rows (`cwv-weekly`, `traffic-weekly`): also drop rows with `week <` the earliest `month` in `metricsRows` (skip when `metricsRows` is empty).
  - Remove `totalVisits`; rewrite the selection comment to "rank by latest month's visits".
  - `preview.mjs`: delete its copy of the substitution logic; `import { assembleHtml } from "./build-report.mjs"`; accept `--out <path>` or a positional path (monthly's parsing); default `path.join(process.env.CLAUDE_SCRATCH_DIR || os.tmpdir(), "preview-trending.html")`. Apply the same `os.tmpdir()` default to `monthly-report/scripts/preview.mjs`.

- [ ] **Step 4: Run tests and fixture preview**
Run: `node trending-report/scripts/test-build-report.mjs && node trending-report/scripts/preview.mjs "$HOME/.dt-reports/preview-trending.html"` — Expected: exit 0, `Wrote …`.

- [ ] **Step 5: Commit** — `fix(trending-report): export assembleHtml, merge dtctl constants, sort months, null empty months`

---

### Task 3: DQL fixes (D1, D4, D6, E2, E9)

**Files:**
- Modify: `monthly-report/references/queries/{cm-daily-cwv,cm-device-compare,cm-daily-device}.dql`, `trending-report/references/queries/{browser-perf-monthly,cwv-monthly,cwv-weekly,metrics-monthly,traffic-weekly}.dql`
- Delete: `monthly-report/references/queries/cm-cwv-distribution.dql`

**Interfaces:**
- Produces: same output columns and filenames as today (contract for build scripts), minus `cm-cwv-distribution.json`.

- [ ] **Step 1: Apply edits**
  - Append `, union: true` to the `timeseries` parameter list (after `filter: …` / `by: {…}`) in: `cm-daily-cwv`, `cm-device-compare`, `browser-perf-monthly`, `cwv-monthly`, `cwv-weekly`, `metrics-monthly`, `traffic-weekly`.
  - All 5 trending files: `from: -6M` → `from: now()@M - 6M`.
  - `cwv-monthly`: remove `x=countDistinct(…)` and `d = x[]`. `metrics-monthly`: remove `z = percentile(…)` and `z=z[]`.
  - `browser-perf-monthly`: append `| sort month asc`.
  - Replace the `fieldsAdd <name> = d[<name>] …` + `fields`/`fieldsRemove d` pair with a single `fields` assignment (removes "overrides an existing field" warnings and the stray `t` array), e.g. `cm-daily-cwv` becomes (verified on tenant):

```
| fieldsAdd d = record(t=t[], lcp=lcp[], inp=inp[], cls=cls[])
| expand d
| fields day = d[t], lcp = d[lcp], inp = d[inp], cls = d[cls], device.type
| filterOut isNull(device.type)
| sort day asc
```
  Same pattern for `cm-daily-device` (`fields day = d[t], sessions = d[sessions], device.type`), `cwv-weekly` (`fields week = d[t], lcp = d[lcp], inp = d[inp], cls = d[cls]`), `traffic-weekly` (`fields week = d[t], sessions = d[sessions], xhr = d[xhr], navigations = d[navigations]`). Keep each file's existing `filterOut`/`sort` lines after it.

- [ ] **Step 2: Verify on tenant** (needs a dtctl context; in Nov 2026 `demo live`; the monthly event queries scan ~200 GB per frontend — run once)

```bash
for F in "www.cloud.easytravel.com" "EasyTrade"; do for q in monthly-report/references/queries/*.dql trending-report/references/queries/*.dql; do
  printf '%s %s: ' "$F" "$(basename "$q")"
  dtctl query -f "$q" --set frontend="$F" -o json --agent --spill=never | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=JSON.parse(s);console.log(d.ok, (d.result.records||[]).length, d.context.window?.from, (d.context.warnings||[]).join("|"))})'
done; done
```
Expected: every line `true`; `www.cloud.easytravel.com cm-device-compare.dql` ≥ 2 rows (was 0); `cm-daily-cwv.dql` > 0 rows (was 0); `browser-perf-monthly.dql` > 0 rows (was 0); trending windows start on the 1st of a month; no warning containing `overrides`. `EasyTrade cm-device-compare.dql` desktop row unchanged by `union: true` (`sessions` 475300 before and after, when run in Nov 2026).

- [ ] **Step 3: Commit** — `fix(reports): outer-join multi-metric timeseries, month-align trending window, drop unused distribution query`

---

### Task 4: `--print-tables` + findings prompts (E3, D7, D8, U7)

**Files:**
- Modify: `monthly-report/scripts/build-report.mjs`, `trending-report/scripts/build-report.mjs`, both `references/findings-prompt.md`
- Test: both `scripts/test-build-report.mjs`

**Interfaces:**
- Consumes: `buildCurrentMonthData`, `buildTrendingData` (Tasks 1-2).
- Produces: `export function renderTables(data: Data): string` in each build script; CLI `node build-report.mjs --data <dir> --print-tables` prints it and exits (no `--out`/`--findings` needed). `--type` is no longer required (ignored if passed).

- [ ] **Step 1: Write failing tests** (append to each `test-build-report.mjs`):

```js
const t = renderTables(data);
assert.match(t, /^### Device Comparison$/m);                       // monthly
assert.match(t, /^Device \| Sessions \| Page Loads \| LCP p75 \| INP p75 \| CLS p75$/m);
assert.match(t, /\| 1\.55s \|/);   // lcp 1547 ms
assert.match(t, /\| 180ms \|/);    // inp 180 ms
assert.match(t, /\| 0\.069/);      // cls already ÷10000 in data
assert.match(t, /\| — \|/);        // null renders em dash
// trending
assert.match(tt, /^### Browser & Device \(shown panels\)$/m);
```

- [ ] **Step 2: Run, confirm failure** — `node <skill>/scripts/test-build-report.mjs` both → non-zero.

- [ ] **Step 3: Implement**
  - `parseArgs`: copy `full-page-analysis/scripts/build-report.mjs:62-75` boolean-flag handling (a flag followed by nothing or another `--flag` is `true`).
  - Formatting: ms `<1000` → `"123ms"`, else `"1.23s"` (existing `fmtMs`); CLS `toFixed(3)`; counts `toLocaleString("en-US")`; percentages `toFixed(1) + "%"`; null/undefined → `"—"`. Rows are `a | b | c`.
  - Monthly tables, in order (`### ` heading, header row, rows): `Daily Sessions (<monthLabel>)` `Day | Desktop | Mobile`; `Daily CWV p75 (<monthLabel>)` `Day | Device | LCP | INP | CLS`; `Device Comparison` (header above); `CWV Tiers` `Metric | Good | Needs Improvement | Poor`; `Top Pages` `Page | Visits | LCP p75 | INP p75 | CLS p75 | Avg Exceptions | Avg Req Errors`; `Daily Error Rates (% of sessions)` `Day | JS Error % | Request Error %`; `Daily Error Counts` `Day | JS Error | Request`; `Top Exceptions` `Count | Type | Message | Source`; `Top Request Errors` `Count | Method | Status | Host | Path`. Omit the Mobile column/rows when the mobile series is null.
  - Trending tables: `Monthly Traffic` `Month | Sessions | XHR Requests | Navigations | % Desktop`; `Monthly CWV p75` `Month | LCP | INP | CLS`; `Weekly CWV p75` `Week | LCP | INP | CLS`; `Browser & Device (shown panels)` `Panel | Month | Visits | LCP | INP | CLS` (non-null panels only, every month).
  - Rewrite both `findings-prompt.md` (target ≤ 70 lines each):
    1. Input: run `node <SKILL_BASE_DIR>/scripts/build-report.mjs --data "$WORK" --print-tables`; analyse only that output; never read the raw JSON or `queries.md`. `—` means not measured — never treat it as zero.
    2. Persona + thresholds (unchanged values).
    3. Rules: bullets only, ≤ 3 per heading (cards clip overflow — both skills), ~15 words, hard cap 20, lead with the finding, no preamble/advice/causes not in data, `- No notable changes.` fallback.
    4. Headings exactly — monthly: `## Traffic`, `## Core Web Vitals`, `## Top Pages`, `## Error Rates`; trending: `## Traffic`, `## Core Web Vitals`, `## Browser & Device`.
    5. Append `## Raw Data` containing the printed tables verbatim (not rendered).
    6. Keep each file's worked example.
    Delete: CoPilot history, `buildSupplementary` references, the `queries.md` filename pointer, monthly §4a, trending "Flag error-session spikes" line and every "top 8".

- [ ] **Step 4: Run tests + live check**
Run: both test files; then on Task 3's live data dir `node monthly-report/scripts/build-report.mjs --data "$WORK" --print-tables | head -20`.
Expected: tests exit 0; tables print, no `NaN`, no `undefined`.

- [ ] **Step 5: Commit** — `feat(reports): --print-tables for findings; tighten findings prompts`

---

### Task 5: `run-queries.mjs` — cross-platform query runner + frontend picker (I9, I10, I13, I15, E1, E6, E8)

**Files:**
- Create: `monthly-report/scripts/run-queries.mjs`, `monthly-report/scripts/test-run-queries.mjs`, `monthly-report/references/frontends.dql`; then copy all three to `trending-report/` (identical).

**Interfaces:**
- Produces:
  - `export function resolveDtctl(env = process.env, platform = process.platform, exists = fs.existsSync): string | null` — `"dtctl"` when `dtctl` or `dtctl.exe` exists in any `env.PATH` entry (split on `path.delimiter`); else first existing of: win32 `path.win32.join(env.LOCALAPPDATA, "dtctl", "dtctl.exe")`; others `~/.local/bin/dtctl`, `/usr/local/bin/dtctl`, `/opt/homebrew/bin/dtctl`; else `null`.
  - `export async function runQueries({ frontend: string, outDir: string, context?: string, dtctl: { cmd: string, prefixArgs: string[] }, queriesDir: string }): Promise<Array<{ name: string, ok: boolean, rows: number, error: string | null }>>` — `mkdirSync(outDir, { recursive: true })`; one concurrent `child_process.spawn` per `*.dql` (sorted), args `[...prefixArgs, "query", "-f", file, "--set", "frontend=" + frontend, "-o", "json", "--agent", "--spill=never", ...(context ? ["--context", context] : [])]`, no shell; stdout written to `outDir/<name>.json`; `ok` = envelope `ok === true` and `result.kind === "records"`; `error` = `envelope.error.message` ?? first stderr line ?? `"unparseable dtctl output — dtctl too old? run the setup skill"`.
  - CLI: `node run-queries.mjs --frontend <name> --out <dir> [--context <ctx>]` prints `<name>: <rows> rows` or `<name>: FAILED <error>` per query, exit 1 if any failed; `node run-queries.mjs --list-frontends [--context <ctx>]` runs `../references/frontends.dql` and prints `<page_loads>\t<frontend.name>` per row; dtctl unresolvable → stderr `dtctl not found — run the setup skill (/tools:setup), then restart Claude Code`, exit 2.
- `references/frontends.dql` (verified: 0 bytes scanned, 67 ms, web frontends only):

```
timeseries loads = sum(dt.frontend.web.page.largest_contentful_paint, rollup: count), from: now()-7d, by: {frontend.name}
| fieldsAdd page_loads = arraySum(loads)
| fields frontend.name, page_loads
| sort page_loads desc
| limit 30
```

- [ ] **Step 1: Write failing tests.** Fake dtctl = `{ cmd: process.execPath, prefixArgs: [fake] }` where `fake` is a tmp `.mjs` that prints `{"ok":true,"result":{"kind":"records","records":[{"argv":<process.argv.slice(2)>}]}}`; a second fake prints `{"ok":false,"error":{"message":"boom"}}`; a third prints `not json`. Tmp `queriesDir` with `a.dql`, `b.dql`.

```js
assert.deepEqual(res.map(r => [r.name, r.ok, r.rows]), [["a", true, 1], ["b", true, 1]]);
assert.ok(fs.existsSync(path.join(out, "a.json")));
assert.ok(argvOf("a").includes('frontend=Shop "EU"/web app'));   // verbatim, one arg
assert.deepEqual(argvOf("a").slice(-2), ["--context", "prod"]);
assert.ok(!argvNoCtx.includes("--context"));
assert.equal(failRes[0].error, "boom");
assert.match(garbageRes[0].error, /dtctl too old/);
assert.equal(resolveDtctl({ PATH: binDir }, "darwin", p => p === path.join(binDir, "dtctl")), "dtctl");
assert.equal(resolveDtctl({ PATH: "", LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32",
  p => p === "C:\\Users\\x\\AppData\\Local\\dtctl\\dtctl.exe"), "C:\\Users\\x\\AppData\\Local\\dtctl\\dtctl.exe");
assert.equal(resolveDtctl({ PATH: "" }, "linux", () => false), null);
```

- [ ] **Step 2: Run, confirm failure** — `node monthly-report/scripts/test-run-queries.mjs` → non-zero.
- [ ] **Step 3: Implement `run-queries.mjs`** per Interfaces. When `resolveDtctl` returns a full path, use it as `cmd` with empty `prefixArgs`.
- [ ] **Step 4: Run tests + live check**
Run: `node monthly-report/scripts/test-run-queries.mjs && node monthly-report/scripts/run-queries.mjs --list-frontends | head -5 && node monthly-report/scripts/run-queries.mjs --frontend "www.cloud.easytravel.com" --out "$HOME/.dt-reports/check-monthly"`
Expected: tests silent; picker lists web frontends only (no `easyTravel_Mobile`); 9 `… rows` lines, none FAILED.
- [ ] **Step 5: Copy to trending, verify identical, commit**
Run: `for f in scripts/run-queries.mjs scripts/test-run-queries.mjs references/frontends.dql; do cp "monthly-report/$f" "trending-report/$f"; done && node trending-report/scripts/test-run-queries.mjs`
Commit — `feat(reports): cross-platform run-queries.mjs and metric-based frontend picker`

---

### Task 6: `render-pdf.mjs` — browser discovery, open, saved-copy pickup, gated cleanup (I8, I9, I16, U1, U2)

**Files:**
- Create: `monthly-report/scripts/render-pdf.mjs`, `monthly-report/scripts/test-render-pdf.mjs`; copy both to `trending-report/scripts/`.
- Delete: `{monthly-report,trending-report}/assets/render-pdf.sh`, `{monthly-report,trending-report}/assets/render-pdf.ps1`.
- Modify: `monthly-report/README.md`, `trending-report/README.md` — preview/render lines only (`node scripts/render-pdf.mjs --in <html> --out <pdf> --source <html>`).

**Interfaces:**
- Produces:
  - `export function findBrowser(platform: string, env: object, exists: (p) => boolean): string | null` — first existing of: `env.CHROME_PATH`; darwin `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `<HOME>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`, `/Applications/Chromium.app/Contents/MacOS/Chromium`, `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`; win32 (via `path.win32.join`) `<ProgramFiles>\Google\Chrome\Application\chrome.exe`, `<ProgramFiles(x86)>\Google\Chrome\Application\chrome.exe`, `<LOCALAPPDATA>\Google\Chrome\Application\chrome.exe`, `<ProgramFiles(x86)>\Microsoft\Edge\Application\msedge.exe`, `<ProgramFiles>\Microsoft\Edge\Application\msedge.exe` (`env.ProgramFiles` default `C:\Program Files`, `env["ProgramFiles(x86)"]` default `C:\Program Files (x86)`; skip `LOCALAPPDATA` candidates when it is unset; `<HOME>` = `env.HOME ?? os.homedir()`); linux `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/snap/bin/chromium`, `/usr/bin/microsoft-edge`.
  - `export function chromeArgs(inHtml: string, outPdf: string, theme: "light"|"dark", profileDir: string): string[]` → `["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--user-data-dir=" + profileDir, "--no-pdf-header-footer", "--virtual-time-budget=8000", "--print-to-pdf=" + outPdf, pathToFileURL(inHtml).href + "#theme=" + theme]`. The temp profile keeps headless runs off the user's open Chrome.
  - `export function savedCopies(stem: string, downloadsDir: string): string[]` — files matching `^<escaped stem>( \(\d+\))?\.html$`; `[]` if dir missing.
  - `export function pickSource(generatedHtml: string, downloadsDir: string): string` — newest mtime among `generatedHtml` and `savedCopies(basename(generatedHtml, ".html"), downloadsDir)`.
  - `export function finalize(pdfPath: string, cleanupPaths: string[]): boolean` — PDF exists and size > 0 → `rmSync(p, { recursive: true, force: true })` each, return true; else delete nothing, return false.
  - `export function openCommand(platform: string, file: string): { cmd: string, args: string[] }` — darwin `open [file]`; win32 `cmd ["/c", "start", "", file]`; else `xdg-open [file]`.
  - `export function expandHome(p: string): string` — leading `~`, `~/`, `~\` → `os.homedir()`.
  - CLI:
    - `--find-browser` → print path, exit 0; none → exit 2 with `No Chromium-based browser found (Chrome, Edge, Chromium). Install Google Chrome or set CHROME_PATH.`
    - `--open <file>` → spawn `openCommand`, detached, exit 0.
    - `--in <generated.html> --out <file.pdf> [--theme light|dark] [--source <html>] [--cleanup <path>...]` (`--cleanup` takes all remaining args) → `expandHome` + `path.resolve` every path; source = `--source` ?? `pickSource(in, ~/Downloads)`; print `Source: <path>`; `spawnSync(browser, chromeArgs(...), { timeout: 120000 })` with a `fs.mkdtempSync(os.tmpdir()/dt-pdf-)` profile removed afterwards; cleanup list = given paths + `savedCopies(stem, ~/Downloads)`; `finalize` true → print `PDF: <out>`, exit 0; false → stderr `PDF not written: <out>` + last 5 browser stderr lines + `Nothing was deleted.`, exit 1. Theme default `light`.

- [ ] **Step 1: Write failing tests**

```js
const H = "/Users/x";
assert.equal(findBrowser("darwin", { HOME: H }, p => p === `${H}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`),
  `${H}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`);
assert.equal(findBrowser("win32", { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, p => p.endsWith("Local\\Google\\Chrome\\Application\\chrome.exe")),
  "C:\\Users\\x\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe");
assert.match(findBrowser("win32", {}, p => p.endsWith("msedge.exe")), /msedge\.exe$/);
assert.equal(findBrowser("linux", { CHROME_PATH: "/opt/c" }, p => p === "/opt/c"), "/opt/c");
assert.equal(findBrowser("linux", {}, () => false), null);
if (process.platform === "win32")
  assert.equal(chromeArgs("C:\\Users\\John Smith\\r.html", "C:\\o.pdf", "dark", "C:\\p").at(-1), "file:///C:/Users/John%20Smith/r.html#theme=dark");
else
  assert.equal(chromeArgs("/Users/John Smith/r.html", "/o.pdf", "dark", "/p").at(-1), "file:///Users/John%20Smith/r.html#theme=dark");
// pickSource: generated (mtime t0), "<stem> (1).html" (t0+60s) newest, "<stem>-other.html" (t0+120s) ignored
assert.equal(pickSource(gen, dl), path.join(dl, `${stem} (1).html`));
assert.equal(pickSource(gen, path.join(dl, "missing")), gen);
// finalize gating
assert.equal(finalize(emptyPdf, [keep]), false); assert.ok(fs.existsSync(keep));
assert.equal(finalize(realPdf, [keep]), true);   assert.ok(!fs.existsSync(keep));
assert.deepEqual(openCommand("win32", "C:\\a b.html"), { cmd: "cmd", args: ["/c", "start", "", "C:\\a b.html"] });
assert.equal(expandHome("~/Downloads/a.pdf"), path.join(os.homedir(), "Downloads/a.pdf"));
```

- [ ] **Step 2: Run, confirm failure** — `node monthly-report/scripts/test-render-pdf.mjs` → non-zero.
- [ ] **Step 3: Implement `render-pdf.mjs`** per Interfaces.
- [ ] **Step 4: Run tests + real render**
Run: `node monthly-report/scripts/test-render-pdf.mjs && node monthly-report/scripts/preview.mjs "$HOME/.dt-reports/p.html" && node monthly-report/scripts/render-pdf.mjs --in "$HOME/.dt-reports/p.html" --out "$HOME/.dt-reports/p.pdf" --source "$HOME/.dt-reports/p.html" --theme dark`
Expected: `Source: …p.html`, `PDF: …p.pdf`; opening `p.pdf` shows 4 dark pages.
- [ ] **Step 5: Copy to trending, delete old scripts, update READMEs, commit**
Run: `cp monthly-report/scripts/{render-pdf.mjs,test-render-pdf.mjs} trending-report/scripts/ && git rm {monthly-report,trending-report}/assets/render-pdf.{sh,ps1} && node trending-report/scripts/test-render-pdf.mjs`
Commit — `feat(reports): cross-platform render-pdf.mjs with Edge/per-user Chrome, saved-copy pickup, gated cleanup`

---

### Task 7: Report SKILL.md rewrites (I1, I13, I14, I15, I16, E5, E6, E7, E8, U1-U3, U6)

**Files:**
- Modify: `monthly-report/SKILL.md`, `trending-report/SKILL.md`

**Interfaces:**
- Consumes: `run-queries.mjs` CLI (Task 5), `build-report.mjs --print-tables` / build CLI (Task 4), `render-pdf.mjs` CLI (Task 6).

- [ ] **Step 1: Rewrite both files** with this section order and content. Frontmatter unchanged. Trending H1 → `# Dynatrace RUM Trending Report`, "4 pages".
  1. **Shell rule** (one line): every command is bash; on Windows it runs in Claude Code's Git Bash — never translate to PowerShell. If the shell is PowerShell, Step 0 stops the run.
  2. **Flags:** `--no-preview` (skip step 5, theme light); `--install` → "run the `setup` skill (`/tools:setup`) and stop".
  3. **Step 0 — Precheck** (one shell call): `uname -s && dtctl config current-context && node --version && node <SKILL_BASE_DIR>/scripts/render-pdf.mjs --find-browser`. If it fails with `uname` not recognized, or a `&&` parse error, Claude is running PowerShell (Windows without Git Bash): tell the user to run `/tools:setup`, which installs Git for Windows, then restart Claude Code; stop. Any other failure → tell user to run `/tools:setup` (on Windows, restart Claude Code after setup), stop.
  4. **Context:** `dtctl config get-contexts`. One context → use it, no question. More → one `AskUserQuestion` listing up to 4 contexts (current first, "(current)"). Set `CONTEXT`; pass `--context "$CONTEXT"` to every later command. Never run `dtctl config use-context`. New environments → setup skill.
  5. **Step 1 — Frontend:** if named, use it. Else `node <SKILL_BASE_DIR>/scripts/run-queries.mjs --list-frontends --context "$CONTEXT"`; one `AskUserQuestion` with the top 4 by page loads (label = name, description = "N page loads (7d)"); "Other" lets the user type any name. Derive `SLUG` and `YYYY-MM` per Global Constraints; `WORK="$HOME/.dt-reports/<SLUG>-<KIND>-<YYYY-MM>"`, `NAME=<SLUG>-<KIND>-<YYYY-MM>`.
  6. **Step 2 — Queries:** `node <SKILL_BASE_DIR>/scripts/run-queries.mjs --frontend "<FRONTEND>" --out "$WORK" --context "$CONTEXT"`. Any `FAILED` → show the line, stop. Every query 0 rows → frontend has no data for the period, stop.
  7. **Step 3 — Findings:** follow `references/findings-prompt.md`; write `$WORK/findings.md`.
  8. **Step 4 — Build:** `node <SKILL_BASE_DIR>/scripts/build-report.mjs --frontend "<FRONTEND>" --environment "$CONTEXT" --data "$WORK" --findings "$WORK/findings.md" --out "$WORK/$NAME.html" > /dev/null` (stderr kept). Trending keeps its browser-selection paragraph, corrected to "ranked by latest month's visits".
  9. **Step 5 — Preview:** `node <SKILL_BASE_DIR>/scripts/render-pdf.mjs --open "$WORK/$NAME.html"`; one `AskUserQuestion`, two questions. Q1 text: "The report is open in your browser. Click into any findings panel to edit, then click **Save changes**. Come back here when done." Options: **Build the PDF** ("uses your latest saved copy automatically"), **Regenerate analysis** (redo steps 3-4, reopen). Q2: **Light** (print-friendly, recommended) / **Dark**. If the user answers Q1 via "Other" with a file path, pass it as `--source`.
  10. **Step 6 — PDF + cleanup:** `node <SKILL_BASE_DIR>/scripts/render-pdf.mjs --in "$WORK/$NAME.html" --out "$HOME/Downloads/$NAME.pdf" --theme <THEME> [--source "<path>"] --cleanup "$WORK"`. Exit 0 → tell the user the `PDF:` path and which `Source:` was used. Non-zero → show stderr; say edits and data are kept in `$WORK` and `~/Downloads`; stop.
  Delete: the whole `--install` section, the old context check, `grep '^{'` notes, every macOS/Windows split block, the separate step 7 cleanup, `findings.txt`.

- [ ] **Step 2: Verify text**
Run: `grep -nE 'pwsh|powershell|Start-Process|Remove-Item|/tmp|use-context|render-pdf\.(sh|ps1)|&>/dev/null' monthly-report/SKILL.md trending-report/SKILL.md; grep -nF "grep '^{'" monthly-report/SKILL.md trending-report/SKILL.md`
Expected: no output from either. `wc -c` each SKILL.md < 7500 bytes (was ~11.5 KB).

- [ ] **Step 3: End-to-end dry run** (mac, `demo live`): run steps 2, 4 (with a stub `findings.md`) and 6 by hand for `www.cloud.easytravel.com` for both skills.
Expected: monthly PDF page 1 KPIs show non-zero Sessions and an LCP tile with a value (was "0" / "—"); trending page 4 shows populated browser panels (was 6 blank); `$WORK` deleted afterwards.

- [ ] **Step 4: Commit** — `refactor(reports): bash-only cross-platform SKILL workflow; drop duplicated install`

---

### Task 8: Setup skill — single install owner (I1-I7, I10, I11)

**Files:**
- Modify: `setup/SKILL.md`

- [ ] **Step 1: Rewrite** with these steps (bash only after Step 0; Windows = Git Bash; `OS=$(uname -s)` → `Darwin` | `Linux` | `MINGW*`/`MSYS*` = Windows):
  0. **Shell check (Windows bootstrap)** — run `uname -s`.
     - Prints `Darwin`, `Linux`, `MINGW*` or `MSYS*` → continue to step 1.
     - Fails (`uname` not recognized) → Claude is running PowerShell, meaning Git for Windows is missing or Claude Code can't find it. Check `Test-Path "C:\Program Files\Git\bin\bash.exe"`, then `Test-Path "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"`.
       - Neither exists → run `winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements`.
       - One exists → tell the user to set the user environment variable `CLAUDE_CODE_GIT_BASH_PATH` to that `bash.exe` path.
       - Either way, tell the user to fully restart Claude Code (CLI or desktop app) and run `/tools:setup` again; stop. These commands, plus the dtctl `powershell -Command` install, are the only PowerShell in any skill.
  1. **dtctl** — `dtctl version` (Windows fallback: `"$(cygpath "$LOCALAPPDATA")/dtctl/dtctl.exe" version`; `cygpath` ships with Git Bash). Missing or older than `0.45.0` →
     - Any OS with `command -v brew`: `brew install dynatrace-oss/tap/dtctl || brew upgrade dtctl`.
     - macOS/Linux without brew: `curl -fsSL https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.sh | DTCTL_INSTALL_DIR="$HOME/.local/bin" sh`, then `export PATH="$HOME/.local/bin:$PATH"` for this session and tell the user to add that line to their shell profile.
     - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/dynatrace-oss/dtctl/main/install.ps1 | iex"`; use `"$(cygpath "$LOCALAPPDATA")/dtctl/dtctl.exe"` in place of `dtctl` for the rest of setup.
     No output redirection on install commands.
  2. **Claude skills** — `dtctl skills install --for claude --global --force`.
  3. **Node ≥ 18** — `node -e "process.exit(+process.versions.node.split('.')[0] >= 18 ? 0 : 1)"`. Missing/old → brew: `brew install node`; Windows: `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements`; macOS without brew / Linux: tell the user to install the LTS from https://nodejs.org (Linux: their package manager, via `! sudo …`), stop.
  4. **Browser** — any of the Task 6 `findBrowser` paths exists (list them as a single `ls` per OS). None → macOS with brew: `brew install --cask google-chrome`; Windows: Edge ships with Windows 10/11, so report it missing as unusual and point to https://www.google.com/chrome; Linux: tell the user to install Chrome or Chromium.
  5. **Environment** — `dtctl config get-contexts`. None → ask context name and environment URL (example `https://abc12345.apps.dynatrace.com`), then tell the user to run `! dtctl auth login --context "<NAME>" --environment "<URL>"` and confirm when the browser login finishes.
  6. **Doctor** — `dtctl doctor`; surface failures.
  7. **Report** — shell (`uname -s` output), dtctl version, Node version, browser path, context + URL; on Windows add "restart Claude Code so dtctl/node are on PATH"; skills ready: `full-page-analysis`, `user-journeys`, `trending-report`, `monthly-report`.

- [ ] **Step 2: Verify** — run the skill's commands in order on this Mac (everything already installed).
Expected: each check passes without installing; `dtctl skills install … --global --force` writes under `~/.claude/skills/`, not the CWD (`ls .claude/skills 2>/dev/null` in the repo shows nothing new).

- [ ] **Step 3: Commit** — `fix(setup): non-interactive, cross-platform installs; global dtctl skills`

---

### Task 9: Templates — consistent footer, save bar, contract comments (U5, U8, E2)

**Files:**
- Modify: `trending-report/assets/report-trending.html.tmpl`, `monthly-report/assets/report-cm.html.tmpl` (comments only), `trending-report/scripts/build-report.mjs`, `monthly-report/scripts/build-report.mjs` (save-bar text)
- Test: both `scripts/test-build-report.mjs`

**Interfaces:**
- Consumes: `assembleHtml` (Tasks 1-2). Trending `assembleHtml` now substitutes `{{GENERATED_AT}}` (same `YYYY-MM-DD HH:MM UTC` format as monthly `renderReport`).

- [ ] **Step 1: Write failing test** (both skills):

```js
assembleHtml({ data, findings, frontend: "f", environment: "env", dateRangeLabel: "x", generatedAt: "2026-11-03 10:00 UTC", outPath: out });
const html = fs.readFileSync(out, "utf8");
assert.ok(html.includes("Generated 2026-11-03 10:00 UTC"));
assert.equal(html.slice(html.indexOf("-->")).match(/\{\{[A-Z_]+\}\}/), null);   // no unreplaced placeholder after the contract comment
assert.ok(html.includes("✓ Saved — check your Downloads"));
```

- [ ] **Step 2: Run, confirm failure** (trending) — non-zero.
- [ ] **Step 3: Implement**
  - Trending page 1 footer left span → `Generated {{GENERATED_AT}}`; pages 2-4 left span → `Confidential — for customer use only` (monthly's wording). Add `{{GENERATED_AT}}` to the trending contract comment.
  - Trending save bar: replace its `<style>`/markup/script block with monthly's block verbatim. Both: button success text `✓ Saved — check your Downloads`.
  - Monthly contract comment (lines 14-16, 57-60): `cmCwvDistribution: { lcp: { p75 }, inp: { p75 }, cls: { p75 } }` — p75 only; drop bucket wording.
- [ ] **Step 4: Run tests + visual check** — both test files exit 0; preview + render both skills (Task 6 Step 4 commands); page 1 footer shows `Generated …` in both PDFs; save bar looks identical in both previews.
- [ ] **Step 5: Commit** — `fix(reports): consistent footer and save bar across monthly and trending`

---

### Task 10: Docs (E4, I12, U4)

**Files:**
- Modify: `monthly-report/references/queries.md`, `trending-report/references/queries.md`, `trending-report/README.md`, `monthly-report/README.md`, `plugins/tools/README.md`

- [ ] **Step 1: Rewrite**
  - Both `queries.md`: run command (`run-queries.mjs`), filename map (monthly 9 files, trending 5), unit conversions, one line per query (feeds + output columns). No DQL copies — the `.dql` files are the source. Note `union: true` and why (spec D1).
  - `trending-report/README.md`: same shape as monthly's — 4-page trending PDF, prerequisites via `/tools:setup`, fixture preview + `render-pdf.mjs` commands, keep the `sips` verification note.
  - `plugins/tools/README.md`: Installation — shell: `claude plugin marketplace add brandonsturrock/brandon-insights` then `claude plugin install tools@brandon-insights`; inside Claude Code: `/plugin marketplace add brandonsturrock/brandon-insights`, `/plugin install tools@brandon-insights`, `/reload-plugins`. Prerequisites → "run `/tools:setup` once". Skill table: link each skill's `README.md`; `setup` links `SKILL.md` (it has no README).
- [ ] **Step 2: Verify** — `grep -rnE 'render-pdf\.(sh|ps1)|device-dist-monthly|claude /plugin|findings\.txt' plugins/tools/README.md monthly-report trending-report --include=*.md` → no output; `grep -rn -- '--install' plugins/tools/README.md monthly-report trending-report --include=*.md` → only the one-line redirect in each SKILL.md.
- [ ] **Step 3: Commit** — `docs(reports): trim queries.md, fix install commands, refresh trending README`

---

### Task 11: CI across macOS, Windows, Linux (U9)

**Files:**
- Create: `.github/workflows/report-skills-ci.yml`

- [ ] **Step 1: Write workflow**
  - Triggers: `push` and `pull_request` on paths `plugins/tools/skills/monthly-report/**`, `plugins/tools/skills/trending-report/**`, the workflow file.
  - Job `test`: matrix `os: [macos-latest, windows-latest, ubuntu-latest]`; `defaults.run.shell: bash` (Git Bash on Windows, mirroring Claude Code); `actions/setup-node@v4` with `node-version: 20`; for each skill dir: run `test-build-report.mjs`, `test-run-queries.mjs`, `test-render-pdf.mjs`; `node scripts/preview.mjs "$RUNNER_TEMP/<skill>.html"`; `node scripts/render-pdf.mjs --in "$RUNNER_TEMP/<skill>.html" --out "$RUNNER_TEMP/<skill>.pdf" --source "$RUNNER_TEMP/<skill>.html"`; `test -s "$RUNNER_TEMP/<skill>.pdf"`.
  - Job `identical` (ubuntu): `cmp` each Global-Constraints identical file between the two skills; fail on first difference.
- [ ] **Step 2: Verify** — push branch; all 3 OS legs + `identical` green. A Linux "No usable sandbox" failure is a real-user Linux bug: fix it in `chromeArgs` (add `--no-sandbox` only when `process.getuid?.() === 0`), not in CI.
- [ ] **Step 3: Commit** — `ci(reports): test, preview and render on macOS, Windows, Linux`

---

### Task 12: Release

**Files:**
- Modify: `plugins/tools/.claude-plugin/plugin.json` (`"version": "2.12.1"` → `"2.13.0"`)

- [ ] **Step 1: Full local check** — all six test files exit 0; Task 7 Step 3 dry run passes for both skills.
- [ ] **Step 2: Windows manual pass** — a Windows machine with Claude Code; a fresh user with no Git for Windows and no dtctl. Repeat once in the CLI and once in a desktop-app local session.
  1. Install the plugin from the branch.
  2. Run `/tools:setup`. Expected: it detects PowerShell, installs Git via winget without prompts, asks for a restart, and stops.
  3. Restart Claude Code and run `/tools:setup` again. Expected: `uname -s` prints `MINGW64_NT…` and setup finishes without hangs or sudo/agreement prompts.
  4. Restart, then run `/tools:monthly-report www.cloud.easytravel.com` and `/tools:trending-report www.cloud.easytravel.com`. Edit and save a finding twice, then build the PDF.
  5. Expected: both PDFs land in `%USERPROFILE%\Downloads`; the PDF contains the second edit; `%USERPROFILE%\.dt-reports\` is empty afterwards.
  6. Also run a report skill before setup on a Git-less machine. Expected: the precheck stops with the "run `/tools:setup`" message.
- [ ] **Step 3: Commit** — `chore(tools): bump to 2.13.0`

---

## Decisions for Brandon (not blocking — defaults chosen above)

- Footer wording: page 1 `Generated <ts>`, pages 2-4 `Confidential — for customer use only` (monthly's current text) for both reports.
- `YYYY-MM` in trending filenames = last complete month (was ambiguous).
- Repo working tree shows `.claude/skills/dtctl/` deleted (artifact of project-scoped `dtctl skills install`); commit that deletion separately if wanted.
