export function parseLinkHeader(value) {
  if (!value) return [];
  const out = [];
  // Split on commas not inside angle brackets
  const parts = [];
  let depth = 0;
  let buf = "";
  for (const ch of value) {
    if (ch === "<") depth += 1;
    else if (ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());

  for (const part of parts) {
    const m = part.match(/^<([^>]+)>\s*(.*)$/);
    if (!m) continue;
    const url = m[1];
    const params = {};
    const paramRe = /;\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*("([^"]*)"|([^;]+))/g;
    let pm;
    while ((pm = paramRe.exec(m[2])) !== null) {
      params[pm[1].toLowerCase()] = (pm[3] !== undefined ? pm[3] : pm[4]).trim();
    }
    out.push({ url, params });
  }
  return out;
}

export async function checkLinkHeader(_baseUrl, homepage) {
  const start = performance.now();
  const id = "link-header";
  const name = "Link: HTTP header";
  const category = "visibility";
  const specUrl = "https://datatracker.ietf.org/doc/html/rfc8288";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#8-link-discovery-link-tag-http-link-header-and-content-negotiation";

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to inspect response headers.",
      specUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  const headerValue = homepage.headers.get("link") || "";
  const links = parseLinkHeader(headerValue);
  const markdownLinks = links.filter(
    (l) =>
      (l.params.rel || "").toLowerCase().split(/\s+/).includes("alternate") &&
      (l.params.type || "").toLowerCase() === "text/markdown"
  );

  const relsFound = [
    ...new Set(
      links
        .flatMap((l) => (l.params.rel || "").toLowerCase().split(/\s+/))
        .filter(Boolean)
    ),
  ];

  if (markdownLinks.length > 0) {
    return {
      id,
      name,
      category,
      status: "pass",
      summary: `Link header advertises markdown alternate (${markdownLinks[0].url}).`,
      details: {
        markdownLinks,
        otherLinkCount: links.length - markdownLinks.length,
        relsFound,
      },
      specUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  if (links.length === 0) {
    return {
      id,
      name,
      category,
      status: "info",
      summary: "No Link: header sent.",
      detail: "The HTML <link> tag is more common, and this is the header-level equivalent of it.",
      details: { linkHeaderPresent: false },
      specUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  return {
    id,
    name,
    category,
    status: "info",
    summary: "Link header is sent, but none of its entries advertise markdown.",
    detail: `Found ${links.length} entr${links.length === 1 ? "y" : "ies"} with rels: ${relsFound.join(", ") || "none"}.`,
    details: {
      linkHeaderPresent: true,
      otherLinkCount: links.length,
      relsFound,
    },
    specUrl,
    learnMoreUrl,
    durationMs: performance.now() - start,
  };
}
