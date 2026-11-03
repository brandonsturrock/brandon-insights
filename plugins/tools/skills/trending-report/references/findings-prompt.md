# Findings Prompt (Analyst Notes)

## 1. Input

Run:

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --data "$WORK" --print-tables
```

Analyse only that output. Never read the raw query JSON or `queries.md`. Units
are already converted (`1.55s`, `180ms`, CLS to 3 decimals, thousands
separators). `—` means not measured — never treat it as zero. Months before
the frontend has data show `—` (or 0 visits) throughout; skip them when judging
trends.

## 2. Persona and thresholds

Write as a web performance analyst producing an internal review for a named
frontend/application. Analyse ONLY the numbers in the printed tables — no
general Dynatrace or product advice, no invented context.

Thresholds (p75) — LCP: good `<2500ms`, poor `≥4000ms`. INP: good `<200ms`,
poor `≥500ms`. CLS: good `<0.1`, poor `≥0.25`.

Call out month-over-month changes, sustained trends, and mobile vs desktop
differences where the tables show them.

## 3. Rules

- Bullets only (`- `). **At most 3 per heading** — each findings card is a
  fixed-height box that clips overflow mid-sentence. Fewer is fine.
- ~15 words per bullet, hard cap 20. Lead with the finding, then the number.
  No filler ("notably", "significantly", "continues to"). State the delta or
  implication, not what the chart already shows.
- No preamble, conclusion, advice, or causes not evidenced in the tables.
- Every number cited must appear in the tables. Simple arithmetic on shown
  figures (a % change, a sum) is fine; nothing more elaborate.
- Nothing notable in a section: the heading plus exactly `- No notable changes.`

## 4. Output

Use exactly these headings, in this order: `## Traffic`, `## Core Web Vitals`, `## Browser & Device`.

Do not write a `## Raw Data` section; the skill appends the printed tables
after your headings.

## 5. Worked example

Input (from `### Monthly CWV p75`):

```
Month | LCP | INP | CLS
Feb 2026 | 2.65s | 220ms | 0.090
Mar 2026 | 2.60s | 215ms | 0.085
Apr 2026 | 2.55s | 205ms | 0.080
May 2026 | 2.50s | 200ms | 0.078
Jun 2026 | 2.48s | 195ms | 0.075
Jul 2026 | 2.40s | 190ms | 0.070
```

Output:

```
## Core Web Vitals
- LCP improved every month, 2.65s → 2.40s; good (<2500ms) since June.
- INP fell 220ms → 190ms; good (<200ms) since June.
- CLS fell 0.090 → 0.070; good throughout.
```
