import { describe, it, expect } from "./helpers/expect.js";
import { __test__ } from "../src/core/robots-policy.js";

const { decide } = __test__;

describe("robots-policy decide()", () => {
  it("allows when robots.txt is empty", () => {
    expect(decide("", "/").allowed).toBe(true);
  });

  it("allows on wildcard with empty Disallow", () => {
    expect(decide("User-agent: *\nDisallow:\n", "/").allowed).toBe(true);
  });

  it("blocks on wildcard Disallow: /", () => {
    const r = decide("User-agent: *\nDisallow: /\n", "/");
    expect(r.allowed).toBe(false);
    expect(r.matchedAgent).toBe("*");
  });

  it("blocks when named for our UA", () => {
    const r = decide("User-agent: AIReadinessCheck\nDisallow: /\n", "/");
    expect(r.allowed).toBe(false);
    expect(r.matchedAgent).toBe("AIReadinessCheck");
  });

  it("named-block overrides wildcard-allow", () => {
    const text =
      "User-agent: *\nDisallow:\n\n" +
      "User-agent: AIReadinessCheck\nDisallow: /\n";
    const r = decide(text, "/");
    expect(r.allowed).toBe(false);
    expect(r.matchedAgent).toBe("AIReadinessCheck");
  });

  it("named-allow overrides wildcard-block", () => {
    const text =
      "User-agent: *\nDisallow: /\n\n" +
      "User-agent: AIReadinessCheck\nDisallow:\n";
    const r = decide(text, "/");
    expect(r.allowed).toBe(true);
    expect(r.matchedAgent).toBe("AIReadinessCheck");
  });

  it("wildcard with specific path Disallow leaves root allowed", () => {
    const r = decide("User-agent: *\nDisallow: /admin\n", "/");
    expect(r.allowed).toBe(true);
  });

  it("tolerates comments and blank lines", () => {
    const text =
      "# Hello\n\n" +
      "User-agent: AIReadinessCheck   # comment\n" +
      "Disallow: /  # block all\n";
    expect(decide(text, "/").allowed).toBe(false);
  });

  it("UA matching is case-insensitive", () => {
    expect(decide("User-agent: aireadinesscheck\nDisallow: /\n", "/").allowed).toBe(false);
  });

  it("ignores directives that appear before any User-agent", () => {
    const text = "Disallow: /\nUser-agent: *\nAllow: /\n";
    expect(decide(text, "/").allowed).toBe(true);
  });

  it("no rules under matching UA group means allowed", () => {
    const text = "User-agent: AIReadinessCheck\n\n";
    expect(decide(text, "/").allowed).toBe(true);
  });
});
