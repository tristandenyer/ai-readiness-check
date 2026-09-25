import { describe, it, expect } from "./helpers/expect.js";
import { calculateGrade, pointsFor, WEIGHTS } from "../src/core/grade.js";

const ALL_CHECK_IDS = Object.keys(WEIGHTS);
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

function build(status) {
  return ALL_CHECK_IDS.map((id) => ({ id, status }));
}

describe("pointsFor", () => {
  it("gives full credit on pass", () => {
    expect(pointsFor("pass", 15)).toBe(15);
    expect(pointsFor("pass", 2)).toBe(2);
  });

  it("gives half credit on warn", () => {
    expect(pointsFor("warn", 15)).toBe(7.5);
    expect(pointsFor("warn", 8)).toBe(4);
    expect(pointsFor("warn", 2)).toBe(1);
  });

  it("gives zero on fail", () => {
    expect(pointsFor("fail", 15)).toBe(0);
    expect(pointsFor("fail", 2)).toBe(0);
  });

  it("gives zero on info", () => {
    expect(pointsFor("info", 15)).toBe(0);
  });

  it("gives zero on unknown status", () => {
    expect(pointsFor("nonsense", 15)).toBe(0);
  });
});

describe("calculateGrade", () => {
  it("perfect score: all pass returns 100 and grade A", () => {
    const result = calculateGrade(build("pass"));
    expect(result.score).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.earned).toBe(TOTAL_WEIGHT);
    expect(result.possible).toBe(TOTAL_WEIGHT);
    expect(result.passing).toBe(ALL_CHECK_IDS.length);
    expect(result.warnings).toBe(0);
    expect(result.failing).toBe(0);
    expect(result.info).toBe(0);
  });

  it("worst score: all fail returns 0 and grade F", () => {
    const result = calculateGrade(build("fail"));
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
    expect(result.earned).toBe(0);
    expect(result.possible).toBe(TOTAL_WEIGHT);
    expect(result.failing).toBe(ALL_CHECK_IDS.length);
  });

  it("all info: 0 score, F grade, no crash", () => {
    const result = calculateGrade(build("info"));
    expect(result.score).toBe(0);
    expect(result.grade).toBe("F");
    expect(result.earned).toBe(0);
    expect(result.possible).toBe(0);
    expect(result.info).toBe(ALL_CHECK_IDS.length);
  });

  it("info results are excluded from possible (denominator)", () => {
    // 1 pass on a weighted check, plus all others marked info
    const passId = "robots-txt"; // 18 in the new scheme
    const passWeight = WEIGHTS[passId];
    const results = ALL_CHECK_IDS.map((id) =>
      id === passId ? { id, status: "pass" } : { id, status: "info" }
    );
    const r = calculateGrade(results);
    expect(r.earned).toBe(passWeight);
    expect(r.possible).toBe(passWeight); // info excluded
    expect(r.score).toBe(passWeight);
  });

  it("warn earns half credit, score is the raw earnings rounded", () => {
    // robots-txt is 20 in the new scheme; warn earns 10.
    const results = [{ id: "robots-txt", status: "warn" }];
    const r = calculateGrade(results);
    expect(r.earned).toBe(10);
    expect(r.possible).toBe(20);
    expect(r.score).toBe(10);
    expect(r.grade).toBe("F"); // 10 < 60
    expect(r.warnings).toBe(1);
  });

  it("grade thresholds map to score buckets", () => {
    // All-pass earns 100 → A.
    expect(calculateGrade(build("pass")).grade).toBe("A");

    // 9 earned (one warn on robots-txt) → F.
    expect(
      calculateGrade([{ id: "robots-txt", status: "warn" }]).grade,
    ).toBe("F");

    // 20+20+20+8+8 = 76 earned → C.
    expect(
      calculateGrade([
        { id: "robots-txt", status: "pass" },
        { id: "llms-txt", status: "pass" },
        { id: "schema-jsonld", status: "pass" },
        { id: "content-negotiation", status: "pass" },
        { id: "md-route", status: "pass" },
      ]).grade,
    ).toBe("C");

    // All weighted checks pass → 100 → A.
    expect(
      calculateGrade([
        { id: "robots-txt", status: "pass" },
        { id: "llms-txt", status: "pass" },
        { id: "schema-jsonld", status: "pass" },
        { id: "content-negotiation", status: "pass" },
        { id: "md-route", status: "pass" },
        { id: "markdown-link", status: "pass" },
        { id: "sitemap", status: "pass" },
        { id: "llms-full-txt", status: "pass" },
      ]).grade,
    ).toBe("A");

    // 84 → B
    expect(
      calculateGrade([
        { id: "robots-txt", status: "pass" }, // 20
        { id: "llms-txt", status: "pass" }, // 20
        { id: "schema-jsonld", status: "pass" }, // 20
        { id: "content-negotiation", status: "pass" }, // 8
        { id: "md-route", status: "pass" }, // 8
        { id: "markdown-link", status: "pass" }, // 8
      ]).grade,
    ).toBe("B"); // 84 earned

    // 60 → D
    expect(
      calculateGrade([
        { id: "robots-txt", status: "pass" }, // 20
        { id: "llms-txt", status: "pass" }, // 20
        { id: "schema-jsonld", status: "pass" }, // 20
      ]).grade,
    ).toBe("D"); // 60 earned
  });

  it("a fail on a heavily-weighted check costs more than a light one", () => {
    const allPassButRobots = ALL_CHECK_IDS.map((id) => ({
      id,
      status: id === "robots-txt" ? "fail" : "pass",
    }));
    const allPassButHint = ALL_CHECK_IDS.map((id) => ({
      id,
      status: id === "ai-hint-div" ? "fail" : "pass",
    }));
    expect(calculateGrade(allPassButRobots).score).toBeLessThan(
      calculateGrade(allPassButHint).score,
    );
  });

  it("zero-weight info-only checks do not affect the score", () => {
    // ai-txt, tdmrep, agent-card, mcp-json all carry weight 0.
    // Passing them shouldn't bump the score; failing shouldn't drop it.
    const baseline = calculateGrade([
      { id: "robots-txt", status: "pass" },
    ]);
    const withInfoChecksPass = calculateGrade([
      { id: "robots-txt", status: "pass" },
      { id: "ai-txt", status: "pass" },
      { id: "tdmrep", status: "pass" },
      { id: "agent-card", status: "pass" },
      { id: "mcp-json", status: "pass" },
    ]);
    const withInfoChecksFail = calculateGrade([
      { id: "robots-txt", status: "pass" },
      { id: "ai-txt", status: "fail" },
      { id: "tdmrep", status: "fail" },
      { id: "agent-card", status: "fail" },
      { id: "mcp-json", status: "fail" },
    ]);
    expect(withInfoChecksPass.score).toBe(baseline.score);
    expect(withInfoChecksFail.score).toBe(baseline.score);
  });

  it("counts each status correctly in the summary fields", () => {
    const results = [
      { id: "robots-txt", status: "pass" },
      { id: "llms-txt", status: "pass" },
      { id: "schema-jsonld", status: "warn" },
      { id: "sitemap", status: "fail" },
      { id: "ai-txt", status: "info" },
      { id: "tdmrep", status: "info" },
    ];
    const r = calculateGrade(results);
    expect(r.passing).toBe(2);
    expect(r.warnings).toBe(1);
    expect(r.failing).toBe(1);
    expect(r.info).toBe(2);
  });

  it("empty results array does not crash", () => {
    const r = calculateGrade([]);
    expect(r.score).toBe(0);
    expect(r.grade).toBe("F");
    expect(r.earned).toBe(0);
    expect(r.possible).toBe(0);
  });

  it("unknown check ids contribute zero weight without throwing", () => {
    const r = calculateGrade([{ id: "nonexistent-check", status: "pass" }]);
    expect(r.score).toBe(0);
    expect(r.passing).toBe(1);
  });
});

describe("WEIGHTS", () => {
  it("has all 19 expected check ids", () => {
    expect(ALL_CHECK_IDS).toHaveLength(19);
  });

  it("totals to exactly 100 points so the score reads as a sum", () => {
    expect(TOTAL_WEIGHT).toBe(100);
  });

  it("weights the three high-impact checks at 20 each", () => {
    expect(WEIGHTS["robots-txt"]).toBe(20);
    expect(WEIGHTS["llms-txt"]).toBe(20);
    expect(WEIGHTS["schema-jsonld"]).toBe(20);
  });

  it("info-only niche checks carry zero weight by design", () => {
    expect(WEIGHTS["ai-txt"]).toBe(0);
    expect(WEIGHTS["tdmrep"]).toBe(0);
    expect(WEIGHTS["agent-card"]).toBe(0);
    expect(WEIGHTS["mcp-json"]).toBe(0);
    expect(WEIGHTS["api-agent-yaml"]).toBe(0);
    expect(WEIGHTS["content-signals"]).toBe(0);
    expect(WEIGHTS["api-catalog"]).toBe(0);
  });

  it("opt-out signals carry zero weight by design", () => {
    // ai-meta-tags (noai / noimageai), x-robots-tag, link-header, and
    // ai-hint-div are all "only add if you want to opt out" signals.
    // Their absence is fine for any public site that wants to be
    // discoverable — penalizing for their absence would put a
    // permanent ceiling on every clean public site's score.
    expect(WEIGHTS["ai-meta-tags"]).toBe(0);
    expect(WEIGHTS["x-robots-tag"]).toBe(0);
    expect(WEIGHTS["link-header"]).toBe(0);
    expect(WEIGHTS["ai-hint-div"]).toBe(0);
  });
});
