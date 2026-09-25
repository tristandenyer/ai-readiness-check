import { describe, it, expect, beforeEach, afterEach, vi } from "./helpers/expect.js";
import { runCheck } from "../src/core/run-check.js";
import { __setFetchImplForTests } from "../src/core/fetch.js";

/* End-to-end test of the AI Readiness Check pipeline.

   The per-checker suites cover each rule in isolation; this one covers
   the thing a user actually hits: runCheck() against a whole site. It
   stubs global fetch with a synthetic origin so the run is offline and
   deterministic, then asserts the contract the UI and the MCP tool both
   depend on — every checker reports, the grade is derived from those
   reports, and no site shape makes the pipeline throw.

   If this file fails, the readiness check is broken for real users, not
   just in some edge case. It runs on every push via `npm run build`. */

const EXPECTED_CHECK_IDS = [
  "robots-txt",
  "llms-txt",
  "llms-full-txt",
  "ai-txt",
  "tdmrep",
  "agent-card",
  "mcp-json",
  "api-agent-yaml",
  "content-signals",
  "api-catalog",
  "sitemap",
  "schema-jsonld",
  "ai-meta-tags",
  "markdown-link",
  "ai-hint-div",
  "x-robots-tag",
  "content-negotiation",
  "md-route",
  "link-header",
];

const VALID_STATUSES = new Set(["pass", "warn", "fail", "info"]);

const ORIGIN = "https://fixture.test";

function html({ head = "", body = "" } = {}) {
  return `<!doctype html><html lang="en"><head><title>Fixture</title>${head}</head><body>${body}<p>${"Body copy long enough that the page is not treated as client-rendered. ".repeat(
    6,
  )}</p></body></html>`;
}

/* A site that ships every AI-readiness signal we check for. */
const RICH_ROUTES = {
  "/": {
    body: html({
      head: `<link rel="alternate" type="text/markdown" href="${ORIGIN}/index.md">
        <meta name="ai-content-declaration" content="human-written">
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Fixture","url":"${ORIGIN}"}</script>`,
      body: `<div data-ai-hint="Fixture site for pipeline tests"></div>`,
    }),
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-robots-tag": "all",
      link: `<${ORIGIN}/index.md>; rel="alternate"; type="text/markdown"`,
    },
  },
  "/robots.txt": {
    body: [
      "User-agent: *",
      "Allow: /",
      "Content-Signal: search=yes, ai-train=no",
      "",
      // The checker wants named AI bots, not just a wildcard group.
      ...["GPTBot", "ClaudeBot", "Google-Extended", "PerplexityBot", "CCBot", "Applebot-Extended"].flatMap(
        (bot) => [`User-agent: ${bot}`, "Allow: /", ""],
      ),
      `Sitemap: ${ORIGIN}/sitemap.xml`,
    ].join("\n"),
    headers: { "content-type": "text/plain" },
  },
  "/llms.txt": { body: "# Fixture\n\n> A fixture site.\n\n## Docs\n\n- [Home](/): home\n" },
  "/llms-full.txt": { body: "# Fixture\n\nEverything, inlined.\n" },
  "/ai.txt": { body: "User-agent: *\nAllow: /\n" },
  "/.well-known/tdmrep.json": {
    body: JSON.stringify([{ location: "/", "tdm-reservation": 1 }]),
    headers: { "content-type": "application/json" },
  },
  "/.well-known/agent-card.json": {
    body: JSON.stringify({
      name: "Fixture Agent",
      description: "Fixture",
      url: `${ORIGIN}/agent`,
      version: "1.0.0",
      capabilities: {},
      skills: [],
    }),
    headers: { "content-type": "application/json" },
  },
  "/.well-known/mcp.json": {
    body: JSON.stringify({ mcpServers: { fixture: { url: `${ORIGIN}/mcp` } } }),
    headers: { "content-type": "application/json" },
  },
  "/.well-known/api-agent.yaml": {
    body: "openapi: 3.1.0\ninfo:\n  title: Fixture\n  version: 1.0.0\npaths: {}\n",
    headers: { "content-type": "application/yaml" },
  },
  "/.well-known/api-catalog": {
    body: JSON.stringify({
      linkset: [{ anchor: ORIGIN, "service-desc": [{ href: `${ORIGIN}/openapi.json` }] }],
    }),
    headers: { "content-type": "application/linkset+json" },
  },
  "/sitemap.xml": {
    body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}/</loc></url></urlset>`,
    headers: { "content-type": "application/xml" },
  },
  "/index.md": { body: "# Fixture\n\nMarkdown twin.\n", headers: { "content-type": "text/markdown" } },
};

/* A site that ships none of them, and 404s every well-known path. */
const BARE_ROUTES = {
  "/": {
    body: html({ body: "<h1>Bare</h1>" }),
    headers: { "content-type": "text/html; charset=utf-8" },
  },
};

function makeFetch(routes, { defaultStatus = 404 } = {}) {
  return vi.fn(async (url, options = {}) => {
    const { pathname } = new URL(url);
    const accept = options?.headers?.accept || "";
    const route = routes[pathname];

    /* Content negotiation: the markdown twin is served from the page URL
       when the client asks for it. */
    if (!route && accept.includes("text/markdown")) {
      return new Response("", { status: defaultStatus });
    }
    if (route && accept.includes("text/markdown") && routes["/index.md"]) {
      return new Response(routes["/index.md"].body, {
        status: 200,
        headers: { "content-type": "text/markdown", vary: "Accept" },
      });
    }
    if (!route) {
      return new Response("Not found", {
        status: defaultStatus,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: route.headers ?? { "content-type": "text/plain" },
    });
  });
}

/* The checkers call node:http through lib/checkers/fetch.js, not the
   global fetch, so the stub is installed through that module's test hook
   instead of on globalThis. Assigning to `stub.fetch` keeps the tests
   below reading the same way. */
const stub = {
  set fetch(fn) {
    __setFetchImplForTests(fn);
  },
};

afterEach(() => {
  __setFetchImplForTests(null);
  vi.restoreAllMocks();
});

describe("runCheck pipeline — a site with every signal present", () => {
  let report;

  beforeEach(async () => {
    stub.fetch = makeFetch(RICH_ROUTES);
    const out = await runCheck(ORIGIN);
    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    report = out.body;
  });

  it("reports the site as reachable and not robots-blocked", () => {
    expect(report.reachable).toBe(true);
    expect(report.blockedByRobots).toBeUndefined();
    expect(report.url).toBe(ORIGIN);
    expect(report.origin).toBe(ORIGIN);
  });

  it("runs every checker exactly once", () => {
    const ids = report.results.map((r) => r.id);
    expect(ids.sort()).toEqual([...EXPECTED_CHECK_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns a well-formed result object for each checker", () => {
    for (const r of report.results) {
      expect(typeof r.id, r.id).toBe("string");
      expect(typeof r.name, r.id).toBe("string");
      expect(VALID_STATUSES.has(r.status), `${r.id} status=${r.status}`).toBe(true);
      // Every checker carries a remediation pointer for the UI.
      expect(r.fixSummary, r.id).toBeTruthy();
    }
  });

  it("grades the run and keeps score, grade, and counts consistent", () => {
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect("ABCDF").toContain(report.grade);
    expect(report.earned).toBeLessThanOrEqual(report.possible);

    const counted =
      report.summary.passing + report.summary.warnings + report.summary.failing + report.summary.info;
    expect(counted).toBe(report.results.length);
  });

  it("actually passes the checks the fixture satisfies", () => {
    const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
    // A regression that broke fetching or parsing would show up as these
    // flipping to "fail" while the fixture still serves them.
    for (const id of ["robots-txt", "llms-txt", "sitemap", "schema-jsonld", "ai-hint-div"]) {
      expect(byId[id].status, `${id} should not fail for the rich fixture`).not.toBe("fail");
    }
    expect(report.summary.passing).toBeGreaterThan(5);
  });

  it("logs the requests it made, starting with the page fetch", () => {
    expect(Array.isArray(report.requestLog)).toBe(true);
    expect(report.requestLog[0].url).toBe(ORIGIN);
    expect(report.requestLog.some((e) => e.url === `${ORIGIN}/robots.txt`)).toBe(true);
  });

  it("caps free-form strings at 200 chars before they reach an LLM", () => {
    for (const r of report.results) {
      if (typeof r.summary === "string") expect(r.summary.length).toBeLessThanOrEqual(200);
      if (typeof r.detail === "string") expect(r.detail.length).toBeLessThanOrEqual(200);
    }
  });
});

/* A hostile site controls the strings that end up in `details` — agent
   names, header values, schema @type strings. Uncapped, they inflate the
   response and land in the UI verbatim. */
describe("runCheck pipeline — a site returning oversized values", () => {
  const LONG = "A".repeat(5000);

  function collectStrings(v, key = null, out = []) {
    if (typeof v === "string") out.push([key, v]);
    else if (Array.isArray(v)) v.forEach((x) => collectStrings(x, key, out));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) collectStrings(x, k, out);
    }
    return out;
  }

  it("caps every string inside details, not just summary and detail", async () => {
    stub.fetch = makeFetch({
      ...RICH_ROUTES,
      "/.well-known/agent-card.json": {
        body: JSON.stringify({
          name: LONG,
          description: LONG,
          url: `${ORIGIN}/agent`,
          version: "1.0.0",
          capabilities: {},
          skills: [],
        }),
        headers: { "content-type": "application/json" },
      },
    });
    const report = (await runCheck(ORIGIN)).body;

    for (const r of report.results) {
      for (const [key, s] of collectStrings(r.details)) {
        // URL-valued keys keep the URL cap so links stay clickable.
        const limit = /url$/i.test(key || "") ? 500 : 200;
        expect(s.length, `${r.id}.${key} is ${s.length} chars`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("keeps the tested URL intact in the request log", async () => {
    stub.fetch = makeFetch(RICH_ROUTES);
    const report = (await runCheck(ORIGIN)).body;
    for (const entry of report.requestLog) {
      expect(entry.url).not.toMatch(/…$/);
      expect(() => new URL(entry.url)).not.toThrow();
    }
  });
});

describe("runCheck pipeline — a site with no signals", () => {
  it("still completes, and scores below the fully-equipped site", async () => {
    stub.fetch = makeFetch(RICH_ROUTES);
    const rich = (await runCheck(ORIGIN)).body;

    stub.fetch = makeFetch(BARE_ROUTES);
    const bare = (await runCheck(ORIGIN)).body;

    expect(bare.reachable).toBe(true);
    expect(bare.results.map((r) => r.id).sort()).toEqual([...EXPECTED_CHECK_IDS].sort());
    expect(bare.score).toBeLessThan(rich.score);
    expect(bare.summary.failing).toBeGreaterThan(0);
  });
});

describe("runCheck pipeline — degraded sites", () => {
  it("returns an unreachable report instead of throwing when the site 500s", async () => {
    stub.fetch = vi.fn(async () => new Response("boom", { status: 500 }));
    const out = await runCheck(ORIGIN);
    expect(out.ok).toBe(true);
    expect(out.body.reachable).toBe(false);
    expect(out.body.reachableStatus).toBe(500);
    expect(typeof out.body.reason).toBe("string");
    expect(out.body.results).toEqual([]);
  });

  it("returns an unreachable report when fetch itself throws", async () => {
    stub.fetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const out = await runCheck(ORIGIN);
    expect(out.ok).toBe(true);
    expect(out.body.reachable).toBe(false);
    expect(out.body.results).toEqual([]);
  });

  it("honors robots.txt and skips the checks when disallowed", async () => {
    stub.fetch = makeFetch({
      ...RICH_ROUTES,
      "/robots.txt": {
        body: "User-agent: *\nDisallow: /\n",
        headers: { "content-type": "text/plain" },
      },
    });
    const out = await runCheck(ORIGIN);
    expect(out.body.blockedByRobots).toBe(true);
    expect(out.body.results).toEqual([]);
    expect(out.body.blockedReason).toContain("robots.txt");
  });
});

describe("runCheck pipeline — input rejection", () => {
  it.each([
    ["not a string", 42],
    ["a private host", "http://127.0.0.1/"],
    ["an IPv4-in-IPv6 private host", "http://[::ffff:127.0.0.1]/"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["an over-long URL", `https://example.com/${"a".repeat(600)}`],
  ])("rejects %s without making a request", async (_label, input) => {
    const spy = vi.fn();
    stub.fetch = spy;
    const out = await runCheck(input);
    expect(out.ok).toBe(false);
    expect(out.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
