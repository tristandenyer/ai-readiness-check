import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";

/* Content Signals Policy (contentsignals.org, Cloudflare-backed) —
   `Content-Signal:` directives inside robots.txt that declare how
   fetched content may be used (e.g. search=yes, ai-train=no,
   ai-input=yes). Distinct from ad-hoc AI-bot Disallow rules: this is
   a structured usage-preference vocabulary aligned with the IETF
   AIPREF working group's direction. Cloudflare Radar measured ~4%
   adoption among top domains (April 2026), so absence is info, not a
   deduction. Unscored while AIPREF standardization is pending. */
export async function checkContentSignals(baseUrl) {
  const start = performance.now();
  const id = "content-signals";
  const name = "Content Signals";
  const category = "permission";
  const specUrl = "https://contentsignals.org/";
  const promptUrl =
    promptUrlFor("content-signals.md");
  let fetchMs = null;

  const testedUrl = `${baseUrl}/robots.txt`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    const text = res.text || "";
    const isRealFile =
      res.ok && text.trim() && looksLikeRealFile(text, res.contentType, "text");

    const signalLines = isRealFile
      ? text.match(/^\s*content-signal\s*:\s*(.+)$/gim) || []
      : [];

    if (signalLines.length === 0) {
      return {
        id,
        name,
        category,
        status: "info",
        summary: "No Content-Signal directives in robots.txt.",
        detail:
          "Content Signals declare how AI systems may use your content (search, ai-input, ai-train) in a structured vocabulary aligned with the IETF AIPREF effort. Adoption is ~4% of top domains, so this is informational only.",
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    const signals = signalLines
      .map((line) => line.replace(/^\s*content-signal\s*:\s*/i, "").trim())
      .filter(Boolean);

    return {
      id,
      name,
      category,
      status: "pass",
      summary: `robots.txt declares ${signalLines.length} Content-Signal directive${signalLines.length === 1 ? "" : "s"}.`,
      detail: "Not scored while the IETF AIPREF standardization is pending.",
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: { signalCount: signalLines.length, signals: signals.slice(0, 5) },
      }),
      specUrl,
      promptUrl,
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
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
