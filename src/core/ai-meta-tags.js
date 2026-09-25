import { promptUrlFor } from "./links.js";


const AI_DIRECTIVES = [
  "noai",
  "noimageai",
  "noarchive",
  "max-snippet",
  "max-image-preview",
];

export async function checkAiMetaTags(_baseUrl, homepage) {
  const start = performance.now();
  const id = "ai-meta-tags";
  const name = "AI meta tags";
  const category = "permission";
  const specUrl = "https://iptc.org/std/guidelines/data-mining-opt-out/";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#4-html-meta-tags-and-x-robots-tag-headers-for-ai";
  const promptUrl = promptUrlFor("ai-meta-tags.md");

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to inspect <meta> tags.",
      specUrl,
      learnMoreUrl,
      promptUrl,
      durationMs: performance.now() - start,
    };
  }

  const metas = homepage.document.querySelectorAll(
    'meta[name="robots"], meta[name="googlebot"]'
  );
  const directivesFound = new Set();
  metas.forEach((m) => {
    const content = (m.getAttribute("content") || "").toLowerCase();
    for (const d of AI_DIRECTIVES) {
      if (content.includes(d)) directivesFound.add(d);
    }
  });

  const directives = [...directivesFound];

  if (directives.some((d) => d === "noai" || d === "noimageai" || d === "noarchive")) {
    /* "Present" doesn't always mean "right for you." Each directive
       opts out of something different, and a site may have inherited
       them without realizing the trade-off. The summary names what
       was found; `detail` carries the supporting context on a second
       line in a smaller style so the headline stays scannable. */
    const effects = [];
    if (directives.includes("noai")) effects.push("noai opts out of generative AI training");
    if (directives.includes("noimageai")) effects.push("noimageai opts out of AI image training");
    if (directives.includes("noarchive")) effects.push("noarchive blocks cached snapshots in search results, which can also reduce visibility in AI tools that rely on cached pages");
    return {
      id,
      name,
      category,
      status: "pass",
      summary: `AI directives present: ${directives.join(", ")}.`,
      detail: `${effects.join("; ")}. Present is fine if intentional, but each directive trades visibility for opt-out.`,
      details: { directivesFound: directives },
      specUrl,
      learnMoreUrl,
      promptUrl,
      durationMs: performance.now() - start,
    };
  }

  return {
    id,
    name,
    category,
    status: "info",
    summary: "No AI-specific meta directives like noai, noimageai, or noarchive.",
    detail: "The default robots tags are perfectly fine. Only add these if you want to opt out.",
    details: { directivesFound: directives },
    specUrl,
    learnMoreUrl,
    promptUrl,
    durationMs: performance.now() - start,
  };
}
