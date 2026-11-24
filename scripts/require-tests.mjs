#!/usr/bin/env node
/**
 * Unit tests gate, second half: a change to packages/audio/src or packages/contracts/src must also
 * change a test in the same package (playbook: Quality gates). Compares against BASE_REF (default origin/main).
 */
import { execFileSync } from "node:child_process";

const base = process.env.BASE_REF ?? "origin/main";
const files = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
const missing = [];
for (const pkg of ["packages/audio", "packages/contracts"]) {
  const src = files.filter((f) => f.startsWith(`${pkg}/src/`));
  const tests = files.filter((f) => f.startsWith(`${pkg}/test/`));
  if (src.length && !tests.length) missing.push(`${pkg}: changed ${src.join(", ")} with no test change`);
}
if (missing.length) {
  console.error(missing.join("\n"));
  process.exit(1);
}
console.log("Every changed source file in packages/audio and packages/contracts comes with a test change.");
