/* The ai-readiness-check command. Returns the exit code:
     0  every check passed
     1  a check, minScore, or the ratchet failed, or robots.txt blocks the checker
     2  the check could not run (bad input or settings, site unreachable, crash) */
import fs from "node:fs";
import { parseArgs } from "node:util";
import { runCheck, PRIVATE_ADDRESS_ERROR } from "../core/run-check.js";
import * as formats from "./formats.js";
import { loadConfig, applyRules, evaluate, ConfigError, CONFIG_FILE } from "./config.js";
import { BASELINE_FILE, compareToBaseline, updateBaseline } from "./baseline.js";

const FORMATS = {
  pretty: formats.formatPretty,
  json: formats.formatJson,
  markdown: formats.formatMarkdown,
  sarif: formats.formatSarif,
  agent: formats.formatAgent,
};

const HELP = `Usage: ai-readiness-check check [url] [options]
       ai-readiness-check baseline [url] [options]
       ai-readiness-check mcp [options]
       ai-readiness-check init [url] [--agent] [--github-action]

check     Checks how ready a website is for AI crawlers, AI search, and AI agents.
baseline  Runs the check and saves the scores to ${BASELINE_FILE} as the
          floor that later runs may not fall below ("ratchet" setting).
mcp       Starts an MCP server on stdin/stdout for AI coding agents. It uses
          this project's settings and can check localhost.
init      Creates ${CONFIG_FILE} with your dev server's URL. --agent also
          adds instructions for AI coding agents to AGENTS.md (and the
          Claude Code skill, if the project uses Claude Code);
          --github-action adds a workflow that checks each deployment.
          Never overwrites files.

The URL can come from "target" in ${CONFIG_FILE} instead.

Options:
  -f, --format <name>  ${Object.keys(FORMATS).join(", ")}
                       (default: pretty in a terminal, json otherwise)
  --pages <paths>      comma-separated paths to check, e.g. /,/blog
  --config <file>      settings file (default: ${CONFIG_FILE}, then
                       the "aiReadiness" key in package.json)
  --allow-private      allow private network addresses such as 10.x and 192.168.x
                       (localhost and 127.0.0.1 are always allowed)
  --timeout <ms>       timeout for each request
  --header <header>    extra request header, e.g. for a protected preview:
                       --header "x-vercel-protection-bypass: $SECRET"
                       Sent only to the site being checked. Repeatable.
  --sarif <file>       also write SARIF to this file (for GitHub code scanning)
  --allow-lower        baseline only: save even if a score went down
  -h, --help           show this help
  -v, --version        show the version

Exit codes: 0 passed, 1 checks failed, 2 the check could not run.

Example: npx ai-readiness-check check http://localhost:3000 --format agent
`;

export const version = () =>
  JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

/* Adds a scheme when there is none: http:// for this machine (dev servers
   rarely use TLS), https:// for everything else. Loopback addresses are
   always allowed, since they are the machine running the check. */
export function prepareUrl(input) {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  const host = input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0].replace(/:\d+$/, "").toLowerCase();
  const isLoopback = host === "localhost" || host === "[::1]" || /^127\./.test(host);
  return { url: hasScheme ? input : `${isLoopback ? "http" : "https"}://${input}`, isLoopback };
}

/* "Name: value" strings to a headers object, or an error message. */
export function parseHeaders(list) {
  const headers = {};
  for (const item of list) {
    const i = item.indexOf(":");
    const name = item.slice(0, i).trim().toLowerCase();
    if (i < 1 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || name === "host") {
      return `--header must look like "Name: value" (and can't set Host). Got: ${item.slice(0, 40)}`;
    }
    headers[name] = item.slice(i + 1).trim();
  }
  return headers;
}

/* The same command with --format agent, for the agent format to print.
   Header values are often secrets, so they are replaced with <hidden>. */
function agentRerunCommand(argv) {
  argv = argv.map((a, i) =>
    /^--header$/.test(argv[i - 1] ?? "") ? `${a.split(":")[0]}: <hidden>`
    : /^--header=/.test(a) ? `${a.split(":")[0]}: <hidden>`
    : a,
  );
  const args = argv.filter((a, i) => !/^(-f|--format)(=|$)/.test(a) && !/^(-f|--format)$/.test(argv[i - 1] ?? ""));
  const quote = (a) => (/^[\w./:=@,[\]-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
  return `npx ai-readiness-check ${args.map(quote).join(" ")} --format agent`;
}

export async function main(argv, io = process) {
  const out = (s) => io.stdout.write(s);
  const err = (s) => io.stderr.write(`${s}\n`);
  const usageError = (msg) => (err(msg), 2);

  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", short: "f" },
        pages: { type: "string" },
        config: { type: "string" },
        "allow-private": { type: "boolean" },
        timeout: { type: "string" },
        header: { type: "string", multiple: true },
        "allow-lower": { type: "boolean" },
        sarif: { type: "string" },
        agent: { type: "boolean" },
        "github-action": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }));
  } catch (e) {
    return usageError(`${e.message}\n\n${HELP}`);
  }

  if (values.version) return out(`${version()}\n`), 0;
  if (values.help || positionals[0] === "help") return out(HELP), 0;
  const [command, targetArg, ...extra] = positionals;
  if (!["check", "baseline", "mcp", "init"].includes(command) || extra.length || (command === "mcp" && targetArg)) {
    return usageError(HELP);
  }
  if (command === "init") {
    const { init } = await import("./init.js");
    return out(init({ url: targetArg && prepareUrl(targetArg).url, agent: values.agent, githubAction: values["github-action"], version: version() })), 0;
  }

  let config;
  try {
    config = loadConfig(values.config);
  } catch (e) {
    if (e instanceof ConfigError) return usageError(e.message);
    throw e;
  }

  const timeoutMs = values.timeout === undefined ? undefined : Number(values.timeout);
  if (timeoutMs !== undefined && !(Number.isInteger(timeoutMs) && timeoutMs >= 100)) {
    return usageError("--timeout must be a whole number of milliseconds, 100 or more.");
  }
  const headers = parseHeaders(values.header ?? []);
  if (typeof headers === "string") return usageError(headers);
  const runOptions = { allowPrivate: values["allow-private"] === true, timeoutMs, headers };

  if (command === "mcp") {
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer({ config, options: runOptions, version: version() }, { input: io.stdin, output: io.stdout });
    return 0;
  }

  const target = targetArg ?? config.target;
  if (!target) return usageError(`No URL given, and no "target" in ${config.source}.\n\n${HELP}`);
  const format = values.format ?? (io.stdout.isTTY ? "pretty" : "json");
  if (!FORMATS[format]) return usageError(`Unknown format "${format}". Use one of: ${Object.keys(FORMATS).join(", ")}.`);
  const pages = values.pages ? values.pages.split(",").map((p) => p.trim()) : config.pages;
  if (!pages.every((p) => p.startsWith("/"))) return usageError('--pages must be paths that start with "/", like /,/blog');

  const run = await checkPages(target, pages, { ...runOptions, rules: config.rules });
  if (run.error) return usageError(run.error);
  const { reports } = run;

  const context = { version: version(), rerunCommand: agentRerunCommand(argv) };
  if (format === "sarif") out(formats.formatSarif(reports, context));
  else if (format === "json") out(formats.formatJson(reports.length === 1 ? reports[0] : reports));
  else if (format === "agent") {
    const found = formats.problemsAcross(reports);
    out(reports.map((r, i) => formats.formatAgent(r, { ...context, found: found[i] })).join("\n"));
  } else out(reports.map((r) => FORMATS[format](r, context)).join("\n"));
  if (values.sarif) fs.writeFileSync(values.sarif, formats.formatSarif(reports, context));

  const result = evaluate(reports, config);
  // `baseline` records the site as it is, so failing checks don't fail it.
  if (command === "baseline" && result.code === 1) Object.assign(result, { code: 0, reasons: [] });
  // A run that couldn't check the site says nothing about the floor.
  if (result.code !== 2 && (command === "baseline" || config.ratchet)) {
    const ratchet = ratchetStep(command, reports, config, { version: context.version, allowLower: values["allow-lower"] });
    result.code = Math.max(result.code, ratchet.code);
    result.reasons.push(...ratchet.reasons);
    for (const note of ratchet.notes) err(note);
  }
  for (const reason of result.reasons) err(reason);
  return result.code;
}

/* Runs the check on each page of `target` and applies the rules.
   Returns { reports }, or { error } when a page couldn't be checked at all.
   Shared by the CLI commands and the MCP server. */
export async function checkPages(target, pages, { rules = {}, allowPrivate = false, timeoutMs, headers } = {}) {
  const { url, isLoopback } = prepareUrl(target);
  let urls;
  try {
    // With only "/", check the URL as given (it may already include a path).
    urls = pages.length === 1 && pages[0] === "/" ? [url] : pages.map((p) => new URL(p, url).href);
  } catch {
    return { error: `"${target}" is not a valid URL.` };
  }
  const options = { allowPrivateNetwork: isLoopback || allowPrivate, timeoutMs, headers };
  const reports = [];
  for (const pageUrl of urls) {
    let result;
    try {
      result = await runCheck(pageUrl, options);
    } catch (e) {
      return { error: `The check crashed on ${pageUrl}: ${e?.message ?? e}` };
    }
    if (!result.ok) {
      const hint = result.body?.error === PRIVATE_ADDRESS_ERROR ? " Add --allow-private to check it." : "";
      return { error: `Could not check ${pageUrl}: ${result.body?.error}.${hint}` };
    }
    reports.push(applyRules(result.body, rules));
  }
  return { reports };
}

/* `baseline` saves the floor. `check` with the ratchet on compares with
   it, and saves it on the first run when there is none yet. */
function ratchetStep(command, reports, config, { version, allowLower }) {
  const { name: targetName, tolerance } = config.ratchet ?? { name: "default", tolerance: 0 };
  if (command === "check") {
    const compared = compareToBaseline(reports, { targetName, tolerance, rules: config.rules, version });
    if (!compared.missing) return compared;
  }
  const saved = updateBaseline(reports, { targetName, version, allowLower });
  if (!saved.written) {
    return {
      code: 1,
      reasons: [`Not saved: the score went down (${saved.lower.join(", ")}). Fix the site, or run again with --allow-lower.`],
      notes: [],
    };
  }
  return { code: 0, reasons: [], notes: [`Saved the floor to ${BASELINE_FILE}. Commit this file.`] };
}
