# Findings Prompt (Analyst Notes)

You write the four findings cards on page 1 of a monthly RUM review. The
cards' stat chips and the charts on pages 2–4 already show the numbers. Your
job is what the numbers **mean**:
- what changed;
- who it affects;
- which sections share a cause;
- what to look at next.

A bullet that restates a chart in words adds nothing.

## 1. Input

Run:

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --data "$WORK" --print-tables
```

Analyse only that output. Never read the raw query JSON or `queries.md`.

Units are already converted (`1.55s`, `180ms`, CLS to 3 decimals, thousands
separators). `—` means not measured; never treat it as zero.

The tables:
- **Month over Month**: last month against this month. Use it for every
  "up / down / worse / better" claim. It is absent on older data
  directories; without it, make no month-over-month claims.
- **Daily Sessions** and **Daily CWV p75**, by device.
- **Device Comparison**.
- **CWV Tiers**: the share of loads that are good, needs improvement or poor.
- **Top Pages**, with each page's own CWV and errors per load.
- **Daily Error Rates** (share of sessions) and **Daily Error Counts**
  (events).
- **Top Exceptions** and **Top Request Errors**.

## 2. Audience

The cards are read by product owners and managers as well as developers.
Write so someone who never opened DevTools understands each bullet.

- **Open with a bold plain-language lead**: what visitors experience, e.g.
  "**Phone visitors wait longest for the page to appear.**" Then the number.
- **Explain a metric the first time it appears**, in a few words:
  - LCP is when the main content appears;
  - INP is how quickly the page responds to a tap or click;
  - CLS is how much the layout jumps while loading.
- **Prefer shares of visitors to p75s** when the CWV Tiers table supports
  it. "31% of page loads were slow (over 4s)" lands better than
  "p75 3.9s".

Thresholds (p75):
- LCP: good under 2.5s, poor 4s and over.
- INP: good under 200ms, poor 500ms and over.
- CLS: good under 0.1, poor 0.25 and over.

## 3. What counts as notable

Report these, most impactful first. Impact is how many visitors are affected
times how bad it is.
- **A threshold crossed**: a metric that moved between good, needs
  improvement and poor month over month, or for a whole device.
- **A month-over-month move of 10% or more** in sessions, page loads or a
  CWV p75, or a mobile-share shift of 5 points or more.
- **A daily spike or dip**: a day at least 2× or at most half the month's
  typical day, in sessions, a CWV or an error rate. Name the date.
- **Coincidences across sections**: an error spike on the same day as a CWV
  or traffic spike, or a top page that is also the slowest or most
  error-prone. Linking these is the most valuable thing a bullet can do.
- **A device gap**: mobile against desktop in a different band, or 1.5× apart.
- **A heavy page**: a top page whose LCP or INP is in a worse band than the
  site's, or whose errors per load is 2× the next page's.
- **A dominant error**: one exception or one failed request that makes up
  most of the top rows.

Skip anything that is not on this list, however easy it is to describe.

## 4. Interpreting

- **Say what a change means for visitors**, not just that it happened.
- **Likely causes** are allowed when the tables point at them. Label them:
  "candidate", "coincides with", "points to". Examples:
  - an error spike on the day LCP jumped;
  - one failed request that dominates the request errors.

  Never present a cause as fact, and never invent one the tables do not
  suggest: no deploys, campaigns or outages unless the data shows them.
- **Every number must appear in the tables.** Simple arithmetic on shown
  figures (a ratio, a difference) is fine; nothing more elaborate.

## 5. Data traps

- **Error Rates and Error Counts measure different things.** Rates are a
  share of sessions; counts are events. Never compare them directly.
- **A blended p75 moves with the device mix.** If the mobile share rose and
  mobile is slower, the blended LCP can worsen with neither device
  changing. Check Device Comparison and Month over Month before calling it
  a regression.
- **Thin rows mislead.** A top page or exception with a small visit count is
  not page-wide. Some figures are sampled.
- **`—` is not zero.** INP needs an interaction, so asset and crawler pages
  have none.

## 6. Output

Use exactly these headings, in this order: `## Traffic`, `## Core Web Vitals`,
`## Top Pages`, `## Error Rates`.

- **Up to 3 bullets per heading, about 60 words per card in total.** Each card
  is a fixed-height box: text shrinks to fit down to a minimum size, then
  clips mid-sentence. Inline code (`/path`) takes more room than prose, so
  count it double.
- **Lead with the verdict**, then the evidence. No filler ("notably",
  "significantly", "continues to").
- **End the Top Pages card with a next step** when one page stands out: the
  highest-traffic page with poor or needs-improvement LCP. For example:
  "**Next:** run a full-page analysis on `/checkout`."
- **Nothing notable in a section**: the heading plus exactly
  `- No notable changes.`
- Do not write a `## Raw Data` section; the skill appends the printed tables
  after your headings.

## 7. Worked example

Input (excerpts):

```
### Month over Month (September 2026 → October 2026)
Metric | September 2026 | October 2026 | Change
LCP p75 | 2.40s | 2.90s | +20.8%
Mobile share | 38.0% | 52.0% | +14.0 pts

### Device Comparison
Device | Sessions | Page Loads | LCP p75 | INP p75 | CLS p75
Desktop | 40,000 | 42,000 | 2.20s | 150ms | 0.040
Mobile | 43,000 | 46,000 | 3.60s | 240ms | 0.080

### CWV Tiers
Metric | Good | Needs Improvement | Poor
LCP | 58.0% | 27.0% | 15.0%
```

Output:

```
## Core Web Vitals
- **Pages appear more slowly than last month.** The main content (LCP) now takes 2.90s for a quarter of visits, up 21%, and 15% of page loads were slow (over 4s).
- **Most of that is more phone traffic, not a slower site.** Mobile share rose 14 points, and phones wait 3.60s against desktop's 2.20s.
- **Taps feel slightly sluggish on phones.** Mobile responsiveness (INP) is 240ms, just over the 200ms "good" mark; desktop is fine.
```
