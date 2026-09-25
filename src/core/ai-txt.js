import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";


export async function checkAiTxt(baseUrl) {
  const start = performance.now();
  const id = "ai-txt";
  const name = "ai.txt";
  const category = "permission";
  const specUrl = "https://site.spawning.ai/spawning-ai-txt";
  const promptUrl = promptUrlFor("ai-txt-spawning.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#2-aitxt-from-spawningai";
  let fetchMs = null;

  let testedUrl = `${baseUrl}/ai.txt`;
  try {
    let res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // True 404 OR soft 404 (server returns 200 with HTML/SPA shell at
    // unknown paths). looksLikeRealFile rejects HTML responses and
    // bodies that begin with HTML markers; the structural check then
    // confirms it's actually an ai.txt and not just any plain-text
    // response that happened to be served at /ai.txt.
    //
    // Two formats count as real: the Spawning opt-out (User-Agent:
    // lines, robots.txt-style) and the June 2026 IETF draft
    // (draft-car-ai-txt-wellknown) with Training/Scraping/Indexing/
    // Caching policy fields. The IETF draft homes the file at
    // /.well-known/ai.txt, so when the root path misses we probe
    // there as a fallback.
    const ietfFields =
      /^\s*(spec-version|training|scraping|indexing|caching)\s*:/im;
    const isRealAiTxt = (r) => {
      const t = r.text || "";
      return (
        r.ok &&
        t.trim() &&
        looksLikeRealFile(t, r.contentType, "text") &&
        (/^user-agent\s*:/im.test(t) || ietfFields.test(t))
      );
    };

    if (!isRealAiTxt(res)) {
      const wellKnownUrl = `${baseUrl}/.well-known/ai.txt`;
      const wkRes = await fetchWithTimeout(wellKnownUrl, { timeoutMs: 10000 });
      if (isRealAiTxt(wkRes)) {
        testedUrl = wellKnownUrl;
        res = wkRes;
      } else {
        return {
          id,
          name,
          category,
          status: "info",
          summary: "No ai.txt found (checked /ai.txt and /.well-known/ai.txt).",
          detail:
            "Covers both the Spawning training opt-out and the June 2026 IETF draft (draft-car-ai-txt-wellknown) that adds Training/Scraping/Indexing/Caching policy fields at /.well-known/ai.txt. Most sites don't have either, so this is informational only.",
          details: buildResponseDetails({ testedUrl, res }),
          specUrl,
          promptUrl,
          learnMoreUrl,
          fetchMs,
          durationMs: performance.now() - start,
        };
      }
    }

    const text = res.text || "";
    const userAgentLines = (text.match(/^user-agent\s*:/gim) || []).length;
    const isIetfFormat = userAgentLines === 0 && ietfFields.test(text);

    if (isIetfFormat) {
      const policyFields = (
        text.match(/^\s*(training|scraping|indexing|caching)\s*:\s*(.+)$/gim) ||
        []
      ).map((l) => l.trim());
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `ai.txt present in IETF draft format with ${policyFields.length} policy field${policyFields.length === 1 ? "" : "s"}.`,
        details: buildResponseDetails({
          testedUrl,
          res,
          extra: {
            format: "ietf-draft",
            policyFields: policyFields.slice(0, 5),
            sizeBytes: text.length,
          },
        }),
        specUrl: "https://datatracker.ietf.org/doc/draft-car-ai-txt-wellknown/",
        promptUrl,
        learnMoreUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    // Surface up to a few User-Agent values so the user sees which
    // bots the file actually addresses.
    const agentMatches =
      text.match(/^\s*user-agent\s*:\s*(.+)$/gim) || [];
    const sampleAgents = agentMatches
      .slice(0, 5)
      .map((line) => line.replace(/^\s*user-agent\s*:\s*/i, "").trim())
      .filter(Boolean);

    return {
      id,
      name,
      category,
      status: "pass",
      summary: `ai.txt present with ${userAgentLines} User-Agent rule${userAgentLines === 1 ? "" : "s"} (Spawning training opt-out).`,
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: {
          userAgentLines,
          sampleAgents,
          sizeBytes: text.length,
        },
      }),
      specUrl,
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
      specUrl,
      promptUrl,
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
