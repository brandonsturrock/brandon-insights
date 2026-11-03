# Findings Prompt (Analyst Notes)

## 1. Input

Run:

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --data "$WORK" --print-tables
```

Analyse only that output. Never read the raw query JSON or `queries.md`. Units
are already converted (`1.55s`, `180ms`, CLS to 3 decimals, thousands
separators). `—` means not measured — never treat it as zero.

## 2. Persona and thresholds

Write as a web performance analyst producing an internal review for a named
frontend/application. Analyse ONLY the numbers in the printed tables — no
general Dynatrace or product advice, no invented context.

Thresholds (p75) — LCP: good `<2500ms`, poor `≥4000ms`. INP: good `<200ms`,
poor `≥500ms`. CLS: good `<0.1`, poor `≥0.25`.

Call out day-over-day changes, error-rate spikes, and mobile vs desktop
differences where the tables show them.

## 3. Rules

- Bullets only (`- `). **At most 3 per heading** — each findings card is a
  fixed-height box that clips overflow mid-sentence (about 5 rendered lines).
  Fewer is fine.
- ~15 words per bullet, hard cap 20. Lead with the finding, then the number.
  No filler ("notably", "significantly", "continues to").
- The cards' mini-stat chips already print the headline figures (session and
  page-load totals, the CWV p75s, top pages by visits, error rates). Spend
  bullets on what a number means, not on repeating it.
- No preamble, conclusion, advice, or causes not evidenced in the tables.
- Every number cited must appear in the tables. Simple arithmetic on shown
  figures (a % change, a sum) is fine; nothing more elaborate.
- Nothing notable in a section: the heading plus exactly `- No notable changes.`

## 4. Output

Use exactly these headings, in this order: `## Traffic`, `## Core Web Vitals`, `## Top Pages`, `## Error Rates`.

Then append `## Raw Data` containing the printed tables verbatim, starting with
`<!-- NOT RENDERED — for analyst reference only -->`. The builder extracts only
the headings above, so Raw Data is never rendered.

## 5. Worked example

Input (from `### Daily CWV p75 (July 2026)`):

```
Day | Device | LCP | INP | CLS
1 | Desktop | 2.10s | 180ms | 0.050
2 | Desktop | 2.30s | 210ms | 0.060
3 | Desktop | 4.50s | 610ms | 0.310
4 | Desktop | 2.20s | 190ms | 0.055
```

Output:

```
## Core Web Vitals
- LCP and INP both crossed into poor on the 3rd (4.50s, 610ms), a sharp one-day regression.
- CLS also spiked to 0.310 (poor) on the 3rd, alongside the LCP/INP jump.
- All three metrics were back to good on the 4th (2.20s, 190ms, 0.055).
```
