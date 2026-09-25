import { parseHtml } from "./html-scan.js";
import { fetchWithTimeout } from "./fetch.js";

export const PAGE_TIMEOUT_MS = 10000;

export async function fetchAndParsePage(pageUrl) {
  /* Longer timeout for the initial homepage fetch than for individual
     checkers (5s default). Every per-page checker depends on this
     response, so a timeout here turns into a "couldn't reach the site"
     for the whole run — worth giving slow hosts (cold WP caches, CDN
     misses) extra breathing room. */
  const res = await fetchWithTimeout(pageUrl, {
    timeoutMs: PAGE_TIMEOUT_MS,
    headers: { accept: "text/html,application/xhtml+xml" },
  });

  if (!res.ok || !res.text) {
    /* Pass headers + a small body sample through so the caller can
       detect bot-protection responses (Cloudflare challenge, Akamai,
       etc.) and surface a more specific error. */
    return {
      reachable: false,
      status: res.status,
      error: res.error || (res.status >= 400 ? `http_${res.status}` : "unknown"),
      headers: res.headers,
      bodySample: typeof res.text === "string" ? res.text.slice(0, 4096) : "",
    };
  }

  const document = parseHtml(res.text);
  const bodyText = document.body.textContent.trim();
  const isLikelyClientRendered = bodyText.length < 200;

  const finalUrl = res.finalUrl || pageUrl;
  let finalOrigin = pageUrl;
  try {
    finalOrigin = new URL(finalUrl).origin;
  } catch {
    finalOrigin = pageUrl;
  }
  let requestedOrigin = pageUrl;
  try {
    requestedOrigin = new URL(pageUrl).origin;
  } catch {}
  const redirected = finalOrigin !== requestedOrigin;

  return {
    reachable: true,
    html: res.text,
    document,
    headers: res.headers,
    isLikelyClientRendered,
    finalUrl,
    finalOrigin,
    redirected,
    ttfbMs: res.ttfbMs ?? null,
  };
}

// Backwards-compat alias — old name was used externally.
export const fetchAndParseHomepage = fetchAndParsePage;

