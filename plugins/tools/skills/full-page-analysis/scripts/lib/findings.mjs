// Shared thresholds for the full-page-analysis report.
//
// One source of truth, deliberately: the aggregate template colours the Core
// Web Vitals table from these, and computeFindings (appended by a later task)
// derives its rules from the same numbers. Hardcoding either copy would let
// the report's colours and its findings disagree.
//
// The web-vitals entries are the published good / poor boundaries
// (https://web.dev/articles/vitals): at or below `good` is good, above `poor`
// is poor, between them is needs-improvement. The template feeds the pair to
// the ported `msRating` as [good, poor]; computeFindings reads the named
// fields directly, which is why this is an object and not a bare pair.
export const THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  fcp: { good: 1800, poor: 3000 },
  inp: { good: 200, poor: 500 },
  ttfb: { good: 800, poor: 1800 },
  cls: { good: 0.1, poor: 0.25 },

  // Share of page loads a resource must appear in before a per-resource number
  // describes the page rather than a handful of unlucky loads. This is the
  // distinction v2 exists to make: a p75 of 820 ms over 1,190 of 1,200 loads
  // is a page problem, the same figure over 3 loads is noise.
  prevalence: {
    widespread: 0.5, // at or above: the finding applies to the page
    rare: 0.05,      // below: too few loads to generalise from
  },
};
