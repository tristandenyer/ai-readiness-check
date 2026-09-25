import { REPO_BASE_URL } from "./links.js";
/* Reachability assessment for the AI Readiness Check.

   This is NOT a 17th file checker. It's a separate dimension that
   answers "if an AI fetcher fetches this URL once, how long will it
   take and is the response cached at the edge?" The verdict and any
   advice are returned as a top-level `reachability` field on the API
   response, alongside (not inside) the main score.

   Inputs come from the existing homepage fetch — no new requests are
   issued. We read TTFB from the fetch instrumentation and parse the
   response headers + a small body sample for platform fingerprints. */

const TTFB_FAST_MS = 800;
const TTFB_SLOW_MS = 1500;
const TTFB_VERY_SLOW_MS = 2500;


/* Detect the hosting platform from response headers + the HTML
   <meta name="generator"> tag. Confidence is "high" when the signal
   is unambiguous (e.g. a vendor-specific header), "medium" when the
   signal is suggestive but not definitive, "low" or null otherwise.
   Only "high" confidence triggers platform-specific advice; lower
   confidences fall back to generic recommendations. */
function detectPlatform(headers, html) {
  const h = (k) =>
    typeof headers?.get === "function" ? headers.get(k) || "" : "";
  const hasHeader = (k) => Boolean(h(k));
  const headerKeys = (() => {
    if (!headers) return [];
    if (typeof headers.keys === "function") return Array.from(headers.keys());
    return [];
  })();
  const has = (predicate) =>
    headerKeys.some((k) => predicate(k.toLowerCase()));
  const generator =
    (html.match(
      /<meta\s+name=["']generator["']\s+content=["']([^"']+)/i,
    ) || [])[1] || "";

  if (
    h("link").includes('rel="https://api.w.org/"') ||
    /WordPress/i.test(generator)
  ) {
    return { platform: "wordpress", platformConfidence: "high" };
  }
  if (hasHeader("x-vercel-id") || /^Vercel/i.test(h("server"))) {
    return { platform: "vercel", platformConfidence: "high" };
  }
  if (hasHeader("x-nf-request-id") || /^Netlify/i.test(h("server"))) {
    return { platform: "netlify", platformConfidence: "high" };
  }
  if (hasHeader("x-shopify-stage") || hasHeader("x-sorting-hat-podid")) {
    return { platform: "shopify", platformConfidence: "high" };
  }
  if (/^Squarespace/i.test(h("server")) || hasHeader("x-contextid")) {
    return { platform: "squarespace", platformConfidence: "high" };
  }
  if (
    hasHeader("x-wix-request-id") ||
    hasHeader("x-wix-renderer-server") ||
    /^Pepyaka/i.test(h("server"))
  ) {
    return { platform: "wix", platformConfidence: "high" };
  }
  if (has((k) => k.startsWith("x-wf-"))) {
    return { platform: "webflow", platformConfidence: "medium" };
  }
  if (hasHeader("x-ghost-cache-status") || /Ghost/i.test(generator)) {
    return { platform: "ghost", platformConfidence: "high" };
  }
  return { platform: null, platformConfidence: "low" };
}

/* Detect which CDN, if any, is in front of the origin. Independent
   of platform detection — a WordPress site can sit behind Cloudflare,
   a Vercel-hosted site uses Vercel's edge by default, etc. */
function detectCdn(headers) {
  const h = (k) =>
    typeof headers?.get === "function" ? headers.get(k) || "" : "";
  const hasHeader = (k) => Boolean(h(k));
  if (hasHeader("cf-ray") || /^cloudflare/i.test(h("server"))) {
    return "cloudflare";
  }
  if (hasHeader("x-vercel-cache") || /^Vercel/i.test(h("server"))) {
    return "vercel";
  }
  if (hasHeader("x-nf-request-id") || /^Netlify/i.test(h("server"))) {
    return "netlify";
  }
  if (
    /akamaighost/i.test(h("server")) ||
    hasHeader("x-akamai-transformed")
  ) {
    return "akamai";
  }
  if (/^CloudFront/i.test(h("server"))) {
    return "cloudfront";
  }
  // Fastly: x-served-by often shows "cache-...-XXX-PHX". Conservative
  // match to avoid grabbing other "x-served-by" usages.
  if (/^cache-[a-z0-9]+-[A-Z]+/.test(h("x-served-by"))) {
    return "fastly";
  }
  return null;
}

/* Map specific cache-state headers to one of three buckets:
   - "hit" — response was served from edge cache
   - "miss" — passed through cache but didn't hit
   - "bypass" — explicitly not cached (Cloudflare DYNAMIC, BYPASS)
   We also look at WP plugin cache headers since those are origin-side
   page caches; a hit there means the origin didn't render fresh. */
function detectCacheState(headers) {
  const h = (k) =>
    typeof headers?.get === "function" ? headers.get(k) || "" : "";
  const cf = h("cf-cache-status").toUpperCase();
  if (["HIT", "STALE", "REVALIDATED", "UPDATING"].includes(cf)) return "hit";
  if (["MISS", "EXPIRED"].includes(cf)) return "miss";
  if (["DYNAMIC", "BYPASS"].includes(cf)) return "bypass";

  const vercel = h("x-vercel-cache").toUpperCase();
  if (["HIT", "STALE", "PRERENDER"].includes(vercel)) return "hit";
  if (vercel === "MISS") return "miss";

  const wpo = h("wpo-cache-status").toLowerCase();
  if (wpo === "cached") return "hit";

  // WP Super Cache, W3 Total Cache, LiteSpeed Cache fingerprints.
  if (/^hit/i.test(h("x-cache-enabled"))) return "hit";
  if (/^hit/i.test(h("x-litespeed-cache"))) return "hit";

  // Fastly: x-cache often "HIT" or "MISS" or "HIT, MISS" (chain).
  const fastly = h("x-cache").toUpperCase();
  if (fastly.startsWith("HIT")) return "hit";
  if (fastly.startsWith("MISS")) return "miss";

  return null;
}

/* Generic guidance returned when we can't fingerprint the platform
   confidently. Two suggestions, two links — keep it short. */
const GENERIC_ADVICE = {
  platformContext: null,
  suggestions: [
    "Put a caching CDN in front of your origin so common files are served from the edge",
    "Cache pages at the application or web-server layer where possible",
  ],
  links: [
    {
      label: "MDN: HTTP caching",
      href: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching",
    },
    {
      label: "Cloudflare's free tier (works in front of any origin)",
      href: "https://www.cloudflare.com/plans/",
    },
  ],
};

/* Platform-specific advice. Only used when platformConfidence === "high".
   Each entry mirrors the GENERIC_ADVICE shape so the frontend renders
   them identically. */
const PLATFORM_ADVICE = {
  wordpress: {
    platformContext: "We detected WordPress.",
    suggestions: [
      "Add a page-caching plugin (WP Rocket, W3 Total Cache, LiteSpeed Cache, or WP-Optimize)",
      "Put a caching CDN in front of your origin (Cloudflare's free tier works on any origin)",
      "Consider a managed WordPress host with built-in page and edge caching",
    ],
    links: [
      {
        label: "WP Rocket: How to fix Time to First Byte",
        href: "https://wp-rocket.me/blog/how-to-fix-time-to-first-byte/",
      },
      {
        label: "Cloudflare Automatic Platform Optimization for WordPress",
        href: "https://developers.cloudflare.com/automatic-platform-optimization/",
      },
      {
        label: "Kinsta: A complete guide to TTFB",
        href: "https://kinsta.com/blog/time-to-first-byte/",
      },
    ],
  },
  shopify: {
    platformContext:
      "We detected Shopify, which already serves your storefront over a global CDN.",
    suggestions: [
      "Audit theme apps and third-party scripts that block first-byte rendering",
      "Reduce image weight and lazy-load below-the-fold media",
      "Avoid heavy server-side liquid logic on your homepage and key landing pages",
    ],
    links: [
      {
        label: "Shopify: Web performance best practices",
        href: "https://shopify.dev/docs/storefronts/themes/best-practices/performance",
      },
    ],
  },
  squarespace: {
    platformContext:
      "We detected Squarespace, which manages caching and CDN for you.",
    suggestions: [
      "Reduce third-party scripts and embedded widgets",
      "Compress and right-size images before uploading",
      "Avoid heavy code injections in the site header",
    ],
    links: [
      {
        label: "Squarespace: Improving site performance",
        href: "https://support.squarespace.com/hc/en-us/articles/207601537",
      },
    ],
  },
  wix: {
    platformContext:
      "We detected Wix, which manages caching and CDN for you.",
    suggestions: [
      "Reduce third-party apps and scripts on key pages",
      "Compress images and avoid auto-playing video on the homepage",
    ],
    links: [
      {
        label: "Wix: Improve your site's performance",
        href: "https://support.wix.com/en/article/site-performance-improving-your-sites-loading-time",
      },
    ],
  },
  webflow: {
    platformContext:
      "We detected Webflow, which serves your site over a global CDN.",
    suggestions: [
      "Audit interactions and third-party scripts that block initial render",
      "Compress images and use responsive variants",
      "Move heavy custom code out of the head where possible",
    ],
    links: [
      {
        label: "Webflow: Site speed and performance",
        href: "https://help.webflow.com/hosting/site-speed-and-performance",
      },
    ],
  },
  ghost: {
    platformContext: "We detected Ghost.",
    suggestions: [
      "Put a caching CDN in front of your Ghost instance",
      "Audit theme code and third-party scripts on your homepage",
    ],
    links: [
      {
        label: "Ghost: Preparing for launch",
        href: "https://ghost.org/help/preparing-for-launch/",
      },
    ],
  },
  vercel: {
    platformContext:
      "We detected Vercel, which serves your site over a global edge network.",
    suggestions: [
      "Use Static or ISR rendering where possible so responses are served from the edge",
      "Move expensive work behind cached API routes or use cache headers on your responses",
    ],
    links: [
      {
        label: "Vercel: Caching responses",
        href: "https://vercel.com/docs/edge-network/caching",
      },
    ],
  },
  netlify: {
    platformContext:
      "We detected Netlify, which serves your site over a global edge network.",
    suggestions: [
      "Use static or pre-rendered output where possible",
      "Cache function/API responses with appropriate headers",
    ],
    links: [
      {
        label: "Netlify: Caching and performance",
        href: "https://docs.netlify.com/platform/caching/",
      },
    ],
  },
};

/* Special-case advice for the case where Cloudflare is in front of
   the origin but the HTML response is being passed through (DYNAMIC /
   BYPASS). This is independent of platform — it's worth pointing out
   regardless of the underlying CMS. */
const CLOUDFLARE_BYPASS_ADVICE = {
  platformContext:
    "We see Cloudflare in front of your site, but the HTML response isn't being served from the cache.",
  suggestions: [
    "Add a Cloudflare Cache Rule to cache your homepage and AI-discoverable files (/llms.txt, /.well-known/agent-card.json, etc.)",
    "If you're on WordPress, consider Cloudflare Automatic Platform Optimization",
  ],
  links: [
    {
      label: "Cloudflare Cache Rules documentation",
      href: "https://developers.cloudflare.com/cache/how-to/cache-rules/",
    },
    {
      label: "Cloudflare APO for WordPress",
      href: "https://developers.cloudflare.com/automatic-platform-optimization/",
    },
  ],
};

function buildSummary({ ttfbMs, cacheState, verdict }) {
  const intro =
    "Time to first byte for the HTML page at this URL, plus edge-cache and CDN signals";
  if (ttfbMs == null) {
    return { lead: `${intro}. We couldn't measure response time on this fetch.` };
  }
  const ttfbStr = ttfbMs >= 1000 ? `${(ttfbMs / 1000).toFixed(1)}s` : `${ttfbMs}ms`;
  if (verdict === "fast") {
    if (cacheState === "hit") {
      return {
        lead: `${intro} was ${ttfbStr} with an edge-cache hit. Fast and likely reachable for AI fetching.`,
      };
    }
    return {
      lead: `${intro} was ${ttfbStr}. Fast enough that AI fetching is unlikely to give up on the page itself.`,
    };
  }
  if (verdict === "slow") {
    return {
      lead: `${intro} was ${ttfbStr}. AI fetching typically operates under short time budgets,`,
      emphasis: "so a moderately slow origin makes it more likely a fetch gives up before reading the page or its linked AI files.",
    };
  }
  // very_slow
  return {
    lead: `${intro} was ${ttfbStr}. Slow responses don't break your AI files (they're still there), but AI fetching typically operates under short time budgets,`,
    emphasis: "so a slow origin makes it more likely a fetch gives up before reading the page or its linked AI files.",
  };
}

function pickAdvice({
  verdict,
  platform,
  platformConfidence,
  cdn,
  cacheState,
}) {
  if (verdict === "fast") return null;

  // Cloudflare is in path but bypass: surface that specifically. It's
  // often more actionable than platform-specific advice.
  if (cdn === "cloudflare" && cacheState === "bypass") {
    return CLOUDFLARE_BYPASS_ADVICE;
  }

  if (platformConfidence === "high" && PLATFORM_ADVICE[platform]) {
    return PLATFORM_ADVICE[platform];
  }

  return GENERIC_ADVICE;
}

/* Main entry point. Takes the result object from fetchAndParsePage()
   and returns the reachability assessment. Returns null when the page
   is unreachable, behind a bot challenge, or otherwise didn't deliver
   a normal response — those cases are surfaced by their own UI cards
   and showing a reachability badge would be misleading. */
export function classifyReachability(page) {
  if (!page || page.reachable !== true) return null;
  const ttfbMs = typeof page.ttfbMs === "number" ? page.ttfbMs : null;
  if (ttfbMs == null) return null;

  const headers = page.headers;
  const html = typeof page.html === "string" ? page.html : "";

  const { platform, platformConfidence } = detectPlatform(headers, html);
  const cdn = detectCdn(headers);
  const cacheState = detectCacheState(headers);

  let verdict;
  if (ttfbMs < TTFB_FAST_MS) {
    verdict = "fast";
  } else if (ttfbMs < TTFB_SLOW_MS && cacheState === "hit") {
    // Cache hit but still moderately slow (e.g. distant PoP) — give
    // the benefit of the doubt; the cache hit is itself a positive signal.
    verdict = "fast";
  } else if (ttfbMs < TTFB_VERY_SLOW_MS) {
    verdict = "slow";
  } else {
    verdict = "very_slow";
  }

  const advice = pickAdvice({
    verdict,
    platform,
    platformConfidence,
    cdn,
    cacheState,
  });

  return {
    verdict,
    ttfbMs,
    cdn,
    cacheState,
    platform,
    platformConfidence,
    summary: buildSummary({ ttfbMs, cacheState, verdict }),
    advice,
  };
}

// Exposed for tests / introspection.
export const REACHABILITY_THRESHOLDS = {
  fastMs: TTFB_FAST_MS,
  slowMs: TTFB_SLOW_MS,
  verySlowMs: TTFB_VERY_SLOW_MS,
};

// Re-export so callers don't have to know the location.
export { REPO_BASE_URL as AWESOME_REPO_URL };
