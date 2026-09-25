import { describe, it, expect, vi, beforeEach } from "./helpers/expect.js";

import { stubFetch, resetFetch } from "./helpers/stub-fetch.js";
import { checkApiAgentYaml } from "../src/core/api-agent-yaml.js";

const BASE = "https://example.com";

beforeEach(() => {
  resetFetch();
});

describe("checkApiAgentYaml", () => {
  it("reports info (not fail) when the file is missing", async () => {
    stubFetch({
      ok: false,
      status: 404,
      text: "Not found",
      contentType: "text/plain",
      ttfbMs: 12,
    });
    const r = await checkApiAgentYaml(BASE);
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/No \/\.well-known\/api-agent\.yaml/);
    expect(r.details.testedUrl).toBe(`${BASE}/.well-known/api-agent.yaml`);
  });

  it("rejects SPA shells served with HTTP 200 (soft 404)", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: "<!doctype html><html><body>app</body></html>",
      contentType: "text/html",
      ttfbMs: 12,
    });
    const r = await checkApiAgentYaml(BASE);
    expect(r.status).toBe("info");
  });

  it("rejects a non-YAML text response with no top-level keys", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: "just some prose with no yaml structure",
      contentType: "text/plain",
      ttfbMs: 12,
    });
    const r = await checkApiAgentYaml(BASE);
    expect(r.status).toBe("info");
  });

  it("passes on a real YAML file", async () => {
    stubFetch({
      ok: true,
      status: 200,
      text: "spec_version: 0.3\napi:\n  name: Example API\nrefs:\n  openapi: /openapi.json\n",
      contentType: "application/yaml",
      ttfbMs: 12,
    });
    const r = await checkApiAgentYaml(BASE);
    expect(r.status).toBe("pass");
    expect(r.summary).toMatch(/Found/);
    expect(r.detail).toMatch(/Not scored/);
    expect(r.specUrl).toBe(
      "https://github.com/tristandenyer/api-field-guide-spec",
    );
    expect(r.learnMoreUrl).toBe("/work/api-field-guide-for-ai-agents");
  });

  // fetchWithTimeout never throws; a network error comes back as a failed
  // response, so the checker reports the file as not found. Phase 3 of the
  // plan adds an "inconclusive" status for this case.
  it("reports a network error as not found", async () => {
    stubFetch(new Error("boom"));
    const r = await checkApiAgentYaml(BASE);
    expect(r.status).toBe("info");
  });
});
