import { describe, it, expect, beforeAll, afterAll } from "./helpers/expect.js";
import http from "node:http";
import { checkLlmsTxt } from "../src/core/llms-txt.js";
import { checkSitemap } from "../src/core/sitemap.js";
import { checkLlmsFullTxt } from "../src/core/llms-full-txt.js";
import { withRunOptions } from "../src/core/run-options.js";

/* A local site whose sitemap and llms.txt each test sets. */
let server;
let base;
let site = {};
const hits = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] ?? 0) + 1;
    const body = { "/sitemap.xml": site.sitemap, "/llms.txt": site.llms, "/llms-full.txt": site.full, "/robots.txt": site.robots }[req.url];
    if (body === undefined) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": req.url.endsWith(".xml") ? "application/xml" : "text/plain" });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const sitemap = (host, paths) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${host}${p}</loc></url>`).join("")}</urlset>`;
const llms = (host, paths, extra = "") =>
  `# Site\n\n> A site.\n\n## Pages\n\n${paths.map((p) => `- [${p}](${host}${p}): page`).join("\n")}\n${extra}`;
const check = (setup) => {
  site = setup;
  return withRunOptions({ allowPrivateNetwork: true }, () => checkLlmsTxt(base));
};

describe("llms.txt links compared with the sitemap", () => {
  it("passes a one-page site that links its one page", async () => {
    const r = await check({ sitemap: sitemap(base, ["/"]), llms: llms(base, ["/index.md"]) });
    expect(r.status).toBe("pass");
    expect(r.summary).toBe("Valid llms.txt with 1 section and 1 link.");
  });

  it("matches production URLs in both files while checking a dev server", async () => {
    const prod = "https://www.acme.example";
    const r = await check({ sitemap: sitemap(prod, ["/", "/about"]), llms: llms("https://acme.example", ["/", "/about.md"]) });
    expect(r.status).toBe("pass");
  });

  it("names the sitemap pages llms.txt doesn't link", async () => {
    const r = await check({ sitemap: sitemap(base, ["/", "/about", "/blog/", "/faq"]), llms: llms(base, ["/", "/faq"]) });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("llms.txt is missing pages. It links 1 of the 3 pages in sitemap.xml, not counting the home page.");
    expect(r.detail).toBe("Missing: links to these pages in sitemap.xml: /about, /blog.");
  });

  it("asks a large site for 20 of its pages, not all of them", async () => {
    const pages = Array.from({ length: 30 }, (_, i) => `/p${i}`);
    expect((await check({ sitemap: sitemap(base, pages), llms: llms(base, pages.slice(0, 20)) })).status).toBe("pass");
    const r = await check({ sitemap: sitemap(base, pages), llms: llms(base, pages.slice(0, 19)) });
    expect(r.status).toBe("warn");
    expect(r.detail).toMatch(/at least 20 of this site's 30 pages \(it links 19\)/);
  });

  it("doesn't expect a link to the home page", async () => {
    expect((await check({ sitemap: sitemap(base, ["/", "/about"]), llms: llms(base, ["/about"]) })).status).toBe("pass");
  });

  it("names the real problem when coverage is fine", async () => {
    const r = await check({ sitemap: sitemap(base, ["/"]), llms: llms(base, ["/"]).replace("> A site.", "") });
    expect(r.summary).toBe("llms.txt is incomplete.");
    expect(r.detail).toBe("Missing: a blockquote summary.");
  });

  it("without a sitemap, needs one link to the site; other sites and the llms files don't count", async () => {
    const r = await check({ llms: llms("https://github.com", ["/acme"], `- [Full](${base}/llms-full.txt): all`) });
    expect(r.status).toBe("warn");
    expect(r.detail).toContain("a link to at least one page on this site");
    expect((await check({ llms: llms(base, ["/"]) })).status).toBe("pass");
  });

  it("fetches robots.txt and the sitemap once per run, shared between checks", async () => {
    site = { robots: "User-agent: *\nAllow: /\n", sitemap: sitemap(base, ["/"]), llms: llms(base, ["/"]) };
    delete hits["/robots.txt"];
    delete hits["/sitemap.xml"];
    await withRunOptions({ allowPrivateNetwork: true }, () => Promise.all([checkSitemap(base), checkLlmsTxt(base)]));
    expect(hits["/robots.txt"]).toBe(1);
    expect(hits["/sitemap.xml"]).toBe(1);
  });
});

describe("llms-full.txt covers the pages llms.txt links", () => {
  const checkFull = (setup) => {
    site = setup;
    return withRunOptions({ allowPrivateNetwork: true }, () => checkLlmsFullTxt(base));
  };
  const llmsWith = (links) =>
    `# Site\n\n> A site.\n\n## Pages\n\n${links.map(([t, u]) => `- [${t}](${u}): page`).join("\n")}\n\n## Optional\n\n- [Old](${base}/old): skip\n- [Full](${base}/llms-full.txt): all\n`;

  it("counts a page covered by a heading with its title or a mention of its URL", async () => {
    const r = await checkFull({
      llms: llmsWith([["Home", `${base}/index.md`], ["Pricing Plans", `${base}/pricing.md`], ["Blog Post", `${base}/blog/first.md`]]),
      full: `# Site\n\n## Home\n\nWelcome.\n\n## Pricing plans\n\nCheap.\n\n# A differently titled post\n\n*Source: https://www.site.example/blog/first*\n\n${"Words. ".repeat(100)}`,
    });
    expect(r.status).toBe("pass");
    expect(r.summary).toMatch(/^llms-full\.txt covers all 3 pages linked from llms\.txt/);
  });

  it("names the pages it doesn't cover, and isn't fooled by many headings inside one page", async () => {
    const r = await checkFull({
      llms: llmsWith([["Home", `${base}/`], ["About", `${base}/about`], ["Pricing", `${base}/pricing`]]),
      full: `# Site\n\n## Home\n\n${"## Some subheading\n\nText.\n\n".repeat(20)}`,
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("llms-full.txt looks truncated: it covers 1 of the 3 pages linked from llms.txt.");
    expect(r.detail).toContain("About; Pricing");
  });
});

