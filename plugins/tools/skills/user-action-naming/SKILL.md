---
name: user-action-naming
description: Use when Dynatrace RUM user action names for a frontend need cleanup, renaming, merging, or splitting — vague default names like "click on  on /p/...", actions fragmented by product names or IDs — or when the user asks for OpenPipeline user action naming rules / processors.
---

# Dynatrace user action naming cleanup

Turns a frontend's raw `user.events` user actions into a reviewed naming proposal and one OpenPipeline processor per new name, plus a themed PDF of the rules. Two goals only: **clarity** (vague default names) and **merging** (same action split by unique values). Every app is different — naming same-view actions is a judgment call, not a lookup.

**Shell:** every command is bash. On Windows it runs in Claude Code's Git Bash; never translate to PowerShell (if the shell is PowerShell, Step 0 stops the run). Shell state does not persist between Bash calls, so substitute literal values for `$CONTEXT`, `$OUT` and `<SKILL_BASE_DIR>` in every command (`$HOME` stays as is). Write `<SKILL_BASE_DIR>` (this skill's base directory) with forward slashes (`C:/Users/...` on Windows) and quote the whole script path if it contains spaces.

## Step 0 - Precheck

```bash
uname -s && dtctl config current-context && node --version && node <SKILL_BASE_DIR>/scripts/render-pdf.mjs --find-browser
```

Any failure: tell the user to run `/tools:setup` (or `/setup` if you installed the skills standalone) and stop. On Windows, afterwards close this terminal window and open a new one before starting Claude Code again.

## Step 1 - Context and frontend

Run `dtctl config get-contexts`. One context: use it. Several: one `AskUserQuestion` listing up to 4 (current first, labelled "(current)"). Set `CONTEXT`; pass `--context "$CONTEXT"` to every dtctl call. Never change dtctl's active context.

If the user named a frontend, use it. Otherwise run the query below and ask one `AskUserQuestion` with the top 4 ("Other" lets them type any name):
```bash
dtctl query 'fetch user.events, from: now()-7d | filter characteristics.has_user_action | summarize count=count(), by: {frontend.name} | sort count desc | limit 10' --context "$CONTEXT" -o csv
```
Set `FRONTEND`. `SLUG` = FRONTEND lowercased, runs of characters outside `[a-z0-9.-]` → `-`, trimmed. `OUT` = `$HOME/Downloads/<SLUG>-user-action-naming`; `mkdir -p "$OUT"`.

## Step 2 - Raw data

Always raise the record limit — IDs in `view.name` can push rows past the 1000 default.
```bash
dtctl query 'fetch user.events, from: now()-7d
| filter frontend.name == "<FRONTEND>"
| filter characteristics.has_user_action
| summarize count=count(), by: {user_action.name, user_action.type, view.name, view.source.name, url.path}
| sort count desc' --context "$CONTEXT" -o csv --max-result-records 200000 > "$OUT/raw.csv"
```
Header only (no rows): the frontend has no user actions in 7 days — tell the user and stop.

## Step 3 - Placeholders and groups

```bash
node <SKILL_BASE_DIR>/scripts/group.mjs "$OUT/raw.csv" --segments
```
Lists path positions with many distinct values. Decide which are unique data (product slugs, categories, order IDs) vs. real distinct pages (`/credit-card/active|order|status` are pages). Obvious IDs (digits, UUIDs, digit-bearing tokens) are already auto-replaced with `:id:`. Pick meaningful placeholder names. No candidates is a valid outcome (the app already templates its views) — skip `--ph`.

```bash
node <SKILL_BASE_DIR>/scripts/group.mjs "$OUT/raw.csv" --ph /p/=product --ph /c/=category > "$OUT/groups.csv"
```
Read every group; iterate placeholders if groups still fragment.

## Step 4 - Name and review files

Name each group (rules below), then write `$OUT/review.csv` and `$OUT/findings.md` with quoted heredocs (`cat > "$OUT/review.csv" <<'EOF'`), not the Write tool.

## Step 5 - Rules and PDF

```bash
node <SKILL_BASE_DIR>/scripts/build-rules.mjs "$OUT/review.csv" --frontend '<FRONTEND>' --context "$CONTEXT" --md "$OUT/openpipeline-rules.md" --pdf "$OUT/openpipeline-rules.pdf"
```
Every rule is dry-run on the last 7 days; its top 3 real matches are listed as `old name` → `new name`, with each extracted `event_properties.<name> = "<value>"` indented beneath. A `dry-run problems:` line names rules that failed or matched nothing — fix those rows and rerun. Exit 2: dtctl missing, run `/tools:setup`.

Tell the user: edit `review.csv`, then rerun Step 5. Show only file paths plus counts: distinct names before → after (total, and renamed → new), rule count, medium/low rows.

## Naming rules

| Type | New name | Notes |
|---|---|---|
| `hard_navigation` | `Load <cleaned path>` | Only rename when the path contains a placeholder (`Load /p/:product:`). Unchanged names → `keep=n`. |
| `soft_navigation` | `Navigate to <cleaned view.name>` | **Every** soft navigation, no exceptions — even sign-in, logout, or submit that change views. Never split by `view.source.name`. |
| `same_view` | Plain action name (`Add to Cart`, `Long Buy`) | Judgment from context; see below. |

**Placeholder syntax is `:name:`** (`/p/:product:`, `/order/:order_id:`). Never `{}` or `<>`. Existing custom names using other syntax get renamed too.

**Same-view judgment** — read cleaned `url.path` (usually carries the meaning), element in the default name, page, `view.source.name` (helps interpret, never part of the name), sibling groups, volume.
- **Split** one default name hitting different paths (`submitButton on /instruments/:id:` → Buy / Sell / Long Buy / Long Sell).
- **Merge** names differing only by unique data (`add-to-cart on /p/<50 products>` → Add to Cart).
- Path wins over page when they disagree.
- No confident business meaning → fallback name `<cleaned view.name>: <cleaned url.path>`, confidence low.
- Background polling/beacons attached to clicks at low volume → `keep=n`, reason "noise".
- Confidence: `high` (clear path verb/resource or meaningful element), `medium` (plausible from one signal), `low` (generic path + generic element, e.g. `/graphql`, `click on div`). Medium/low need a `reason`.

## review.csv

One row per group from `groups.csv`, or merged where they share a new name (`build-rules.mjs` also merges rows with the same type + name).

| Column | Content |
|---|---|
| `keep` | `y` → becomes a rule; `n` → unchanged, noise, or rejected |
| `type` | user action type |
| `proposed_name` | new `user_action.name` |
| `confidence` | high / medium / low |
| `reason` | why medium/low, or why keep=n |
| `match` | condition isolating the group beyond frontend + type |
| `extract` | parse steps, `;;`-separated, each `field\|DPL pattern` |
| `current_names` | top raw variants, `;`-separated, most frequent first (copy `top_raw_names`) |
| `variant_count`, `count` | from groups.csv (`count` feeds the PDF summary table) |

**`match` — the OpenPipeline matcher only allows** `matchesValue`, `matchesPhrase`, `isNull`, `isNotNull`, `==`/`!=`, `and`/`or`/`not`. No `matchesPattern`, `contains`, `startsWith`. `matchesValue` wildcards only at start/end. Match on `view.name` / `url.path`, **never `user_action.name`** — renames must not affect other rules.
- Load/Navigate: `matchesValue(view.name, "/p/*")` or `view.name == "/cart"`
- Same view: `url.path == "/api/cart/items"`
- Mid-path placeholder: `matchesValue(url.path, "/broker-service/v1/balance/*") and matchesValue(url.path, "*/deposit")`
- Path can't separate actions (generic endpoint) → add the element: `and matchesValue(ui_element.name, "*-T-quick-sell")`. `ui_element.name` is the element in the default name.

**`extract` — each placeholder becomes `event_properties.<placeholder>`**, emitted as `parse(field, "DPL")` inside the same `fieldsAdd` (function form, not the `parse` command).
- Tail: `view.name|'/p/' LD:event_properties.product`. Mid-path: `url.path|'/broker-service/v1/balance/' INT:event_properties.account_id '/deposit'`.
- Extract every placeholder that appears in the proposed name.
- IDs only in `url.path` (`/balance/:id:`): extract when it identifies a business entity, named after it (`account_id`, `instrument_id`); skip IDs you can't identify.
- Some apps template `view.name` themselves (`/instruments/:id:` literally). The raw value is then in `view.detected_name` (`/instruments/13`) — extract from that.

## Verify

Step 5 dry-runs each rule (top 3 matches). For counts, run a rule as a query — matcher text in `filter`, processor text unchanged after it:
```
fetch user.events, from: now()-7d
| filter <matching condition>
| <processor definition>
| summarize count=count(), by: {user_action.name}
```
Add `countDistinct(event_properties.<p>)` and `countIf(isNull(event_properties.<p>))` per extracted property. Counts should match `groups.csv` (small drift from the moving window is fine). This proves the DQL, not OpenPipeline behavior. Unverified: whether OpenPipeline may write `event_properties.*` without a property definition, and whether `frontend.name` is set before the matcher runs. Say so.

## findings.md

Short bullets with counts: names before → after; existing custom names (`custom-name` flag); capture gaps (`blank-element` = user interaction capture likely off, `blank-page`); IDs in `view.name` (`id-in-view`); noise groups left alone.

## Common mistakes

| Mistake | Correct |
|---|---|
| Naming a soft navigation by its request ("Sign In", "Get Prices") | `Navigate to <view>` always |
| Splitting navigations by source view | Source only interprets; it's queryable already |
| One big processor with `if()` branches | One processor per new name |
| Readable page names ("Product Page") | Cleaned paths (`/p/:product:`) |
| Assuming a soft nav fired a request | Check `url.path` — often empty |
| Default 1000-row query limit | `--max-result-records` |
| Abbreviated rules ("same prefix as above") | `build-rules.mjs` writes full condition + processor for every rule |
