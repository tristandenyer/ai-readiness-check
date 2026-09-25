import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";
import { llmsLinks, sitePagePath, siteHostsFor } from "./llms-links.js";
import { sitemapPageUrls, MAX_PAGES as MAX_SITEMAP_PAGES } from "./sitemap.js";

/* llms.txt is a curated list, not a full index: a site with up to this
   many pages in its sitemap should link all of them; a larger one at
   least this many. */
const EXPECTED_LINKS_CAP = 20;
const MAX_LISTED = 10;


// Same signals as ai-hint-div.js. Kept in sync deliberately — when the
// root-level llms.txt is missing AND a hint div advertises a per-page
// convention, we want the failure copy to point that out instead of
// just "could not fetch".
const AI_KEYWORDS = /\b(ai|machine|bot|agent|llm|crawler)\b/i;
const PER_PAGE_HINT = /\/llms\.txt|\/llms-full\.txt|append.*\.md|\.md\b/i;

function detectPerPageHint(homepage) {
  if (!homepage || homepage.isLikelyClientRendered || !homepage.document) {
    return false;
  }
  const hidden = homepage.document.querySelectorAll('[aria-hidden="true"]');
  for (const el of hidden) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    if (AI_KEYWORDS.test(text) && PER_PAGE_HINT.test(text)) return true;
  }
  return false;
}

export async function checkLlmsTxt(baseUrl, homepage) {
  const start = performance.now();
  const id = "llms-txt";
  const name = "llms.txt";
  const category = "visibility";
  const specUrl = "https://llmstxt.org/";
  const promptUrl = promptUrlFor("llms-txt.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#5-llmstxt";
  let fetchMs = null;

  const testedUrl = `${baseUrl}/llms.txt`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Treat true 404s and soft 404s (200 with HTML/SPA shell) as
    // missing. llms.txt is markdown; an HTML response served at this
    // path means the server is returning the SPA shell for unknown
    // paths, not an actual llms.txt.
    const text = res.text || "";
    const isRealFile =
      res.ok &&
      text.trim() &&
      looksLikeRealFile(text, res.contentType, "text");

    if (!isRealFile) {
      const hasPerPageHint = detectPerPageHint(homepage);
      const isSoft404 = res.ok && res.status !== 404;

      let summary;
      let detail;
      if (res.status === 404) {
        summary = "No llms.txt found.";
        detail = "Without it, AI tools can't get a curated index of your content.";
      } else if (isSoft404 && hasPerPageHint) {
        summary = "No root-level llms.txt — site uses a per-page convention.";
        detail =
          "The server returned the SPA shell instead of a markdown file. An AI hint div on this site advertises per-page /llms.txt or .md indexes, which is a different (non-spec) convention.";
      } else if (isSoft404) {
        summary = "No llms.txt — server returned the SPA shell at /llms.txt.";
        detail =
          "The request returned 200, but the body was HTML, not a markdown index. The llmstxt.org spec requires a markdown file at the host root.";
      } else {
        summary = `Could not fetch llms.txt (${res.error || res.status}).`;
      }

      return {
        id,
        name,
        category,
        status: "fail",
        summary,
        detail,
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        promptUrl,
        learnMoreUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const lines = text.split(/\r?\n/);
    const sizeBytes = new TextEncoder().encode(text).length;

    const h1Match = lines.find((l) => /^#\s+\S/.test(l));
    const h1Title = h1Match ? h1Match.replace(/^#\s+/, "").trim().slice(0, 80) : null;
    const hasH1 = !!h1Match;
    const hasBlockquote = lines.some((l) => /^>\s+\S/.test(l));
    const sectionCount = lines.filter((l) => /^##\s+\S/.test(l)).length;
    const linkCount = llmsLinks(text).length;

    // Compare the pages llms.txt links to with the pages in the sitemap.
    const sitemapUrls = (await sitemapPageUrls(baseUrl).catch(() => null)) ?? [];
    const siteHosts = siteHostsFor(baseUrl, sitemapUrls);
    const pathOf = (u) => sitePagePath(u, baseUrl, siteHosts);
    const linked = new Set(llmsLinks(text).map((l) => pathOf(l.url)).filter(Boolean));
    // The home page isn't expected: llms.txt stands in for it.
    const sitemapPages = [...new Set(sitemapUrls.map(pathOf).filter((p) => p && p !== "/"))];
    const notLinked = sitemapPages.filter((p) => !linked.has(p));
    const covered = sitemapPages.length - notLinked.length;
    const isLarge = sitemapPages.length > EXPECTED_LINKS_CAP;
    const pageCount = sitemapUrls.length >= MAX_SITEMAP_PAGES ? `${MAX_SITEMAP_PAGES} or more` : String(sitemapPages.length);
    // A small site should link every page. A large one should link at
    // least EXPECTED_LINKS_CAP of its own pages, wherever they are listed.
    const coverageShort = isLarge ? linked.size < EXPECTED_LINKS_CAP : notLinked.length > 0;

    const baseExtra = {
      sizeBytes,
      h1Title,
      sectionCount,
      linkCount,
      sitePageLinks: linked.size,
      sitemapPages: sitemapPages.length,
      hasBlockquote,
    };

    if (!hasH1) {
      return {
        id,
        name,
        category,
        status: "fail",
        summary: "llms.txt is present but has no H1 heading.",
        detail: "An H1 is required by the llmstxt.org spec, so this file is invalid as written.",
        details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
        specUrl,
        promptUrl,
        learnMoreUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const missing = [];
    if (!hasBlockquote) missing.push("a blockquote summary");
    if (sectionCount < 1) missing.push("H2 sections");
    if (linked.size < 1) missing.push("a link to at least one page on this site");
    if (coverageShort) {
      const more = notLinked.length > MAX_LISTED ? ` and ${notLinked.length - MAX_LISTED} more` : "";
      missing.push(
        isLarge
          ? `links to at least ${EXPECTED_LINKS_CAP} of this site's ${pageCount} pages (it links ${linked.size}), choosing the most important`
          : `links to these pages in sitemap.xml: ${notLinked.slice(0, MAX_LISTED).join(", ")}${more}`,
      );
    }
    const coverage = !sitemapPages.length
      ? ""
      : isLarge
        ? ` It links ${linked.size} of this site's pages; sitemap.xml lists ${pageCount}.`
        : ` It links ${covered} of the ${pageCount} pages in sitemap.xml, not counting the home page.`;

    if (missing.length === 0) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `Valid llms.txt with ${sectionCount} section${sectionCount === 1 ? "" : "s"} and ${linkCount} link${linkCount === 1 ? "" : "s"}.${coverage}`,
        details: buildResponseDetails({ testedUrl, res, extra: baseExtra }),
        specUrl,
        promptUrl,
        learnMoreUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    return {
      id,
      name,
      category,
      status: "warn",
      summary: coverageShort && missing.length === 1 ? `llms.txt is missing pages.${coverage}` : "llms.txt is incomplete.",
      detail: `Missing: ${missing.join("; ")}.`,
      details: buildResponseDetails({ testedUrl, res, extra: { ...baseExtra, missing } }),
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
