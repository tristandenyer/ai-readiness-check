import { describe, it, expect, beforeEach, afterEach } from "./helpers/expect.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { detectDevUrl } from "../src/cli/init.js";
import { loadConfig } from "../src/cli/config.js";

const startDir = process.cwd();
let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "air-init-"));
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(startDir);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run(...argv) {
  let stdout = "";
  const io = { stdout: { isTTY: false, write: (s) => (stdout += s) }, stderr: { write: () => {} } };
  return { code: await main(argv, io), stdout };
}

describe("detectDevUrl", () => {
  it("uses a port set in the dev script first", () => {
    expect(detectDevUrl({ scripts: { dev: "next dev -p 4000" }, dependencies: { next: "15" } })).toBe("http://localhost:4000");
    expect(detectDevUrl({ scripts: { dev: "vite --port=8081" } })).toBe("http://localhost:8081");
  });

  it("falls back to the framework's default port, then 3000", () => {
    expect(detectDevUrl({ devDependencies: { vite: "8" } })).toBe("http://localhost:5173");
    expect(detectDevUrl({ dependencies: { astro: "5", vite: "8" } })).toBe("http://localhost:4321");
    expect(detectDevUrl({})).toBe("http://localhost:3000");
  });
});

describe("ai-readiness-check init", () => {
  it("writes a settings file that loads, with the detected URL", async () => {
    fs.writeFileSync("package.json", JSON.stringify({ devDependencies: { vite: "8" } }));
    const { code, stdout } = await run("init");
    expect(code).toBe(0);
    expect(stdout).toContain("Created ai-readiness.config.json");
    expect(loadConfig().target).toBe("http://localhost:5173");
  });

  it("uses a URL given on the command line", async () => {
    await run("init", "localhost:8080");
    expect(loadConfig().target).toBe("http://localhost:8080");
  });

  it("never overwrites an existing file", async () => {
    fs.writeFileSync("ai-readiness.config.json", '{"minScore": 50}');
    const { stdout } = await run("init");
    expect(stdout).toContain("Skipped ai-readiness.config.json");
    expect(fs.readFileSync("ai-readiness.config.json", "utf8")).toBe('{"minScore": 50}');
  });

  it("--agent puts the full steps in AGENTS.md, once, for any agent", async () => {
    fs.writeFileSync("AGENTS.md", "# Rules\n\nBe careful.");
    const { stdout } = await run("init", "--agent");
    await run("init", "--agent");
    const agents = fs.readFileSync("AGENTS.md", "utf8");
    expect(agents.startsWith("# Rules\n\nBe careful.\n")).toBe(true);
    expect(agents.match(/^## AI readiness$/gm)).toHaveLength(1);
    expect(agents).toContain("### Steps");
    expect(agents).toContain("npx ai-readiness-check check <url> --format agent");
    expect(agents).not.toContain("name: ai-readiness"); // no skill frontmatter
    expect(fs.existsSync(".claude")).toBe(false);
    expect(stdout).toContain("the Claude Code skill wasn't added");
  });

  it("--agent also adds the Claude Code skill when the project uses Claude Code", async () => {
    fs.writeFileSync("CLAUDE.md", "@AGENTS.md\n");
    await run("init", "--agent");
    expect(fs.readFileSync(".claude/skills/ai-readiness/SKILL.md", "utf8")).toMatch(/^---\nname: ai-readiness\n/);
  });

  it("--github-action adds a workflow pinned to this version", async () => {
    await run("init", "--github-action");
    const yml = fs.readFileSync(".github/workflows/ai-readiness.yml", "utf8");
    const { version } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(yml).toContain(`tristandenyer/ai-readiness-check@v${version}`);
    expect(yml).toContain("${{ github.event.deployment_status.target_url }}");
  });
});
