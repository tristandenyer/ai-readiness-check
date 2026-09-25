import { describe, it, expect, beforeEach, afterEach } from "./helpers/expect.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, applyRules, evaluate, ConfigError } from "../src/cli/config.js";
import { WEIGHTS } from "../src/core/grade.js";

const schema = JSON.parse(fs.readFileSync(new URL("../schema.json", import.meta.url), "utf8"));
const startDir = process.cwd();
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-config-"));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(startDir);
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (file, data) => fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
const configError = (fn) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.message;
    throw e;
  }
  return null;
};

describe("loadConfig: where settings come from", () => {
  it("uses defaults when there is no settings file", () => {
    expect(loadConfig()).toEqual({ target: undefined, pages: ["/"], rules: {}, failOn: "fail", minScore: undefined, ratchet: null, source: "defaults" });
  });

  it("reads the aiReadiness key in package.json", () => {
    write("package.json", { name: "x", aiReadiness: { minScore: 40 } });
    const c = loadConfig();
    expect(c.minScore).toBe(40);
    expect(c.source).toBe('package.json "aiReadiness"');
  });

  it("prefers ai-readiness.config.json over package.json", () => {
    write("package.json", { aiReadiness: { minScore: 40 } });
    write("ai-readiness.config.json", { minScore: 70 });
    expect(loadConfig().minScore).toBe(70);
  });

  it("prefers --config over both", () => {
    write("ai-readiness.config.json", { minScore: 70 });
    write("custom.json", { minScore: 90 });
    expect(loadConfig("custom.json").minScore).toBe(90);
  });

  it("ignores a package.json with no aiReadiness key", () => {
    write("package.json", { name: "x" });
    expect(loadConfig().source).toBe("defaults");
  });
});

describe("loadConfig: validation", () => {
  it("rejects an unknown check id and lists the valid ones", () => {
    write("ai-readiness.config.json", { rules: { "llms-text": "off" } });
    const msg = configError(() => loadConfig());
    expect(msg).toMatch(/unknown check "llms-text"/);
    expect(msg).toContain("llms-txt");
  });

  it("rejects bad values", () => {
    const bad = [
      { rules: { "llms-txt": "skip" } },
      { failOn: "error" },
      { minScore: 101 },
      { minScore: "80" },
      { pages: ["blog"] },
      { pages: [] },
      { target: 3000 },
      { minscore: 80 },
      { ratchet: "yes" },
      { ratchet: { tolerance: -1 } },
      { ratchet: { name: "" } },
      { ratchet: { floor: 50 } },
      [],
    ];
    for (const settings of bad) {
      write("ai-readiness.config.json", settings);
      expect(configError(() => loadConfig()), JSON.stringify(settings)).toBeTruthy();
    }
  });

  it("reports a file that isn't valid JSON", () => {
    fs.writeFileSync(path.join(dir, "ai-readiness.config.json"), "{ not json");
    expect(configError(() => loadConfig())).toMatch(/Could not read ai-readiness\.config\.json/);
  });

  it("reads the ratchet setting", () => {
    write("ai-readiness.config.json", { ratchet: true });
    expect(loadConfig().ratchet).toEqual({ tolerance: 0, name: "default" });
    write("ai-readiness.config.json", { ratchet: { tolerance: 2, name: "production" } });
    expect(loadConfig().ratchet).toEqual({ tolerance: 2, name: "production" });
  });

  it("allows a $schema key", () => {
    write("ai-readiness.config.json", { $schema: "https://unpkg.com/ai-readiness-check/schema.json" });
    expect(configError(() => loadConfig())).toBeNull();
  });

  it("schema.json lists exactly the checks the code has", () => {
    expect([...schema.properties.rules.propertyNames.enum].sort()).toEqual(Object.keys(WEIGHTS).sort());
  });
});

const result = (id, status) => ({ id, status });
const report = (results, extra = {}) => ({ url: "https://example.com", reachable: true, results, score: 50, ...extra });

describe("applyRules", () => {
  it("removes checks set to off and rescales the score over what remains", () => {
    // llms-txt (20) passes, robots-txt (20) fails. Turning robots-txt off
    // leaves 80 possible points; 20 of them earned is a score of 25.
    const r = applyRules(report([result("llms-txt", "pass"), result("robots-txt", "fail")]), { "robots-txt": "off" });
    expect(r.results.map((x) => x.id)).toEqual(["llms-txt"]);
    expect(r.score).toBe(25);
    expect(r.grade).toBe("F");
    expect(r.summary.failing).toBe(0);
  });

  it("never lowers the score by turning a check off", () => {
    const all = Object.keys(WEIGHTS).map((id) => result(id, "pass"));
    const r = applyRules(report(all), { "llms-txt": "off", sitemap: "off" });
    expect(r.score).toBe(100);
  });

  it("leaves the report alone when nothing is off", () => {
    const base = report([result("llms-txt", "fail")]);
    expect(applyRules(base, { "llms-txt": "warn" })).toBe(base);
  });
});

describe("evaluate", () => {
  const defaults = { rules: {}, failOn: "fail", minScore: undefined };

  it("passes when nothing failed", () => {
    expect(evaluate([report([result("llms-txt", "pass"), result("sitemap", "warn")])], defaults).code).toBe(0);
  });

  it("fails on a failing check and names it", () => {
    const { code, reasons } = evaluate([report([result("llms-txt", "fail")])], defaults);
    expect(code).toBe(1);
    expect(reasons[0]).toContain("llms-txt (fail)");
  });

  it("a warn rule reports the failure without failing the run", () => {
    expect(evaluate([report([result("llms-txt", "fail")])], { ...defaults, rules: { "llms-txt": "warn" } }).code).toBe(0);
  });

  it("failOn warn makes warnings fail the run", () => {
    expect(evaluate([report([result("sitemap", "warn")])], { ...defaults, failOn: "warn" }).code).toBe(1);
  });

  it("fails below minScore", () => {
    const { code, reasons } = evaluate([report([], { score: 64 })], { ...defaults, minScore: 80 });
    expect(code).toBe(1);
    expect(reasons[0]).toContain("score 64 is below minScore 80");
  });

  it("returns 2 when a page produced no results, and 1 when robots.txt blocks the checker", () => {
    expect(evaluate([report([], { reachable: false, reason: "down" })], defaults).code).toBe(2);
    expect(evaluate([report([], { blockedByRobots: true })], defaults).code).toBe(1);
  });

  it("uses the worst result across pages", () => {
    const pages = [report([result("llms-txt", "pass")]), report([result("llms-txt", "fail")])];
    expect(evaluate(pages, defaults).code).toBe(1);
  });
});

describe("inconclusive checks and the score", () => {
  it("leaves an inconclusive check out of the score instead of counting it as zero", async () => {
    const { calculateGrade } = await import("../src/core/grade.js");
    const all = Object.keys(WEIGHTS).map((id) => ({ id, status: "pass" }));
    expect(calculateGrade(all).score).toBe(100);
    const blip = all.map((r) => (r.id === "llms-txt" ? { ...r, status: "inconclusive" } : r));
    expect(calculateGrade(blip).score).toBe(100);
    const halfWarn = all.map((r) => (r.id === "robots-txt" ? { ...r, status: "warn" } : r.id === "llms-txt" ? { ...r, status: "inconclusive" } : r));
    expect(calculateGrade(halfWarn).score).toBe(Math.round((70 * 100) / 80)); // 80 measured, 10 lost to the warn
  });

  it("also leaves it out after rules turn other checks off", () => {
    const all = Object.keys(WEIGHTS).map((id) => ({ id, status: id === "llms-txt" ? "inconclusive" : "pass" }));
    const report = { url: "https://example.com", reachable: true, results: all };
    expect(applyRules(report, { sitemap: "off" }).score).toBe(100);
  });
});

describe("minScore boundary", () => {
  it("passes a score equal to minScore and fails one point below", () => {
    const at = (score, minScore) => evaluate([{ url: "https://example.com", reachable: true, score, results: [] }], { rules: {}, failOn: "fail", minScore }).code;
    expect(at(100, 100)).toBe(0);
    expect(at(99, 100)).toBe(1);
    expect(at(0, 0)).toBe(0);
  });
});

