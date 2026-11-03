# Review: monthly-report + trending-report (2026-11-03)

Source of truth for `docs/superpowers/plans/2026-11-03-report-skills-hardening.md`.
Verified against the `demo live` tenant with dtctl 0.45.0 (frontends
`www.cloud.easytravel.com`, `EasyTrade`, `Astroshop`). Windows items are from code
reading plus dtctl's own `install.ps1`, not executed. Paths are relative to
`plugins/tools/skills/`.

These skills are distributed to many users: install and run must work unchanged on
macOS, Windows and Linux.

## Install (I)

- **I1** — Install steps exist in 3 divergent copies (monthly `--install`, trending
  `--install`, `setup`). `setup` is the only owner; skills keep a one-call precheck.
- **I2** — `dtctl skills install --for claude` installs into the CWD project
  (`--global` needed) and prompts on existing files (`--force` needed).
- **I3** — `dtctl auth login` blocks on the browser OAuth callback; Claude cannot
  run it inline. User runs `! dtctl auth login …`.
- **I4** — Example URL `.live.dynatrace.com`; dtctl's own examples use `.apps.dynatrace.com`.
- **I5** — No minimum dtctl version. Tested: 0.45.0.
- **I6** — macOS `install.sh` targets `/usr/local/bin` and calls `sudo mv` when not
  writable; the Bash tool cannot answer a password prompt. Use
  `DTCTL_INSTALL_DIR="$HOME/.local/bin"`.
- **I7** — setup's no-Homebrew Node path is nodesource + `apt-get` (Linux-only, root).
- **I8** — Chrome lookup: macOS only `/Applications/Google Chrome.app`; Windows only
  machine-wide Chrome (misses `%LOCALAPPDATA%` per-user install; Edge never used);
  Linux none.
- **I9** — Windows: Claude Code's Bash tool is Git Bash. PowerShell blocks
  (`irm|iex`, `Start-Process`, `Remove-Item`, `Test-Path`) aren't bash. `pwsh` isn't
  installed by default; `powershell.exe` default policy blocks `.ps1`. `/tmp` means
  `%TEMP%` in Git Bash but `C:\tmp` in PowerShell. `render-pdf.ps1` never expands `~`
  inside `"--print-to-pdf=$Out"`.
- **I10** — Windows PATH changes from `install.ps1`/winget are invisible to the
  running Claude Code process. dtctl lands in `%LOCALAPPDATA%\dtctl\dtctl.exe`.
- **I11** — winget's first run prompts for agreements (hangs). Prefer `OpenJS.NodeJS.LTS`.
- **I12** — `plugins/tools/README.md` install commands are invalid (`claude /plugin …`).
- **I13** — SKILL step 2 writes into `/tmp/<f>-monthly-<YYYY-MM>/` without creating it.
- **I14** — Steps 4/6 use relative `scripts/…`, `assets/…` (resolve against user CWD);
  step 2 uses `<SKILL_BASE_DIR>`.
- **I15** — Frontend names are used raw in file paths (spaces, `/`, quotes break them).
- **I17** — Git Bash is not guaranteed on Windows: Claude Code no longer requires Git
  for Windows and falls back to PowerShell as the shell tool when it is missing
  (code.claude.com/docs/en/setup; desktop app local sessions stopped requiring Git
  in 1.49585.0). Decision: Git Bash is the supported Windows route; `setup` checks
  for it and installs Git for Windows when missing.
- **I16** — Output suppressed with `&>/dev/null` / `> /dev/null 2>&1` hides the
  reason for failures (brew, build, render).

## Data correctness (D)

- **D1** — Multi-metric `timeseries` inner-joins on dimensions. When INP has no
  `device.type` split, `cm-device-compare`, `cm-daily-cwv`, `browser-perf-monthly`
  return 0 rows (monthly KPIs "0 sessions / 0 page loads", CWV tiles "—"; trending
  browser page blank). Fix verified: `union: true` on every multi-metric `timeseries`
  (EasyTrade results unchanged).
- **D2** — dtctl 0.45 agent mode (auto-on under Claude Code) moves columns that are
  identical in every row into `result.constant` and drops null keys. `loadRecords`
  ignores `constant`, so a desktop-only frontend loses `device.type` and every
  device-split series is 0.
- **D3** — `cm-errors` counts arrive as strings; `cur.total += r.total_sessions || 0`
  concatenates ("1275"+"800" = 1275800). Error rates wrong when ≥2 devices on a day.
- **D4** — Trending `from: -6M` isn't month-aligned; first month is partial. Fix
  verified: `from: now()@M - 6M` (window starts on the 1st).
- **D5** — Absent days filled with 0 (`byDayDevice`), rendered as "0ms — good".
  Trending months with no data render 0 sessions.
- **D6** — `(a, b) => a - b` on ISO strings is a no-op sort; `browser-perf-monthly.dql`
  has no `sort`.
- **D7** — Monthly findings prompt §4a says treat missing `cm-errors` days as zero
  (wrong: missing = not measured). Prompts never mention CLS ÷10000.
- **D8** — Trending findings prompt asks for error spikes (no error data) and top 8
  browsers (report shows 6).
- **D9** — Trending browser-ranking comment says 6-month total; code ranks by latest
  month (`totalVisits` unused).
- **D10** — Monthly build derives the report month from the wall clock, not the data;
  a run across a month boundary filters out every row.

## Efficiency (E)

- **E1** — Frontend picker: `fetch user.events` 7d = 133 GB, 2.8 s, counts events,
  includes mobile apps. Verified replacement (metric, 0 bytes, 67 ms, web only):
  `timeseries loads = sum(dt.frontend.web.page.largest_contentful_paint, rollup: count), from: now()-7d, by: {frontend.name}`.
- **E2** — `cm-cwv-distribution.dql` scans 44.7 GB; its buckets are never rendered
  (template reads only `.p75`, computed from `cm-device-compare`).
- **E3** — Findings authoring reads ~31 KB raw JSON + 24 KB `queries.md` (~14K tokens)
  and converts units by hand. Build script should print ready tables.
- **E4** — Monthly `references/queries.md` documents 16 queries (6 absent from the
  skill, 6 drifted from `.dql`). Trending `queries.md` duplicates all DQL.
- **E5** — `--install` + context-check text ≈ half of each 11.5 KB SKILL.md.
- **E6** — `| grep '^{'` is a no-op (single-line envelope, warnings inside
  `context.warnings`) and unavailable outside bash.
- **E7** — Context question asked every run; "Switch" uses `use-context`, which
  silently changes the user's global default. Use `--context` per invocation.
- **E8** — Frontend picker pages 3 at a time (+ "Show more…").
- **E9** — Unused series (`z` metrics-monthly, `x` cwv-monthly); "field overrides"
  warnings in 4 queries; dead helpers in monthly build.

## User experience (U)

- **U1** — Cleanup deletes the user's edited HTML even if the PDF failed.
- **U2** — Saved-edit path assumed exactly `~/Downloads/<name>.html`; a second save
  is `<name> (1).html`.
- **U3** — Trending H1 "Dynatrace RUM Monthly Review"; trending SKILL says 3 pages
  (template 4); monthly build comment says 5 pages (template 4).
- **U4** — Trending README entirely stale.
- **U5** — Footers differ (monthly page 1 "Generated <ts>", pages 2-4
  "Confidential — for customer use only"; trending all pages
  "CONFIDENTIAL · FOR CUSTOMER USE ONLY", no timestamp).
- **U6** — `{{ENVIRONMENT_NAME}}` never passed; env line always blank.
- **U7** — Bullet budget: monthly ≤3; trending "3-4" with the same clipping cards.
- **U8** — Drift: save-bar CSS/text, preview prompt text, trending `preview.mjs`
  duplicates template substitution instead of importing `assembleHtml`.
- **U10** — User feedback: open HTML → edit → click Save (download to `~/Downloads`)
  → return to Claude → pick the right option is unintuitive and confusing. Root cause:
  a `file://` page can't write to disk, so edits had to travel through Downloads
  (introduced 4217e24 as a step up from editing a txt file; no server alternative
  was considered). Decision (Brandon, 2026-11-03): a local review page served by a
  small Node server — edits autosave to the work dir, **Create PDF** renders and
  opens the PDF in place, **Rewrite analysis** hands back to Claude; no Downloads
  round trip, no option question, no theme question. Supersedes U2. `--no-preview`
  remains for remote sessions (browser can't reach 127.0.0.1 there).
- **U9** — Each skill must stay standalone (release workflow zips each skill dir
  alone), so shared files are copies; nothing checks they stay identical.

## Release checklist (Windows manual pass — run before publishing 2.13.0)

Once in the Claude Code CLI and once in a desktop-app local session, as a fresh Windows user with no Git for Windows and no dtctl:
1. Install the plugin from the branch.
2. `/tools:setup` → detects PowerShell, installs Git via winget without prompts, asks you to open a new terminal, stops.
3. New terminal, `/tools:setup` again → `uname -s` prints `MINGW64_NT…`; finishes with no hangs, sudo or agreement prompts.
4. New terminal; `/tools:monthly-report www.cloud.easytravel.com` and `/tools:trending-report www.cloud.easytravel.com`. On each review page: edit a finding, Theme → Dark, Create PDF. Expect: PDF opens from `%USERPROFILE%\Downloads`, dark, with the edit; Claude reports the path unprompted; `%USERPROFILE%\.dt-reports\` empty.
5. Monthly again → Rewrite analysis → Claude rewrites the findings and opens a fresh review page.
6. Trending again → edit, close the tab, tell Claude "build the PDF" → PDF contains the edit.
7. On a Git-less machine, run a report skill before setup → precheck stops with the "run `/tools:setup`" message.
Also: push the branch and confirm `.github/workflows/report-skills-ci.yml` is green on all 6 legs (first real Windows/Linux run).

## Follow-ups (deliberately not done in this branch)

- `full-page-analysis` and `user-journeys` still use the old render-pdf.sh/.ps1 + Downloads save flow — port them to render-pdf.mjs / review.mjs.
- `--cleanup` only refuses blank paths and ancestors of the PDF; an allow-list rooted at `~/.dt-reports` would stop a mistyped path (needs an injectable root for tests).
- CI checks whole shared files for identity, not the duplicated `REVIEW_BAR` / `loadRecords` blocks inside the two build scripts.
- review.mjs: malformed request-targets get 500 before the auth check and re-arm the idle timer; `render` must stay synchronous (commented); autosave status can briefly overwrite "Creating PDF…".
- Linux: Ubuntu's `~/.bashrc` returns early for non-interactive shells, so a PATH line appended at the end may not apply; zsh users on Linux are pointed at `~/.bashrc`. `setup/SKILL.md` "run /tools:setup again" lacks the standalone `/setup` hint.
- Tables: error rates print with 1 decimal (hides <0.05%); weekly sessions aren't printed for findings; long exception messages aren't truncated.
- Data: blended p75 weights aren't `Number()`-coerced; trending weekly cutoff is wall-clock based; "Unknown · Desktop" browser panel (rows without `browser.name`) shown as a real panel — product decision.
