const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  // CGNAT (RFC 6598). Some cloud metadata services live in this range
  // and corporate networks use it for internal NAT pools. Adding so an
  // attacker can't reach those via redirect-to-100.64.x.x.
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
  // IPv6: URL.hostname keeps the surrounding brackets, e.g. "[::1]" or "[fe80::1]".
  /^::1$/,
  /^::$/,
  // fc00::/7 spans fc00–fdff. Matching only "fc" would miss fd00::/8, which
  // is the half of the range real networks actually use.
  /^f[cd][0-9a-f]{2}:/i,
  /^fe[89ab][0-9a-f]:/i,
];

/* Ports that never serve public web content and are common SSRF
   targets (databases, cache servers, mail, SSH, etc.). Blocked
   regardless of the destination IP — even if a public host is at
   one of these ports, we have no business fetching it. */
const BLOCKED_PORTS = new Set([
  "22",    // SSH
  "23",    // Telnet
  "25",    // SMTP
  "110",   // POP3
  "143",   // IMAP
  "445",   // SMB
  "1433",  // MSSQL
  "1521",  // Oracle
  "2049",  // NFS
  "2375",  // Docker daemon
  "2376",  // Docker daemon TLS
  "3306",  // MySQL
  "3389",  // RDP
  "5432",  // Postgres
  "5984",  // CouchDB
  "6379",  // Redis
  "9200",  // Elasticsearch
  "9300",  // Elasticsearch transport
  "11211", // Memcached
  "27017", // MongoDB
  "27018", // MongoDB
  "50070", // Hadoop
]);

/* An IPv6 literal can carry an IPv4 address inside it, and the URL parser
   may hand back either spelling: "[::ffff:127.0.0.1]" normalizes to
   "[::ffff:7f00:1]". Both mean 127.0.0.1, so fold them to dotted quad and
   let the IPv4 patterns above decide. */
function embeddedIpv4(host) {
  const dotted = host.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];
  const hex = host.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

function isPrivateIp(ip) {
  if (!ip) return false;
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = embeddedIpv4(host);
  if (mapped) return isPrivateIp(mapped);
  /* Deny-by-default for IPv6 literals: 2000::/3 is the only globally
     routable unicast space, so anything else (loopback, ULA, link-local,
     multicast, unspecified, and encodings we haven't thought of) is not
     something this scanner should ever fetch. Hostnames never reach this
     branch — only IPv6 literals contain a colon. */
  if (host.includes(":")) return !/^[23][0-9a-f]{0,3}:/i.test(host);
  return PRIVATE_HOST_PATTERNS.some((rx) => rx.test(host));
}

/* The private addresses a developer's own machine and network use:
   loopback and the RFC 1918 / ULA ranges. These are the only private
   addresses allowPrivateNetwork opens. Link-local (169.254.0.0/16,
   fe80::/10) stays blocked because cloud metadata services live there,
   and so do CGNAT (100.64.0.0/10), 0.0.0.0, and "::". */
const LOCAL_NETWORK_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
];

function isLocalNetworkIp(ip) {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = embeddedIpv4(host);
  if (mapped) return isLocalNetworkIp(mapped);
  return LOCAL_NETWORK_PATTERNS.some((rx) => rx.test(host));
}

/* The one predicate both boundaries use. With allowPrivateNetwork off
   (the default, and the only setting the website and hosted MCP server
   use) this is exactly isPrivateIp. */
function isBlockedHost(ip, allowPrivateNetwork) {
  if (!isPrivateIp(ip)) return false;
  if (allowPrivateNetwork !== true) return true;
  return !isLocalNetworkIp(ip);
}

/* SSRF guard for any URL we're about to fetch. Resolves the hostname
   via DNS and rejects responses that point at private/loopback/
   link-local space. Catches public-hostname-pointing-at-private-IP
   tricks (e.g. someone configures evil.com → 127.0.0.1) plus the
   redirect-to-localhost variant when the caller re-checks each hop.

   Also rejects URLs with userinfo (https://user:pass@host) and
   non-web ports (databases, mail, SSH, etc.).

   allowPrivateNetwork lets loopback and local-network addresses through
   for a developer checking their own dev server. See isLocalNetworkIp.

   Returns { ok: true } or { ok: false, reason }. */
export async function assertSafeUrl(url, { allowPrivateNetwork = false } = {}) {
  // Defense-in-depth length check. normalizeUrl already enforces this at
  // the input boundary, but redirects can grow URLs (long Location:
  // headers), and other callers may skip normalization. Cheap to check.
  if (typeof url !== "string" || url.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "url_too_long" };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "bad_protocol" };
  }
  // Reject embedded credentials. URL.username/password are empty strings
  // when absent, so any non-empty value here means the input was
  // https://user@host or https://user:pass@host. Legit public sites
  // never need this; it's a vector for confusing logs and downstream
  // tools.
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "userinfo_present" };
  }
  // Block non-web ports. URL.port is "" for default (80/443) and a
  // numeric string otherwise. Empty = OK.
  if (parsed.port && BLOCKED_PORTS.has(parsed.port)) {
    return { ok: false, reason: "blocked_port" };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "missing_host" };
  if (isBlockedHost(host, allowPrivateNetwork)) {
    return { ok: false, reason: "private_host" };
  }

  // DNS resolution: catches public hostnames that resolve to private IPs.
  // Skipped if hostname is already a literal IP (URL parser would've kept it).
  const isLiteralIp = /^[0-9.]+$/.test(host) || host.includes(":");
  if (!isLiteralIp) {
    try {
      const dns = await import("node:dns/promises");
      const records = await dns.lookup(host, { all: true });
      for (const rec of records) {
        if (isBlockedHost(rec.address, allowPrivateNetwork)) {
          return { ok: false, reason: "resolves_to_private" };
        }
      }
      /* The caller connects to these exact addresses instead of resolving
         the name a second time. Without that, a name that answers with a
         public address here and a private one microseconds later would be
         fetched at the private address — the check would pass and the
         connection would still go somewhere internal. All of them are
         returned, in order, so a host with several addresses keeps its
         failover. */
      return { ok: true, addresses: records.map((r) => r.address) };
    } catch {
      /* DNS failed. The fetch will fail the same way and report it; there
         is nothing to pin, so the caller connects normally. */
      return { ok: true, addresses: [] };
    }
  }
  // Literal address: nothing to resolve, so there is no window to exploit.
  return { ok: true, addresses: [] };
}

export const MAX_URL_LENGTH = 500;

export function normalizeUrl(input, { allowPrivateNetwork = false } = {}) {
  if (typeof input !== "string") return null;
  if (input.length > MAX_URL_LENGTH) return null;
  let trimmed = input.trim();
  if (!trimmed) return null;

  if (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  // Reject embedded credentials at the boundary. Same rationale as
  // assertSafeUrl: legit input never has these, and accepting them
  // creates confusing log lines downstream.
  if (parsed.username || parsed.password) return null;
  // Block non-web ports up front, before the URL ever reaches the
  // SSRF guard or fetcher.
  if (parsed.port && BLOCKED_PORTS.has(parsed.port)) return null;

  // isBlockedHost strips IPv6 brackets and folds IPv4-in-IPv6 spellings, so
  // the input boundary rejects exactly what the pre-fetch guard rejects.
  if (isBlockedHost(parsed.hostname, allowPrivateNetwork)) return null;

  // Drop fragment, keep origin + path + search. For bare hostnames the path is
  // "/" so we collapse to the origin form.
  parsed.hash = "";
  if (parsed.pathname === "/" && !parsed.search) {
    return parsed.origin;
  }
  return parsed.origin + parsed.pathname + parsed.search;
}

export function originOf(fullUrl) {
  try {
    return new URL(fullUrl).origin;
  } catch {
    return null;
  }
}
