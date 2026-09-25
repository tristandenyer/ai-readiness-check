<img width="742" height="334" alt="Screenshot 2026-09-24 at 21 04 23" src="https://github.com/user-attachments/assets/a405a4b4-54cf-4855-bce7-bc54f5e3183c" />

# AI Readiness Check (the npm package)

Checks how ready a website is for AI crawlers, AI search, and AI agents, and tells you how to fix what's missing. It runs 19 checks: `robots.txt` rules for AI crawlers, `llms.txt`, `schema.org JSON-LD`, markdown versions of pages, sitemaps, MCP discovery, and more.

Run it on your own machine, in CI, or from an AI coding agent. Requires Node.js 22 or newer.

- Zero dependencies.
- About 250 KB installed.
- In CI it adds about 3 seconds per run (measured on 2 pages), plus about 7 seconds if you upload SARIF.

## Why use it

- **Get cited by AI search.** ChatGPT, Claude, and Perplexity can only cite pages they can fetch and read. The checks find what stops them: crawlers blocked in `robots.txt`, pages that are empty until JavaScript runs, no machine-readable summary of the site.
- **Every problem comes with a fix.** Each failing check links to a copy-paste prompt in [awesome-ai-website-files](https://github.com/tristandenyer/awesome-ai-website-files) that tells you, or your AI coding agent, exactly what to add.
- **Keep it from getting worse.** Fail CI when the score drops below a minimum, or below the best score the site has reached so far (the optional "ratchet").
- **Works with AI coding agents.** An agent can run the check, and you can choose to apply each fix (AI prompts are supplied), and run the check again until it passes, through the instructions `init --agent` adds to `AGENTS.md` (or a Claude Code skill), or the local MCP server (supplied in package).

## Quick start

```sh
npx ai-readiness-check check https://example.com
```

To check a dev server, start it and point the check at it:

```sh
npx ai-readiness-check check localhost:3000
```

To set up a project (settings file, instructions for AI coding agents, GitHub workflow):

```sh
npx ai-readiness-check init --agent --github-action
```

Then ask your coding agent to "make this site AI-ready", or fix the problems by hand using the links in the output.

`npx` downloads and runs the newest version. To pin a version for CI instead, install it in the project and run it the same way:

```sh
npm install --save-dev ai-readiness-check
npx ai-readiness-check check https://example.com   # uses the installed version
```

Or add it to `package.json` and run `npm run ai-readiness`:

```json
"scripts": { "ai-readiness": "ai-readiness-check check" }
```

Use `npx`, not `npm`: `npm ai-readiness-check` fails with "Unknown command".

## What it checks

The weights sum to exactly 100: three high-impact checks (`robots.txt`, `llms.txt`, `schema.org JSON-LD`) are worth 20 points each, five more are worth 8 each, and the rest are unscored niche or opt-out signals shown for visibility. A pass earns full credit, a warn earns half, and a fail earns nothing. An info result, which usually means a missing-but-optional file, is left out of the denominator entirely so it doesn't drag the score down.

| Id                    | Points | What it looks for                                                                                                                                                         |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `robots-txt`          | 20     | robots.txt that names the AI crawlers you allow (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, ...)                                                                    |
| `llms-txt`            | 20     | llms.txt per [llmstxt.org](https://llmstxt.org/): H1, blockquote summary, H2 sections of links. It should link every page in your sitemap, or at least 20 on a large site |
| `schema-jsonld`       | 20     | schema.org JSON-LD on the page                                                                                                                                            |
| `content-negotiation` | 8      | Markdown returned when a client sends `Accept: text/markdown`                                                                                                             |
| `md-route`            | 8      | A markdown version of the page at the same URL plus `.md`                                                                                                                 |
| `markdown-link`       | 8      | `<link rel="alternate" type="text/markdown">` in the page's `<head>`                                                                                                      |
| `sitemap`             | 8      | sitemap.xml at the root or named in robots.txt                                                                                                                            |
| `llms-full-txt`       | 8      | llms-full.txt with the full text of every page llms.txt links to                                                                                                          |
| `mcp-json`            | 0      | /.well-known/mcp.json pointing at your MCP servers                                                                                                                        |
| `tdmrep`              | 0      | /.well-known/tdmrep.json (W3C text and data mining reservations)                                                                                                          |
| `ai-txt`              | 0      | ai.txt with per-crawler training permissions (spawning.ai format)                                                                                                         |
| `agent-card`          | 0      | /.well-known/agent-card.json (A2A agent card)                                                                                                                             |
| `api-agent-yaml`      | 0      | /.well-known/api-agent.yaml, for sites that serve an API                                                                                                                  |
| `content-signals`     | 0      | `Content-Signal` lines in robots.txt ([contentsignals.org](https://contentsignals.org/))                                                                                  |
| `api-catalog`         | 0      | /.well-known/api-catalog (RFC 9727), for sites that publish APIs                                                                                                          |
| `ai-meta-tags`        | 0      | AI-related meta tags in `<head>`                                                                                                                                          |
| `x-robots-tag`        | 0      | `X-Robots-Tag` response headers                                                                                                                                           |
| `link-header`         | 0      | A `Link:` response header pointing at the markdown version                                                                                                                |
| `ai-hint-div`         | 0      | A hidden `<div data-ai-hint>` summary for AI tools                                                                                                                        |

The article [The Complete List of AI Files Your Website Needs in 2026](https://www.tristandenyer.com/work/ai-files-for-websites-2026) explains each file, what uses it, and whether it's worth adding.

The checker reads pages the way AI crawlers do: it fetches the HTML and does not run JavaScript. A page that is empty until JavaScript runs fails its page-level checks (`schema-jsonld`, `markdown-link`, `md-route`) unless the tags are already in the HTML the server sends, because AI crawlers get the same empty page. The failure says so. [Why Your Site Isn't Showing Up in ChatGPT, Claude, or Perplexity](https://www.tristandenyer.com/work/why-ai-tools-cant-see-your-site) covers that problem and the other common reasons AI tools can't read a site.

### Scoring

| Status         | Meaning                                                                           | Points                                                 |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pass`         | Present and correct                                                               | All                                                    |
| `warn`         | Present but incomplete                                                            | Half                                                   |
| `fail`         | Missing or broken, or not in the HTML because the page needs JavaScript           | None                                                   |
| `info`         | Doesn't apply to this site. Only 0-point checks report this                       | None, and the score doesn't change                     |
| `inconclusive` | The file couldn't be fetched this time (timeout, DNS failure, dropped connection) | Left out; the score is scaled over the checks that ran |

Grades: A is 90 or more, B 80 or more, C 70 or more, D 60 or more, F below 60.

## Commands

```
npx ai-readiness-check check example.com
npx ai-readiness-check baseline
npx ai-readiness-check mcp
npx ai-readiness-check init localhost:5173
```

| Command          | What it does                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check [url]`    | Runs the checks and prints the results                                                                                                           |
| `baseline [url]` | Runs the checks and saves the scores as the ratchet floor (see [Ratchet](#ratchet-a-score-that-only-goes-up))                                    |
| `mcp`            | Starts a local MCP server on stdin/stdout for AI coding agents                                                                                   |
| `init [url]`     | Creates `ai-readiness.config.json`. `--agent` adds instructions for AI coding agents; `--github-action` adds a workflow. Never overwrites a file |

The URL can be left out when the settings file has a `target`. A URL without `http://` or `https://` gets `http://` for localhost and `https://` otherwise.

### Options

Options with two names, like `-f, --format`, take either one: `-f json`, `--format json`, and `--format=json` all work.

```
npx ai-readiness-check check example.com --pages /,/about,/blog
npx ai-readiness-check check example.com --pages /,sitemap:5
npx ai-readiness-check check --config ci/ai-readiness.json
npx ai-readiness-check check example.com --timeout 20000
npx ai-readiness-check check https://my-app-git-feature.vercel.app --header "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"
npx ai-readiness-check check http://192.168.1.20:3000 --allow-private
npx ai-readiness-check check example.com -f markdown --sarif results.sarif
npx ai-readiness-check baseline --allow-lower
```

| Option                     | For                  | What it does                                                                                                                        |
| -------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `-f, --format <name>`      | check, baseline      | `pretty`, `json`, `markdown`, `sarif`, or `agent`. Default: `pretty` in a terminal, `json` otherwise                                |
| `--pages <paths>`          | check, baseline      | Comma-separated paths to check, e.g. `/,/blog,/pricing` or `/,sitemap:5`. Overrides `pages` in the settings                         |
| `--config <file>`          | all                  | Settings file to use instead of `ai-readiness.config.json`                                                                          |
| `--timeout <ms>`           | check, baseline, mcp | Timeout for each request, 100 or more. Default: 10000 for most files, 5000 for the page-level checks                                |
| `--header "<Name: value>"` | check, baseline, mcp | Extra request header, e.g. a preview deployment's bypass secret. Repeatable. Sent only to the site being checked, and never printed |
| `--allow-private`          | check, baseline, mcp | Allow private network addresses (10.x, 172.16–31.x, 192.168.x). localhost is always allowed                                         |
| `--sarif <file>`           | check                | Also write SARIF to this file, next to the chosen format                                                                            |
| `--allow-lower`            | baseline             | Save the floor even if a score went down                                                                                            |
| `--agent`                  | init                 | Also add instructions for AI coding agents to AGENTS.md, and the Claude Code skill if the project uses Claude Code                  |
| `--github-action`          | init                 | Also add `.github/workflows/ai-readiness.yml`                                                                                       |
| `-h, --help`               |                      | Show help                                                                                                                           |
| `-v, --version`            |                      | Show the version                                                                                                                    |

### Output formats

```
npx ai-readiness-check check example.com -f markdown
npx ai-readiness-check check example.com --format markdown
```

| `--format` | For                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pretty`   | Reading in a terminal                                                                                                        |
| `json`     | Scripts. One report, or an array when `--pages` has more than one page                                                       |
| `markdown` | PR comments and job summaries                                                                                                |
| `sarif`    | GitHub code scanning                                                                                                         |
| `agent`    | AI coding agents: numbered fixes in order of score impact, where to make each one, and a plain-text link to its instructions |

Why the run failed is printed to stderr, so JSON and SARIF on stdout stay valid.

### Exit codes

```
npx ai-readiness-check check example.com -f json > report.json
case $? in
  0) echo "passed" ;;
  1) echo "checks failed: see report.json" ;;
  2) echo "the check could not run" ;;
esac
```

| Code | Meaning                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Passed                                                                                                                                  |
| 1    | A check failed, the score is lower than `minScore` or the ratchet floor, or robots.txt blocks the checker                               |
| 2    | The check could not run: bad input or settings, the site could not be reached, or more than half the checks could not fetch their files |

## Settings

Put settings in `ai-readiness.config.json`, or under an `aiReadiness` key in `package.json`. `--config <file>` points somewhere else. The `$schema` line gives your editor autocomplete and checks the file as you type.

```json
{
  "$schema": "https://unpkg.com/ai-readiness-check/schema.json",
  "target": "http://localhost:3000",
  "pages": ["/", "/blog", "sitemap:5"],
  "rules": { "ai-txt": "off", "llms-full-txt": "warn" },
  "failOn": "fail",
  "minScore": 60,
  "ratchet": { "tolerance": 2, "name": "production" }
}
```

| Setting             | Default             | Meaning                                                                                                                                                                             |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`            | none                | URL to check when none is given on the command line                                                                                                                                 |
| `pages`             | `["/"]`             | Paths to check on the target, plus at most one `"sitemap:N"` to check N sitemap pages per run (see [Check rotating pages from the sitemap](#check-rotating-pages-from-the-sitemap)) |
| `rules`             | every check `error` | Per check id: `off` skips it and leaves it out of the score, `warn` reports a failure without failing the run, `error` fails the run                                                |
| `failOn`            | `"fail"`            | `"warn"` makes warnings fail the run too                                                                                                                                            |
| `minScore`          | none                | The lowest passing score, 0–100. A page that scores less fails the run; a page that scores exactly this passes. `100` allows only a perfect score                                   |
| `ratchet`           | `false`             | `true`, or an object with the two settings below                                                                                                                                    |
| `ratchet.tolerance` | `0`                 | Points the score may drop below the floor before the run fails                                                                                                                      |
| `ratchet.name`      | `"default"`         | Name of this floor in the baseline file, so staging and production can keep separate floors                                                                                         |

Unknown settings and unknown check ids are errors, so a typo can't silently turn a rule off.

### Check rotating pages from the sitemap

The paths in `pages` are checked on every run. Add `"sitemap:N"` to also check N pages from the site's sitemap, a different N each run:

```json
"pages": ["/", "/blog", "sitemap:5"]
```

- The pages rotate in order, so every sitemap page is checked once every few runs. On a site with 50 other pages, `sitemap:5` covers all of them in 10 runs.
- In GitHub Actions the rotation follows the run number, so rerunning a failed run checks the same pages. Elsewhere it follows the date.
- Only each sitemap URL's path is used, on the site being checked. A dev server whose sitemap lists production URLs gets its own pages checked.
- The run lists the pages it picked. Pages already in `pages` are skipped.
- The ratchet leaves these pages out, since each run checks different ones. They still fail the run on a failing check or a score below `minScore`.
- Site-wide files such as `robots.txt` and `llms.txt` are fetched once per run, so each extra page adds only its own requests.

## Ratchet: a score that only goes up

With `"ratchet": true`, the first run saves each page's score and check results to `ai-readiness.baseline.json`. Commit that file. After that, a run fails when:

- a page's score drops below its saved score, or
- any single check gets worse (pass → warn, or warn → fail), even if the total score went up.

When the score rises, the run says so. Save the new floor and commit it:

```sh
npx ai-readiness-check baseline
```

`baseline` refuses to save a lower score. To accept one on purpose, add `--allow-lower`.

- Pages are matched by path, so a preview URL that changes on every deploy still uses the same floor.
- An `inconclusive` check never counts as getting worse, and keeps its previous result in the baseline. Requests that fail on the network are retried once, except timeouts.
- After a major version of this package changes the scoring, the saved results are re-scored with the new weights, so the floor moves because of the new scoring, not because of your site.
- Never edit the baseline file by hand. The GitHub Action can update it for you (`commit-baseline`).

## GitHub Action

```yaml
name: AI readiness
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write # only for upload-sarif
      actions: read # only for upload-sarif in a private repo
    steps:
      - uses: actions/checkout@v7
      - uses: tristandenyer/ai-readiness-check@v0.2.1
        with:
          url: https://www.example.com
          upload-sarif: true
```

The results table goes to the job summary. With `upload-sarif: true`, each problem also shows up in the repository's Security tab, with a link to how to fix it. Code scanning is free for public repositories; a private repository needs GitHub Advanced Security. The action runs the copy of the tool that ships inside it, so it downloads nothing from npm.

| Input             | Default                    | Meaning                                                                                                                                |
| ----------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `url`             | `target` from the settings | URL to check                                                                                                                           |
| `pages`           | `pages` from the settings  | Comma-separated paths, e.g. `/,/blog` or `/,sitemap:5`                                                                                 |
| `config`          | `ai-readiness.config.json` | Path to a settings file                                                                                                                |
| `headers`         | none                       | Extra request headers, one per line. Sent only to the site being checked                                                               |
| `upload-sarif`    | `false`                    | `true` sends problems to GitHub code scanning. Needs `security-events: write`, and `actions: read` in a private repo                   |
| `commit-baseline` | `false`                    | `true` saves and pushes a higher ratchet floor after a passing run. Needs `contents: write`. Use it only on pushes to your main branch |

| Output      | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `exit-code` | `0` passed, `1` checks failed, `2` the check could not run. The job fails on anything but `0` |

### Check each preview deployment

Vercel reports each finished deployment to GitHub. This workflow checks the preview URL from that report:

```yaml
name: AI readiness (preview)
on: deployment_status
jobs:
  check:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: tristandenyer/ai-readiness-check@v0.2.1
        with:
          url: ${{ github.event.deployment_status.target_url }}
```

If the preview has Deployment Protection turned on, Vercel answers the checker with a 401. Create a Protection Bypass for Automation secret in the Vercel project settings, save it as a GitHub secret, and pass it as a header:

```yaml
with:
  url: ${{ github.event.deployment_status.target_url }}
  headers: |
    x-vercel-protection-bypass: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
```

Other hosts that protect previews work the same way with a different header:

| Host                                                                                          | Header                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Cloudflare Access (including Cloudflare Pages previews)                                       | `CF-Access-Client-Id` and `CF-Access-Client-Secret`, from a service token |
| Any site behind HTTP basic auth (Netlify's `Basic-Auth` header rule, AWS Amplify, nginx, ...) | `Authorization: Basic <base64 of user:password>`                          |

Netlify's site-wide password protection uses a login cookie, not a header, so it can't be bypassed this way.

## AI coding agents

### Instructions for your agent

```
npx ai-readiness-check init --agent
```

This adds an "AI readiness" section to `AGENTS.md` with the full steps. Codex, Cursor, GitHub Copilot, and most other coding agents read `AGENTS.md`. If the project uses Claude Code (it has a `.claude/` folder or a `CLAUDE.md`), the same steps are also added as a skill at `.claude/skills/ai-readiness/SKILL.md`, since (at time of writing) Claude Code reads skills rather than `AGENTS.md`.

Then ask your agent to "make this site AI-ready". It runs the check, fetches the instructions for each problem, applies them, and runs the check again until it passes, for at most 3 rounds. It uses your production URL in files like sitemap.xml, and asks for it if the project doesn't say. It never lowers the ratchet floor.

Any agent can also use `--format agent` directly: it lists each problem with where to fix it and a plain-text instructions URL. Agents that support MCP can use the local MCP server below.

### Local MCP server

```sh
claude mcp add ai-readiness -- npx -y ai-readiness-check mcp
```

For other clients, the command is `npx -y ai-readiness-check mcp`, over stdio. It has one tool, `run_ai_readiness_check`, with an optional `url` input, and returns the same report as the [hosted MCP server](https://www.tristandenyer.com/mcp), plus:

- `passed` and `reasons`: whether the result meets this project's `rules`, `minScore`, and ratchet floor.
- `fix_raw_url` on each problem: a plain-text prompt the agent can fetch.
- It can check `localhost`, and private network addresses with `mcp --allow-private`.
- `target` from the settings is the default URL. `--header` and `--timeout` work as they do for `check`.

The MCP server only compares with the ratchet floor. Saving a new floor is left to `ai-readiness-check baseline`.

The hosted server needs nothing installed and checks public sites only. Use the local one for dev servers, protected previews, and your project's settings.

## Use it from code

```js
import { runCheck, WEIGHTS } from "ai-readiness-check";

const { ok, status, body } = await runCheck("https://example.com", {
  timeoutMs: 10000,
});
if (ok) {
  console.log(body.grade, body.score, body.summary);
  for (const r of body.results)
    console.log(r.id, r.status, r.summary, r.promptUrl);
}
```

| Option                | Default                                          | Meaning                                                      |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `timeoutMs`           | 10000 for most files, 5000 for page-level checks | Timeout for each request                                     |
| `headers`             | none                                             | Extra request headers, sent only to the checked URL's origin |
| `allowPrivateNetwork` | `false`                                          | Allow loopback and private network addresses                 |
| `userAgent`           | see below                                        | User agent for every request                                 |
| `denylist`            | `[]`                                             | Domains that must never be checked (subdomains included)     |

`ok` is false when the URL can't be checked at all (`status` 400 and `body.error`). Otherwise `body` has `url`, `reachable`, `grade`, `score`, `summary` (counts per status), and `results`, one per check with `id`, `name`, `status`, `summary`, `detail`, `fixSummary`, `promptUrl`, `promptRawUrl`, `learnMoreUrl`, and `specUrl`.

`WEIGHTS` maps each check id to its points. `PROMPTS_REF` is the git ref of awesome-ai-website-files that the prompt links point at.

## What it sends, and to where

- Requests go only to the site being checked, with the user agent `Mozilla/5.0 (compatible; AIReadinessCheck/1.0; +https://www.tristandenyer.com/ai-readiness-check)`. Allow it in your firewall or bot protection if you block unknown crawlers.
- To send a different user agent, use `--header "User-Agent: ..."`. For example, send GPTBot's to see what OpenAI's crawler gets from your site: `--header "User-Agent: Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)"`. Some firewalls also check that a crawler's requests come from its published IP addresses, so they may block the check while letting the real crawler through.
- One check run makes about 15 to 30 requests, depending on what the site has. Files read by several checks (robots.txt, llms.txt, the sitemap) are fetched once.
- Private network addresses are refused unless you allow them. Cloud metadata addresses (169.254.x) are always refused. Every redirect is checked again, so a public URL can't redirect the checker into your network.
- Only the first 1 MB of each response is read.
- Nothing is sent anywhere else. There is no telemetry.

## Learn more

- [awesome-ai-website-files](https://github.com/tristandenyer/awesome-ai-website-files): the fix prompts every result links to, plus examples of each file.
- [The Complete List of AI Files Your Website Needs in 2026](https://www.tristandenyer.com/work/ai-files-for-websites-2026): what each file does and which ones matter.
- [Why Your Site Isn't Showing Up in ChatGPT, Claude, or Perplexity](https://www.tristandenyer.com/work/why-ai-tools-cant-see-your-site): CDN rules, firewalls, slow responses, and JavaScript-only pages.
- [Which AI Crawlers to Block in robots.txt, and Which to Allow](https://www.tristandenyer.com/work/robots-txt-for-ai-agents): the robots.txt check in depth.
- [AI Readiness Check on the web](https://www.tristandenyer.com/ai-readiness-check): the same checks in your browser, with a shareable report.

## Issues

Report bugs and ask for new checks at [github.com/tristandenyer/ai-readiness-check/issues](https://github.com/tristandenyer/ai-readiness-check/issues).

## Support this project

ai-readiness-check is free and MIT licensed. If it helps you, you can [sponsor its development on GitHub](https://github.com/sponsors/tristandenyer).

## License

[MIT](LICENSE)
