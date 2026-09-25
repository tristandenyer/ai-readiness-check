/* The ratchet: ai-readiness.baseline.json records each page's score and
   check results, and later runs may not fall below them. */
import fs from "node:fs";
import { calculateGrade } from "../core/grade.js";
import { applyRules } from "./config.js";
import { noResultsReason } from "./formats.js";

export const BASELINE_FILE = "ai-readiness.baseline.json";
const RANK = { fail: 0, warn: 1, pass: 2 }; // info and inconclusive aren't ranked

/* Pages are keyed by path, so a preview URL that changes on every deploy
   still matches its floor. */
const pagePath = (report) => {
  const u = new URL(report.url);
  return u.pathname + u.search;
};
const major = (v) => String(v ?? "0").split(".")[0];

export function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
}

/* Sorted keys, two-space indent, trailing newline: the same results always
   produce the same file, so diffs show only real changes. */
function writeBaseline(data) {
  const sortKeys = (v) =>
    Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
    : v;
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(sortKeys(data), null, 2) + "\n");
}

/* Records the reports as the new floor for `targetName`. An inconclusive
   check keeps its previous status, since this run learned nothing about it.
   Returns the pages whose score would go down; nothing is written then
   unless allowLower is set. */
export function updateBaseline(reports, { targetName, version, allowLower }) {
  const baseline = readBaseline() ?? { version: 1, targets: {} };
  const previous = baseline.targets[targetName]?.pages ?? {};
  const pages = {};
  const lower = [];
  for (const report of reports) {
    if (noResultsReason(report)) continue;
    const path = pagePath(report);
    const checks = {};
    for (const r of report.results) {
      checks[r.id] = r.status === "inconclusive" ? previous[path]?.checks?.[r.id] : r.status;
    }
    pages[path] = { score: report.score, checks };
    if (previous[path] && report.score < previous[path].score) lower.push(`${path}: ${previous[path].score} → ${report.score}`);
  }
  if (lower.length && !allowLower) return { written: false, lower };
  baseline.packageVersion = version;
  baseline.targets[targetName] = { pages };
  writeBaseline(baseline);
  return { written: true, lower };
}

/* Compares reports with the baseline. Returns the exit code (0 or 1),
   failure reasons, and notes (score rose, scoring changed, no baseline). */
export function compareToBaseline(reports, { targetName, tolerance, rules, version }) {
  const baseline = readBaseline();
  const entry = baseline?.targets?.[targetName];
  if (!entry) return { code: 0, reasons: [], notes: [], missing: true };

  const reasons = [];
  const notes = [];
  const scoringChanged = major(baseline.packageVersion) !== major(version);

  for (const report of reports) {
    if (noResultsReason(report)) continue;
    const path = pagePath(report);
    const prev = entry.pages?.[path];
    if (!prev) {
      notes.push(`${path}: not in the baseline yet. Run "ai-readiness-check baseline" to add it.`);
      continue;
    }

    let floor = prev.score;
    if (scoringChanged) {
      // Re-score the recorded results with this version's weights, so a
      // change in scoring isn't mistaken for a change in the site.
      const results = Object.entries(prev.checks).map(([id, status]) => ({ id, status }));
      floor = applyRules({ results, ...calculateGrade(results) }, rules).score;
      notes.push(`${path}: scoring changed in v${major(version)}. The floor moved from ${prev.score} to ${floor} because of new weights, not because of your site.`);
    }

    if (report.score < floor - tolerance) {
      reasons.push(`${report.url}: score ${report.score} is below the baseline of ${floor}.`);
    } else if (report.score > floor) {
      notes.push(`${path}: score rose ${floor} → ${report.score}. Run "ai-readiness-check baseline" and commit ${BASELINE_FILE}.`);
    }

    for (const r of report.results) {
      const before = prev.checks[r.id];
      if (RANK[before] !== undefined && RANK[r.status] !== undefined && RANK[r.status] < RANK[before]) {
        reasons.push(`${report.url}: ${r.id} got worse (${before} → ${r.status}). ${r.promptUrl ? `How to fix: ${r.promptUrl}` : ""}`.trim());
      }
    }
  }
  return { code: reasons.length ? 1 : 0, reasons, notes, missing: false };
}
