import fs from "node:fs";

/* Links to the fix-it prompts in awesome-ai-website-files. The two repos
   release in lockstep: package version X.Y.Z links to that repo's tag
   vX.Y.Z, so each version links to the prompt text it was released with.
   The release workflow refuses to publish until the tag exists. */
const { version } = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
export const PROMPTS_REF = `v${version}`;
export const REPO_BASE_URL = "https://github.com/tristandenyer/awesome-ai-website-files";

export const promptUrlFor = (file) => `${REPO_BASE_URL}/blob/${PROMPTS_REF}/prompts/${file}`;

/* The plain-text copy of a prompt link, for AI agents to fetch. */
export const rawPromptUrl = (url) =>
  url?.startsWith(`${REPO_BASE_URL}/blob/`)
    ? url.replace(`${REPO_BASE_URL}/blob/`, "https://raw.githubusercontent.com/tristandenyer/awesome-ai-website-files/")
    : null;

/* Checkers link to articles on the website by path. Outside the website
   (a terminal, a CI log) a path leads nowhere, so it gets the site's origin. */
export const SITE_URL = "https://www.tristandenyer.com";
export const absoluteUrl = (url) => (url?.startsWith("/") ? SITE_URL + url : url);

/* Help links by check id. enrichResult fills these in for every result,
   so a checker that leaves a link off one of its return paths still
   gets it. */
const PROMPT_FILES = {
  "agent-card": "agent-card-json.md",
  "ai-hint-div": "ai-hint-div.md",
  "ai-meta-tags": "ai-meta-tags.md",
  "ai-txt": "ai-txt-spawning.md",
  "api-catalog": "api-catalog.md",
  "content-negotiation": "content-negotiation.md",
  "content-signals": "content-signals.md",
  "llms-full-txt": "llms-full-txt.md",
  "llms-txt": "llms-txt.md",
  "markdown-link": "markdown-discovery.md",
  "mcp-json": "mcp-json.md",
  "md-route": "md-routes.md",
  "robots-txt": "robots-txt.md",
  "schema-jsonld": "schema-jsonld.md",
  tdmrep: "tdmrep-json.md",
};
const ARTICLES = {
  "api-agent-yaml": "/work/api-field-guide-for-ai-agents",
  "link-header": "/work/ai-files-for-websites-2026#8-link-discovery-link-tag-http-link-header-and-content-negotiation",
  "x-robots-tag": "/work/ai-files-for-websites-2026#4-html-meta-tags-and-x-robots-tag-headers-for-ai",
  sitemap: "https://www.sitemaps.org/protocol.html",
};
export const defaultPromptUrl = (id) => (PROMPT_FILES[id] ? promptUrlFor(PROMPT_FILES[id]) : undefined);
export const defaultLearnMoreUrl = (id) => ARTICLES[id];
