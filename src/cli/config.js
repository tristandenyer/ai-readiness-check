/* Project settings: where they are read from, what they may contain, and
   how they decide whether a run passes. */
import fs from "node:fs";
import { WEIGHTS, calculateGrade, gradeFor, scaledScore } from "../core/grade.js";
import { noResultsReason } from "./formats.js";

export const CONFIG_FILE = "ai-readiness.config.json";
const CHECK_IDS = Object.keys(WEIGHTS);
const RULE_VALUES = ["off", "warn", "error"];

export class ConfigError extends Error {}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new ConfigError(`Could not read ${file}: ${err.message}`);
  }
};

/* First match wins: --config <path>, ai-readiness.config.json, the
   "aiReadiness" key in package.json, then defaults. */
export function loadConfig(explicitPath) {
  let raw = {};
  let source = "defaults";
  if (explicitPath) {
    raw = readJson(explicitPath);
    source = explicitPath;
  } else if (fs.existsSync(CONFIG_FILE)) {
    raw = readJson(CONFIG_FILE);
    source = CONFIG_FILE;
  } else if (fs.existsSync("package.json")) {
    const pkg = readJson("package.json");
    if (pkg.aiReadiness !== undefined) {
      raw = pkg.aiReadiness;
      source = 'package.json "aiReadiness"';
    }
  }
  return { ...validate(raw, source), source };
}

function validate(raw, source) {
  const problem = (msg) => {
    throw new ConfigError(`${source}: ${msg}`);
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) problem("settings must be a JSON object.");

  const known = ["$schema", "target", "pages", "rules", "failOn", "minScore", "ratchet"];
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) problem(`unknown setting "${key}". Valid settings: ${known.slice(1).join(", ")}.`);
  }
  const { target, pages = ["/"], rules = {}, failOn = "fail", minScore, ratchet: rawRatchet = false } = raw;

  if (target !== undefined && typeof target !== "string") problem('"target" must be a URL string.');
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every((p) => typeof p === "string" && p.startsWith("/"))) {
    problem('"pages" must be a list of paths that start with "/", like ["/", "/blog"].');
  }
  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) problem('"rules" must be an object.');
  for (const [id, value] of Object.entries(rules)) {
    if (!CHECK_IDS.includes(id)) problem(`unknown check "${id}" in "rules". Valid checks: ${CHECK_IDS.join(", ")}.`);
    if (!RULE_VALUES.includes(value)) problem(`rule "${id}" must be one of: ${RULE_VALUES.join(", ")}.`);
  }
  if (failOn !== "fail" && failOn !== "warn") problem('"failOn" must be "fail" or "warn".');
  if (minScore !== undefined && !(Number.isInteger(minScore) && minScore >= 0 && minScore <= 100)) {
    problem('"minScore" must be a whole number from 0 to 100.');
  }
  return { target, pages, rules, failOn, minScore, ratchet: validateRatchet(rawRatchet, problem) };
}

/* "ratchet": true, or { "tolerance": 2, "name": "production" }. Returns
   null when the ratchet is off. */
function validateRatchet(raw, problem) {
  if (raw === false) return null;
  if (raw !== true && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    problem('"ratchet" must be true, false, or an object like { "tolerance": 2 }.');
  }
  const { tolerance = 0, name = "default", ...rest } = raw === true ? {} : raw;
  if (Object.keys(rest).length) problem(`unknown ratchet setting "${Object.keys(rest)[0]}". Valid: tolerance, name.`);
  if (!(Number.isInteger(tolerance) && tolerance >= 0 && tolerance <= 100)) problem('"ratchet.tolerance" must be a whole number from 0 to 100.');
  if (typeof name !== "string" || !name) problem('"ratchet.name" must be a non-empty string.');
  return { tolerance, name };
}

/* Removes checks set to "off" and recalculates the score over the
   checks that remain, so turning a check off never lowers the score. */
export function applyRules(report, rules) {
  const off = new Set(Object.keys(rules).filter((id) => rules[id] === "off"));
  if (off.size === 0 || !Array.isArray(report.results) || report.results.length === 0) return report;
  const results = report.results.filter((r) => !off.has(r.id));
  const g = calculateGrade(results);
  const weightOf = (ids) => ids.reduce((sum, id) => sum + (WEIGHTS[id] ?? 0), 0);
  const inconclusive = results.filter((r) => r.status === "inconclusive").map((r) => r.id);
  const score = scaledScore(g.earned, weightOf([...off, ...inconclusive]));
  return {
    ...report,
    results,
    score,
    grade: gradeFor(score),
    earned: g.earned,
    possible: g.possible,
    summary: { passing: g.passing, warnings: g.warnings, failing: g.failing, info: g.info, inconclusive: g.inconclusive },
  };
}

/* Decides the exit code for a set of page reports:
   0 passed, 1 a check or minScore failed, 2 a page produced no results. */
export function evaluate(reports, { rules, failOn, minScore }) {
  let code = 0;
  const reasons = [];
  for (const report of reports) {
    if (report.blockedByRobots) {
      code = Math.max(code, 1);
      reasons.push(`${report.url}: robots.txt blocks the checker.`);
      continue;
    }
    const noResults = noResultsReason(report);
    if (noResults) {
      code = 2;
      reasons.push(`${report.url}: ${noResults}`);
      continue;
    }
    const inconclusive = report.results.filter((r) => r.status === "inconclusive").length;
    if (inconclusive * 2 > report.results.length) {
      code = 2;
      reasons.push(`${report.url}: ${inconclusive} of ${report.results.length} checks could not fetch their files. Check the site is up, then run again.`);
      continue;
    }
    const failed = report.results.filter(
      (r) => rules[r.id] !== "warn" && (r.status === "fail" || (failOn === "warn" && r.status === "warn")),
    );
    if (failed.length) {
      code = Math.max(code, 1);
      reasons.push(`${report.url}: ${failed.map((r) => `${r.id} (${r.status})`).join(", ")}.`);
    }
    if (minScore !== undefined && report.score < minScore) {
      code = Math.max(code, 1);
      reasons.push(`${report.url}: score ${report.score} is below minScore ${minScore}.`);
    }
  }
  return { code, reasons };
}
