import { promptUrlFor } from "./links.js";
import { fetchWithTimeout } from "./fetch.js";
import { looksLikeRealFile, buildResponseDetails } from "./file-presence.js";


export async function checkMcpJson(baseUrl) {
  const start = performance.now();
  const id = "mcp-json";
  const name = "mcp.json";
  const category = "agent";
  const specUrl = "https://modelcontextprotocol.io/";
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#13-well-knownmcpjson-mcp-server-manifest";
  const promptUrl = promptUrlFor("mcp-json.md");
  let fetchMs = null;

  const testedUrl = `${baseUrl}/.well-known/mcp.json`;
  try {
    const res = await fetchWithTimeout(testedUrl, { timeoutMs: 10000 });
    fetchMs = res.ttfbMs;

    // Treat true 404s and soft 404s (200 with HTML/SPA shell) as
    // missing. mcp.json is JSON; an HTML response means the server
    // returned its app shell for an unknown path.
    const text = res.text || "";
    const isRealFile =
      res.ok &&
      text.trim() &&
      looksLikeRealFile(text, res.contentType, "json");

    if (!isRealFile) {
      return {
        id,
        name,
        category,
        status: "info",
        summary: "No /.well-known/mcp.json.",
        detail: "Only relevant if your site exposes Model Context Protocol tools.",
        details: buildResponseDetails({ testedUrl, res }),
        specUrl,
        learnMoreUrl,
        promptUrl,
        fetchMs,
        durationMs: performance.now() - start,
      };
    }

    // Parse and surface the structural facts that make this a real
    // mcp.json: server name (or schema_version), tool count, total size.
    const parsed = JSON.parse(text);
    const sizeBytes = text.length;
    const serverName =
      typeof parsed?.name === "string" ? parsed.name : null;
    const schemaVersion =
      typeof parsed?.schema_version === "string" ? parsed.schema_version : null;
    const toolCount = Array.isArray(parsed?.servers)
      ? parsed.servers.reduce(
          (n, s) => n + (Array.isArray(s?.tools) ? s.tools.length : 0),
          0,
        )
      : Array.isArray(parsed?.tools)
      ? parsed.tools.length
      : 0;

    const summaryBits = [];
    if (serverName) summaryBits.push(`"${serverName}"`);
    if (toolCount > 0)
      summaryBits.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
    const summary = summaryBits.length
      ? `Valid mcp.json (${summaryBits.join(", ")}).`
      : "Valid mcp.json (no servers or tools declared).";

    return {
      id,
      name,
      category,
      status: "pass",
      summary,
      details: buildResponseDetails({
        testedUrl,
        res,
        extra: {
          sizeBytes,
          schemaVersion,
          serverName,
          toolCount,
        },
      }),
      specUrl,
      learnMoreUrl,
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
      learnMoreUrl,
      promptUrl,
      fetchMs,
      durationMs: performance.now() - start,
    };
  }
}
