/* Reading the links in an llms.txt, shared by the llms.txt and
   llms-full.txt checks. */

/* Every "- [title](url)" link, with its title and whether it sits in
   the "## Optional" section (llmstxt.org: secondary links a reader may
   skip). */
export function llmsLinks(text) {
  const links = [];
  let optional = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s/.test(line)) optional = /^##\s+Optional\s*$/i.test(line);
    const m = line.match(/^\s*-\s+\[([^\]]+)\]\(([^)\s]+)/);
    if (m) links.push({ title: m[1].trim(), url: m[2], optional });
  }
  return links;
}

const isLlmsFile = (url) => /\/llms(-full)?\.txt$/i.test(url.split(/[?#]/)[0]);

/* Links llms-full.txt should cover: not Optional, and not the llms
   files themselves. */
export const contentLinks = (text) => llmsLinks(text).filter((l) => !l.optional && !isLlmsFile(l.url));

const squash = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Whether llms-full.txt covers the page a link points to: it has a
   heading with the link's title, or it mentions the page's path (e.g. a
   "Source: https://site/work/post" line). The home page "/" is matched
   by title only, since every URL contains "/". */
export function coversLink(fullText, headings, link, path) {
  const title = squash(link.title);
  if (title && headings.some((h) => h.includes(title))) return true;
  return Boolean(path && path !== "/" && new RegExp(`${escapeRegExp(path)}(?:\\.md)?(?![\\w-])`, "i").test(fullText));
}

export const headingsOf = (text) => [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => squash(m[1]));

const bareHost = (host) => host.toLowerCase().replace(/^www\./, "");

/* The page a link points to, as a path, if it is a page on this site;
   otherwise null. "/about.md", "/about.html", "/about/" and "/about" are
   the same page, and "/index.md" is "/". `siteHosts` are the hosts that
   count as this site: the checked host, plus the hosts its sitemap lists
   (a dev server's sitemap names the production host). */
export function sitePagePath(url, baseUrl, siteHosts) {
  let u;
  try {
    u = new URL(url, baseUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !siteHosts.has(bareHost(u.hostname)) || isLlmsFile(u.pathname)) return null;
  const path = u.pathname
    .replace(/\.md$/i, "")
    .replace(/\.html?$/i, "")
    .replace(/\/index$/i, "/")
    .replace(/\/+$/, "");
  return path || "/";
}

export const siteHostsFor = (baseUrl, extraUrls = []) =>
  new Set([baseUrl, ...extraUrls].flatMap((u) => {
    try {
      return [bareHost(new URL(u).hostname)];
    } catch {
      return [];
    }
  }));
