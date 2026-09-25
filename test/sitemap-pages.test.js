import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "./helpers/expect.js";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main, rotation } from "../src/cli/main.js";
import { pagesProblem } from "../src/cli/config.js";
import { readBaseline } from "../src/cli/baseline.js";

describe("rotation", () => {
  const paths = ["/a", "/b", "/c", "/d", "/e"];

  it("checks every path once every ceil(paths / n) runs", () => {
    const seen = new Set([0, 1, 2].flatMap((run) => rotation(paths, 2, run)));
    expect([...seen].sort()).toEqual(paths);
  });

  it("wraps around the end of the list", () => {
    expect(rotation(paths, 2, 2)).toEqual(["/e", "/a"]);
  });

  it("returns every path when there are no more than n", () => {
    expect(rotation(["/a", "/b"], 5, 7)).toEqual(["/a", "/b"]);
  });
});

describe("pages validation", () => {
  it("accepts paths plus one sitemap:N", () => {
    expect(pagesProblem(["/", "/blog", "sitemap:5"])).toBe(null);
    expect(pagesProblem(["sitemap:1"])).toBe(null);
  });

  it("rejects a bad entry or a second sitemap:N", () => {
    for (const pages of [["blog"], ["sitemap"], ["sitemap:0"], ["/", "sitemap:2", "sitemap:3"], []]) {
      expect(pagesProblem(pages), JSON.stringify(pages)).toMatch(/sitemap:N/);
    }
  });
});

describe("sitemap:N on a site", () => {
  const PAGES = ["/", "/a", "/b", "/c", "/d", "/e"];
  let server;
  let base;
  let robotsGets;
  let sitemap;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/robots.txt") {
        if (req.method === "GET") robotsGets++;
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("User-agent: *\nAllow: /\n");
      }
      if (req.url === "/sitemap.xml" && sitemap) {
        // Production URLs, as a dev server's sitemap usually has.
        const urls = PAGES.map((p) => `<url><loc>https://www.example.com${p}</loc></url>`).join("");
        res.writeHead(200, { "content-type": "application/xml" });
        return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
      }
      if (PAGES.includes(req.url)) {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><html><head><title>${req.url}</title></head><body><main>${"Text. ".repeat(50)}</main></body></html>`);
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const startDir = process.cwd();
  let dir;
  beforeEach(() => {
    robotsGets = 0;
    sitemap = true;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-sitemap-pages-"));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(startDir);
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.GITHUB_RUN_NUMBER;
  });

  async function run(runNumber, ...argv) {
    process.env.GITHUB_RUN_NUMBER = String(runNumber);
    const io = { stdout: { isTTY: false, write: (s) => (io.out += s) }, stderr: { write: (s) => (io.err += s) }, out: "", err: "" };
    io.code = await main(["check", base, "--format", "json", ...argv], io);
    return io;
  }
  const checked = (io) => [JSON.parse(io.out)].flat().map((r) => [new URL(r.url).pathname, r.sampled === true]);

  it("adds n sitemap pages on the checked host, skipping pages already listed, and says which", async () => {
    const io = await run(0, "--pages", "/,/a,sitemap:2");
    expect(checked(io)).toEqual([["/", false], ["/a", false], ["/b", true], ["/c", true]]);
    expect(io.err).toMatch(/sitemap:2: checked \/b, \/c \(run 0\)\. Every sitemap page is checked once every 2 runs\./);
  });

  it("picks the next pages on the next run", async () => {
    const io = await run(1, "--pages", "/,/a,sitemap:2");
    expect(checked(io).filter(([, s]) => s).map(([p]) => p)).toEqual(["/d", "/e"]);
  });

  it("fetches site-wide files once for all pages", async () => {
    await run(0, "--pages", "/,/a,sitemap:2");
    expect(robotsGets).toBe(1);
  });

  it("says so when the site has no sitemap", async () => {
    sitemap = false;
    const io = await run(0, "--pages", "/,sitemap:2");
    expect(checked(io)).toEqual([["/", false]]);
    expect(io.err).toMatch(/sitemap:2: no sitemap found/);
  });

  it("leaves sampled pages out of the ratchet", async () => {
    fs.writeFileSync("ai-readiness.config.json", JSON.stringify({ pages: ["/", "sitemap:2"], ratchet: true }));
    await run(0);
    expect(Object.keys(readBaseline().targets.default.pages)).toEqual(["/"]);
    const second = await run(1);
    expect(second.err).toMatch(/sitemap:2: checked \/c, \/d \(run 1\)/);
    expect(second.err).not.toMatch(/not in the baseline|below the baseline|got worse/);
  });
});
