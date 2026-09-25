import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";


const KNOWN_AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "Google-Extended",
  "PerplexityBot",
  "Perplexity-User",
  "CCBot",
  "Applebot-Extended",
  "Bytespider",
  "Meta-ExternalAgent",
  "FacebookBot",
  "Amazonbot",
  "cohere-ai",
  "Diffbot",
  "Omgilibot",
  "ImagesiftBot",
  "YouBot",
  "Timpibot",
];

const SEARCH_BOTS = ["OAI-SearchBot", "PerplexityBot"];

function findUserAgents(text) {
  const found = new Set();
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (!m) continue;
    const agent = m[1].trim();
    for (const bot of KNOWN_AI_BOTS) {
      if (agent.toLowerCase() === bot.toLowerCase()) found.add(bot);
    }
  }
  return [...found];
}

function blocksBot(text, botName) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let inGroup = false;
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const uaMatch = line.match(/^user-agent\s*:\s*(.+)$/i);
    if (uaMatch) {
      inGroup = uaMatch[1].trim().toLowerCase() === botName.toLowerCase();
      continue;
    }
    if (!inGroup) continue;
    const disMatch = line.match(/^disallow\s*:\s*(.*)$/i);
    if (disMatch && disMatch[1].trim() === "/") return true;
  }
  return false;
}

export async function checkRobotsTxt(baseUrl) {
  const start = performance.now();
  const id = "robots-txt";
  const name = "robots.txt";
  const category = "permission";
  const specUrl = "https://www.rfc-editor.org/rfc/rfc9309";
  const promptUrl = promptUrlFor("robots-txt.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#1-robotstxt-updated-for-the-ai-era";
  let fetchMs = null;

  const testedUrl = `${baseUrl}/robots.txt`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Treat both true 404s and soft 404s (200 with HTML/SPA shell) as
    // missing. A robots.txt is defined by having User-agent: lines —
    // anything else served at /robots.txt isn't actually a robots.txt.
    const text = res.text || "";
    const hasUserAgent = /^user-agent\s*:/im.test(text);
    const isRealFile =
      res.ok &&
      text.trim() &&
      looksLikeRealFile(text, res.contentType, "text") &&
      hasUserAgent;

    if (!isRealFile) {
      return {
        id,
        name,
        category,
        status: "fail",
        summary:
          res.status === 404
            ? "No robots.txt found."
            : `Could not fetch robots.txt (${res.error || res.status}).`,
        detail:
          res.status === 404
            ? "AI crawlers have no rules to follow, so they fall back to their own defaults."
            : undefined,
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const aiBotsFound = findUserAgents(text);
    const totalAiBots = aiBotsFound.length;
    const totalUserAgentLines = (text.match(/^user-agent\s*:/gim) || []).length;
    const sitemapLines = (text.match(/^sitemap\s*:/gim) || []).length;
    const baseExtra = {
      sizeBytes: text.length,
      totalUserAgentLines,
      sitemapLines,
      aiBotsFound,
      totalAiBots,
    };

    const blockedSearch = SEARCH_BOTS.filter((b) => blocksBot(text, b));
    if (blockedSearch.length > 0) {
      return {
        id,
        name,
        category,
        status: "warn",
        summary: `robots.txt blocks ${blockedSearch.join(" and ")}.`,
        detail: "These are AI search bots, not training crawlers. Blocking them removes you from AI search results.",
        details: buildResponseDetails({
          testedUrl,
          res,
          extra: { ...baseExtra, blockedSearch },
        }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    if (totalAiBots >= 5) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `Explicit rules for ${totalAiBots} AI bots.`,
        details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    if (totalAiBots >= 1) {
      return {
        id,
        name,
        category,
        status: "warn",
        summary: `Only ${totalAiBots} AI bot${totalAiBots === 1 ? "" : "s"} mentioned.`,
        detail: "Most crawlers will fall back to the default User-agent rule, so unnamed bots get whatever that allows.",
        details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    return {
      id,
      name,
      category,
      status: "fail",
      summary: "robots.txt exists but has no AI bot rules.",
      details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
      specUrl,
      promptUrl,
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  } catch (err) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: `Network error: ${err?.message || "unknown"}`,
      specUrl,
      promptUrl,
      learnMoreUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
