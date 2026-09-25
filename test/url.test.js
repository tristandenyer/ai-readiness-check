import { describe, it, expect } from "./helpers/expect.js";
import { normalizeUrl, assertSafeUrl, MAX_URL_LENGTH } from "../src/core/url.js";

describe("normalizeUrl", () => {
  describe("happy paths", () => {
    it("returns origin for a well-formed https URL", () => {
      expect(normalizeUrl("https://example.com")).toBe("https://example.com");
    });

    it("preserves http when explicit", () => {
      expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    });

    it("adds https:// when no protocol given", () => {
      expect(normalizeUrl("example.com")).toBe("https://example.com");
      expect(normalizeUrl("www.example.com")).toBe("https://www.example.com");
    });

    it("preserves path and query, drops only the fragment", () => {
      expect(normalizeUrl("https://example.com/foo/bar?x=1#section")).toBe(
        "https://example.com/foo/bar?x=1"
      );
      expect(normalizeUrl("https://example.com/work/post-123")).toBe(
        "https://example.com/work/post-123"
      );
    });

    it("collapses bare-origin URLs (path '/') to the origin form", () => {
      expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    });

    it("trims surrounding whitespace", () => {
      expect(normalizeUrl("  https://example.com  ")).toBe("https://example.com");
      expect(normalizeUrl("\thttps://example.com\n")).toBe("https://example.com");
    });

    it("preserves a non-default port", () => {
      expect(normalizeUrl("https://example.com:8443")).toBe("https://example.com:8443");
    });

    it("lowercases the hostname (URL parser default)", () => {
      expect(normalizeUrl("HTTPS://EXAMPLE.COM")).toBe("https://example.com");
    });
  });

  describe("SSRF protection — blocks private and reserved hosts", () => {
    const cases = [
      "localhost",
      "http://localhost",
      "https://localhost",
      "https://localhost:3000",
      "https://localhost/some/path",
      "127.0.0.1",
      "https://127.0.0.1",
      "https://127.255.255.254",
      "https://0.0.0.0",
      "https://10.0.0.1",
      "https://10.255.255.255",
      "https://192.168.0.1",
      "https://192.168.255.255",
      "https://172.16.0.1",
      "https://172.20.10.5",
      "https://172.31.255.255",
      "https://169.254.169.254", // AWS metadata IP
    ];
    it.each(cases)("rejects %s", (input) => {
      expect(normalizeUrl(input)).toBeNull();
    });
  });

  /* An IPv6 literal can spell an IPv4 address several ways, and the URL
     parser rewrites some of them: [::ffff:127.0.0.1] comes back as
     [::ffff:7f00:1]. Each of these reached the fetcher before the guard
     folded IPv4-in-IPv6 back to dotted quad. */
  describe("SSRF protection — blocks IPv4 addresses spelled as IPv6", () => {
    const cases = [
      "http://[::ffff:127.0.0.1]",      // v4-mapped loopback
      "http://[::ffff:7f00:1]",         // same address, hex spelling
      "http://[0:0:0:0:0:ffff:127.0.0.1]",
      "http://[::ffff:10.0.0.1]",
      "http://[::ffff:192.168.1.1]",
      "http://[::ffff:172.16.0.1]",
      "http://[::ffff:169.254.169.254]", // cloud metadata
      "http://[::ffff:100.64.0.1]",      // CGNAT
      "http://[::127.0.0.1]",            // v4-compatible form
      "http://[::7f00:1]",
    ];
    it.each(cases)("rejects %s at the input boundary", (input) => {
      expect(normalizeUrl(input)).toBeNull();
    });
    it.each(cases)("rejects %s at the pre-fetch guard", async (input) => {
      const result = await assertSafeUrl(input);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("private_host");
    });
  });

  describe("SSRF protection — blocks non-global IPv6", () => {
    const cases = [
      "http://[::1]",
      "http://[::]",
      "http://[fc00::1]",
      "http://[fd00::1]",      // the half of fc00::/7 that networks actually use
      "http://[fdff:1234::1]",
      "http://[fe80::1]",
      "http://[ff02::1]",      // multicast
    ];
    it.each(cases)("rejects %s", async (input) => {
      expect(normalizeUrl(input)).toBeNull();
      expect((await assertSafeUrl(input)).ok).toBe(false);
    });
  });

  describe("SSRF protection — still allows global IPv6", () => {
    const cases = [
      "http://[2606:4700:4700::1111]", // Cloudflare DNS
      "http://[2001:4860:4860::8888]", // Google DNS
      "http://[3ffe::1]",
    ];
    it.each(cases)("allows %s", async (input) => {
      expect(normalizeUrl(input)).not.toBeNull();
      expect((await assertSafeUrl(input)).ok).toBe(true);
    });
  });

  describe("allowPrivateNetwork — opens loopback and local-network addresses", () => {
    const opts = { allowPrivateNetwork: true };
    const cases = [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.8.8.8",
      "http://[::1]:3000",
      "http://[::ffff:127.0.0.1]",
      "http://10.0.0.5",
      "http://172.16.0.1",
      "http://172.31.255.254",
      "http://192.168.1.10:8080",
      "http://[fd00::1]",
    ];
    it.each(cases)("allows %s", async (input) => {
      expect(normalizeUrl(input, opts)).not.toBeNull();
      expect((await assertSafeUrl(input, opts)).ok).toBe(true);
    });
  });

  describe("allowPrivateNetwork — still blocks metadata, link-local, and odd ranges", () => {
    const opts = { allowPrivateNetwork: true };
    const cases = [
      "http://169.254.169.254",          // AWS / GCP / Azure metadata
      "http://[::ffff:169.254.169.254]",
      "http://[fe80::1]",
      "http://100.100.100.200",          // Alibaba metadata, CGNAT range
      "http://0.0.0.0",
      "http://[::]",
      "http://[ff02::1]",
      "http://localhost:5432",           // blocked port
      "http://127.0.0.1:6379",           // blocked port
    ];
    it.each(cases)("rejects %s", async (input) => {
      expect(normalizeUrl(input, opts)).toBeNull();
      expect((await assertSafeUrl(input, opts)).ok).toBe(false);
    });
  });

  describe("allowPrivateNetwork — only the literal true opens anything", () => {
    it.each([undefined, false, "true", 1, {}])("%s keeps localhost blocked", async (value) => {
      const opts = { allowPrivateNetwork: value };
      expect(normalizeUrl("http://127.0.0.1", opts)).toBeNull();
      expect((await assertSafeUrl("http://127.0.0.1", opts)).ok).toBe(false);
    });
  });

  describe("SSRF protection — does NOT block public 172.x ranges outside 16-31", () => {
    it("allows 172.15.x.x (just below private range)", () => {
      expect(normalizeUrl("https://172.15.0.1")).toBe("https://172.15.0.1");
    });
    it("allows 172.32.x.x (just above private range)", () => {
      expect(normalizeUrl("https://172.32.0.1")).toBe("https://172.32.0.1");
    });
  });

  describe("rejects non-http(s) protocols", () => {
    const schemes = [
      "file:///etc/passwd",
      "ftp://example.com",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "ws://example.com",
      "gopher://example.com",
    ];
    it.each(schemes)("rejects %s", (input) => {
      expect(normalizeUrl(input)).toBeNull();
    });
  });

  describe("invalid input", () => {
    it("returns null for empty string", () => {
      expect(normalizeUrl("")).toBeNull();
    });

    it("returns null for whitespace-only", () => {
      expect(normalizeUrl("   ")).toBeNull();
      expect(normalizeUrl("\t\n")).toBeNull();
    });

    it("returns null for non-strings", () => {
      expect(normalizeUrl(null)).toBeNull();
      expect(normalizeUrl(undefined)).toBeNull();
      expect(normalizeUrl(42)).toBeNull();
      expect(normalizeUrl({})).toBeNull();
    });

    it("returns null for completely malformed input", () => {
      // "not a url" gets prefixed with https:// → "https://not a url" — invalid URL
      expect(normalizeUrl("not a url")).toBeNull();
    });
  });

  describe("IPv6 (basic safety)", () => {
    it("rejects loopback ::1", () => {
      expect(normalizeUrl("https://[::1]")).toBeNull();
    });
    it("rejects fe80:: link-local prefix", () => {
      expect(normalizeUrl("https://[fe80::1]")).toBeNull();
    });
    it("rejects fc00:: unique-local prefix", () => {
      expect(normalizeUrl("https://[fc00::1]")).toBeNull();
    });
  });

  describe("length cap", () => {
    it("exposes MAX_URL_LENGTH constant", () => {
      expect(MAX_URL_LENGTH).toBe(500);
    });

    it("accepts a URL right at the limit", () => {
      const padding = "a".repeat(MAX_URL_LENGTH - "https://example.com/".length);
      const input = `https://example.com/${padding}`;
      expect(input.length).toBe(MAX_URL_LENGTH);
      expect(normalizeUrl(input)).toBe(input);
    });

    it("rejects a URL one character over the limit", () => {
      const padding = "a".repeat(MAX_URL_LENGTH - "https://example.com/".length + 1);
      const input = `https://example.com/${padding}`;
      expect(input.length).toBe(MAX_URL_LENGTH + 1);
      expect(normalizeUrl(input)).toBeNull();
    });

    it("rejects an obviously oversize URL", () => {
      expect(normalizeUrl("https://example.com/" + "x".repeat(10_000))).toBeNull();
    });
  });
});

describe("assertSafeUrl", () => {
  it("rejects invalid URLs", async () => {
    const r = await assertSafeUrl("not a url");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid_url");
  });

  it("rejects non-http(s) protocols", async () => {
    const r = await assertSafeUrl("ftp://example.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_protocol");
  });

  it("rejects literal private IPv4 (loopback)", async () => {
    const r = await assertSafeUrl("http://127.0.0.1/foo");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private_host");
  });

  it("rejects literal private IPv4 (RFC1918)", async () => {
    const r = await assertSafeUrl("http://10.0.0.1");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private_host");
  });

  it("rejects AWS metadata IP", async () => {
    const r = await assertSafeUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private_host");
  });

  it("rejects literal private IPv6 (::1)", async () => {
    const r = await assertSafeUrl("http://[::1]/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private_host");
  });

  it("rejects 'localhost' hostname literal", async () => {
    const r = await assertSafeUrl("http://localhost/");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("private_host");
  });

  it("allows a public hostname (DNS-resolved to public IP)", async () => {
    /* example.com is reserved by IANA for documentation, has stable
       public A records. Network-dependent test, but example.com is
       essentially a fixture of the internet. */
    const r = await assertSafeUrl("https://example.com/");
    expect(r.ok).toBe(true);
  });
});
