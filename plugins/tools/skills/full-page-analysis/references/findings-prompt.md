# Writing analyst notes for a full-page-analysis report

You are adding the **Analyst notes** to a full-page-analysis report.
`build-report.mjs` has already computed the deterministic findings. Your job is
the part a rule cannot do:
- say *why* the page is slow;
- say which findings share a cause;
- say what to change first.

## Input: the context digest

Read one document and nothing else:

```bash
node <SKILL_BASE_DIR>/scripts/build-report.mjs --data <data-dir> --page-title "<PAGE>" --print-context
```

It is built from the same coerced data the report renders, so it cannot
disagree with the page. It holds:
- `findings` — the computed findings (`id`, `severity`, `title`, `evidence`).
- `cwv` — p50/p75/p95 and `n` per metric.
- `lcp` — the page-wide LCP parts at p75 and the share of image LCPs.
  - `topElements` lists the most common LCP elements with their own part p75s.
  - For images, `topElements[].resource.initiatorType` says how the browser
    fetched the image.
- `ttfbPhasesP75`, `renderBlocking`, `slowestResources`, `heaviestResources`, `thirdParty`,
  `longTasks`, `errors` (with `topExceptions`) and `segments` — the
  page-wide aggregates.
- `exampleAction` — **one load**:
  - its LCP element and parts;
  - when its LCP request started (`lcpRequest`, ms from navigation start);
  - its render-blocking requests, long tasks and exceptions on the same clock.

**Every number in the notes must appear in the digest.** Do not read raw query
JSON: its counters are unparsed strings. Do not run extra queries to find
numbers to cite. If something you need is missing, leave it out.

## How to diagnose

Work from the worst Core Web Vital down. For most pages that is LCP, so start
there.

### LCP: start from its largest part

The four parts add up to LCP on each load. Find the largest in
`lcp.partsP75`. Then check the same part in the top `lcp.topElements` entry,
which is the element most loads actually wait on.

| Largest part | What it means | Confirm with | Typical fix |
|---|---|---|---|
| TTFB | the server or CDN is slow to respond | `ttfbPhasesP75`; `cwv.ttfb` | cache the HTML at the CDN, fix the slow back-end, cut redirects |
| Resource load delay | the LCP image is requested late, because the browser finds it late | `topElements[].resource.initiatorType`: `css` is a CSS background; `script`, `xmlhttprequest` or `fetch` means inserted by code; `img` is a plain `<img>`. Also `exampleAction.lcpRequest.startMs` against the end of `exampleAction.renderBlockingRequests` | put the image in the HTML as an `<img>`; add `fetchpriority="high"` or `<link rel="preload">`; drop `loading="lazy"` on it |
| Resource load duration | the image takes long to download | `resource.transferP75`, `resource.durationP75` | compress and resize it; serve AVIF/WebP; serve responsive sizes |
| Element render delay | the image or text is ready but cannot paint | `renderBlocking`; `longTasks`; text LCPs (`kind: "text"`), which usually wait on script or web fonts | defer or async render-blocking scripts; inline the critical CSS; render the text server-side; `font-display: swap` |

A text LCP has no resource, so render delay is almost all of it past TTFB. Look
at what paints the text: client-side rendering, script that fills in data, or
web fonts.

### Other metrics

- **INP**: long tasks are the mechanism. Third-party scripts present on most
  loads (`thirdParty`) are candidates, not proven causes. Say "candidate".
- **CLS**: late-inserted images, ads, banners and font swaps. The digest has no
  per-element shift data, so name the likely sources and stop there.
- **FCP above good while TTFB is fine**: render-blocking CSS/JS.
- **TTFB**: name the largest phase in `ttfbPhasesP75`.

### Connect the findings

The point of the notes is the link a single rule cannot make. One cause that
explains three findings is one bullet, not three. Examples of links worth
making:
- `render-blocking` plus a large element render delay: the same scripts.
- `slow-lcp` plus a CSS-background LCP image: late discovery. Preloading fixes
  more than shaving the image does.
- `errors` driven by one exception: say which one. Several `topExceptions` rows
  are often the same bug in different browsers' wording. Group them and give
  the share of the biggest row, not a sum.
- `slow-inp` plus `long-tasks` plus heavy third parties: profile those scripts
  first.

### Name the platform when URLs reveal it

URL patterns often show the stack. For example:
- `/etc.clientlibs/` and `/content/dam/` mean Adobe Experience Manager;
- `/_next/` means Next.js;
- `/wp-content/` means WordPress;
- `cdn.shopify.com` means Shopify.

Naming the platform makes a fix concrete, for example "AEM clientlib
categories can load async". State it as an inference ("the URLs suggest
AEM"), never as fact.

## Data traps

These have produced wrong notes before:
- **p75s do not add up.** The LCP parts' p75s and the TTFB phases' p75s do not
  sum to the LCP or TTFB p75. Compare parts with each other; never subtract them
  from the total.
- **Third-party time is summed per load.** Requests overlap, so
  `summedRequestTimeP75` is time spent fetching, not time added to the load.
- **"Other failed requests" are mostly noise.** `errors.otherFailedPct` counts
  failed requests that are neither 4xx nor 5xx: beacons, aborted and cancelled
  requests. Do not present it as users seeing failures. CSP violations matter
  only if they block something the page needs.
- **The example action is one load.** Anything from `exampleAction` gets
  labelled "in the example action". Never generalise from it. Every claim about
  "most loads" must come from an aggregate or a finding.
- **Prevalence gates are deliberate.** A dramatic resource missing from
  `slowestResources` or the findings is usually below the 50% widespread
  threshold. It does not describe the page. Mention it only as affecting a
  small number of loads.

## Output

Plain markdown under the two headings the build reads, in this order:

```
## Executive summary

## Analyst notes
```

Anything under other headings is ignored.

### Executive summary

The first thing in the report, read by people who will read nothing else.
- **3 bullets**, each under 40 words, with a bold lead like the notes.
- **The verdict**: how the page does against the Core Web Vitals, in
  visitor terms ("the main content takes 4.7s to appear for a quarter of
  visitors").
- **The cause**: the one or two root causes, with no file names or code.
- **The fix and who does it**: the kind of change ("front-end changes to how
  the banner loads"), not the implementation.
- Same rules as the notes: only numbers from the digest, no jargon without a
  plain explanation.
- If no findings fired, one bullet saying so is enough.

### Analyst notes

- **At most 8 bullets, ordered by impact on the worst Core Web Vital.** The
  first bullet is the change that moves the headline metric most.
  - The first 3–5 cover the main causes.
  - Use the rest for secondary wins, such as heavy files in
    `heaviestResources`, images that could load later, or a noisy third
    party. Each must name a distinct action.
  - Stop when you run out of distinct actions; fewer bullets is fine.
- **Each bullet is one action plus its evidence:**
  - what to change;
  - the evidence that ties it to the page, usually the link between findings;
  - which metric it moves.
  - Under 60 words.
- **Lead with the action**: "Preload the carousel image…", not "The analysis
  shows that…".

### Write for a mixed audience

The notes are read by managers and product owners as well as developers. Each
bullet should make sense to someone who has never opened DevTools, without
losing the detail a developer needs to act.

- **Open with a bold plain-language lead**: what is wrong in terms of what
  visitors experience. Example: "**The main banner image shows up late.**"
- **Follow with the technical cause and fix.** Keep the file names, URLs and
  numbers.
- **Explain a technical term briefly the first time it appears**, in a few
  words: "render-blocking scripts (code the browser must finish before it can
  show anything)". Do not explain terms a developer audience would find
  patronising, such as "JavaScript" or "image".
- **Name the user impact** ("the page looks blank for longer", "taps feel
  sluggish") rather than only the metric. Name the metric too, for the
  developers.
- **Use plain sentences.** No arrows, abbreviations or jargon chains. "LCP"
  can stay once it has been introduced as "the main content appearing".

Plain-language anchors for the common terms:

| Term | Say it as |
|---|---|
| LCP | when the main content (usually the hero image or headline) appears |
| FCP | when anything first appears on screen |
| INP | how quickly the page responds to a tap or click |
| CLS | how much the layout jumps around while loading |
| TTFB | how long the server takes to start responding |
| Render-blocking | code or styles the browser must finish before showing anything |
| Long task | a stretch where the browser is too busy to respond |
| Third party | code from another company, such as ads, analytics or chat |
| Preload / `fetchpriority` | telling the browser to fetch something first |
| Exception | a script error |
- **Do not repeat a finding's evidence line.** The reader has it beside the
  notes. Cite a number only when it is the reason for the link or the action,
  and cite one, not the derivation.
- **No hedging filler** ("worth noting", "arguably", "generally"). The
  inference labels above ("candidate", "suggests") are the only qualifiers.
- **No findings fired:** write one bullet saying the page meets every
  threshold. If the digest shows something close to a threshold, add a second
  bullet naming that metric and its largest part. Do not invent problems.
- **Inline formatting:** `` `code` `` for file names, URLs and code, and
  `**bold**` sparingly. Nothing else renders.

### Formatting numbers

Match the report so a number reads as the same fact as the table beside it:
- milliseconds under 1000 as `123ms`;
- 1000 and over as `1.23s`;
- CLS to three decimals, e.g. `0.083`;
- not measured as `—`, never `0`.

## Thresholds

Copied from `THRESHOLDS` in `scripts/lib/findings.mjs`. Also present in the
digest as `thresholds`.

| Metric | Good | Poor |
|---|---|---|
| LCP  | under 2500ms | over 4000ms |
| INP  | under 200ms  | over 500ms  |
| CLS  | under 0.1    | over 0.25   |
| FCP  | under 1800ms | over 3000ms |
| TTFB | under 800ms  | over 1800ms |

TTFB is not a Core Web Vital, but web.dev publishes these boundaries for it.
The three Core Web Vitals are LCP, INP and CLS.

Other rule gates, from the same file:
- `prevalence.widespread` (0.5) — a resource, third party or render-blocker
  must be on at least half of loads, or half of its own requests for blocking,
  before a rule fires.
- `prevalence.rare` (0.05) — below this the tables label a row "rare".
- `resourceSlowMs` (500), `thirdPartySlowMs` (200) — the p75 floors for
  `slow-resources` and `slow-third-party`.
- `errorRate` (0.05) — the share of loads with any error before `errors` fires.
- `segmentRatio` (1.5) / `segmentMinShare` (0.05) — a browser/device segment
  fires `segment-outlier` only at 1.5x the blended LCP p75 and 5% of loads.

## Before you save

Check each bullet:
1. Every number is in the digest.
2. A claim about the example action says so.
3. Third-party time is not described as added time.
4. No p75s are summed or subtracted.
