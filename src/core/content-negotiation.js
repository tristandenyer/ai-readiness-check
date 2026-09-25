import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";


export async function checkContentNegotiation(baseUrl, homepage) {
  const start = performance.now();
  const id = "content-negotiation";
  const name = "Accept: text/markdown content negotiation";
  const category = "visibility";
  const specUrl =
    "https://datatracker.ietf.org/doc/html/rfc9110#name-content-negotiation";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#8-link-discovery-link-tag-http-link-header-and-content-negotiation";
  const promptUrl = promptUrlFor("content-negotiation.md");
  let fetchMs = null;

  try {
    const res = await fetchWithTimeout(baseUrl, {
      headers: { accept: "text/markdown" },
    });
    fetchMs = res.ttfbMs;

    if (!res.ok) {
      return {
        id,
        name,
        category,
        status: "fail",
        summary: `Server returned ${res.status} when asked for markdown.`,
        details: { status: res.status, error: res.error },
        specUrl,
        learnMoreUrl,
        fetchMs,
      durationMs: performance.now() - start,
      };
    }

    const markdownContentType = res.contentType.toLowerCase();
    const htmlContentType = (
      homepage?.headers.get("content-type") || ""
    ).toLowerCase();
    const varyHeader = (res.headers.get("vary") || "").toLowerCase();
    const hasVaryAccept = /\baccept\b/.test(varyHeader);
    const isMarkdown = markdownContentType.includes("text/markdown");

    const details = {
      htmlContentType,
      markdownContentType,
      returnedMarkdown: isMarkdown,
      hasVaryAccept,
      varyHeader: varyHeader || null,
    };

    if (isMarkdown && hasVaryAccept) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: "Returns text/markdown with Vary: Accept.",
        detail: "Claude Code and Cursor will get the markdown version automatically when they ask for it.",
        details,
        specUrl,
        learnMoreUrl,
        fetchMs,
      durationMs: performance.now() - start,
      };
    }

    if (isMarkdown && !hasVaryAccept) {
      return {
        id,
        name,
        category,
        status: "warn",
        summary: "Returns markdown but is missing Vary: Accept.",
        detail: "Without that header, a CDN cache might serve markdown to browsers that expected HTML.",
        details,
        specUrl,
        learnMoreUrl,
        fetchMs,
      durationMs: performance.now() - start,
      };
    }

    const varyNote = hasVaryAccept
      ? " The server does send Vary: Accept, but that's a caching hint and only matters once the server actually returns different content per Accept header, which it currently doesn't."
      : "";
    return {
      id,
      name,
      category,
      status: "fail",
      summary: `Server ignores Accept: text/markdown and returns ${markdownContentType || "the same response"} instead.`,
      detail: `Cloudflare Pro+ auto-enables negotiation; on other hosts it needs a header rule.${varyNote}`,
      details,
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
