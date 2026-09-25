import { promptUrlFor } from "./links.js";


export async function checkMarkdownLink(_baseUrl, homepage) {
  const start = performance.now();
  const id = "markdown-link";
  const name = '<link rel="alternate" type="text/markdown">';
  const category = "visibility";
  const promptUrl = promptUrlFor("markdown-discovery.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#8-link-discovery-link-tag-http-link-header-and-content-negotiation";

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to inspect <head>.",
      promptUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  const links = homepage.document.querySelectorAll(
    'link[rel="alternate"][type="text/markdown"]'
  );
  const hrefs = [];
  links.forEach((l) => {
    const h = l.getAttribute("href");
    if (h) hrefs.push(h);
  });

  if (hrefs.length > 0) {
    return {
      id,
      name,
      category,
      status: "pass",
      summary: `Markdown alternate link present (${hrefs[0]}).`,
      details: { hrefFound: hrefs[0], count: hrefs.length },
      promptUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  return {
    id,
    name,
    category,
    status: "fail",
    summary: 'No <link rel="alternate" type="text/markdown"> in <head>.',
    detail: "Without it, AI tools have to guess where the markdown version of this page lives.",
    promptUrl,
    learnMoreUrl,
    durationMs: performance.now() - start,
  };
}
