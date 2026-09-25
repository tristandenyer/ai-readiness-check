/* The short report the MCP tool returns: grade, score, counts, and the
   failing and warning checks with how to fix each. Same fields as the
   hosted server at https://www.tristandenyer.com/api/mcp/v1, plus
   fix_raw_url and the pass/fail verdict from the project's settings. */
import { noResultsReason, scrub } from "../cli/formats.js";
import { SITE_URL } from "../core/links.js";

export const TOOL_VERSION = "1.0.0";
const MAX_ITEMS = 20;
const MAX_STRING = 200;
const cap = (s) => (typeof s === "string" && s.length > MAX_STRING ? s.slice(0, MAX_STRING - 1) + "…" : s);

const entry = (r) => ({
  id: r.id,
  name: r.name,
  message: cap(scrub([r.summary, r.detail].filter(Boolean).join(" "))),
  fix_url: r.promptUrl ?? r.learnMoreUrl ?? null,
  fix_raw_url: r.promptRawUrl ?? null,
  fix_summary: cap(r.fixSummary || ""),
});

/* A public site also gets a link to the full report on the website. A
   local or private address can't be checked from there, so it gets none. */
export function slimReport(report, { isPublic }) {
  const noResults = noResultsReason(report);
  const results = noResults ? [] : report.results;
  const pick = (status) => results.filter((r) => r.status === status).slice(0, MAX_ITEMS).map(entry);
  const { passing = 0, warnings = 0, failing = 0, info = 0, inconclusive = 0 } = report.summary ?? {};
  return {
    tool_version: TOOL_VERSION,
    url: report.url,
    reachable: report.reachable !== false,
    ...(report.blockedByRobots ? { blocked_by_robots: true } : {}),
    ...(noResults ? { reason: cap(noResults) } : {}),
    grade: noResults ? null : report.grade,
    score: noResults ? null : report.score,
    summary: { passing, warnings, failing, info, inconclusive },
    failing: pick("fail"),
    warnings: pick("warn"),
    ...(isPublic ? { full_report_url: `${SITE_URL}/ai-readiness-check?url=${encodeURIComponent(report.url)}` } : {}),
  };
}

/* The same report as text. Many clients show only the text, so every
   problem's fix is spelled out here too. */
export function reportText(slim, { passed, reasons }) {
  if (slim.reason) return `${slim.url}: no results. ${slim.reason}`;
  const s = slim.summary;
  const lines = [
    `${slim.url}: grade ${slim.grade} (${slim.score}/100). ${s.passing} passing, ${s.warnings} warnings, ${s.failing} failing${s.inconclusive ? `, ${s.inconclusive} inconclusive` : ""}.`,
    passed ? "Passes this project's settings." : `Fails this project's settings:\n${reasons.map((r) => `- ${r}`).join("\n")}`,
  ];
  for (const [title, list] of [["Failing, fix these", slim.failing], ["Warnings, consider fixing", slim.warnings]]) {
    if (!list.length) continue;
    lines.push("", `${title}:`);
    for (const r of list) {
      lines.push(`- ${r.name || r.id}: ${r.message} Fix: ${r.fix_summary}${r.fix_raw_url || r.fix_url ? ` Instructions: ${r.fix_raw_url || r.fix_url}` : ""}`);
    }
  }
  if (slim.full_report_url) lines.push("", `Full report: ${slim.full_report_url}`);
  return lines.join("\n");
}
