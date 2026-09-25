import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";


export async function checkAgentCard(baseUrl) {
  const start = performance.now();
  const id = "agent-card";
  const name = "agent-card.json";
  const category = "agent";
  const specUrl = "https://a2a-protocol.org/";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#12-well-knownagent-cardjson-a2a-protocol";
  const promptUrl = promptUrlFor("agent-card-json.md");
  let fetchMs = null;

  const testedUrl = `${baseUrl}/.well-known/agent-card.json`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Treat true 404s and soft 404s (200 with HTML/SPA shell) as
    // missing. agent-card.json is JSON; an HTML response means the
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
        summary: "No /.well-known/agent-card.json.",
        detail: "Only relevant if you're running an A2A agent on this domain.",
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const parsed = JSON.parse(text);
    const hasName = typeof parsed?.name === "string" && parsed.name.length > 0;
    const hasDescription =
      typeof parsed?.description === "string" && parsed.description.length > 0;
    const hasSkills = Array.isArray(parsed?.skills);
    const hasInterfaces =
      Array.isArray(parsed?.supported_interfaces) ||
      Array.isArray(parsed?.interfaces) ||
      Array.isArray(parsed?.endpoints);
    const skillCount = Array.isArray(parsed?.skills) ? parsed.skills.length : 0;
    const agentName = hasName ? parsed.name : null;

    const baseExtra = {
      sizeBytes: text.length,
      agentName,
      skillCount,
      hasDescription,
      hasInterfaces,
    };

    if (hasName && hasDescription && hasSkills && hasInterfaces) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `Valid A2A agent card for "${parsed.name}".`,
        details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const missing = [];
    if (!hasName) missing.push("name");
    if (!hasDescription) missing.push("description");
    if (!hasSkills) missing.push("skills array");
    if (!hasInterfaces) missing.push("supported_interfaces");

    return {
      id,
      name,
      category,
      status: "warn",
      summary: "agent-card.json is present but incomplete.",
      detail: `Missing: ${missing.join(", ")}.`,
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: { ...baseExtra, missing },
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
