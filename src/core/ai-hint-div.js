import { promptUrlFor } from "./links.js";


const AI_KEYWORDS = /\b(ai|machine|bot|agent|llm|crawler)\b/i;
const MARKDOWN_HINT = /\.md\b|\/llms\.txt|\/llms-full\.txt|markdown/i;

export async function checkAiHintDiv(_baseUrl, homepage) {
  const start = performance.now();
  const id = "ai-hint-div";
  const name = "AI hint div";
  const category = "visibility";
  const promptUrl = promptUrlFor("ai-hint-div.md");
  const learnMoreUrl =
    "/work/ai-files-for-websites-2026#9-the-hidden-hey-ai-hint-div";

  if (!homepage) {
    return {
      id,
      name,
      category,
      status: "fail",
      summary: "Could not fetch the homepage to look for an AI hint div.",
      promptUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  const hidden = homepage.document.querySelectorAll('[aria-hidden="true"]');
  let found = null;
  for (const el of hidden) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    if (AI_KEYWORDS.test(text) && MARKDOWN_HINT.test(text)) {
      found = text.slice(0, 160);
      break;
    }
  }

  if (found) {
    return {
      id,
      name,
      category,
      status: "pass",
      summary: "Visually-hidden AI hint div found.",
      details: { snippet: found },
      promptUrl,
      learnMoreUrl,
      durationMs: performance.now() - start,
    };
  }

  return {
    id,
    name,
    category,
    status: "info",
    summary: "No hidden AI hint div found.",
    detail: "This is an unofficial convention, only useful if you want a shortcut for paste-into-AI flows.",
    promptUrl,
    learnMoreUrl,
    durationMs: performance.now() - start,
  };
}
