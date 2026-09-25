import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { contentLinks, coversLink, headingsOf, sitePagePath, siteHostsFor } from "./llms-links.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";


const AI_KEYWORDS = /\b(ai|machine|bot|agent|llm|crawler)\b/i;
const PER_PAGE_HINT = /\/llms\.txt|\/llms-full\.txt|append.*\.md|\.md\b/i;

function detectPerPageHint(homepage) {
  if (!homepage || homepage.isLikelyClientRendered || !homepage.document) {
    return false;
  }
  const hidden = homepage.document.querySelectorAll('[aria-hidden="true"]');
  for (const el of hidden) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    if (AI_KEYWORDS.test(text) && PER_PAGE_HINT.test(text)) return true;
  }
  return false;
}

export async function checkLlmsFullTxt(baseUrl, homepage) {
  const start = performance.now();
  const id = "llms-full-txt";
  const name = "llms-full.txt";
  const category = "visibility";
  const promptUrl = promptUrlFor("llms-full-txt.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#6-llms-fulltxt";
  let fetchMs = null;

  const testedUrl = `${baseUrl}/llms-full.txt`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Treat true 404s and soft 404s (200 with HTML/SPA shell) as
    // missing. llms-full.txt should be plain text or markdown — an
    // HTML response means the server returned its app shell for an
    // unknown path.
    const text = res.text || "";
    const isRealFile =
      res.ok &&
      text.trim() &&
      looksLikeRealFile(text, res.contentType, "text");

    if (!isRealFile) {
      const isSoft404 = res.ok && res.status !== 404;
      const hasPerPageHint = isSoft404 && detectPerPageHint(homepage);

      let summary = "No llms-full.txt found.";
      let detail =
        "This check is worth 8 points. Mintlify reports docs sites get 3-4x more AI traffic from llms-full.txt than llms.txt.";
      if (hasPerPageHint) {
        summary =
          "No root-level llms-full.txt — site uses a per-page convention.";
        detail =
          "The server returned the SPA shell instead of a markdown file. An AI hint div on this site advertises per-page /llms.txt or .md indexes, a different (non-spec) convention.";
      } else if (isSoft404) {
        summary =
          "No llms-full.txt — server returned the SPA shell at /llms-full.txt.";
        detail =
          "The request returned 200, but the body was HTML, not a markdown file. This check is worth 8 points; most useful for AI-traffic-heavy docs sites.";
      }

      /* Scoring rubric for this 8-point check: missing = fail (zero
         points), present but incomplete/truncated = warn (half
         credit, handled below). Never `info` when absent — info is
         excluded from the score's denominator, so the deduction
         would silently vanish from a "/ 100" scorecard. */
      return {
        id,
        name,
        category,
        status: "fail",
        summary,
        detail,
        details: buildResponseDetails({ testedUrl, res }),
        promptUrl,
        learnMoreUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const sizeBytes = new TextEncoder().encode(text).length;
    const fullH1Count = (text.match(/^#\s+\S/gm) || []).length;
    const fullH2Count = (text.match(/^##\s+\S/gm) || []).length;
    const fullSectionCount = Math.max(fullH1Count, fullH2Count);

    // Which pages linked from llms.txt appear in llms-full.txt.
    let links = [];
    try {
      const llmsRes = await fetchWithTimeout(`${baseUrl}/llms.txt`, { timeoutMs: 10000 });
      if (llmsRes.ok && llmsRes.text) links = contentLinks(llmsRes.text);
    } catch {}
    const headings = headingsOf(text);
    const siteHosts = siteHostsFor(baseUrl, links.map((l) => l.url).filter((u) => /^https?:/i.test(u)));
    const notCovered = links.filter((l) => !coversLink(text, headings, l, sitePagePath(l.url, baseUrl, siteHosts)));
    const covered = links.length - notCovered.length;

    const baseExtra = {
      sizeBytes,
      sizeKB: Math.round(sizeBytes / 1024),
      sectionCount: fullSectionCount,
      h1Count: fullH1Count,
      h2Count: fullH2Count,
      llmsLinkCount: links.length,
      coveredLinks: covered,
    };
    const result = (status, summary, detail) => ({
      id,
      name,
      category,
      status,
      summary,
      ...(detail ? { detail } : {}),
      details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
      promptUrl,
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    });

    // Only the first MB is read, so coverage can't be judged past it.
    if (res.truncated) {
      return result("pass", `llms-full.txt is larger than 1 MB. Only the first 1 MB was read, so coverage of the pages in llms.txt wasn't checked.`);
    }

    if (links.length > 0) {
      const counts = `${covered} of the ${links.length} page${links.length === 1 ? "" : "s"} linked from llms.txt`;
      if (notCovered.length === 0) {
        return result("pass", `llms-full.txt covers all ${links.length} page${links.length === 1 ? "" : "s"} linked from llms.txt (${Math.round(sizeBytes / 1024)} KB).`);
      }
      const more = notCovered.length > 10 ? ` and ${notCovered.length - 10} more` : "";
      return result(
        "warn",
        covered * 2 < links.length ? `llms-full.txt looks truncated: it covers ${counts}.` : `llms-full.txt covers ${counts}.`,
        `Missing (no heading with the page's title and no mention of its URL): ${notCovered.slice(0, 10).map((l) => l.title).join("; ")}${more}.`,
      );
    }

    return {
      id,
      name,
      category,
      status: "pass",
      summary: `llms-full.txt present (${fullSectionCount} section${fullSectionCount === 1 ? "" : "s"}, ${Math.round(sizeBytes / 1024)} KB).`,
      details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
      promptUrl,
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  } catch (err) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: `Network error: ${err?.message || "unknown"}`,
      promptUrl,
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
