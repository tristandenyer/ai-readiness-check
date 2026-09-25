import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "./helpers/expect.js";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { compareToBaseline, updateBaseline, readBaseline, BASELINE_FILE } from "../src/cli/baseline.js";

const startDir = process.cwd();
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-baseline-"));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(startDir);
  fs.rmSync(dir, { recursive: true, force: true });
});

const report = (score, checks, url = "https://preview-123.example.com/") => ({
  url,
  reachable: true,
  score,
  results: Object.entries(checks).map(([id, status]) => ({ id, status, promptUrl: `https://docs/${id}` })),
});
const opts = { targetName: "default", tolerance: 0, rules: {}, version: "0.1.0" };

describe("updateBaseline", () => {
  it("writes sorted keys with a trailing newline, keyed by page path", () => {
    updateBaseline([report(55, { "sitemap": "pass", "llms-txt": "fail" })], { targetName: "default", version: "0.1.0" });
    const text = fs.readFileSync(BASELINE_FILE, "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.indexOf('"llms-txt"')).toBeLessThan(text.indexOf('"sitemap"'));
    expect(readBaseline().targets.default.pages["/"]).toEqual({ score: 55, checks: { "llms-txt": "fail", sitemap: "pass" } });
  });

  it("refuses to lower the floor unless allowLower is set", () => {
    updateBaseline([report(55, {})], { targetName: "default", version: "0.1.0" });
    const refused = updateBaseline([report(44, {})], { targetName: "default", version: "0.1.0" });
    expect(refused.written).toBe(false);
    expect(readBaseline().targets.default.pages["/"].score).toBe(55);
    updateBaseline([report(44, {})], { targetName: "default", version: "0.1.0", allowLower: true });
    expect(readBaseline().targets.default.pages["/"].score).toBe(44);
  });

  it("keeps the previous status of an inconclusive check", () => {
    updateBaseline([report(55, { "llms-txt": "pass" })], { targetName: "default", version: "0.1.0" });
    updateBaseline([report(60, { "llms-txt": "inconclusive" })], { targetName: "default", version: "0.1.0" });
    expect(readBaseline().targets.default.pages["/"].checks["llms-txt"]).toBe("pass");
  });

  it("keeps separate floors per name", () => {
    updateBaseline([report(55, {})], { targetName: "staging", version: "0.1.0" });
    updateBaseline([report(90, {})], { targetName: "production", version: "0.1.0" });
    expect(Object.keys(readBaseline().targets).sort()).toEqual(["production", "staging"]);
  });
});

describe("compareToBaseline", () => {
  beforeEach(() => updateBaseline([report(55, { "llms-txt": "pass", sitemap: "warn" })], { targetName: "default", version: "0.1.0" }));

  it("reports a missing baseline without failing", () => {
    expect(compareToBaseline([report(10, {})], { ...opts, targetName: "other" })).toEqual({ code: 0, reasons: [], notes: [], missing: true });
  });

  it("fails when the score drops below the floor", () => {
    const r = compareToBaseline([report(50, { "llms-txt": "pass", sitemap: "warn" })], opts);
    expect(r.code).toBe(1);
    expect(r.reasons[0]).toMatch(/score 50 is below the baseline of 55/);
  });

  it("allows a drop within the tolerance", () => {
    expect(compareToBaseline([report(53, { "llms-txt": "pass", sitemap: "warn" })], { ...opts, tolerance: 2 }).code).toBe(0);
  });

  it("fails when one check gets worse, even if the score went up", () => {
    const r = compareToBaseline([report(70, { "llms-txt": "warn", sitemap: "pass" })], opts);
    expect(r.code).toBe(1);
    expect(r.reasons[0]).toMatch(/llms-txt got worse \(pass → warn\)\. How to fix: https:\/\/docs\/llms-txt/);
  });

  it("does not fail on an inconclusive check", () => {
    expect(compareToBaseline([report(55, { "llms-txt": "inconclusive", sitemap: "warn" })], opts).code).toBe(0);
  });

  it("suggests saving a new floor when the score rises", () => {
    const r = compareToBaseline([report(60, { "llms-txt": "pass", sitemap: "pass" })], opts);
    expect(r.code).toBe(0);
    expect(r.notes[0]).toMatch(/score rose 55 → 60/);
  });

  it("matches pages by path, whatever the host", () => {
    expect(compareToBaseline([report(40, { "llms-txt": "pass" }, "http://localhost:3000/")], opts).code).toBe(1);
  });

  it("re-scores the floor after a major version change", () => {
    const r = compareToBaseline([report(55, { "llms-txt": "pass", sitemap: "warn" })], { ...opts, version: "1.0.0" });
    expect(r.notes.some((n) => /scoring changed in v1/.test(n))).toBe(true);
  });
});

/* End to end: a local site whose llms.txt can be switched on, off, or made
   to hang past the timeout. */
describe("ratchet through the CLI", () => {
  let server;
  let base;
  let llms = "ok";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/llms.txt") {
        if (llms === "hang") return; // never answers: the request times out
        if (llms === "ok") {
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("# Test\n\n> A test site.\n\n## Docs\n\n- [Home](/): home\n");
        }
      }
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!doctype html><html><head><title>Test</title></head><body><main>${"Text. ".repeat(50)}</main></body></html>`);
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

  async function run(...argv) {
    let stderr = "";
    const io = { stdout: { isTTY: false, write: () => {} }, stderr: { write: (s) => (stderr += s) } };
    return { code: await main(argv, io), stderr };
  }
  const config = (settings) => fs.writeFileSync("ai-readiness.config.json", JSON.stringify(settings));

  it("saves the floor on the first run, then fails when a check regresses", async () => {
    // Failing checks are set to "warn" so only the ratchet decides the exit code.
    const rules = { "llms-full-txt": "warn", "ai-txt": "warn", tdmrep: "warn", "agent-card": "warn", "mcp-json": "warn",
      "api-agent-yaml": "warn", "content-signals": "warn", "api-catalog": "warn", sitemap: "warn", "schema-jsonld": "warn",
      "ai-meta-tags": "warn", "markdown-link": "warn", "ai-hint-div": "warn", "robots-txt": "warn", "llms-txt": "warn",
      "content-negotiation": "warn", "md-route": "warn", "link-header": "warn", "x-robots-tag": "warn" };
    config({ target: base, ratchet: true, rules });
    llms = "ok";

    const first = await run("check");
    expect(first.code).toBe(0);
    expect(first.stderr).toContain(`Saved the floor to ${BASELINE_FILE}`);
    const floor = readBaseline().targets.default.pages["/"];
    expect(floor.checks["llms-txt"]).not.toBe("fail");

    expect((await run("check")).code).toBe(0);

    llms = "missing";
    const worse = await run("check");
    expect(worse.code).toBe(1);
    expect(worse.stderr).toMatch(/llms-txt got worse \((pass|warn) → fail\)/);

    const refused = await run("baseline");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("--allow-lower");
    expect((await run("baseline", "--allow-lower")).code).toBe(0);
    expect(readBaseline().targets.default.pages["/"].checks["llms-txt"]).toBe("fail");
  }, 60000);

  it("reports a timed-out file as inconclusive and doesn't count it against the floor", async () => {
    config({ target: base, ratchet: true });
    llms = "ok";
    await run("baseline");
    llms = "hang";
    const io = { stdout: { isTTY: false, write: (s) => (io.out += s) }, stderr: { write: (s) => (io.err += s) }, out: "", err: "" };
    await main(["check", "--timeout", "500"], io);
    const check = JSON.parse(io.out).results.find((r) => r.id === "llms-txt");
    expect(check.status).toBe("inconclusive");
    expect(check.summary).toMatch(/Could not fetch .*llms\.txt \(timeout\)/);
    expect(io.err).not.toMatch(/llms-txt got worse/);
  }, 60000);
});
