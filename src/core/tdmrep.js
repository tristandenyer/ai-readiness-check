import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";


export async function checkTdmrep(baseUrl) {
  const start = performance.now();
  const id = "tdmrep";
  const name = "tdmrep.json";
  const category = "permission";
  const specUrl = "https://w3c.github.io/tdm-reservation-protocol/spec/";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#3-well-knowntdmrepjson";
  const promptUrl = promptUrlFor("tdmrep-json.md");
  let fetchMs = null;

  const testedUrl = `${baseUrl}/.well-known/tdmrep.json`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Treat true 404s and soft 404s (200 with HTML/SPA shell) as
    // missing. tdmrep.json is JSON; an HTML response means the
    // server returned its app shell for an unknown path.
    const text = res.text || "";
    const isRealFile =
      res.ok &&
      text.trim() &&
      looksLikeRealFile(text, res.contentType, "json");

    if (!isRealFile) {
      return {
        id,
        name,
        category,
        status: "info",
        summary: "No /.well-known/tdmrep.json.",
        detail: "Legally significant in the EU but rare globally, so this one is informational only.",
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const parsed = JSON.parse(text);

    if (!Array.isArray(parsed)) {
      return {
        id,
        name,
        category,
        status: "warn",
        summary: "tdmrep.json is not the expected shape.",
        detail: "The W3C TDMRep schema requires an array of rules at the root.",
        details: buildResponseDetails({
          testedUrl,
          res,
          extra: { rootKind: typeof parsed, sizeBytes: text.length },
        }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const validRules = parsed.filter(
      (r) => r && typeof r === "object" && "location" in r && "tdm-reservation" in r
    );

    if (validRules.length === parsed.length && validRules.length > 0) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `Valid tdmrep.json with ${validRules.length} rule${validRules.length === 1 ? "" : "s"}.`,
        details: buildResponseDetails({
          testedUrl,
          res,
          extra: {
            ruleCount: validRules.length,
            totalEntries: parsed.length,
            sizeBytes: text.length,
          },
        }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    return {
      id,
      name,
      category,
      status: "warn",
      summary: `tdmrep.json has ${parsed.length - validRules.length} malformed rule${parsed.length - validRules.length === 1 ? "" : "s"}.`,
      detail: 'Each rule needs both "location" and "tdm-reservation" to be valid per the W3C schema.',
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: {
          ruleCount: validRules.length,
          totalEntries: parsed.length,
          malformedCount: parsed.length - validRules.length,
          sizeBytes: text.length,
        },
      }),
      specUrl,
      learnMoreUrl,
      promptUrl,
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
      learnMoreUrl,
      promptUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
