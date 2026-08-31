// Shared thresholds for the full-page-analysis report.
//
// One source of truth, deliberately: the aggregate template colours the Core
// Web Vitals table from these, and computeFindings (appended by a later task)
// derives its rules from the same numbers. Hardcoding either copy would let
// the report's colours and its findings disagree.
//
// The web-vitals entries are the published good / needs-improvement boundaries
// (https://web.dev/articles/vitals). Each is the pair `msRating` in the
// template already expects: [good, needsImprovement].
export const THRESHOLDS = {
  lcpMs: [2500, 4000],
  fcpMs: [1800, 3000],
  inpMs: [200, 500],
  ttfbMs: [800, 1800],
  clsScore: [0.1, 0.25],

  // Share of page loads a resource must appear in before a per-resource number
  // describes the page rather than a handful of unlucky loads. This is the
  // distinction v2 exists to make: a p75 of 820 ms over 1,190 of 1,200 loads
  // is a page problem, the same figure over 3 loads is noise.
  prevalence: {
    widespread: 0.5, // at or above: the finding applies to the page
    rare: 0.05,      // below: too few loads to generalise from
  },
};
