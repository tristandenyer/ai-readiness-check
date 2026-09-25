import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";


const CONTENT_PATH_HINTS = [
  /^\/blog\//i,
  /^\/work\//i,
  /^\/posts?\//i,
  /^\/articles?\//i,
  /^\/writing\//i,
  /^\/notes?\//i,
  /^\/essays?\//i,
  /^\/docs?\//i,
  /^\/guides?\//i,
  /^\/(20\d\d)\//,
];

const SKIP_EXT = /\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|pdf|zip|xml|json|txt|md|mp3|mp4|webm|avif)$/i;
const SKIP_PATH = /^\/(api|_next|favicon|sitemap|robots|llms|feed|images?|fonts?|static|assets?)\b/i;

function collectCandidates(document, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const seen = new Set();
  const ranked = [];

  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return;
    let abs;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (abs.origin !== origin) return;
    if (!abs.pathname || abs.pathname === "/") return;
    if (SKIP_EXT.test(abs.pathname)) return;
    if (SKIP_PATH.test(abs.pathname)) return;
    abs.hash = "";
    abs.search = "";
    const path = abs.href.replace(/\/$/, "");
    if (seen.has(path)) return;
    seen.add(path);

    const isContent = CONTENT_PATH_HINTS.some((rx) => rx.test(abs.pathname));
    const slugDepth = abs.pathname.split("/").filter(Boolean).length;
    const looksDeep = slugDepth >= 2;
    const score = (isContent ? 100 : 0) + (looksDeep ? 10 : 0) - slugDepth;
    ranked.push({ path, score });
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.path);
}

async function tryMarkdown(testedUrl) {
  const res = await fetchWithTimeout(testedUrl, {
    headers: { accept: "text/markdown,*/*" },
  });
  return {
    testedUrl,
    ok: res.ok,
    status: res.status,
    contentType: res.contentType,
    isMarkdown: res.ok && res.contentType.toLowerCase().includes("text/markdown"),
    error: res.error,
  };
}

export async function checkMdRoute(baseUrl, homepage) {
  const start = performance.now();
  const id = "md-route";
  const name = ".md route pattern";
  const category = "visibility";
  const promptUrl = promptUrlFor("md-routes.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#7-md-versions-of-every-page";

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to find an internal link to test.",
      promptUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  const candidates = [];
  // If the user gave us a specific page (not just the origin), check its .md
  // sibling first — that's the URL they actually care about.
  try {
    const parsed = new URL(baseUrl);
    if (parsed.pathname && parsed.pathname !== "/") {
      const cleaned = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
      candidates.push(cleaned);
    }
  } catch {}
  for (const c of collectCandidates(homepage.document, baseUrl)) {
    if (!candidates.includes(c)) candidates.push(c);
    if (candidates.length >= 5) break;
  }
  if (candidates.length === 0) {
    const origin = (() => { try { return new URL(baseUrl).origin; } catch { return baseUrl; } })();
    candidates.push(`${origin}/index`);
  }

  const attempts = [];
  for (const path of candidates) {
    const result = await tryMarkdown(`${path}.md`);
    attempts.push(result);
    if (result.isMarkdown) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `${result.testedUrl} returns text/markdown.`,
        details: {
          testedUrl: result.testedUrl,
          contentType: result.contentType,
          attemptsTried: attempts.length,
        },
        promptUrl,
        learnMoreUrl,
        durationMs: performance.now() - start,
      };
    }
  }

  // Final fallback: try /index.md at the origin if not already covered
  const indexOrigin = (() => { try { return new URL(baseUrl).origin; } catch { return baseUrl; } })();
  const indexUrl = `${indexOrigin}/index.md`;
  if (!attempts.some((a) => a.testedUrl === indexUrl)) {
    const idx = await tryMarkdown(indexUrl);
    attempts.push(idx);
    if (idx.isMarkdown) {
      return {
        id,
        name,
        category,
        status: "pass",
        summary: `${idx.testedUrl} returns text/markdown.`,
        details: { testedUrl: idx.testedUrl, contentType: idx.contentType, attemptsTried: attempts.length },
        promptUrl,
        learnMoreUrl,
        durationMs: performance.now() - start,
      };
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    id,
    name,
    category,
    status: "fail",
    summary: `Tried ${attempts.length} URL${attempts.length === 1 ? "" : "s"} with .md appended. None returned markdown.`,
    detail: "Markdown sibling files help AI understand your page in a less expensive way vs giving up on it, or giving out low-effort responses.",
    details: {
      attemptsTried: attempts.length,
      lastTested: last?.testedUrl,
      lastStatus: last?.status,
      lastContentType: last?.contentType || null,
      attempts: attempts.map((a) => ({
        url: a.testedUrl,
        status: a.status,
        contentType: a.contentType || null,
      })),
    },
    promptUrl,
    learnMoreUrl,
    durationMs: performance.now() - start,
  };
}
