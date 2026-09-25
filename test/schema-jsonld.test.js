import { describe, it, expect } from "./helpers/expect.js";
import { parseHtml } from "../src/core/html-scan.js";
import { checkSchemaJsonld } from "../src/core/schema-jsonld.js";

function makeHomepage(jsonLdStrings) {
  const scripts = jsonLdStrings
    .map((s) => `<script type="application/ld+json">${s}</script>`)
    .join("\n");
  const html = `<!doctype html><html><body><p>${"x".repeat(300)}</p>${scripts}</body></html>`;
  const document = parseHtml(html);
  return { document, isLikelyClientRendered: false };
}

describe("checkSchemaJsonld", () => {
  it("passes a flat top-level @type node", async () => {
    const homepage = makeHomepage([
      JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name: "x" }),
    ]);
    const r = await checkSchemaJsonld("https://example.com", homepage);
    expect(r.status).toBe("pass");
    expect(r.details.typesFound).toContain("WebSite");
  });

  it("passes a Yoast-style @graph payload (regression: bug #2)", async () => {
    const yoastLike = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", "@id": "https://blog.postman.com/x/", url: "https:\\/\\/blog.postman.com\\/x\\/" },
        { "@type": "Article", headline: "Hello" },
        { "@type": "Organization", name: "Postman" },
      ],
    };
    const homepage = makeHomepage([JSON.stringify(yoastLike)]);
    const r = await checkSchemaJsonld("https://example.com", homepage);
    expect(r.status).toBe("pass");
    expect(r.details.validCount).toBe(3);
    expect(r.details.typesFound).toEqual(
      expect.arrayContaining(["WebPage", "Article", "Organization"]),
    );
  });

  it("handles escaped forward slashes in URLs without error", async () => {
    // JSON.stringify won't emit \/, but real WP/PHP output does — embed raw.
    const raw = '{"@context":"https://schema.org","@type":"Article","url":"https:\\/\\/blog.postman.com\\/x\\/"}';
    const homepage = makeHomepage([raw]);
    const r = await checkSchemaJsonld("https://example.com", homepage);
    expect(r.status).toBe("pass");
    expect(r.details.parseErrors).toBe(0);
  });

  it("fails when no JSON-LD blocks exist", async () => {
    const homepage = makeHomepage([]);
    const r = await checkSchemaJsonld("https://example.com", homepage);
    expect(r.status).toBe("fail");
  });
});
