# Changelog — tools plugin

Every version bump in `.claude-plugin/plugin.json` gets an entry here, newest first.

## 2.14.2 — 2026-11-05

- **user-action-naming:** pulled from distribution until ready; development continues on branch `wip/user-action-naming`.

## 2.14.1 — 2026-11-05

- **full-page-analysis, user-journeys, monthly-report, trending-report:** removed the `--install` flag; dependency installs are owned by `/tools:setup` only.

## 2.14.0 — 2026-11-05

- **New skill: `user-action-naming`.** Proposes cleaned RUM user action names for a frontend (`Load /p/:product:`, `Navigate to /cart`, `Add to Cart`) and writes one OpenPipeline processor per new name — matching condition, processor definition, and dry-run `old → new` examples with captured `event_properties` — as markdown and PDF.
- **monthly-report, trending-report:** raw-event queries (`fetch user.events` / `user.sessions`) are probed and sampled (1:10 / 1:100 / 1:1000) to keep each scan under 100 GB. A scan-limit warning now fails the query instead of silently returning only the newest days.
- **monthly-report:** session error rates come from `user.sessions` (were blank on large tenants); top pages, exceptions and request errors scale counts by the sampling ratio; the footer notes the ratio used.
- **monthly-report:** findings cards shrink text to fit (minimum 10px) instead of clipping mid-sentence; the review page outlines a card that still overflows. Findings prompt caps each heading at 45 words.
- **reports:** symlink-safe `build-report` entry, CLS null handling, DATA escaping, output folder created before PDF write; Windows wording and frontend-quoting fixes in the docs.

## 2.13.0 — 2026-11-03

- **reports:** local review page with autosave, Create PDF and Rewrite analysis, replacing the Downloads round trip.
- **reports:** cross-platform Node scripts — `run-queries.mjs` (metric-based frontend picker), `render-pdf.mjs` (Chrome / Edge / Chromium, freshness gate, safe cleanup); bash-only SKILL workflow for Windows Git Bash.
- **reports:** `--print-tables` for writing findings; tighter findings prompts.
- **reports:** fixes for outer-joined multi-metric timeseries, month-aligned trending window, dtctl constant columns, UTF-8 output across chunks, LCP/INP p75 of 0 treated as not measured, consistent footers.
- **setup:** non-interactive cross-platform installs, no sudo, persistent `~/.local/bin` PATH, global dtctl skills.

## 2.12.1 — 2026-10-14

- **monthly-report:** scorecard alignment, path truncation, 3-decimal averages.

## 2.12.0 — 2026-10-14

- **reports:** Dynatrace-branded deck overhaul for trending and monthly; light/dark theme toggle; JS/Request error chart; print contrast.
- **monthly-report:** CLS scaling, absent-data rating and chart scale fixes.

## 2.11.2 — 2026-10-13

- **monthly-report:** stop rescaling raw `user.events` CLS by 1e4.
- **skills:** `dtctl auth login --context` (not `--context-name`).
- **docs:** missing skills added to the README.

## 2.11.1 — 2026-09-01

- **full-page-analysis:** report layout rework — branded title and context block, metric tiles instead of the CWV table, findings paired with analyst notes, Strato dark palette; scoping fixes (third-party by `url.provider`, failed navigations, failed-document loads excluded from instance selection); restored in-browser edit/save.

## 2.11.0 — 2026-08-31

- **full-page-analysis v2:** aggregate analysis, Strato waterfall, deterministic finding rules with analyst notes, HTML + PDF output.

Earlier versions: see `git log -- plugins/tools`.
