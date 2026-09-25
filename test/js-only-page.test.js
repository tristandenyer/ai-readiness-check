import { describe, it, expect, beforeAll, afterAll } from "./helpers/expect.js";
import http from "node:http";
import { runCheck } from "../src/core/run-check.js";

/* A single-page app: the HTML has an empty <div id="root"> and a script.
   `head` is what the server puts in <head> for each test. */
let server;
let base;
let head = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>App</title>${head}</head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const resultFor = async (id) => (await runCheck(base, { allowPrivateNetwork: true })).body.results.find((r) => r.id === id);

describe("a page that is empty until JavaScript runs", () => {
  it("fails its page-level checks and says JavaScript is the cause", async () => {
    head = "";
    for (const id of ["schema-jsonld", "markdown-link", "md-route"]) {
      const r = await resultFor(id);
      expect(r.status, id).toBe("fail");
      expect(r.detail, id).toMatch(/^This page has almost no text until JavaScript runs/);
    }
  }, 30000);

  it("still passes a tag that is in the HTML the server sends", async () => {
    head = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"App","url":"${"https://app.example"}"}</script>`;
    expect((await resultFor("schema-jsonld")).status).not.toBe("fail");
  }, 30000);

  it("still checks the 0-point opt-outs: info when absent, pass when present", async () => {
    head = "";
    const absent = await resultFor("ai-meta-tags");
    expect(absent.status).toBe("info");
    expect(absent.summary).toMatch(/^No AI-specific meta directives/);
    head = '<meta name="robots" content="noai, noimageai">';
    expect((await resultFor("ai-meta-tags")).status).toBe("pass");
  }, 30000);
});
