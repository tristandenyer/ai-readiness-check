/* Output formats for `ai-readiness-check check`. Each takes the report
   from runCheck and returns a string; formatSarif takes every page's
   report, since SARIF needs one combined log. */
import fs from "node:fs";
import { WEIGHTS } from "../core/grade.js";

/* Checks fixed by publishing a file at the site root, and that file. */
const ROOT_FILES = {
  "robots-txt": "robots.txt",
  "content-signals": "robots.txt",
  "llms-txt": "llms.txt",
  "llms-full-txt": "llms-full.txt",
  "ai-txt": "ai.txt",
  tdmrep: ".well-known/tdmrep.json",
  "agent-card": ".well-known/agent-card.json",
  "mcp-json": ".well-known/mcp.json",
  "api-agent-yaml": ".well-known/api-agent.yaml",
  "api-catalog": ".well-known/api-catalog",
  sitemap: "sitemap.xml",
};
const SERVER_CHECKS = new Set(["content-negotiation", "md-route", "x-robots-tag", "link-header"]);

/* The folder a project serves as the site root, found by name only. */
const staticDir = () => ["public", "static"].find((d) => fs.existsSync(d)) ?? null;

/* Where to make the fix, e.g. "public/llms.txt". */
export function whereToFix(id, dir = staticDir()) {
  if (ROOT_FILES[id]) return dir ? `${dir}/${ROOT_FILES[id]}` : ROOT_FILES[id];
  if (SERVER_CHECKS.has(id)) return "server or hosting configuration (response headers, routes)";
  return "the page's <head>";
}

const RANK = { fail: 0, warn: 1, pass: 2, info: 3, inconclusive: 3 };
const byImpact = (a, b) => RANK[a.status] - RANK[b.status] || (WEIGHTS[b.id] ?? 0) - (WEIGHTS[a.id] ?? 0);
const sorted = (report) => [...report.results].sort(byImpact);
/* Where to read how to fix a check: its prompt, else the article, else the spec. */
const helpUrl = (r) => r.promptUrl ?? r.learnMoreUrl ?? r.specUrl;
export const problems = (report) => sorted(report).filter((r) => r.status === "fail" || r.status === "warn");

/* Why the report has no check results, or null if it has them. */
export function noResultsReason(report) {
  if (report.blockedByRobots) return report.blockedReason;
  if (report.reachable === false) return report.reason || report.reachableError || "The site could not be reached.";
  return null;
}

/* Some check summaries quote text taken from the checked site (page
   titles, schema.org types, header values). An agent might treat that
   text as instructions, so output meant for agents replaces quoted text.
   Our own "(3 sections)" style counts are kept. */
const COUNTS = /^\d[\d.,]*\s*[A-Za-z%/.][\w%/. -]*(,\s*\d[\d.,]*\s*[A-Za-z%/.][\w%/. -]*)*$/;
export function scrub(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(/"[^"]*"/g, '"…"')
    .replace(/`[^`]*`/g, "`…`")
    .replace(/\(([^()]+)\)/g, (match, inner) => (COUNTS.test(inner.trim()) ? match : "(…)"));
}

const headline = (r) => {
  const { passing, warnings, failing, info, inconclusive } = r.summary;
  const counts = `${passing} passing, ${warnings} warnings, ${failing} failing, ${info} info${inconclusive ? `, ${inconclusive} inconclusive` : ""}`;
  return `${r.url}: grade ${r.grade}, score ${r.score}/100 (${counts})`;
};

export function formatPretty(report) {
  const reason = noResultsReason(report);
  if (reason) return `${report.url}\n${reason}\n`;
  const icon = { pass: "✓", warn: "!", fail: "✗", info: "i", inconclusive: "?" };
  const lines = [headline(report), ""];
  for (const r of sorted(report)) {
    lines.push(`${icon[r.status]} ${r.name}: ${r.summary}`);
    if (RANK[r.status] < 2) lines.push(`    Fix: ${r.fixSummary}`, `    How: ${helpUrl(r) ?? ""}`);
  }
  return lines.join("\n") + "\n";
}

export const formatJson = (report) => JSON.stringify(report, null, 2) + "\n";

export function formatMarkdown(report) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  const reason = noResultsReason(report);
  if (reason) return `## AI readiness: ${report.url}\n\n${cell(reason)}\n`;
  const lines = [`## AI readiness: ${headline(report)}`, "", "| Status | Check | Result | Fix |", "|---|---|---|---|"];
  for (const r of sorted(report)) {
    const fix = RANK[r.status] < 2 ? `${cell(r.fixSummary)}${helpUrl(r) ? ` [How](${helpUrl(r)})` : ""}` : "";
    lines.push(`| ${r.status} | ${cell(r.name)} | ${cell(r.summary)} | ${fix} |`);
  }
  return lines.join("\n") + "\n";
}

/* Problems across pages. A root-file check (llms.txt, robots.txt, ...)
   is the same on every page, so it is listed only for the first page. */
export function problemsAcross(reports) {
  const seen = new Set();
  return reports.map((report) =>
    problems(report).filter((r) => {
      const key = ROOT_FILES[r.id] ? r.id : `${r.id} ${report.url}`;
      return !seen.has(key) && seen.add(key);
    }),
  );
}

/* One SARIF log for every page checked. */
export function formatSarif(reports, { version }) {
  const found = problemsAcross(reports).flatMap((list, i) => list.map((r) => ({ ...r, checkedUrl: reports[i].url })));
  const rules = [...new Map(found.map((r) => [r.id, r])).values()];
  const reason = reports.map(noResultsReason).find(Boolean) ?? null;
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "ai-readiness-check",
          version,
          informationUri: "https://github.com/tristandenyer/ai-readiness-check",
          rules: rules.map((r) => ({
            id: r.id,
            name: r.name,
            shortDescription: { text: r.name },
            help: { text: r.fixSummary ?? r.name },
            helpUri: helpUrl(r),
          })),
        },
      },
      results: found.map((r) => ({
        ruleId: r.id,
        level: r.status === "fail" ? "error" : "warning",
        message: { text: `${r.summary} Fix: ${r.fixSummary} (checked ${r.checkedUrl})` },
        locations: [{
          physicalLocation: {
            // SARIF needs a file. Root-file checks point at that file;
            // others have no single file, so they point at the README.
            artifactLocation: { uri: ROOT_FILES[r.id] ? whereToFix(r.id) : "README.md" },
            region: { startLine: 1 },
          },
        }],
      })),
      invocations: [{
        executionSuccessful: !reason,
        toolExecutionNotifications: reason ? [{ level: "error", message: { text: reason } }] : [],
      }],
    }],
  };
  return JSON.stringify(sarif, null, 2) + "\n";
}

/* `found` is this page's problems less those already listed for an
   earlier page (see problemsAcross). */
export function formatAgent(report, { rerunCommand, found = problems(report) }) {
  const reason = noResultsReason(report);
  if (reason) return `AI readiness check for ${report.url}: no results.\n${reason}\nFix this, then run: ${rerunCommand}\n`;
  const lines = [`AI readiness check for ${headline(report)}.`];
  if (found.length === 0) return `${lines[0]}\n${problems(report).length ? "No other problems on this page." : "Nothing to fix."}\n`;
  lines.push(
    "Fix these in order, highest score impact first. For each one, read the instructions",
    "at the URL given, apply them where it says, then run the check again:",
    `  ${rerunCommand}`,
    "",
  );
  found.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.id} (${r.status}): ${scrub(r.summary)}`,
      ...(r.detail ? [`   Detail: ${scrub(r.detail)}`] : []),
      `   Fix: ${r.fixSummary}`,
      `   Where: ${whereToFix(r.id)}`,
      `   Instructions: ${r.promptRawUrl ?? helpUrl(r) ?? "none"}`,
      "",
    );
  });
  return lines.join("\n");
}
