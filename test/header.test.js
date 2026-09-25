import { describe, it, expect, beforeAll, afterAll } from "./helpers/expect.js";
import http from "node:http";
import { main, parseHeaders } from "../src/cli/main.js";

/* A protected site that answers only when the secret header is sent, and
   redirects /llms.txt to a second site that records what it receives. */
const SECRET = "s3cret-value-123";
let site;
let other;
let base;
const seenByOther = [];

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

beforeAll(async () => {
  other = http.createServer((req, res) => {
    seenByOther.push(req.headers["x-vercel-protection-bypass"]);
    res.writeHead(404);
    res.end();
  });
  const otherPort = await listen(other);
  site = http.createServer((req, res) => {
    if (req.headers["x-vercel-protection-bypass"] !== SECRET) {
      res.writeHead(401, { "content-type": "text/plain" });
      return res.end("Authentication required");
    }
    if (req.url === "/llms.txt") {
      res.writeHead(302, { location: `http://localhost:${otherPort}/llms.txt` });
      return res.end();
    }
    res.writeHead(req.url === "/" ? 200 : 404, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>Preview</title></head><body><main>${"Text. ".repeat(50)}</main></body></html>`);
  });
  base = `http://127.0.0.1:${await listen(site)}`;
});
afterAll(async () => {
  await Promise.all([site, other].map((s) => new Promise((resolve) => s.close(resolve))));
});

async function run(...argv) {
  let stdout = "";
  const io = { stdout: { isTTY: false, write: (s) => (stdout += s) }, stderr: { write: () => {} } };
  return { code: await main(argv, io), stdout };
}

describe("--header", () => {
  it("parses Name: value and rejects bad input", () => {
    expect(parseHeaders(["X-Vercel-Protection-Bypass: abc:def"])).toEqual({ "x-vercel-protection-bypass": "abc:def" });
    expect(typeof parseHeaders(["no colon"])).toBe("string");
    expect(typeof parseHeaders(["Host: evil.com"])).toBe("string");
    expect(typeof parseHeaders(["bad name: x"])).toBe("string");
  });

  it("without the header, the protected site can't be checked", async () => {
    const { stdout } = await run("check", base);
    expect(JSON.parse(stdout).reachable).toBe(false);
  }, 30000);

  it("with the header, the site is checked, and a redirect to another origin doesn't get it", async () => {
    const { stdout } = await run("check", base, "--header", `x-vercel-protection-bypass: ${SECRET}`);
    const report = JSON.parse(stdout);
    expect(report.reachable).toBe(true);
    expect(seenByOther.length).toBeGreaterThan(0);
    expect(seenByOther.every((v) => v === undefined)).toBe(true);
    expect(stdout).not.toContain(SECRET);
  }, 30000);

  it("hides the header value in the agent rerun command", async () => {
    const { stdout } = await run("check", base, "--header", `x-vercel-protection-bypass: ${SECRET}`, "-f", "agent");
    expect(stdout).not.toContain(SECRET);
    expect(stdout).toContain("'x-vercel-protection-bypass: <hidden>'");
  }, 30000);

  it("can replace the user agent", async () => {
    const seen = new Set();
    const ua = http.createServer((req, res) => {
      seen.add(req.headers["user-agent"]);
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => ua.listen(0, "127.0.0.1", resolve));
    await run("check", `http://127.0.0.1:${ua.address().port}`, "--header", "User-Agent: MyAllowlistedBot/1.0");
    await new Promise((resolve) => ua.close(resolve));
    expect([...seen]).toEqual(["MyAllowlistedBot/1.0"]);
  }, 30000);
});
