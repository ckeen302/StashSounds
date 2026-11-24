#!/usr/bin/env node
// More demo loops (ticket 137). Lead-owned.
// Reads the demo's MIDI patterns from apps/web/src/demo/midi (bundled with esbuild so the TypeScript
// runs as is), then hands them to scripts/gen-demo-loops.py, which renders each loop in
// scripts/demo-loops.json, encodes its preview the way the worker does, and writes
// apps/web/src/demo/generated/more-loops.json.
// Usage: node scripts/build-demo-loops.mjs   (needs python3 with numpy, and ffmpeg)
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const root = join(import.meta.dirname, "..");
const esbuild = createRequire(join(root, "apps/web/package.json"))("esbuild");
const work = mkdtempSync(join(tmpdir(), "stash-demo-loops-"));
const entry = join(work, "dump.ts");
writeFileSync(
  entry,
  `import { midiItems } from ${JSON.stringify(join(root, "apps/web/src/demo/midi/catalog"))};
process.stdout.write(JSON.stringify(midiItems().filter((m) => !m.song && !m.mine).map((m) => ({ publicId: m.publicId, sound: m.sound, notes: m.notes }))));`,
);
const bundle = join(work, "dump.mjs");
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "warning" });
const dump = spawnSync(process.execPath, [bundle], { maxBuffer: 1 << 26 });
if (dump.status !== 0) throw new Error(dump.stderr.toString());
const patterns = join(work, "patterns.json");
writeFileSync(patterns, dump.stdout);
const r = spawnSync("python3", [join(root, "scripts/gen-demo-loops.py"), patterns, join(work, "wav")], { stdio: "inherit" });
process.exit(r.status ?? 1);
