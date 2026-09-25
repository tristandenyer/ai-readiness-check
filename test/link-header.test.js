import { describe, it, expect } from "./helpers/expect.js";
import { parseLinkHeader } from "../src/core/link-header.js";

describe("parseLinkHeader", () => {
  it("returns empty array for empty or null input", () => {
    expect(parseLinkHeader("")).toEqual([]);
    expect(parseLinkHeader(null)).toEqual([]);
    expect(parseLinkHeader(undefined)).toEqual([]);
  });

  it("parses a single link with no params", () => {
    const result = parseLinkHeader("<https://example.com/index.md>");
    expect(result).toEqual([{ url: "https://example.com/index.md", params: {} }]);
  });

  it("parses a single link with rel and type", () => {
    const result = parseLinkHeader(
      '<https://example.com/index.md>; rel="alternate"; type="text/markdown"'
    );
    expect(result).toEqual([
      {
        url: "https://example.com/index.md",
        params: { rel: "alternate", type: "text/markdown" },
      },
    ]);
  });

  it("parses unquoted param values", () => {
    const result = parseLinkHeader("<https://example.com>; rel=alternate; type=text/markdown");
    expect(result).toHaveLength(1);
    expect(result[0].params.rel).toBe("alternate");
    expect(result[0].params.type).toBe("text/markdown");
  });

  it("parses multiple comma-separated entries", () => {
    const header =
      '<https://example.com/page.md>; rel="alternate"; type="text/markdown", ' +
      '<https://example.com/style.css>; rel="preload"; as="style"';
    const result = parseLinkHeader(header);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      url: "https://example.com/page.md",
      params: { rel: "alternate", type: "text/markdown" },
    });
    expect(result[1]).toEqual({
      url: "https://example.com/style.css",
      params: { rel: "preload", as: "style" },
    });
  });

  it("handles URLs containing commas inside angle brackets (depth tracking)", () => {
    // RFC 8288 allows commas inside the URL portion <…>; we must split on the
    // outer comma between entries, not inside <>.
    const header =
      '<https://example.com/?a=1,2,3>; rel="alternate"; type="text/markdown", ' +
      '<https://example.com/other>; rel="preload"';
    const result = parseLinkHeader(header);
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe("https://example.com/?a=1,2,3");
    expect(result[1].url).toBe("https://example.com/other");
  });

  it("lowercases param names but preserves param values", () => {
    const result = parseLinkHeader(
      '<https://example.com>; REL="alternate"; TYPE="text/Markdown"'
    );
    expect(result[0].params).toEqual({
      rel: "alternate",
      type: "text/Markdown",
    });
  });

  it("ignores malformed entries that have no <url> portion", () => {
    const result = parseLinkHeader('garbage; rel="alternate"');
    expect(result).toEqual([]);
  });

  it("parses entries with extra whitespace around separators", () => {
    const result = parseLinkHeader(
      '  <https://example.com>  ;  rel = "alternate"  ;  type = "text/markdown"  '
    );
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://example.com");
    expect(result[0].params.rel).toBe("alternate");
    expect(result[0].params.type).toBe("text/markdown");
  });

  it("parses real-world Vercel-style preload header", () => {
    const header =
      "</fonts/sans.woff2>; rel=preload; as=font; type=\"font/woff2\"; crossorigin, " +
      "</fonts/serif.woff2>; rel=preload; as=font";
    const result = parseLinkHeader(header);
    expect(result).toHaveLength(2);
    expect(result[0].params.rel).toBe("preload");
    expect(result[0].params.as).toBe("font");
    expect(result[0].params.type).toBe("font/woff2");
    expect(result[1].url).toBe("/fonts/serif.woff2");
  });

  it("handles a single entry with multiple rel values (space-separated)", () => {
    const result = parseLinkHeader('<https://example.com>; rel="alternate canonical"');
    expect(result[0].params.rel).toBe("alternate canonical");
  });

  it("strips quotes from quoted values but keeps quotes inside the URL", () => {
    const result = parseLinkHeader('<https://example.com>; rel="alternate"');
    expect(result[0].params.rel).toBe("alternate");
    expect(result[0].url).toBe("https://example.com");
  });
});
