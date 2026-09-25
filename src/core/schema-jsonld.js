import { promptUrlFor } from "./links.js";


export async function checkSchemaJsonld(_baseUrl, homepage) {
  const start = performance.now();
  const id = "schema-jsonld";
  const name = "schema.org JSON-LD";
  const category = "visibility";
  const specUrl = "https://schema.org/";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#10-schemaorg-json-ld-structured-data";
  const promptUrl = promptUrlFor("schema-jsonld.md");

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to inspect for JSON-LD.",
      specUrl,
      learnMoreUrl,
      promptUrl,
      durationMs: performance.now() - start,
    };
  }

  const blocks = homepage.document.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  const blockCount = blocks.length;
  const typesFound = [];
  let validCount = 0;
  let parseErrors = 0;

  const collectType = (t) => {
    if (Array.isArray(t)) typesFound.push(...t.filter((x) => typeof x === "string"));
    else if (typeof t === "string") typesFound.push(t);
  };

  blocks.forEach((b) => {
    const raw = b.textContent || "";
    try {
      const data = JSON.parse(raw);
      const candidates = Array.isArray(data) ? data : [data];
      for (const node of candidates) {
        if (!node || typeof node !== "object") continue;
        if (!node["@context"]) continue;
        if (node["@type"]) {
          validCount += 1;
          collectType(node["@type"]);
        }
        // Yoast/Rank Math/most modern WP schema plugins wrap nodes in
        // @graph rather than placing @type at the top level.
        if (Array.isArray(node["@graph"])) {
          for (const child of node["@graph"]) {
            if (child && typeof child === "object" && child["@type"]) {
              validCount += 1;
              collectType(child["@type"]);
            }
          }
        }
      }
    } catch {
      parseErrors += 1;
    }
  });

  const details = { blockCount, validCount, parseErrors, typesFound };

  if (blockCount === 0) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "No schema.org JSON-LD on this page.",
      detail:
        "Microsoft Copilot uses structured data here, but ChatGPT/Claude/Perplexity will miss anything placed only in JSON-LD.",
      details,
      specUrl,
      learnMoreUrl,
      promptUrl,
      durationMs: performance.now() - start,
    };
  }

  if (validCount > 0 && parseErrors === 0) {
    return {
      id,
      name,
      category,
      status: "pass",
      summary: `Found ${validCount} JSON-LD block${validCount === 1 ? "" : "s"} (${typesFound.slice(0, 4).join(", ")}${typesFound.length > 4 ? ", …" : ""}).`,
      details,
      specUrl,
      learnMoreUrl,
      promptUrl,
      durationMs: performance.now() - start,
    };
  }

  if (validCount > 0 && parseErrors > 0) {
    return {
      id,
      name,
      category,
      status: "warn",
      summary: `JSON-LD present but ${parseErrors} block${parseErrors === 1 ? "" : "s"} failed to parse.`,
      detail: "Crawlers ignore the broken blocks. Anything declared only in those blocks won't be picked up.",
      details,
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
    status: "warn",
    summary: "JSON-LD blocks found, but none parsed cleanly.",
    detail: "Each block needs both @context and @type to be recognized as schema.org structured data.",
    details,
    specUrl,
    learnMoreUrl,
    promptUrl,
    durationMs: performance.now() - start,
  };
}
