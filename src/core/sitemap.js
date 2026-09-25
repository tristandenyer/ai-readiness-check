import { fetchWithTimeout } from "./fetch.js";
import { buildResponseDetails } from "./file-presence.js";

/* Parse `Sitemap:` directives out of a robots.txt body. RFC 9309 says
   Sitemap lines are absolute URLs, group-independent (they live
   outside any User-agent block), and there can be more than one. We
   return them in source order so the canonical sitemap (whichever the
   site lists first) is tried first. */
function extractSitemapUrls(robotsText) {
  const out = [];
  const lines = robotsText.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^sitemap\s*:\s*(\S+)/i);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function classify(text) {
  if (/<sitemapindex[\s>]/i.test(text)) {
    const sitemapCount = (text.match(/<sitemap[\s>]/gi) || []).length;
    return { kind: "index", sitemapCount };
  }
  if (/<urlset[\s>]/i.test(text)) {
    const urlCount = (text.match(/<url[\s>]/gi) || []).length;
    return { kind: "urlset", urlCount };
  }
  return null;
}

async function fetchAndClassify(url) {
  const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
  if (!res.ok || !res.text?.trim()) {
    return {
      ok: false,
      status: res.status,
      contentType: res.contentType,
      error: res.error,
      ttfbMs: res.ttfbMs,
    };
  }
  const shape = classify(res.text);
  return {
    ok: true,
    shape,
    status: res.status,
    contentType: res.contentType,
    sizeBytes: res.text.length,
    ttfbMs: res.ttfbMs,
  };
}

/* Where the sitemap may be, in the order to try: Sitemap: lines in
   robots.txt (the discovery mechanism crawlers use, so a site with
   /sitemap_index.xml or /en-us/sitemap.xml is found), then /sitemap.xml.
   Sitemaps on the checked origin come first, so a dev server whose
   robots.txt names the production sitemap is checked against its own. */
async function sitemapCandidates(baseUrl) {
  let advertised = [];
  try {
    const robotsRes = await fetchWithTimeout(`${baseUrl}/robots.txt`, { timeoutMs: 10000 });
    if (robotsRes.ok && robotsRes.text) advertised = extractSitemapUrls(robotsRes.text);
  } catch {
    /* robots.txt fetch failures are tolerated; /sitemap.xml is still tried. */
  }
  const origin = new URL(baseUrl).origin;
  const sameOrigin = (u) => {
    try {
      return new URL(u).origin === origin;
    } catch {
      return false;
    }
  };
  const fallback = `${baseUrl}/sitemap.xml`;
  return [...new Set([...advertised.filter(sameOrigin), fallback, ...advertised.filter((u) => !sameOrigin(u))])];
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
const MAX_CHILD_SITEMAPS = 5;
export const MAX_PAGES = 5000;

/* The page URLs in the site's sitemap, or null if it has none. A sitemap
   index is followed into its first few child sitemaps. */
export async function sitemapPageUrls(baseUrl) {
  for (const url of await sitemapCandidates(baseUrl)) {
    const res = await fetchWithTimeout(url, { timeoutMs: 10000 });
    const shape = res.ok && res.text ? classify(res.text) : null;
    if (!shape) continue;
    if (shape.kind === "urlset") return locs(res.text).slice(0, MAX_PAGES);
    const pages = [];
    for (const child of locs(res.text).slice(0, MAX_CHILD_SITEMAPS)) {
      const childRes = await fetchWithTimeout(child, { timeoutMs: 10000 });
      if (childRes.ok && childRes.text && classify(childRes.text)?.kind === "urlset") pages.push(...locs(childRes.text));
    }
    return pages.slice(0, MAX_PAGES);
  }
  return null;
}

/* The sitemap's pages as sorted, unique paths, or null if the site has no
   sitemap. Only the path is kept, so a dev server whose sitemap lists
   production URLs gets its own pages checked. */
export async function sitemapPaths(baseUrl) {
  const urls = await sitemapPageUrls(baseUrl);
  if (!urls) return null;
  const paths = new Set();
  for (const url of urls) {
    try {
      const u = new URL(url);
      if (/^https?:$/.test(u.protocol)) paths.add(u.pathname + u.search);
    } catch {}
  }
  return [...paths].sort();
}

export async function checkSitemap(baseUrl) {
  const start = performance.now();
  const id = "sitemap";
  const name = "sitemap.xml";
  const category = "meta";

  const candidates = await sitemapCandidates(baseUrl);
  const fallback = `${baseUrl}/sitemap.xml`;
  const advertised = candidates.filter((u) => u !== fallback);

  // Step 2: try each candidate, pass on the first one that returns
  // valid XML. Track the first non-default discovery so we can
  // surface "found via robots.txt" in the summary.
  let lastAttempt = null;
  let lastTtfb = null;
  let lastUrl = null;
  for (const url of candidates) {
    let attempt;
    try {
      attempt = await fetchAndClassify(url);
    } catch (err) {
      attempt = { ok: false, error: err?.message || "fetch_threw" };
    }
    lastAttempt = attempt;
    lastTtfb = attempt.ttfbMs ?? lastTtfb;
    lastUrl = url;
    if (!attempt.ok) continue;

    const viaRobots = url !== fallback;
    const testedUrl = url;
    const fakeRes = { status: attempt.status, contentType: attempt.contentType };

    if (!attempt.shape) {
      return {
        id,
        name,
        category,
        status: "warn",
        summary: viaRobots
          ? `Sitemap referenced by robots.txt is malformed.`
          : "sitemap.xml is present but malformed.",
        detail:
          "Missing a <urlset> or <sitemapindex> root element, so crawlers will skip it.",
        details: buildResponseDetails({
          testedUrl,
          res: fakeRes,
          extra: { viaRobots, sizeBytes: attempt.sizeBytes ?? null },
        }),
        fetchMs: lastTtfb,
        durationMs: performance.now() - start,
      };
    }

    if (attempt.shape.kind === "index") {
      const c = attempt.shape.sitemapCount;
      return {
        id,
        name,
        category,
        status: "pass",
        summary: viaRobots
          ? `Valid sitemap index referencing ${c} sitemap${c === 1 ? "" : "s"} (discovered via robots.txt).`
          : `Valid sitemap index referencing ${c} sitemap${c === 1 ? "" : "s"}.`,
        details: buildResponseDetails({
          testedUrl,
          res: fakeRes,
          extra: {
            kind: "index",
            sitemapCount: c,
            viaRobots,
            sizeBytes: attempt.sizeBytes,
          },
        }),
        fetchMs: lastTtfb,
        durationMs: performance.now() - start,
      };
    }

    const c = attempt.shape.urlCount;
    return {
      id,
      name,
      category,
      status: "pass",
      summary: viaRobots
        ? `Valid sitemap with ${c} URL${c === 1 ? "" : "s"} (discovered via robots.txt).`
        : `Valid sitemap with ${c} URL${c === 1 ? "" : "s"}.`,
      details: buildResponseDetails({
        testedUrl,
        res: fakeRes,
        extra: {
          kind: "urlset",
          urlCount: c,
          viaRobots,
          sizeBytes: attempt.sizeBytes,
        },
      }),
      fetchMs: lastTtfb,
      durationMs: performance.now() - start,
    };
  }

  // Nothing worked.
  return {
    id,
    name,
    category,
    status: "warn",
    summary:
      advertised.length > 0
        ? "robots.txt advertises sitemaps but none could be fetched."
        : "No sitemap.xml found and robots.txt has no Sitemap directive.",
    detail:
      "GPTBot started fetching sitemaps in 2026, so this matters for AI discovery now. Add a Sitemap: line to robots.txt or publish /sitemap.xml at the origin root.",
    details: buildResponseDetails({
      testedUrl: lastUrl ?? fallback,
      res: { status: lastAttempt?.status, contentType: lastAttempt?.contentType },
      extra: { advertised, candidatesTried: candidates.length },
    }),
    fetchMs: lastTtfb,
    durationMs: performance.now() - start,
  };
}
