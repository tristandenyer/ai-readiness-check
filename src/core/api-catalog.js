import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";

/* RFC 9727 (Standards Track, June 2025) — /.well-known/api-catalog.
   A publisher lists its APIs as an RFC 9264 linkset document
   (application/linkset+json with a top-level "linkset" array) so
   machine clients, including AI agents, can discover them. Only
   relevant for domains that publish APIs, so absence is info and the
   check is unscored. */
export async function checkApiCatalog(baseUrl) {
  const start = performance.now();
  const id = "api-catalog";
  const name = "api-catalog";
  const category = "agent";
  const specUrl = "https://www.rfc-editor.org/rfc/rfc9727.html";
  const promptUrl =
    promptUrlFor("api-catalog.md");
  let fetchMs = null;

  const testedUrl = `${baseUrl}/.well-known/api-catalog`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    const text = res.text || "";
    const isRealFile =
      res.ok && text.trim() && looksLikeRealFile(text, res.contentType, "json");

    if (!isRealFile) {
      return {
        id,
        name,
        category,
        status: "info",
        summary: "No /.well-known/api-catalog.",
        detail:
          "RFC 9727 lets API publishers list their APIs for automated discovery. Only relevant if this domain publishes APIs.",
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const linkset = Array.isArray(parsed?.linkset) ? parsed.linkset : null;

    if (!linkset) {
      return {
        id,
        name,
        category,
        status: "warn",
        summary: "api-catalog is present but is not an RFC 9264 linkset.",
        detail:
          'RFC 9727 expects a JSON document with a top-level "linkset" array (application/linkset+json).',
        details: buildResponseDetails({
          testedUrl,
          res,
          extra: { sizeBytes: text.length },
        }),
        specUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const itemCount = linkset.reduce(
      (n, entry) => n + (Array.isArray(entry?.item) ? entry.item.length : 0),
      0,
    );

    return {
      id,
      name,
      category,
      status: "pass",
      summary: `Valid api-catalog linkset listing ${itemCount} API${itemCount === 1 ? "" : "s"}.`,
      detail: "Not scored: only relevant for API publishers.",
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: { itemCount, sizeBytes: text.length },
      }),
      specUrl,
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
      promptUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
