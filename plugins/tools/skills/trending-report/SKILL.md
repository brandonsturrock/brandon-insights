---
name: trending-report
description: Generate a Dynatrace RUM 6-month trending PDF for a web frontend/application — traffic trends, Core Web Vitals over time, and device/browser breakdown. Use when the user asks for a "trending report", "6-month report", "traffic trends", "CWV trends", "browser trends", "device trends", or a frontend/application's 6-month performance trend. Uses the dtctl CLI to query Grail and a local build script to assemble the PDF — no dt-app deployment needed.
---

# Dynatrace RUM Trending Report

6-month trends (4 pages): traffic, Core Web Vitals, device and browser. For the last-month deep-dive use the `monthly-report` skill. Data comes from `dtctl` queries; you write the findings.

**Shell:** every command is bash. On Windows it runs in Claude Code's Git Bash; never translate to PowerShell (if the shell is PowerShell, Step 0 stops the run). Shell state does not persist between Bash calls, so substitute literal values for `$CONTEXT`, `$WORK`, `$NAME` and `<SKILL_BASE_DIR>` in every command (`$HOME` stays as is). Write `<SKILL_BASE_DIR>` (this skill's base directory) with forward slashes (`C:/Users/...` on Windows) and quote the whole script path if it contains spaces.

**Flags:** `--no-preview` skips the browser review in Step 5 (light theme). `--install`: run the `setup` skill (`/tools:setup`) and stop.

## Step 0 - Precheck

One Bash call:

```bash
uname -s && dtctl config current-context && node --version && node <SKILL_BASE_DIR>/scripts/render-pdf.mjs --find-browser
```

- Fails with `uname` not recognized, or a `&&` parse error: Claude is running PowerShell (Windows without Git Bash). Tell the user to run `/tools:setup` (or `/setup` if you installed the skills standalone), which installs Git for Windows, then close this terminal window and open a new one before starting Claude Code again (desktop app: quit it fully and reopen; VS Code: close all windows). Stop.
- Any other failure: tell the user to run `/tools:setup` (or `/setup` if you installed the skills standalone) (on Windows, afterwards close this terminal window and open a new one before starting Claude Code again (desktop app: quit it fully and reopen; VS Code: close all windows)). Stop.

## Context

Run `dtctl config get-contexts`. One context: use it, no question. Several: one `AskUserQuestion` listing up to 4 (current first, labelled "(current)"). Set `CONTEXT` and pass `--context "$CONTEXT"` to every later command that accepts it. Never change dtctl's active context. New environments: the `setup` skill.

## Step 1 - Frontend

If the user named one, use it. Otherwise run:

```bash
node <SKILL_BASE_DIR>/scripts/run-queries.mjs --list-frontends --context "$CONTEXT"
```

It prints `<page_loads>` TAB `<frontend.name>` lines, busiest first (nothing printed or non-zero exit: show the output and stop). Ask one `AskUserQuestion` with the top 4 (label = name, description = "N page loads (7d)"); "Other" lets the user type any name.

Set `FRONTEND`. In commands, single-quote the name as `'<FRONTEND>'` and write a literal `'` in it as `'\''` (inside double quotes bash would change `"`, `$` and backticks). `SLUG` = FRONTEND lowercased, each run of characters outside `[a-z0-9.-]` replaced by `-`, leading/trailing `-` trimmed. `YYYY-MM` = last complete calendar month (UTC). `NAME` = `<SLUG>-trending-<YYYY-MM>`; `WORK` = `$HOME/.dt-reports/<NAME>` (e.g. `$HOME/.dt-reports/www.cloud.easytravel.com-trending-2026-10`).

## Step 2 - Queries

```bash
node <SKILL_BASE_DIR>/scripts/run-queries.mjs --frontend '<FRONTEND>' --out "$WORK" --context "$CONTEXT"
```

Prints `<query>: N rows` (plus `(sampled 1:N)` when a raw-event query was sampled to stay under the 100 GB scan budget) or `<query>: FAILED <error>` per query. A `FAILED PARTIAL result` means Grail's scan limit was still hit — show it and stop. Any `FAILED` (exit 1): show the line and stop. Exit 2 (dtctl missing): tell the user to run `/tools:setup` (or `/setup` if you installed the skills standalone). If the `metrics-monthly` line says `0 rows`: the frontend has no data for the period (usually a mistyped name); tell the user and stop.

## Step 3 - Findings

Follow `references/findings-prompt.md`; write `$WORK/findings.md` with a quoted heredoc (`cat > "$WORK/findings.md" <<'EOF'`), not the Write tool. Then append the raw tables (never rendered):

```bash
{ printf '\n## Raw Data\n\n'; node <SKILL_BASE_DIR>/scripts/build-report.mjs --data "$WORK" --print-tables; } >> "$WORK/findings.md"
```

## Step 4 - Build

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --frontend '<FRONTEND>' --environment "$CONTEXT" --data "$WORK" --findings "$WORK/findings.md" --out "$WORK/$NAME.html" > /dev/null
```

Non-zero exit: show stderr, say the data is kept in `$WORK`, stop.

Browser Performance shows 6 panel slots (browser x device, ranked by the latest month's visits); unused slots render blank. Add `--max-browsers <N>` to change the count.

## Step 5 - Review and PDF

No option or theme question: the user picks both in the review page.

**`--no-preview`:**

```bash
node <SKILL_BASE_DIR>/scripts/render-pdf.mjs --in "$WORK/$NAME.html" --out "$HOME/Downloads/$NAME.pdf" --theme light --cleanup "$WORK"
```

- Exit 0: report the `PDF:` path.
- Non-zero: show stderr, say the data is kept in `$WORK`, stop.

**Otherwise:** run as a background command (Bash tool `run_in_background`; it prints `Review: <url>` and opens the browser):

```bash
node <SKILL_BASE_DIR>/scripts/review.mjs --in "$WORK/$NAME.html" --out "$HOME/Downloads/$NAME.pdf" --cleanup "$WORK"
```

Tell the user, verbatim: "The report is open in your browser. Click any findings panel to edit — changes save automatically. Use **Theme** to pick light or dark, then click **Create PDF**. Click **Rewrite analysis** if you'd like me to redo the findings."

Then wait for the exit notification; never poll. By exit code:
- 0: give the user the `PDF:` path.
- 3 (rewrite): redo Steps 3-4, then restart this step.
- 4: say "Timed out after an hour without activity; your edits are saved," and offer the `--no-preview` command.
- 2: no browser found; tell the user to run `/tools:setup` (or `/setup` if you installed the skills standalone).
- Anything else: show stderr, say edits and data are kept in `$WORK`, stop.

If the user asks for the PDF while the review is still running (for example, they closed the tab): stop the background command and run the `--no-preview` command; their edits are already saved.

**Remote sessions:** if Claude Code runs on a remote machine (SSH, container, cloud), the browser cannot reach the review page; use `--no-preview`.
