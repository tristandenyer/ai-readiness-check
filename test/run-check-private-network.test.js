import { describe, it, expect, beforeAll, afterAll } from "./helpers/expect.js";
import http from "node:http";
import { runCheck } from "../src/core/run-check.js";
import { currentRunOptions } from "../src/core/run-options.js";

/* A real HTTP server on 127.0.0.1, fetched over a real connection (no
   fetch stub). This is what the CLI will do against a developer's dev
   server: the only thing standing between it and the SSRF guard is the
   allowPrivateNetwork option. */
let server;
let port;

const HOME = `<!doctype html><html lang="en"><head>
<title>Local dev site</title>
<meta name="description" content="A site running on a developer's machine.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Local dev site"}</script>
</head><body><main><h1>Local dev site</h1><p>${"Real server-rendered content. ".repeat(40)}</p></main></body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(HOME);
    }
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(
        "User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: *\nAllow: /\n",
      );
    }
    if (req.url === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("runCheck with allowPrivateNetwork against a local server", () => {
  it("rejects the local server by default", async () => {
    const out = await runCheck(`http://127.0.0.1:${port}`);
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("It is a private network address");
  });

  it("checks the local server when the option is set", async () => {
    const out = await runCheck(`http://127.0.0.1:${port}`, {
      allowPrivateNetwork: true,
    });
    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.reachable).toBe(true);
    expect(out.body.results.length).toBeGreaterThan(10);
    const robots = out.body.results.find((r) => r.id === "robots-txt");
    expect(robots.status).not.toBe("fail");
    const schema = out.body.results.find((r) => r.id === "schema-jsonld");
    expect(schema.status).toBe("pass");
  }, 30000);

  it("reaches the server by the name localhost", async () => {
    // localhost can resolve to ::1 first; the server only listens on
    // 127.0.0.1, so this also proves the fetcher falls through to the
    // next verified address.
    const out = await runCheck(`http://localhost:${port}`, {
      allowPrivateNetwork: true,
    });
    expect(out.status).toBe(200);
    expect(out.body.reachable).toBe(true);
  }, 30000);

  it("still refuses a redirect to the cloud metadata address", async () => {
    const out = await runCheck(`http://127.0.0.1:${port}/to-metadata`, {
      allowPrivateNetwork: true,
    });
    expect(out.status).toBe(200);
    expect(out.body.reachable).toBe(false);
  }, 30000);

  it("does not leak the option outside the run", async () => {
    await runCheck(`http://127.0.0.1:${port}`, { allowPrivateNetwork: true });
    expect(currentRunOptions().allowPrivateNetwork).toBe(false);
  }, 30000);
});
