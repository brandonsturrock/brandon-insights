# Findings Prompt (Analyst Notes)

## 1. Purpose

The original dt-app POSTed a data dump to Davis CoPilot
(`/platform/davis/copilot/v1/skills/conversations:message`) and pasted back
whatever markdown it returned. There is no CoPilot call here — Claude reads
the same raw DQL query result JSON and writes the same-shaped analyst-notes
markdown directly, in this same turn. Follow this doc exactly in place of
that HTTP round-trip.

## 2. Data table construction

Build small pipe-delimited tables from the query result JSON before writing
any prose — same shape as the original app's `buildSupplementary` /
`buildCmSupplementary` helpers. Format numbers the same way: milliseconds
under 1000 as `123ms`, 1000+ as `1.23s`; CLS to 3 decimals; counts with
thousands separators.

Exact filenames for query outputs are defined in `references/queries.md`
(owned separately) — resolve by purpose below, don't guess a filename.

### Trending tab inputs (6-month view)

- **Monthly traffic query output** → table `Month | Sessions | User Actions | Page Loads | % Desktop | % Mobile`
- **Monthly CWV (p75) query output** → table `Month | LCP p75 | INP p75 | CLS p75`
- **Latest-month browser breakdown query output** → filter to only the most
  recent month present, take top 8 rows by visits, table
  `Browser | Device | Visits | LCP p75 | INP p75 | CLS p75`

### Current-Month tab inputs

- **Daily sessions query output** → sum sessions per day across devices,
  table `Day | Sessions`
- **Daily CWV (p75) query output** → table `Day | LCP p75 | INP p75 | CLS p75`
- **Daily errors query output** → table `Day | JS Error Sessions | Request Error Sessions`
- **Device comparison query output** → table `Device | Sessions | Page Loads | LCP p75 | INP p75 | CLS p75`
- **Top pages query output** → table `Page | Visits | LCP p75 | INP p75 | CLS p75 | Avg Exceptions | Avg Req Errors`
  (use `—` for any null metric — do not treat null as zero)

## 3. Persona and instructions

Write as a web performance analyst producing an internal review for a named
frontend/application. Analyze ONLY the numbers in the data tables built in
step 2 — no general Dynatrace or product advice, no invented context.

Apply these Core Web Vitals thresholds (p75) when flagging violations:

- **LCP**: good `<2500ms`, poor `≥4000ms`
- **INP**: good `<200ms`, poor `≥500ms`
- **CLS**: good `<0.1`, poor `≥0.25`

- Trending report: call out month-over-month changes and sustained trends.
- Current-Month report: call out day-over-day changes.
- Flag error-session spikes (JS or request errors) where the data shows them.
- Compare mobile vs desktop performance where the device-level data supports it.

## 4. Output format rules

- Strict markdown, bullets only (`- `), one short sentence per bullet.
- 3-4 bullets per heading maximum, and only if genuinely warranted by the
  data — fewer bullets (or the fallback in §5) when there's less to say.
- No preamble, no conclusion, no general advice.
- Use exactly these headings, in this order, for the report type being written:

**Trending report:**
```
## Traffic
## Core Web Vitals
## Browser & Device
```

**Current-Month report:**
```
## Traffic
## Core Web Vitals
## Top Pages
## Error Rates
```

## 5. Anti-hallucination guardrails

Stricter than the original app: this is Claude's own output now, not a
disclaimed AI feature.

- Every number cited in a bullet must trace back to a value present in the
  data tables from step 2. Simple, directly-derivable arithmetic (e.g. %
  change between two given numbers, a sum already shown) is fine. Do not
  compute anything more elaborate, and do not speculate about causes not
  evidenced in the data (no "likely due to a deploy" style guessing).
- If a section genuinely has nothing notable, emit the heading followed by
  exactly one bullet: `- No notable changes.` Do not invent a finding to
  fill the quota.
- Never reference or fabricate demo/placeholder data. Use only real values
  from the actual query results for this run.

## 6. Worked example

Input data table (Current-Month, Core Web Vitals):

```
Day | LCP p75 | INP p75 | CLS p75
2026-07-01 | 2.10s | 180ms | 0.050
2026-07-02 | 2.30s | 210ms | 0.060
2026-07-03 | 4.50s | 610ms | 0.310
2026-07-04 | 2.20s | 190ms | 0.055
```

Output markdown:

```
## Core Web Vitals
- LCP and INP both crossed into poor territory on 2026-07-03 (4.50s, 610ms), a sharp one-day regression.
- CLS also spiked to 0.310 (poor) on 2026-07-03 alongside the LCP/INP jump.
- All three metrics returned to good on 2026-07-04, back in line with 2026-07-01/02.
```
