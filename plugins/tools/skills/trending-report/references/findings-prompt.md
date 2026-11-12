# Findings Prompt (Analyst Notes)

You write the three findings cards on page 1 of a six-month RUM trend report.
The cards' stat chips and the charts on pages 2–4 already show the numbers.
Your job is what the trend **means**:
- is the site getting better or worse for visitors;
- why;
- which segments are behind it.

A bullet that restates a line chart in words adds nothing.

## 1. Input

Run:

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --data "$WORK" --print-tables
```

Analyse only that output. Never read the raw query JSON or `queries.md`.

Units are already converted (`1.55s`, `180ms`, CLS to 3 decimals, thousands
separators). `—` means not measured; never treat it as zero. Months before
the frontend has data show `—` (or 0 visits) throughout; skip them when judging
trends.

The tables:
- **Monthly Traffic**, with the desktop share.
- **Monthly CWV p75**, blended across devices.
- **Weekly CWV p75**, blended.
- **Weekly CWV p75 by Device**. Absent on older data directories; without it,
  make no device-level trend claims.
- **Browser & Device**: the top browser/device panels by month.

## 2. Audience

The cards are read by product owners and managers as well as developers.
Write so someone who never opened DevTools understands each bullet.

- **Open with a bold plain-language lead**: what visitors experience, e.g.
  "**Pages appear faster than six months ago.**" Then the number.
- **Explain a metric the first time it appears**, in a few words:
  - LCP is when the main content appears;
  - INP is how quickly the page responds to a tap or click;
  - CLS is how much the layout jumps while loading.
- **Use visitor terms**, not chart terms: "a quarter of visits wait 3s or
  more", not "the p75 series trended upward".

Thresholds (p75):
- LCP: good under 2.5s, poor 4s and over.
- INP: good under 200ms, poor 500ms and over.
- CLS: good under 0.1, poor 0.25 and over.

## 3. What counts as notable

Report these, most impactful first. Impact is the share of visits affected
times how bad it is.
- **A threshold crossed** over the period: a metric that moved between good,
  needs improvement and poor. Say when, by month or week.
- **A sustained trend**: 3 or more consecutive weeks, or months, moving the
  same way. Report the start, the end and how long it ran.
- **A step change**: a single week or month that moved 15% or more and held.
  Name the week. That is when to look for a release.
- **A recovery or a relapse**: a metric that crossed back over a threshold.
- **A traffic shift**: sessions up or down 10% or more over the period, or a
  desktop-share move of 5 points or more.
- **A lagging segment**: a browser/device panel in a worse band than the rest,
  or 1.5× the blended figure, on a meaningful share of visits.

Skip anything that is not on this list, however easy it is to describe.

## 4. Interpreting

- **Separate a real change from a mix shift.** The monthly and weekly CWV are
  blended across devices. If the desktop share fell (more phone traffic) and
  phones are slower, the blended LCP worsens with neither device getting
  slower.
  - Check **Weekly CWV p75 by Device** before calling a blended move a
    regression or an improvement.
  - Say which it is: "desktop and mobile are both flat; the rise is more
    phone traffic".
- **Likely causes** are allowed when the tables point at them. Label them:
  "candidate", "coincides with", "starts the week of". Examples:
  - a step change in one week;
  - a single browser driving a blended move.

  Never invent deploys, campaigns or outages.
- **Every number must appear in the tables.** Simple arithmetic on shown
  figures (a % change, a difference) is fine; nothing more elaborate.

## 5. Data traps

- **Partial first months**: months before data starts are `—` or 0. They are
  not a traffic collapse or a perfect score.
- **Weekly noise**: one odd week is not a trend. Require the 3-week run or
  the held step above.
- **Small segments**: a browser panel with little traffic can swing wildly.
  Weigh it by its visits.
- **Missing counters**: XHR or navigation counts that are `—` for some months
  are a data gap, not zero traffic.

## 6. Output

Use exactly these headings, in this order: `## Traffic`, `## Core Web Vitals`,
`## Browser & Device`.

- **Up to 5 bullets per heading, about 90 words per card in total.** Each
  card is a fixed-height box that clips overflow mid-sentence. Fewer is fine.
- **Lead with the verdict**, then the evidence. No filler ("notably",
  "significantly", "continues to").
- **The last Core Web Vitals bullet is the outlook**: the one metric or
  segment to watch or fix next, and why.
- **Nothing notable in a section**: the heading plus exactly
  `- No notable changes.`
- Do not write a `## Raw Data` section; the skill appends the printed tables
  after your headings.

## 7. Worked example

Input (excerpts):

```
### Monthly Traffic
Month | Sessions | XHR Requests | Navigations | % Desktop
May 2026 | 420,000 | ... | ... | 62.0%
Oct 2026 | 482,000 | ... | ... | 51.0%

### Monthly CWV p75
Month | LCP | INP | CLS
May 2026 | 2.30s | 180ms | 0.060
Oct 2026 | 2.70s | 205ms | 0.070

### Weekly CWV p75 by Device
Week | Device | LCP | INP | CLS
May 3 | Desktop | 2.00s | 150ms | 0.050
May 3 | Mobile | 3.10s | 230ms | 0.080
Oct 25 | Desktop | 2.00s | 152ms | 0.050
Oct 25 | Mobile | 3.15s | 235ms | 0.090
```

Output:

```
## Core Web Vitals
- **Pages look slower than in May, but the site itself has not slowed.** The main content (LCP) went from 2.30s to 2.70s for a quarter of visits, moving out of "good".
- **The change is more phone traffic.** Desktop share fell 11 points, and phones wait about 3.1s throughout against desktop's flat 2.00s.
- **Outlook: mobile is the lever.** Phone LCP has sat in "needs improvement" all period; with phones now half of traffic, it decides the site's score.
```
