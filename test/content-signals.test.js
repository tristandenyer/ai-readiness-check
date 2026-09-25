import { describe, it, expect, vi, beforeEach } from "./helpers/expect.js";

import { stubFetch, resetFetch } from "./helpers/stub-fetch.js";
import { checkContentSignals } from "../src/core/content-signals.js";

const BASE = "https://example.com";

beforeEach(() => {
  resetFetch();
});

describe("checkContentSignals", () => {
  it("reports info when robots.txt has no Content-Signal lines", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: "User-agent: *\nAllow: /\n",
      contentType: "text/plain",
      ttfbMs: 10,
    });
    const r = await checkContentSignals(BASE);
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/No Content-Signal/);
  });

  it("reports info when robots.txt itself is missing", async () => {
    stubFetch({
      ok: false,
      status: 404,
      text: "Not found",
      contentType: "text/plain",
      ttfbMs: 10,
    });
    const r = await checkContentSignals(BASE);
    expect(r.status).toBe("info");
  });

  it("passes when Content-Signal directives are declared", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: "User-agent: *\nContent-Signal: search=yes, ai-train=no\nContent-Signal: ai-input=yes\n",
      contentType: "text/plain",
      ttfbMs: 10,
    });
    const r = await checkContentSignals(BASE);
    expect(r.status).toBe("pass");
    expect(r.summary).toMatch(/2 Content-Signal directives/);
    expect(r.details.signals).toEqual([
      "search=yes, ai-train=no",
      "ai-input=yes",
    ]);
  });

  // fetchWithTimeout never throws; a network error comes back as a failed
  // response, so the checker reports the file as not found. Phase 3 of the
  // plan adds an "inconclusive" status for this case.
  it("reports a network error as not found", async () => {
    stubFetch(new Error("boom"));
    const r = await checkContentSignals(BASE);
    expect(r.status).toBe("info");
  });
});
