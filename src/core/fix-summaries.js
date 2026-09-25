/* One-line "what to do" summaries per check ID. Used by the MCP
   server (and any future programmatic consumer) to give an AI agent a
   terse, actionable hint without duplicating the verbose website
   copy. The agent can pair this with the promptUrl to fetch the full
   prompt and apply it.

   Keep each value under 140 characters. Action verb first, target
   second, no marketing. */
export const FIX_SUMMARIES = {
  "robots-txt":
    "Give robots.txt at the site root explicit rules for the AI crawlers you want (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, etc.).",
  "llms-txt":
    "Create or complete llms.txt at the site root per llmstxt.org: H1, blockquote summary, H2 sections linking every important page.",
  "llms-full-txt":
    "Create or complete llms-full.txt at the site root: the full text of each page llms.txt links, with a heading per page.",
  "ai-txt":
    "Add an ai.txt at the site root listing per-bot training/usage permissions in the spawning.ai format.",
  tdmrep:
    "Add a /.well-known/tdmrep.json declaring your TDM (Text and Data Mining) reservations per the W3C TDMRep spec.",
  "agent-card":
    "Add a /.well-known/agent-card.json describing your site's agent capabilities so AI clients can discover what your site offers.",
  "api-agent-yaml":
    "If this domain serves an API, publish a /.well-known/api-agent.yaml (API Field Guide) declaring the operational behavior AI agents need: idempotency, side effects, rate limits, and deprecations.",
  "content-signals":
    "Add Content-Signal directives to robots.txt (e.g. Content-Signal: search=yes, ai-train=no) to declare how AI systems may use your content in the structured vocabulary at contentsignals.org.",
  "api-catalog":
    "If this domain publishes APIs, serve an RFC 9727 linkset document at /.well-known/api-catalog so machine clients and AI agents can discover them.",
  "mcp-json":
    "Add a /.well-known/mcp.json pointing at any MCP servers your site exposes so AI clients can auto-discover them.",
  sitemap:
    "Publish a sitemap.xml at the site root and reference it from robots.txt so crawlers can find every URL.",
  "schema-jsonld":
    "Embed schema.org JSON-LD on each page (Article, BreadcrumbList, FAQPage where relevant) so search and AI tools can parse structure.",
  "ai-meta-tags":
    "To opt out of AI training, add a robots meta tag with noai or noimageai to the page <head>. Optional.",
  "markdown-link":
    "Expose a clean .md version of the page and link to it from <head> via a <link rel=\"alternate\" type=\"text/markdown\"> tag.",
  "ai-hint-div":
    "Add a hidden <div data-ai-hint> with a tight summary AI tools can use as a citation-shaped excerpt.",
  "x-robots-tag":
    "Configure X-Robots-Tag response headers per page so server-side crawl directives are unambiguous.",
  "content-negotiation":
    "Serve text/markdown when an AI client requests it via Accept: text/markdown. Same URL, different representation.",
  "md-route":
    "Expose a parallel /page.md route for every public HTML page so AI tools can fetch markdown directly.",
  "link-header":
    "Send a Link: header on the HTML response advertising the markdown alternate (rel=\"alternate\" type=\"text/markdown\").",
};

export function fixSummaryFor(id) {
  return FIX_SUMMARIES[id] || null;
}
