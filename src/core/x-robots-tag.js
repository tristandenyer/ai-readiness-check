const AI_DIRECTIVES = ["noai", "noimageai", "noarchive"];

export async function checkXRobotsTag(_baseUrl, homepage) {
  const start = performance.now();
  const id = "x-robots-tag";
  const name = "X-Robots-Tag header";
  const category = "permission";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#4-html-meta-tags-and-x-robots-tag-headers-for-ai";

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to inspect response headers.",
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  const headerValue = homepage.headers.get("x-robots-tag") || "";
  const lower = headerValue.toLowerCase();
  const directivesFound = AI_DIRECTIVES.filter((d) => lower.includes(d));

  if (directivesFound.length > 0) {
    /* Present doesn't always mean right. Each directive carries a
       trade-off the site owner may or may not have intended. The
       supporting `detail` is rendered as small/muted text below the
       summary headline. */
    const effects = [];
    if (directivesFound.includes("noai")) effects.push("noai opts out of generative AI training");
    if (directivesFound.includes("noimageai")) effects.push("noimageai opts out of AI image training");
    if (directivesFound.includes("noarchive")) effects.push("noarchive blocks cached snapshots in search results, which can also reduce visibility in AI tools that rely on cached pages");
    return {
      id,
      name,
      category,
      status: "pass",
      summary: `X-Robots-Tag includes AI directives: ${directivesFound.join(", ")}.`,
      detail: `${effects.join("; ")}. Present is fine if intentional, but each directive trades visibility for opt-out.`,
      details: { directivesFound, headerValue },
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  return {
    id,
    name,
    category,
    status: "info",
    summary: "No X-Robots-Tag with AI directives.",
    detail: "Default behavior is fine. DeviantArt and others use this header to apply noai sitewide without modifying every page.",
    details: { headerValue: headerValue || null },
    learnMoreUrl,
    durationMs: performance.now() - start,
  };
}
