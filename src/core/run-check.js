import { REPO_BASE_URL, rawPromptUrl, absoluteUrl, defaultPromptUrl, defaultLearnMoreUrl } from "./links.js";
import { normalizeUrl, originOf, MAX_URL_LENGTH } from "./url.js";
import * as checkers from "./index.js";
import { fetchAndParsePage, PAGE_TIMEOUT_MS } from "./html.js";
import { calculateGrade } from "./grade.js";
import { checkRobotsPolicy } from "./robots-policy.js";
import { classifyReachability } from "./reachability.js";
import { fixSummaryFor } from "./fix-summaries.js";
import { withRunOptions, networkErrorFor, currentRunOptions } from "./run-options.js";

/* The readiness-check pipeline: validate the URL, fetch the page, run
   every checker, and grade the results. The CLI, the MCP server, and the
   website's API all call this.

   Returns an HTTP-style envelope so an API route can pass it through:
     - { ok: false, status: 400, body: { error } } on bad input
     - { ok: true, status: 200, body: <report> } otherwise

   Defense-in-depth caps every free-form summary/detail string at 200
   chars before returning, since these strings end up in an LLM
   context window when an MCP server forwards them. */

const MAX_RESULT_STRING = 200;

function capString(s) {
  if (typeof s !== "string") return s;
  if (s.length <= MAX_RESULT_STRING) return s;
  return s.slice(0, MAX_RESULT_STRING - 1) + "…";
}

/* `details` carries values read off the scanned site — agent names,
   Server headers, schema @type strings — nested a couple of levels deep.
   Capping only the top-level summary/detail left those uncapped, so a
   hostile site could inflate the response with megabyte-long header
   values. Caps every leaf string and bounds the fan-out. */
const MAX_DETAILS_ARRAY = 20;
const MAX_DETAILS_KEYS = 30;

/* URL-valued keys get the URL cap, not the 200-char one: buildRequestLog
   reads details.testedUrl and the UI renders it as a link, so truncating
   it would produce a broken href. MAX_URL_LENGTH already bounds it. */
const isUrlKey = (k) => typeof k === "string" && /url$/i.test(k);

function capDeep(v, depth = 0, key = null) {
  if (typeof v === "string") {
    if (isUrlKey(key)) {
      return v.length <= MAX_URL_LENGTH ? v : v.slice(0, MAX_URL_LENGTH);
    }
    return capString(v);
  }
  if (depth >= 4) return null;
  if (Array.isArray(v)) {
    return v.slice(0, MAX_DETAILS_ARRAY).map((x) => capDeep(x, depth + 1, key));
  }
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .slice(0, MAX_DETAILS_KEYS)
        .map(([k, x]) => [k, capDeep(x, depth + 1, k)]),
    );
  }
  return v;
}

/* A check whose file could not be fetched (timeout, DNS failure, dropped
   connection) says nothing about the site, so it is reported as
   inconclusive and left out of the score instead of counting as missing. */
function markInconclusive(r) {
  const url = r.details?.testedUrl;
  const error = networkErrorFor(url);
  if (!error) return r;
  return { ...r, status: "inconclusive", summary: `Could not fetch ${url} (${error}). Not scored; run the check again.` };
}

/* Page-level scored checks look for tags in the HTML the server sends,
   which is all an AI crawler gets: crawlers don't run JavaScript. When
   one fails on a page that has almost no text until JavaScript runs,
   the fail says that is the cause. */
const PAGE_LEVEL_SCORED = new Set(["schema-jsonld", "markdown-link", "md-route"]);
const JS_ONLY_NOTE =
  "This page has almost no text until JavaScript runs, and AI crawlers don't run JavaScript, so they get an empty page. Render the page on the server or prerender it.";

function markJsOnly(r, page) {
  if (!page?.isLikelyClientRendered || r.status !== "fail" || !PAGE_LEVEL_SCORED.has(r.id)) return r;
  return { ...r, detail: r.detail ? `${JS_ONLY_NOTE} ${r.detail}` : JS_ONLY_NOTE };
}

function enrichResult(r) {
  return {
    ...r,
    summary: capString(r.summary),
    detail: capString(r.detail),
    details: r.details === undefined ? undefined : capDeep(r.details),
    fixSummary: fixSummaryFor(r.id),
    promptUrl: r.promptUrl ?? defaultPromptUrl(r.id),
    promptRawUrl: rawPromptUrl(r.promptUrl ?? defaultPromptUrl(r.id)),
    learnMoreUrl: absoluteUrl(r.learnMoreUrl ?? defaultLearnMoreUrl(r.id)),
  };
}

const CHECKER_PATHS = {
  "robots-txt": { scope: "origin", path: "/robots.txt" },
  "llms-txt": { scope: "origin", path: "/llms.txt" },
  "llms-full-txt": { scope: "origin", path: "/llms-full.txt" },
  "ai-txt": { scope: "origin", path: "/ai.txt" },
  tdmrep: { scope: "origin", path: "/.well-known/tdmrep.json" },
  "agent-card": { scope: "origin", path: "/.well-known/agent-card.json" },
  "mcp-json": { scope: "origin", path: "/.well-known/mcp.json" },
  "api-agent-yaml": { scope: "origin", path: "/.well-known/api-agent.yaml" },
  "content-signals": { scope: "origin", path: "/robots.txt" },
  "api-catalog": { scope: "origin", path: "/.well-known/api-catalog" },
  sitemap: { scope: "origin", path: "/sitemap.xml" },
  "schema-jsonld": { scope: "page" },
  "ai-meta-tags": { scope: "page" },
  "markdown-link": { scope: "page" },
  "ai-hint-div": { scope: "page" },
  "x-robots-tag": { scope: "page" },
  "content-negotiation": { scope: "page", note: "Accept: text/markdown" },
  "md-route": { scope: "dynamic" },
  "link-header": { scope: "page" },
};

function inferStatus(result) {
  if (result.details?.status != null) return result.details.status;
  if (result.status === "pass" || result.status === "warn") return 200;
  if (result.status === "info") return null;
  return null;
}

function buildRequestLog({ requestedUrl, pageUrl, originUrl, page, results }) {
  const log = [];
  log.push({
    url: requestedUrl,
    finalUrl: page.finalUrl !== requestedUrl ? page.finalUrl : undefined,
    purpose: "Initial page fetch (used by per-page checks below)",
    status: page.reachable ? 200 : page.status || 0,
    redirected: page.redirected || undefined,
  });
  log.push({
    url: `${originUrl}/robots.txt`,
    purpose: "Checking robots.txt for crawl rules (we honor them)",
    status: 200,
  });
  for (const r of results) {
    const meta = CHECKER_PATHS[r.id];
    if (!meta) continue;
    if (meta.scope === "origin") {
      // Sitemap may have been discovered via a robots.txt Sitemap:
      // directive at a non-default URL. Prefer the actual URL fetched.
      const url = r.details?.testedUrl || `${originUrl}${meta.path}`;
      log.push({
        url,
        purpose: r.id === "sitemap" && r.details?.viaRobots
          ? `${r.name} (discovered via robots.txt)`
          : r.name,
        status: inferStatus(r),
      });
    } else if (meta.scope === "page") {
      if (r.id === "content-negotiation") {
        log.push({
          url: pageUrl,
          purpose: `${r.name} (Accept: text/markdown)`,
          status: inferStatus(r),
        });
      } else if (r.id === "x-robots-tag" || r.id === "link-header") {
        log.push({
          url: pageUrl,
          purpose: `${r.name} (header on initial fetch)`,
          status: 200,
          reused: true,
        });
      } else {
        log.push({
          url: pageUrl,
          purpose: `${r.name} (parsed from initial fetch)`,
          status: 200,
          reused: true,
        });
      }
    } else if (meta.scope === "dynamic") {
      const tested =
        r.details?.testedUrl || r.details?.attempts?.[0]?.testedUrl;
      if (tested) {
        log.push({
          url: tested,
          purpose: r.name,
          status: inferStatus(r),
        });
      }
    }
  }
  return log;
}

const MANUAL_FALLBACK_LINKS = [
  {
    label:
      "The Complete List of AI Files Your Website Needs in 2026 with AI Prompts",
    href: "/work/ai-files-for-websites-2026",
    kind: "post",
  },
  {
    label: "awesome-ai-website-files (GitHub repo)",
    href: REPO_BASE_URL,
    kind: "repo",
  },
];

function unreachableReport({ requestedUrl, page, start }) {
  const headers = page.headers;
  const cfMitigated = headers?.get?.("cf-mitigated") || "";
  const serverHeader = (headers?.get?.("server") || "").toLowerCase();
  const bodySample = page.bodySample || "";
  const setCookie = headers?.get?.("set-cookie") || "";
  const serverTiming = headers?.get?.("server-timing") || "";
  const headerKeys = (() => {
    try {
      return Array.from(headers?.keys?.() || []).map((k) => k.toLowerCase());
    } catch {
      return [];
    }
  })();
  const hasHeader = (k) => headerKeys.includes(k.toLowerCase());

  const looksLikeCloudflareChallenge =
    cfMitigated.toLowerCase().includes("challenge") ||
    (serverHeader === "cloudflare" &&
      (page.status === 403 || page.status === 503 || page.status === 1020) &&
      /just a moment|enable javascript and cookies|cdn-cgi\/challenge-platform/i.test(
        bodySample,
      ));
  const looksLikeAkamai =
    /akamaighost|akamainetstorage/.test(serverHeader) ||
    hasHeader("akamai-grn") ||
    /AKA_A2=/.test(setCookie) ||
    /\bak_p\b/.test(serverTiming) ||
    /access denied|reference\s*#|akamai-bot/i.test(bodySample);
  const looksLikeImperva =
    hasHeader("x-iinfo") ||
    hasHeader("x-cdn") ||
    /incap_ses|visid_incap/i.test(headers?.get?.("set-cookie") || "") ||
    /incapsula|imperva/i.test(bodySample);
  const looksLikeSucuri =
    /sucuri/i.test(serverHeader) || /sucuri/i.test(bodySample);
  const looksLikeAwsWaf =
    hasHeader("x-amzn-requestid") &&
    page.status === 403 &&
    bodySample.length < 2048;
  const looksLikeF5 =
    /bigip|big-ip/i.test(serverHeader) ||
    /TS[0-9a-f]{8,}/.test(headers?.get?.("set-cookie") || "");
  const looksLikeGenericBotBlock =
    page.status === 403 && bodySample.length < 8192;

  let reason;
  let reachableError = page.error || null;
  let manualLinks = null;

  if (looksLikeCloudflareChallenge) {
    reason =
      'This site is behind a Cloudflare bot challenge (the "Just a moment..." interstitial). Automated tools, including this one, can\'t pass it. You can still check the site manually using the resources below.';
    reachableError = "cloudflare_challenge";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (looksLikeAkamai) {
    reason =
      "This site appears to be behind Akamai's bot protection, which is blocking automated requests. You can still check the site manually using the resources below.";
    reachableError = "akamai_block";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (looksLikeImperva) {
    reason =
      "This site appears to be behind Imperva (Incapsula) bot protection, which is blocking automated requests. You can still check the site manually using the resources below.";
    reachableError = "imperva_block";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (looksLikeSucuri) {
    reason =
      "This site appears to be behind Sucuri's firewall, which is blocking automated requests. You can still check the site manually using the resources below.";
    reachableError = "sucuri_block";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (looksLikeF5) {
    reason =
      "This site appears to be behind an F5 BIG-IP application firewall, which is blocking automated requests. You can still check the site manually using the resources below.";
    reachableError = "f5_block";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (looksLikeAwsWaf) {
    reason =
      "This site appears to be behind AWS WAF, which is blocking automated requests. You can still check the site manually using the resources below.";
    reachableError = "aws_waf_block";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (looksLikeGenericBotBlock) {
    reason =
      "The site returned 403, most likely from a bot-protection service (Akamai, Imperva, F5, AWS WAF, Cloudflare Enterprise, or similar) blocking automated fetches. The site may load fine in a browser even though this tool can't reach it. There's no fix on our end. You can still check the site manually using the resources below.";
    reachableError = "generic_bot_block";
    manualLinks = MANUAL_FALLBACK_LINKS;
  } else if (page.error === "blocked_resolves_to_private") {
    reason =
      "This domain resolves to a private or internal address (something like 10.x.x.x, 192.168.x.x, or a loopback address), so we stopped before connecting. We only scan sites that are reachable on the public internet. If the domain is meant to be public, its DNS records are pointing somewhere internal.";
  } else if (page.error === "blocked_private_host") {
    reason =
      "That address is a private or internal one, so we stopped before connecting. We only scan sites reachable on the public internet.";
  } else if (page.error === "blocked_blocked_port") {
    reason =
      "That port is not one we connect to. We only scan ordinary web ports, not mail, database, or administration ports.";
  } else if (page.error === "blocked_userinfo_present") {
    reason =
      "The URL contains a username or password. Remove the part before the @ sign and try again.";
  } else if (page.error?.startsWith("blocked_")) {
    reason =
      "We stopped before connecting because the URL did not pass our safety checks. Check that it is an ordinary public http:// or https:// address.";
  } else if (page.error === "no_address_reachable") {
    reason =
      "The domain resolves, but we couldn't open a connection to any of the addresses it points to. The server is likely down or blocking us at the network level.";
  } else if (page.error === "dns_failed") {
    reason =
      "We couldn't look up this domain. Check the spelling, and make sure the domain has public DNS records.";
  } else if (page.error === "connection_refused") {
    reason =
      "The server refused the connection. We tried every address this domain points to and nothing accepted a request. The site is likely down, or a firewall is rejecting us.";
  } else if (page.error === "connection_reset") {
    reason =
      "The server closed the connection before responding. This is often a firewall or bot-protection service dropping automated requests.";
  } else if (page.error === "tls_error") {
    reason =
      "We couldn't establish a secure connection. The site's HTTPS certificate is expired, self-signed, or issued for a different domain. Browsers would show a warning here too.";
  } else if (page.status === 404) {
    reason = "The page returned 404. Make sure the URL is correct.";
  } else if (page.status >= 500) {
    reason = `The site returned ${page.status}. Try again later. It may be down right now.`;
  } else if (page.status === 403) {
    reason =
      "The site returned 403. This is often a bot-protection service blocking automated fetches, but it can also be the site explicitly denying access to certain URLs.";
  } else if (page.status >= 400) {
    reason = `The site returned ${page.status} when we tried to load the page.`;
  } else if (page.error === "timeout") {
    const seconds = (currentRunOptions().timeoutMs || PAGE_TIMEOUT_MS) / 1000;
    reason = `The site took too long to respond (over ${seconds} second${seconds === 1 ? "" : "s"}). Try again later.`;
  } else {
    reason =
      "We couldn't reach the site. The domain may not exist, or the server may be blocking our requests.";
  }

  return {
    url: requestedUrl,
    checkedAt: new Date().toISOString(),
    totalDurationMs: Math.round(performance.now() - start),
    reachable: false,
    reachableStatus: page.status || 0,
    reachableError,
    reason,
    manualLinks,
    requestLog: [
      {
        url: requestedUrl,
        purpose: "Initial page fetch",
        status: page.status || 0,
      },
    ],
    results: [],
  };
}

/* Domain denylist, passed in by the caller (a hosted service reads it
   from its own configuration). A denied hostname — exact match or any subdomain — short-circuits
   before a single request is made and returns the same neutral 400
   shape as input validation. */
function isDeniedHost(url, denylist) {
  const list = (Array.isArray(denylist) ? denylist : [])
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

/* Options:
   - denylist: domains that must never be checked (subdomains included).
   - allowPrivateNetwork: allow loopback and local-network addresses, for
     checking a dev server. Off by default. The website and the hosted MCP
     server never set it.
   - timeoutMs, userAgent: override the per-request defaults for this run.
   - headers: extra request headers, e.g. a preview deployment's bypass
     secret. Sent only to the checked URL's own origin, never to another
     site a redirect or a link leads to. */
export const PRIVATE_ADDRESS_ERROR = "It is a private network address";

export async function runCheck(rawUrl, options = {}) {
  const { denylist = [], allowPrivateNetwork = false, timeoutMs, userAgent, headers } =
    options;
  if (typeof rawUrl !== "string") {
    return { ok: false, status: 400, body: { error: "Invalid URL" } };
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      status: 400,
      body: { error: `URL is too long (max ${MAX_URL_LENGTH} characters).` },
    };
  }
  const requestedUrl = normalizeUrl(rawUrl, { allowPrivateNetwork });
  if (!requestedUrl) {
    const isPrivate = !allowPrivateNetwork && normalizeUrl(rawUrl, { allowPrivateNetwork: true });
    return { ok: false, status: 400, body: { error: isPrivate ? PRIVATE_ADDRESS_ERROR : "Invalid URL" } };
  }
  if (isDeniedHost(requestedUrl, denylist)) {
    return {
      ok: false,
      status: 400,
      body: { error: "This URL can't be checked." },
    };
  }
  const headersOrigin = new URL(requestedUrl).origin;
  return withRunOptions({ allowPrivateNetwork, timeoutMs, userAgent, headers, headersOrigin }, () =>
    runPipeline(requestedUrl),
  );
}

async function runPipeline(requestedUrl) {
  const requestedOrigin = originOf(requestedUrl);

  const start = performance.now();
  const page = await fetchAndParsePage(requestedUrl).catch(() => ({
    reachable: false,
    error: "fetch_threw",
  }));

  if (!page.reachable) {
    return {
      ok: true,
      status: 200,
      body: unreachableReport({ requestedUrl, page, start }),
    };
  }

  const pageUrl = page.finalUrl || requestedUrl;
  const originUrl = page.finalOrigin || requestedOrigin;

  const policy = await checkRobotsPolicy(originUrl).catch(() => ({
    allowed: true,
    robotsTxt: null,
    matchedAgent: null,
    rule: null,
  }));

  if (!policy.allowed) {
    const ruleDesc = policy.rule
      ? `Disallow: ${policy.rule.path || "/"}`
      : "Disallow: /";
    const agentDesc =
      policy.matchedAgent === "*"
        ? "the wildcard User-agent (*)"
        : `User-agent ${policy.matchedAgent}`;
    return {
      ok: true,
      status: 200,
      body: {
        url: pageUrl,
        origin: originUrl,
        requestedUrl,
        redirected: page.redirected || false,
        checkedAt: new Date().toISOString(),
        totalDurationMs: Math.round(performance.now() - start),
        reachable: true,
        blockedByRobots: true,
        blockedReason: `${originUrl}/robots.txt blocks our crawler under ${agentDesc} (${ruleDesc}). We're respecting that and not running the rest of the checks.`,
        blockedDetails: {
          matchedAgent: policy.matchedAgent,
          rule: policy.rule,
        },
        requestLog: [
          {
            url: requestedUrl,
            purpose: "Initial page fetch",
            status: 200,
          },
          {
            url: `${originUrl}/robots.txt`,
            purpose: "Checking robots.txt for crawl rules (we honor them)",
            status: 200,
          },
        ],
        results: [],
      },
    };
  }

  const settled = await Promise.allSettled([
    checkers.checkRobotsTxt(originUrl, page),
    checkers.checkLlmsTxt(originUrl, page),
    checkers.checkLlmsFullTxt(originUrl, page),
    checkers.checkAiTxt(originUrl, page),
    checkers.checkTdmrep(originUrl, page),
    checkers.checkAgentCard(originUrl, page),
    checkers.checkMcpJson(originUrl, page),
    checkers.checkApiAgentYaml(originUrl, page),
    checkers.checkContentSignals(originUrl, page),
    checkers.checkApiCatalog(originUrl, page),
    checkers.checkSitemap(originUrl, page),
    checkers.checkSchemaJsonld(pageUrl, page),
    checkers.checkAiMetaTags(pageUrl, page),
    checkers.checkMarkdownLink(pageUrl, page),
    checkers.checkAiHintDiv(pageUrl, page),
    checkers.checkXRobotsTag(pageUrl, page),
    checkers.checkContentNegotiation(pageUrl, page),
    checkers.checkMdRoute(pageUrl, page),
    checkers.checkLinkHeader(pageUrl, page),
  ]);

  const results = settled
    .filter((r) => r.status === "fulfilled")
    .map((r) => enrichResult(markJsOnly(markInconclusive(r.value), page)));

  const requestLog = buildRequestLog({
    requestedUrl,
    pageUrl,
    originUrl,
    page,
    results,
  });

  const summary = calculateGrade(results);
  const reachability = classifyReachability(page);

  return {
    ok: true,
    status: 200,
    body: {
      url: pageUrl,
      origin: originUrl,
      requestedUrl,
      redirected: page.redirected || false,
      checkedAt: new Date().toISOString(),
      totalDurationMs: Math.round(performance.now() - start),
      reachable: true,
      grade: summary.grade,
      score: summary.score,
      earned: summary.earned,
      possible: summary.possible,
      summary: {
        passing: summary.passing,
        warnings: summary.warnings,
        failing: summary.failing,
        info: summary.info,
        inconclusive: summary.inconclusive,
      },
      reachability,
      requestLog,
      results,
    },
  };
}
