#!/usr/bin/env node
/**
 * pnpm licenses: fails when a dependency's license is outside the allowed list (playbook: Licenses gate).
 * Runtime dependencies must be permissive. Development-only tools may also be MPL-2.0 (file-level
 * copyleft, not linked into what we ship). GPL, AGPL and LGPL are never allowed, which keeps
 * Essentia out and keeps Vital's GPL code in its own process (docs/spec/overview.md).
 */
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PERMISSIVE = ["MIT", "MIT-0", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "CC0-1.0", "BlueOak-1.0.0", "Unlicense", "Python-2.0", "CC-BY-4.0", "PSF-2.0", "Zlib"];
const DEV_EXTRA = ["MPL-2.0", "CC-BY-3.0"];
/** Named exceptions, each with a decision record (docs/decisions/0007-license-exceptions.md). */
const EXCEPTIONS = [
  { match: /^@fontsource-variable\//, license: "OFL-1.1" },          // fonts: SIL Open Font License
  { match: /^@img\/sharp-libvips-/, license: "LGPL-3.0-or-later" }, // Next's image optimizer, dynamically loaded, unmodified
];

/** True when every alternative or conjunct of an SPDX-ish expression is acceptable as the expression demands. */
function ok(expr, allowed) {
  const e = String(expr ?? "").replace(/[()*]/g, "").trim();
  if (!e) return false;
  if (/ OR /i.test(e)) return e.split(/ OR /i).some((x) => ok(x, allowed));
  if (/ AND /i.test(e)) return e.split(/ AND /i).every((x) => ok(x, allowed));
  return allowed.includes(e.trim());
}

const problems = [];

// Node: pnpm reports every installed package with its license, grouped by license.
for (const [scope, flag, allowed] of [["runtime", "--prod", PERMISSIVE], ["dev", "--dev", [...PERMISSIVE, ...DEV_EXTRA]]]) {
  const out = execFileSync("pnpm", ["licenses", "list", "--json", flag, "-r"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
  const byLicense = JSON.parse(out || "{}");
  for (const [license, pkgs] of Object.entries(byLicense)) {
    if (ok(license, allowed)) continue;
    for (const p of pkgs) {
      if (EXCEPTIONS.some((x) => x.match.test(p.name) && x.license === license)) continue;
      problems.push(`${scope}: ${p.name}@${(p.versions ?? [p.version]).join(",")} is ${license}`);
    }
  }
}

// Python worker: read license metadata from the locked environment.
const py = `
import json, importlib.metadata as m
out = {}
for d in m.distributions():
    meta = d.metadata
    lic = meta.get("License-Expression") or ""
    if not lic:
        cls = [c.split(" :: ")[-1] for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
        lic = " OR ".join(cls) or (meta.get("License") or "").splitlines()[0] if (meta.get("License") or cls) else ""
    out[meta["Name"]] = lic
print(json.dumps(out))
`;
const CLASSIFIER = { "MIT License": "MIT", "BSD License": "BSD-3-Clause", "Apache Software License": "Apache-2.0", "ISC License (ISCL)": "ISC", "Python Software Foundation License": "PSF-2.0", "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0" };
const pyOut = execFileSync("uv", ["run", "--frozen", "python", "-c", py], { cwd: join(root, "apps/worker"), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const DEV_PY = new Set(["pytest", "ruff", "pluggy", "iniconfig", "packaging", "pygments"]);
for (const [name, raw] of Object.entries(JSON.parse(pyOut))) {
  if (name === "stash-worker") continue;
  const lic = raw.split(" OR ").map((x) => CLASSIFIER[x] ?? x).join(" OR ");
  const allowed = DEV_PY.has(name.toLowerCase()) ? [...PERMISSIVE, ...DEV_EXTRA] : PERMISSIVE;
  if (!ok(lic, allowed)) problems.push(`python: ${name} is ${raw || "unknown"}`);
}

if (problems.length) {
  console.error("Dependencies with licenses outside the allowed list:\n  " + problems.join("\n  "));
  console.error("\nIf one is acceptable, the lead adds it here with a decision file.");
  process.exit(1);
}
console.log("All dependency licenses are on the allowed list.");
