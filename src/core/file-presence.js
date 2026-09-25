/* Shared helper for origin-scoped file checkers (ai.txt, robots.txt,
   llms.txt, agent-card.json, mcp.json, tdmrep.json, etc.).

   Why this exists: many real-world servers don't return 404 for
   missing files — single-page apps and some CMSes serve their HTML
   shell at any unknown path, returning HTTP 200 with the SPA. A
   checker that just looks at `res.ok` will see "200 OK" and report
   the file exists, when in fact the user is looking at a 99 KB HTML
   page that happens to live at /ai.txt.

   `looksLikeRealFile` returns false when the response is almost
   certainly not the file we asked for. Two signals, either of which
   is enough to reject:

     1. content-type. A plain-text or JSON file shouldn't ship as
        text/html. SPAs and HTML 404 pages will trip this.
     2. HTML body markers. Some servers return text/plain or no
        content-type at all but still send <html> or <!doctype>.
        Cheap signature check catches that.

   Callers can then build a per-file structural validation on top
   (e.g. ai.txt requires User-Agent: lines, robots.txt the same,
   llms.txt requires an H1, *.json must parse) and treat the file
   as not-found when both this helper and the structural check
   agree it's bogus. */

const HTML_MARKERS = /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]/i;

/* Standard "Response details" shape used by every origin-scoped
   checker. Keeps the UI consistent and always answers the question
   "what did the scanner actually fetch and what came back?" — even
   on a fail or info verdict. Caller passes the URL it tried, the
   raw fetch response, and a checker-specific `extra` object with the
   structural metrics that justify the verdict (e.g. `{ kind: "index",
   sitemapCount: 14 }` or `{ aiBotsFound: ["GPTBot", ...] }`). */
export function buildResponseDetails({ testedUrl, res, extra = {} }) {
  return {
    testedUrl,
    status: res?.status ?? null,
    contentType: res?.contentType || null,
    ...extra,
  };
}

export function looksLikeRealFile(text, contentType, expected) {
  if (typeof text !== "string" || text.length === 0) return false;
  const ct = (contentType || "").toLowerCase();

  // Strong negative signal: response is HTML.
  if (ct.includes("text/html")) return false;
  if (HTML_MARKERS.test(text.slice(0, 2048))) return false;

  // Per-format positive signal. We don't fail outright on a
  // missing/wrong content-type — many static hosts mis-serve plain
  // text — but a positive structural match overrides everything.
  if (expected === "json") {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  if (expected === "text") {
    // Anything not-HTML and non-empty passes here. Caller is
    // responsible for the structural check (User-Agent: lines,
    // H1 marker, etc.) since those are format-specific.
    return true;
  }

  // Default: treat as text.
  return true;
}
