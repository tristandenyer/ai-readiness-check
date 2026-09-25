import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { Readable, pipeline } from "node:stream";
import { assertSafeUrl } from "./url.js";
import { currentRunOptions, recordNetworkError } from "./run-options.js";

/* Requests go through node:http / node:https rather than fetch, because
   their `lookup` option is how the connection gets pinned to an address
   we already checked, with nothing to install. The global fetch has no
   way to do that.

   The request function resolves to a Response-like object (status, ok,
   headers, body as a web ReadableStream). Tests swap in their own
   implementation here and can return a real `new Response(...)`. */
let fetchImpl = nodeRequest;
export function __setFetchImplForTests(fn) {
  fetchImpl = typeof fn === "function" ? fn : nodeRequest;
}

/* Forces the connection to one specific address. assertSafeUrl resolved
   the name and confirmed the address is public; without this, the HTTP
   client would resolve the name again and could get a different answer.
   Node calls lookup with { all: true } when it tries several address
   families, so both callback shapes are handled. */
function pinnedLookup(address) {
  const family = address.includes(":") ? 6 : 4;
  return (_hostname, opts, cb) => {
    const callback = typeof opts === "function" ? opts : cb;
    if (opts?.all) return callback(null, [{ address, family }]);
    return callback(null, address, family);
  };
}

/* Undoes the response's content-encoding. Output is produced only as the
   body is read, and reading stops at MAX_BODY_BYTES, so a small
   compressed body that expands to gigabytes never gets expanded. */
function decoderFor(encoding) {
  switch ((encoding || "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      return null;
  }
}

function toHeaders(raw) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      try {
        headers.append(name, v);
      } catch {
        // A header value Headers refuses (invalid characters) is dropped.
      }
    }
  }
  return headers;
}

function nodeRequest(url, { method = "GET", headers = {}, signal, pinnedAddress } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    /* agent: false opens a fresh connection per request, so no socket is
       reused across checks or hosts. The hostname stays in the URL, so
       HTTPS still verifies the certificate against the name (and sends it
       as SNI) even though the connection goes to a pinned address. */
    const req = client.request(
      target,
      {
        method,
        headers,
        signal,
        agent: false,
        lookup: pinnedAddress ? pinnedLookup(pinnedAddress) : undefined,
      },
      (res) => {
        const decoder = decoderFor(res.headers["content-encoding"]);
        const stream = decoder ? pipeline(res, decoder, () => {}) : res;
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: toHeaders(res.headers),
          body: Readable.toWeb(stream),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/* Tries each verified address in turn, so a host that publishes several
   addresses still works when the first one is down. Every address here
   already passed the public-address check. */
async function fetchPinned(url, options, addresses) {
  if (!addresses || addresses.length === 0) {
    return fetchImpl(url, options);
  }
  let lastError;
  for (const address of addresses) {
    try {
      return await fetchImpl(url, { ...options, pinnedAddress: address });
    } catch (err) {
      lastError = err;
    }
  }
  /* Report why the last attempt failed rather than a flat "nothing
     worked". An expired certificate or a reset connection is what the
     person needs to see; collapsing every case into one message told a
     site with a bad certificate that its server was unreachable. */
  throw lastError ?? new Error("no_address_reachable");
}

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AIReadinessCheck/1.0; +https://www.tristandenyer.com/ai-readiness-check)";

async function discardBody(res) {
  try {
    await res?.body?.cancel();
  } catch {}
}

/* Several checks read the same files (robots.txt, llms.txt, the
   sitemap). Within one run, a GET with the same URL and headers is
   fetched once and the result shared, so the checked site gets fewer
   requests. Outside a run (tests, a checker called directly) nothing is
   cached. */
export function fetchWithTimeout(url, options = {}) {
  const cache = currentRunOptions().fetchCache;
  if (!cache || (options.method && options.method !== "GET") || options.isRetry) return fetchUncached(url, options);
  const key = `${url} ${JSON.stringify(options.headers ?? {})}`;
  if (!cache.has(key)) cache.set(key, fetchUncached(url, options));
  return cache.get(key);
}

async function fetchUncached(url, options = {}) {
  /* A timeout or user agent set for the whole run (see run-options.js)
     replaces the per-checker values, so a caller can give a slow dev
     server more time without editing every checker. */
  const run = currentRunOptions();
  const { method = "GET", headers = {} } = options;
  const timeoutMs = run.timeoutMs || options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const userAgent = run.userAgent || USER_AGENT;

  /* Time-to-first-byte: the request resolves when response headers
     arrive (before the body), so the elapsed time at that point is a
     reasonable TTFB approximation. The body-read loop below is excluded
     from this measurement. */
  const t0 = performance.now();
  let ttfbMs = null;

  try {
    /* Manual redirect handling so each hop gets re-validated against
       the SSRF guard. Without this, a public URL could 302 to
       http://localhost and bypass the guard on the initial URL. */
    let currentUrl = url;
    let res;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const safety = await assertSafeUrl(currentUrl, {
        allowPrivateNetwork: run.allowPrivateNetwork,
      });
      if (!safety.ok) {
        await discardBody(res);
        return failure(currentUrl, `blocked_${safety.reason}`, null);
      }
      const next = await fetchPinned(
        currentUrl,
        {
          method,
          /* Each hop gets the full timeout, and the last hop's timeout
             also covers reading its body. */
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "user-agent": userAgent,
            accept: headers.accept || "*/*",
            "accept-encoding": "gzip, deflate, br",
            // Checked per hop, so a redirect to another site drops them.
            ...(new URL(currentUrl).origin === run.headersOrigin ? run.headers : undefined),
            ...headers,
          },
        },
        safety.addresses,
      );
      /* The previous hop is finished with once we follow the redirect.
         Drop its body so the socket is not held open. */
      await discardBody(res);
      res = next;
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        currentUrl = new URL(res.headers.get("location"), currentUrl).toString();
        continue;
      }
      break;
    }
    ttfbMs = Math.round(performance.now() - t0);

    let text = "";
    let truncated = false;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder("utf-8", { fatal: false });
        let received = 0;
        while (received < MAX_BODY_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          text += decoder.decode(value, { stream: true });
          if (received >= MAX_BODY_BYTES) {
            truncated = true;
            try {
              await reader.cancel();
            } catch {}
            break;
          }
        }
        text += decoder.decode();
      } else if (typeof res.text === "function") {
        text = await res.text();
        if (text.length > MAX_BODY_BYTES) {
          text = text.slice(0, MAX_BODY_BYTES);
          truncated = true;
        }
      }
    } catch {
      text = "";
    }

    const contentType = res.headers.get("content-type") || "";
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      text,
      contentType,
      finalUrl: currentUrl || url,
      ttfbMs,
      // true when the body was longer than MAX_BODY_BYTES and only the
      // start of it was read.
      truncated,
    };
  } catch (err) {
    const error = classifyError(err);
    if (NETWORK_ERRORS.has(error)) {
      /* One retry for a dropped connection or a DNS hiccup, so a single
         network blip doesn't change the result. A timeout isn't retried:
         that would double an already long wait. */
      if (!options.isRetry && error !== "timeout") {
        return fetchUncached(url, { ...options, isRetry: true });
      }
      recordNetworkError(url, error);
    }
    return failure(url, error, ttfbMs);
  }
}

/* Errors that say nothing about the site's content: the file may exist,
   but it couldn't be fetched this time. */
const NETWORK_ERRORS = new Set([
  "timeout",
  "dns_failed",
  "connection_refused",
  "connection_reset",
  "tls_error",
  "no_address_reachable",
]);

function failure(finalUrl, error, ttfbMs) {
  return { ok: false, status: 0, headers: new Headers(), text: "", contentType: "", finalUrl, ttfbMs, error };
}

/* The real cause is sometimes one level down (err.cause), and a timeout
   arrives as an AbortError whose cause is the TimeoutError. These codes
   are what the report turns into a sentence for the person who ran the
   scan. */
function classifyError(err) {
  if (err?.name === "TimeoutError" || err?.cause?.name === "TimeoutError") {
    return "timeout";
  }
  if (err?.message === "no_address_reachable") return "no_address_reachable";
  const code = err?.cause?.code || err?.code;
  switch (code) {
    case "ECONNREFUSED":
      return "connection_refused";
    case "ECONNRESET":
    case "EPIPE":
      return "connection_reset";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns_failed";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_BODY_TIMEOUT":
      return "timeout";
    case "EPROTO":
    case "ERR_TLS_CERT_ALTNAME_INVALID":
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
    case "CERT_HAS_EXPIRED":
      return "tls_error";
    default:
      return code || err?.message || "network_error";
  }
}
