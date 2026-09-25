/* A local MCP server over stdio: one JSON-RPC 2.0 message per line on
   stdin, one per line on stdout. Written by hand instead of with the MCP
   SDK, which would add about 90 packages. stdout carries only protocol
   messages; anything else goes to stderr.

   Unlike the hosted server, it can check localhost and it applies the
   project's settings (rules, minScore, ratchet). */
import readline from "node:readline";
import { checkPages, prepareUrl } from "../cli/main.js";
import { evaluate } from "../cli/config.js";
import { compareToBaseline } from "../cli/baseline.js";
import { slimReport, reportText } from "./report.js";

// Newest first. A client asking for one of these gets it; otherwise the
// server answers with the newest, as the MCP SDK does.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TOOL_NAME = "run_ai_readiness_check";

const tool = (config) => ({
  name: TOOL_NAME,
  description:
    "Check how ready a website is for AI crawlers, AI search, and AI agents, including a local dev server (http://localhost:3000). " +
    "Returns a grade, a score, and each failing or warning check with fix_summary and fix_raw_url, a plain-text prompt that says how to fix it. " +
    "To fix a check: fetch its fix_raw_url, follow it, then call this tool again to confirm. " +
    "passed says whether the result meets this project's settings (rules, minScore, and the score floor in ai-readiness.baseline.json).",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        maxLength: 500,
        description: config.target
          ? `URL to check. Default: ${config.target} (from the project's settings).`
          : "URL to check, e.g. http://localhost:3000 or https://example.com/about.",
      },
    },
    ...(config.target ? {} : { required: ["url"] }),
    additionalProperties: false,
  },
});

async function callTool(args, { config, options, version }) {
  const url = args?.url ?? config.target;
  if (typeof url !== "string" || !url || url.length > 500) {
    return toolError("Give a url: a string of up to 500 characters.");
  }
  const run = await checkPages(url, ["/"], { ...options, rules: config.rules });
  if (run.error) return toolError(run.error);
  const [report] = run.reports;

  const verdict = evaluate(run.reports, config);
  if (config.ratchet && verdict.code !== 2) {
    // Compare only. Saving the floor is left to the `baseline` command.
    const { name: targetName, tolerance } = config.ratchet;
    const compared = compareToBaseline(run.reports, { targetName, tolerance, rules: config.rules, version });
    verdict.code = Math.max(verdict.code, compared.code);
    verdict.reasons.push(...compared.reasons);
  }
  const slim = slimReport(report, { isPublic: !prepareUrl(url).isLoopback && !options.allowPrivate });
  const structured = { ...slim, passed: verdict.code === 0, reasons: verdict.reasons };
  return {
    content: [{ type: "text", text: reportText(slim, structured) }],
    structuredContent: structured,
  };
}

const toolError = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

/* Handles one parsed message. Returns the response, or null for a
   notification (which gets no response). */
export async function handleMessage(msg, context) {
  const isRequest = msg && typeof msg === "object" && "id" in msg;
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: isRequest ? msg.id : null, error: { code, message } });

  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(-32600, "Invalid Request");
  }
  if (!isRequest) return null; // notifications/initialized, notifications/cancelled, ...

  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "ai-readiness-check", version: context.version },
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: [tool(context.config)] });
    case "tools/call":
      if (msg.params?.name !== TOOL_NAME) return fail(-32602, `Unknown tool: ${msg.params?.name}`);
      try {
        return reply(await callTool(msg.params.arguments, context));
      } catch (e) {
        return reply(toolError(`The check failed: ${e?.message ?? e}`));
      }
    default:
      return fail(-32601, "Method not found");
  }
}

/* Reads messages until stdin closes. Requests are answered as they
   finish, so a slow check doesn't hold up a ping. */
export function startMcpServer(context, { input = process.stdin, output = process.stdout } = {}) {
  const send = (msg) => output.write(JSON.stringify(msg) + "\n");
  const pending = new Set();
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const job = handleMessage(msg, context).then((res) => res && send(res));
    pending.add(job);
    job.finally(() => pending.delete(job));
  });
  return new Promise((resolve) => lines.on("close", () => Promise.all(pending).then(resolve)));
}
