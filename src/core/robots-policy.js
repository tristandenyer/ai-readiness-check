import { fetchWithTimeout } from "./fetch.js";

const OUR_USER_AGENTS = ["AIReadinessCheck", "AIReadinessCheck/1.0"];

// Parse robots.txt and decide whether OUR User-Agent is allowed to fetch the
// given path. Honors the most-specific matching User-Agent group per RFC 9309
// (a group naming us beats *), and uses the longest-matching path rule within
// that group.
function decide(robotsText, path = "/") {
  const lines = robotsText.split(/\r?\n/);

  // Build groups: array of { agents: string[], rules: [{ allow|disallow, path }] }
  const groups = [];
  let current = null;
  let lastDirectiveWasUserAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;

    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const directive = m[1].toLowerCase();
    const value = m[2].trim();

    if (directive === "user-agent") {
      if (!current || !lastDirectiveWasUserAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      lastDirectiveWasUserAgent = true;
      continue;
    }

    lastDirectiveWasUserAgent = false;
    if (!current) {
      // Directive before any User-Agent: ignore per RFC 9309
      continue;
    }
    if (directive === "allow" || directive === "disallow") {
      current.rules.push({ kind: directive, path: value });
    }
  }

  // Pick the most specific group:
  // 1. A group whose agents include any of OUR_USER_AGENTS
  // 2. A group whose agents include "*"
  // 3. Otherwise: no rules apply, allowed
  const lowerOurs = OUR_USER_AGENTS.map((u) => u.toLowerCase());
  let group = groups.find((g) =>
    g.agents.some((a) => lowerOurs.includes(a.toLowerCase()))
  );
  let matchedAgent = null;
  if (group) {
    matchedAgent = group.agents.find((a) =>
      lowerOurs.includes(a.toLowerCase())
    );
  } else {
    group = groups.find((g) => g.agents.includes("*"));
    if (group) matchedAgent = "*";
  }
  if (!group) return { allowed: true, matchedAgent: null, rule: null };

  // Apply longest-match: find the rule whose path is the longest prefix of `path`.
  // An empty Disallow ("Disallow: ") means allow everything for this group.
  let best = null;
  for (const rule of group.rules) {
    if (rule.path === "" && rule.kind === "disallow") {
      // explicit "allow all"
      if (best === null || rule.path.length >= best.path.length) {
        best = { ...rule, allowAll: true };
      }
      continue;
    }
    if (rule.path && path.startsWith(rule.path)) {
      if (best === null || rule.path.length > best.path.length) {
        best = rule;
      } else if (rule.path.length === best.path.length && rule.kind === "allow") {
        // Tie-breaker: Allow wins over Disallow (RFC 9309)
        best = rule;
      }
    }
  }

  if (!best) return { allowed: true, matchedAgent, rule: null };
  if (best.allowAll) return { allowed: true, matchedAgent, rule: best };
  return {
    allowed: best.kind === "allow",
    matchedAgent,
    rule: best,
  };
}

export async function checkRobotsPolicy(baseUrl) {
  const res = await fetchWithTimeout(`${baseUrl}/robots.txt`);
  if (!res.ok || !res.text) {
    // Missing or unreachable robots.txt = no rules, allowed by RFC 9309 default
    return { allowed: true, robotsTxt: null, matchedAgent: null, rule: null };
  }

  const decision = decide(res.text, "/");
  return { ...decision, robotsTxt: res.text };
}

// Exported for testing
export const __test__ = { decide };
