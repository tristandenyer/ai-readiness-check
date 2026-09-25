/* Weights sum to exactly 100 so the top-line score reads as the
   straight sum of the per-check values shown on each card. A check
   worth 18 is "18 of your 100 points." A warn earns half.

   Two categories of unweighted checks. Both display "not scored" on
   their result cards — they're shown for visibility but don't move
   the score in either direction:

   1. Niche files that almost always return `info` because the spec
      doesn't apply to most sites: ai.txt, tdmrep.json,
      agent-card.json. (mcp.json moved to weighted because we now
      ship one and discoverability matters.)

   2. Opt-out signals where *absence* is the desired state for any
      public site that wants to be discoverable: x-robots-tag (no
      blocking header), link-header (no rel=canonical override),
      ai-hint-div (non-standard hint), ai-meta-tags (noai/noimageai
      are informally honored opt-outs, not a formal standard). All
      of these are "only add if you want to opt out" — penalizing
      sites for not opting out would put a permanent ceiling on the
      score for every clean public site. */
export const WEIGHTS = {
  "robots-txt": 20,
  "llms-txt": 20,
  "schema-jsonld": 20,
  "content-negotiation": 8,
  "md-route": 8,
  "markdown-link": 8,
  sitemap: 8,
  "llms-full-txt": 8,
  "mcp-json": 0,
  // Niche files: zero weight by design.
  tdmrep: 0,
  "ai-txt": 0,
  "agent-card": 0,
  // Early-stage RFC (API Field Guide): presence-only, unscored.
  "api-agent-yaml": 0,
  // Content Signals: ~4% adoption, AIPREF standardization pending.
  "content-signals": 0,
  // RFC 9727: only relevant for API publishers.
  "api-catalog": 0,
  // Opt-out signals; absence is what you want on a public site.
  "ai-meta-tags": 0,
  "x-robots-tag": 0,
  "link-header": 0,
  "ai-hint-div": 0,
};

export function pointsFor(status, weight) {
  if (status === "pass") return weight;
  if (status === "warn") return weight * 0.5;
  return 0;
}

/* The score out of 100 when some weight wasn't measured: checks turned
   off, or checks whose files couldn't be fetched (inconclusive). The
   points earned are scaled up over the weight that was measured, so
   leaving a check out never lowers the score. */
export function scaledScore(earned, excludedWeight) {
  const measured = 100 - excludedWeight;
  return measured > 0 ? Math.round((earned * 100) / measured) : 100;
}

export function gradeFor(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function calculateGrade(results) {
  // Weights sum to 100. info checks contribute 0 and are excluded
  // from the denominator (we don't penalize a site for niche files
  // that don't apply). So `score` is the straight sum of per-check
  // earnings, and `possible` is whatever weight applied — which may
  // be less than 100 if the site has info checks. The user sees the
  // same number on the score card that they'd get summing each
  // result card by hand.
  let earned = 0;
  let possible = 0;

  for (const r of results) {
    const weight = WEIGHTS[r.id] ?? 0;
    if (r.status !== "info" && r.status !== "inconclusive") {
      possible += weight;
      earned += pointsFor(r.status, weight);
    }
  }

  // Round to integer for display. Per-check values are integer or
  // .5, but a sum of half-points can land on an .5; we round so the
  // top-line score is always whole. Grade thresholds apply to the
  // rounded value.
  const inconclusiveWeight = results
    .filter((r) => r.status === "inconclusive")
    .reduce((sum, r) => sum + (WEIGHTS[r.id] ?? 0), 0);
  const score = scaledScore(earned, inconclusiveWeight);

  const grade = gradeFor(score);

  const passing = results.filter((r) => r.status === "pass").length;
  const warnings = results.filter((r) => r.status === "warn").length;
  const failing = results.filter((r) => r.status === "fail").length;
  const info = results.filter((r) => r.status === "info").length;
  const inconclusive = results.filter((r) => r.status === "inconclusive").length;

  return { grade, score, earned, possible, passing, warnings, failing, info, inconclusive };
}
