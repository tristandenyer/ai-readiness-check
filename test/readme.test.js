import { describe, it, expect } from "./helpers/expect.js";
import fs from "node:fs";
import { WEIGHTS } from "../src/core/grade.js";

/* The README is the reference for check ids, CLI options, settings, and
   action inputs. These tests fail when one of those is added to the code
   but not to the README. */
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../src/cli/main.js", import.meta.url), "utf8");
const action = fs.readFileSync(new URL("../action.yml", import.meta.url), "utf8");
const schema = JSON.parse(fs.readFileSync(new URL("../schema.json", import.meta.url), "utf8"));

describe("README", () => {
  it("lists every check with its points", () => {
    for (const [id, points] of Object.entries(WEIGHTS)) {
      expect(readme, id).toMatch(new RegExp(`^\\|\\s*\`${id}\`\\s*\\|\\s*${points}\\s*\\|`, "m"));
    }
  });

  it("documents every CLI option", () => {
    const options = [...main.matchAll(/^\s+"?([a-z-]+)"?: \{ type: "(?:string|boolean)"/gm)].map((m) => m[1]);
    expect(options.length).toBeGreaterThan(10);
    for (const o of options) expect(readme, o).toContain(`--${o}`);
  });

  it("documents every setting and every action input", () => {
    const row = (name) => new RegExp(`^\\|\\s*\`${name}\`\\s*\\|`, "m");
    for (const key of Object.keys(schema.properties).filter((k) => k !== "$schema")) expect(readme, key).toMatch(row(key));
    for (const input of [...action.matchAll(/^  ([a-z-]+):\n    description:/gm)].map((m) => m[1])) {
      expect(readme, input).toMatch(row(input));
    }
  });
});
