/* `ai-readiness-check init`: writes a settings file for the project, and
   on request the agent skill and a GitHub workflow. Never overwrites an
   existing file. */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILE } from "./config.js";

/* Default dev server ports, checked in this order. vite is last because
   other frameworks can list it as a dependency too. */
const DEV_PORTS = [
  ["next", 3000],
  ["nuxt", 3000],
  ["astro", 4321],
  ["gatsby", 8000],
  ["@angular/core", 4200],
  ["react-scripts", 3000],
  ["@11ty/eleventy", 8080],
  ["vite", 5173],
];

/* The local dev server URL: a port set in the dev script, else the
   framework's default port, else 3000. */
export function detectDevUrl(pkg = {}) {
  const script = pkg.scripts?.dev ?? pkg.scripts?.start ?? "";
  const set = script.match(/(?:--port[= ]|-p |PORT=)(\d{2,5})\b/);
  if (set) return `http://localhost:${set[1]}`;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const found = DEV_PORTS.find(([name]) => deps[name]);
  return `http://localhost:${found ? found[1] : 3000}`;
}

const SKILL = fs.readFileSync(new URL("../../skills/ai-readiness/SKILL.md", import.meta.url), "utf8");

/* The skill's steps as an AGENTS.md section, for every agent that reads
   AGENTS.md (Codex, Cursor, GitHub Copilot, and most others). Built from
   SKILL.md so the two never differ: frontmatter and title dropped,
   headings moved down one level. */
const AGENTS_HEADING = "## AI readiness";
const agentsSection = () =>
  `\n${AGENTS_HEADING}\n\n` +
  SKILL.replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^# .*\n+/m, "")
    .replace(/^(#+) /gm, "#$1 ")
    .trim() +
  "\n";

/* Claude Code reads skills from .claude/skills/, not AGENTS.md, so the
   skill is copied there when the project uses Claude Code. */
const usesClaudeCode = () => fs.existsSync(".claude") || fs.existsSync("CLAUDE.md");

const workflow = (version) => `# Checks each preview deployment. Vercel reports finished deployments to
# GitHub; other hosts: replace the trigger and the url.
name: AI readiness
on: deployment_status
jobs:
  check:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: tristandenyer/ai-readiness-check@v${version}
        with:
          url: \${{ github.event.deployment_status.target_url }}
          # For previews behind Vercel Deployment Protection:
          # headers: |
          #   x-vercel-protection-bypass: \${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
`;

export function init({ url, agent, githubAction, version }) {
  const lines = [];
  const create = (file, content) => {
    if (fs.existsSync(file)) return lines.push(`Skipped ${file}: it already exists.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    lines.push(`Created ${file}`);
  };

  const pkg = fs.existsSync("package.json") ? JSON.parse(fs.readFileSync("package.json", "utf8")) : {};
  const target = url ?? detectDevUrl(pkg);
  create(CONFIG_FILE, JSON.stringify({ $schema: "https://unpkg.com/ai-readiness-check/schema.json", target }, null, 2) + "\n");

  if (agent) {
    const current = fs.existsSync("AGENTS.md") ? fs.readFileSync("AGENTS.md", "utf8") : "";
    if (current.includes(AGENTS_HEADING)) lines.push("Skipped AGENTS.md: it already has an AI readiness section.");
    else {
      fs.writeFileSync("AGENTS.md", current ? current.replace(/\n*$/, "\n") + agentsSection() : `# Agent instructions\n${agentsSection()}`);
      lines.push(current ? "Added an AI readiness section to AGENTS.md" : "Created AGENTS.md");
    }
    if (usesClaudeCode()) create(".claude/skills/ai-readiness/SKILL.md", SKILL);
    else lines.push("No .claude/ folder or CLAUDE.md here, so the Claude Code skill wasn't added. AGENTS.md has the same steps.");
  }
  if (githubAction) create(".github/workflows/ai-readiness.yml", workflow(version));

  lines.push("", "Next: start your dev server, then run: npx ai-readiness-check check");
  if (!agent) lines.push("For AI coding agents: npx ai-readiness-check init --agent");
  if (!githubAction) lines.push("To check each deployment on GitHub: npx ai-readiness-check init --github-action");
  return lines.join("\n") + "\n";
}
