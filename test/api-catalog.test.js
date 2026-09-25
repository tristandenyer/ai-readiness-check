import { describe, it, expect, vi, beforeEach } from "./helpers/expect.js";

import { stubFetch, resetFetch } from "./helpers/stub-fetch.js";
import { checkApiCatalog } from "../src/core/api-catalog.js";

const BASE = "https://example.com";

beforeEach(() => {
  resetFetch();
});

describe("checkApiCatalog", () => {
  it("reports info when missing", async () => {
    stubFetch({
      ok: false,
      status: 404,
      text: "Not found",
      contentType: "text/plain",
      ttfbMs: 10,
    });
    const r = await checkApiCatalog(BASE);
    expect(r.status).toBe("info");
    expect(r.details.testedUrl).toBe(`${BASE}/.well-known/api-catalog`);
  });

  it("rejects SPA shells served with HTTP 200", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: "<!doctype html><html><body>app</body></html>",
      contentType: "text/html",
      ttfbMs: 10,
    });
    const r = await checkApiCatalog(BASE);
    expect(r.status).toBe("info");
  });

  it("warns when JSON is present but not an RFC 9264 linkset", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: JSON.stringify({ apis: ["https://example.com/api"] }),
      contentType: "application/json",
      ttfbMs: 10,
    });
    const r = await checkApiCatalog(BASE);
    expect(r.status).toBe("warn");
    expect(r.summary).toMatch(/not an RFC 9264 linkset/);
  });

  it("passes on a valid linkset and counts items", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: JSON.stringify({
        linkset: [
          {
            anchor: "https://example.com/.well-known/api-catalog",
            item: [
              { href: "https://developer.example.com/apis/foo" },
              { href: "https://developer.example.com/apis/bar" },
            ],
          },
        ],
      }),
      contentType: 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
      ttfbMs: 10,
    });
    const r = await checkApiCatalog(BASE);
    expect(r.status).toBe("pass");
    expect(r.summary).toMatch(/listing 2 APIs/);
    expect(r.details.itemCount).toBe(2);
  });

  // fetchWithTimeout never throws; a network error comes back as a failed
  // response, so the checker reports the file as not found. Phase 3 of the
  // plan adds an "inconclusive" status for this case.
  it("reports a network error as not found", async () => {
    stubFetch(new Error("boom"));
    const r = await checkApiCatalog(BASE);
    expect(r.status).toBe("info");
  });
});
