import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";

/* api-agent.yaml — the API Field Guide (early-stage RFC). An
   operational contract an API owner publishes at /.well-known/ so AI
   agents learn the behavior OpenAPI doesn't capture: idempotency,
   side effects, rate-limit behavior, deprecations, and a feedback
   channel. Presence-only check while the spec is v0.x: zero weight,
   info when missing, and no structural validation beyond "is this
   actually a YAML file and not an SPA shell." */
export async function checkApiAgentYaml(baseUrl) {
  const start = performance.now();
  const id = "api-agent-yaml";
  const name = "api-agent.yaml";
  const category = "agent";
  const specUrl = "https://github.com/tristandenyer/api-field-guide-spec";
  const learnMoreUrl = "/work/api-field-guide-for-ai-agents";
  let fetchMs = null;

  const testedUrl = `${baseUrl}/.well-known/api-agent.yaml`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Same soft-404 defense as the other origin-scoped files, plus a
    // minimal YAML signature: at least one top-level `key:` line.
    const text = res.text || "";
    const hasYamlKey = /^[A-Za-z0-9_-]+\s*:/m.test(text);
    const isRealFile =
      res.ok &&
      text.trim() &&
      looksLikeRealFile(text, res.contentType, "text") &&
      hasYamlKey;

    if (!isRealFile) {
      return {
        id,
        name,
        category,
        status: "info",
        summary: "No /.well-known/api-agent.yaml.",
        detail:
          "Early-stage RFC: an operational field guide for AI agents using your API. Only relevant if this domain serves an API.",
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        learnMoreUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    return {
      id,
      name,
      category,
      status: "pass",
      summary: "Found /.well-known/api-agent.yaml.",
      detail: "Not scored while the spec is an early RFC.",
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: { sizeBytes: text.length },
      }),
      specUrl,
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
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
