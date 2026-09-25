/* Fails if the package gains a dependency, an install script, or a
   published file outside bin/, src/, and skills/. Run in CI before tests pass and
   before every publish. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const problems = [];

for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundleDependencies"]) {
  if (field in pkg) problems.push(`package.json has "${field}". This package must have no dependencies.`);
}
for (const script of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]) {
  if (pkg.scripts?.[script]) problems.push(`package.json has a "${script}" script. Install and pack scripts are not allowed.`);
}

const [{ files }] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }));
const allowed = /^(package\.json|README\.md|LICENSE|schema\.json|bin\/[\w.-]+\.js|src\/[\w/.-]+\.js|skills\/[\w/.-]+\.md)$/;
for (const { path } of files) {
  if (!allowed.test(path)) problems.push(`Unexpected file in the package: ${path}`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Package OK: no dependencies, no install scripts, ${files.length} files.`);
