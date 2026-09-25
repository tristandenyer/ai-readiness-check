import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "./helpers/expect.js";
import http from "node:http";
import dns from "node:dns";
import zlib from "node:zlib";
import { fetchWithTimeout, __setFetchImplForTests } from "../src/core/fetch.js";
import { assertSafeUrl } from "../src/core/url.js";
import { withRunOptions } from "../src/core/run-options.js";

/* The safety check resolves a hostname and confirms the addresses are
   public. The connection then has to go to one of those exact addresses.
   If it resolved the name a second time, a hostname that answers with a
   public address and then a private one would pass the check and still
   connect somewhere internal.

   Most tests here run against a real HTTP server on 127.0.0.1 (reached
   with allowPrivateNetwork, the way the CLI reaches a dev server), so
   they test what the fetcher does rather than how it is built. A few use
   the test hook to simulate failures a local server can't produce. */

afterEach(() => {
  __setFetchImplForTests(null);
  vi.restoreAllMocks();
});

let server;
let port;
const BIG = "x".repeat(3 * 1024 * 1024);
// 64 MB of zeros compresses to about 64 KB: a decompression bomb.
const BOMB = zlib.gzipSync(Buffer.alloc(64 * 1024 * 1024));

beforeAll(async () => {
  server = http.createServer((req, res) => {
    switch (req.url) {
      case "/hello":
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("hello");
      case "/gzip":
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        return res.end(zlib.gzipSync("compressed with gzip"));
      case "/deflate":
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "deflate" });
        return res.end(zlib.deflateSync("compressed with deflate"));
      case "/br":
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "br" });
        return res.end(zlib.brotliCompressSync("compressed with brotli"));
      case "/bomb":
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        return res.end(BOMB);
      case "/big":
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end(BIG);
      case "/redirect":
        res.writeHead(302, { location: "/hello" });
        return res.end();
      case "/redirect-metadata":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      case "/redirect-loop":
        res.writeHead(302, { location: "/redirect-loop" });
        return res.end();
      case "/hang":
        return; // never responds
      case "/headers":
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(req.headers));
      default:
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

const local = (path) => `http://127.0.0.1:${port}${path}`;
const localByName = (path) => `http://localhost:${port}${path}`;
const allowLocal = (fn, extra = {}) =>
  withRunOptions({ allowPrivateNetwork: true, ...extra }, fn);

describe("assertSafeUrl", () => {
  it("returns the addresses it verified, so the caller can connect to them", async () => {
    const r = await assertSafeUrl("https://example.com/");
    expect(r.ok).toBe(true);
    expect(r.addresses.length).toBeGreaterThan(0);
  });

  it("returns no addresses for a literal address, which needs no lookup", async () => {
    const r = await assertSafeUrl("http://1.1.1.1/");
    expect(r.ok).toBe(true);
    expect(r.addresses).toEqual([]);
  });
});

describe("fetchWithTimeout against a real server", () => {
  it("fetches a page", async () => {
    const r = await allowLocal(() => fetchWithTimeout(local("/hello")));
    expect(r.status).toBe(200);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("hello");
    expect(r.contentType).toBe("text/plain");
    expect(r.headers.get("content-type")).toBe("text/plain");
    expect(r.ttfbMs).toBeGreaterThanOrEqual(0);
  });

  it("connects to the verified address without resolving the name again", async () => {
    // assertSafeUrl resolves through dns/promises. A second resolution by
    // the HTTP client would go through dns.lookup, so make that fail.
    vi.spyOn(dns, "lookup").mockImplementation((_host, _opts, cb) => {
      const callback = typeof _opts === "function" ? _opts : cb;
      callback(Object.assign(new Error("second lookup"), { code: "ENOTFOUND" }));
    });
    const r = await allowLocal(() => fetchWithTimeout(localByName("/hello")));
    expect(r.error).toBeUndefined();
    expect(r.text).toBe("hello");
  });

  it("sends its user agent, and the run's user agent when one is set", async () => {
    const plain = await allowLocal(() => fetchWithTimeout(local("/headers")));
    expect(JSON.parse(plain.text)["user-agent"]).toMatch(/AIReadinessCheck/);
    const custom = await allowLocal(() => fetchWithTimeout(local("/headers")), {
      userAgent: "custom-agent/1.0",
    });
    expect(JSON.parse(custom.text)["user-agent"]).toBe("custom-agent/1.0");
  });

  it("follows a redirect and reports the final URL", async () => {
    const r = await allowLocal(() => fetchWithTimeout(local("/redirect")));
    expect(r.status).toBe(200);
    expect(r.text).toBe("hello");
    expect(r.finalUrl).toBe(local("/hello"));
  });

  it("refuses a redirect to the cloud metadata address", async () => {
    const r = await allowLocal(() => fetchWithTimeout(local("/redirect-metadata")));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("blocked_private_host");
  });

  it("stops following redirects after the limit", async () => {
    const r = await allowLocal(() => fetchWithTimeout(local("/redirect-loop")));
    expect(r.status).toBe(302);
  });

  it.each(["gzip", "deflate", "br"])("decompresses %s", async (encoding) => {
    const r = await allowLocal(() => fetchWithTimeout(local(`/${encoding}`)));
    expect(r.text).toMatch(/^compressed with /);
  });

  it("caps the body at about 1 MB", async () => {
    const r = await allowLocal(() => fetchWithTimeout(local("/big")));
    expect(r.status).toBe(200);
    expect(r.text.length).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024);
    expect(r.text.length).toBeGreaterThan(900 * 1024);
  });

  it("caps a decompression bomb at about 1 MB of decompressed text", async () => {
    const r = await allowLocal(() => fetchWithTimeout(local("/bomb")));
    expect(r.status).toBe(200);
    expect(r.text.length).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024);
  });

  it("times out on a server that never answers", async () => {
    const t0 = Date.now();
    const r = await allowLocal(() => fetchWithTimeout(local("/hang"), { timeoutMs: 300 }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("reports a closed port as connection_refused", async () => {
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));
    const r = await allowLocal(() => fetchWithTimeout(`http://127.0.0.1:${closedPort}/`));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("connection_refused");
  });

  it("refuses a private address when the run doesn't allow it", async () => {
    const r = await fetchWithTimeout(local("/hello"));
    expect(r.error).toBe("blocked_private_host");
  });

  it("fetches a real public HTTPS site with the connection pinned", async () => {
    // Checks the certificate is still verified against the hostname when
    // the connection goes to a pinned address. Needs network access.
    const r = await fetchWithTimeout("https://example.com/", { timeoutMs: 10000 });
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Example Domain/);
  }, 15000);
});

describe("fetchWithTimeout failures simulated through the test hook", () => {
  function okResponse() {
    return new Response("hello", { status: 200, headers: { "content-type": "text/plain" } });
  }
  function failWith(code) {
    const err = new Error("fetch failed");
    err.cause = { code };
    err.code = code;
    return err;
  }

  it("falls back to the next address when the first one fails", async () => {
    let calls = 0;
    __setFetchImplForTests(async () => {
      calls += 1;
      if (calls === 1) throw failWith("ECONNREFUSED");
      return okResponse();
    });
    const r = await fetchWithTimeout("https://example.com/");
    expect(calls).toBe(2);
    expect(r.status).toBe(200);
    expect(r.error).toBeUndefined();
  });

  it("keeps the real cause when every address fails, rather than a flat 'unreachable'", async () => {
    /* A site whose certificate has expired must be told that, not that
       its server could not be reached. */
    for (const [code, expected] of [
      ["ECONNREFUSED", "connection_refused"],
      ["CERT_HAS_EXPIRED", "tls_error"],
    ]) {
      __setFetchImplForTests(async () => {
        throw failWith(code);
      });
      const r = await fetchWithTimeout("https://example.com/");
      expect(r.ok).toBe(false);
      expect(r.error, `all addresses failing with ${code}`).toBe(expected);
    }
  });

  it("reports why a connection failed instead of the generic 'fetch failed'", async () => {
    const cases = [
      ["ECONNREFUSED", "connection_refused"],
      ["ECONNRESET", "connection_reset"],
      ["ENOTFOUND", "dns_failed"],
      ["CERT_HAS_EXPIRED", "tls_error"],
      ["ERR_TLS_CERT_ALTNAME_INVALID", "tls_error"],
      ["UND_ERR_CONNECT_TIMEOUT", "timeout"],
      ["ETIMEDOUT", "timeout"],
    ];
    for (const [code, expected] of cases) {
      __setFetchImplForTests(async () => {
        throw failWith(code);
      });
      const r = await fetchWithTimeout("http://1.1.1.1/");
      expect(r.error, `${code} should be reported as ${expected}`).toBe(expected);
    }
  });

  it("still refuses a private address before any connection is attempted", async () => {
    const impl = vi.fn(async () => okResponse());
    __setFetchImplForTests(impl);
    const r = await fetchWithTimeout("http://127.0.0.1/");
    expect(r.error).toBe("blocked_private_host");
    expect(impl).not.toHaveBeenCalled();
  });
});
