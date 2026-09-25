/**
 * Shared shape definitions for the AI Readiness checker. JSDoc only —
 * this codebase is plain JavaScript.
 *
 * @typedef {"pass" | "warn" | "fail" | "info"} CheckStatus
 * @typedef {"permission" | "visibility" | "agent" | "meta"} CheckCategory
 *
 * @typedef {Object} CheckResult
 * @property {string} id
 * @property {string} name
 * @property {CheckCategory} category
 * @property {CheckStatus} status
 * @property {string} summary
 * @property {Object} [details]
 * @property {string} [promptUrl]
 * @property {string} [specUrl]
 * @property {string} [learnMoreUrl]
 * @property {number} durationMs
 *
 * @typedef {Object} CheckReport
 * @property {string} url
 * @property {string} checkedAt
 * @property {number} totalDurationMs
 * @property {CheckResult[]} results
 *
 * @typedef {Object} HomepageContext
 * @property {string} html
 * @property {Document} document
 * @property {Headers} headers
 * @property {boolean} isLikelyClientRendered
 */
export {};
