#!/usr/bin/env node
// Counts the demo's songs that show no real album cover, per tab, and (with --queue <file>) writes
// the ones still missing as a lookup queue for scripts/find-demo-covers.py, best-known first:
//   1. Presets tab songs, 2. MIDI "chords from songs", 3. Samples tab songs (artists with the most
//   songs here first), 4. the sampled originals (most-sampled first).
// It bundles the demo's own data modules, so the count is exactly what coverFor() resolves.
//
// Usage: node scripts/demo-cover-gaps.mjs [--queue out.json]
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const demo = join(root, "apps/web/src/demo");
const esbuild = createRequire(join(root, "package.json"))("esbuild");
const q = process.argv.indexOf("--queue");
const queue = q > 0 ? process.argv[q + 1] : "";

const entry = `
import { ALL_SONGS } from ${JSON.stringify(join(demo, "presets/songs"))};
import { coverFor } from ${JSON.stringify(join(demo, "presets/cover"))};
import { SONG_CHORDS } from ${JSON.stringify(join(demo, "midi/songs"))};
import { SAMPLE_SONGS, ORIGINALS } from ${JSON.stringify(join(demo, "samples/data"))};
import { writeFileSync } from "node:fs";
const tabs = {
  presets: ALL_SONGS.map((s) => ({ song: s.song, artist: s.artist, album: s.album ?? null, year: null })),
  midi: SONG_CHORDS.map((s) => ({ song: s.song, artist: s.artist, album: s.album ?? null, year: s.year ?? null })),
  samples: SAMPLE_SONGS.map((s) => ({ song: s.song, artist: s.artist, album: s.album, year: s.year, weight: s.samples.length })),
  originals: ORIGINALS.map((o) => ({ song: o.title, artist: o.artist, album: null, year: o.year, weight: o.uses.length })),
};
const counts = {};
const missing = {};
for (const [tab, rows] of Object.entries(tabs)) {
  missing[tab] = rows.filter((r) => !coverFor(r.song, r.artist));
  counts[tab] = { items: rows.length, withoutCover: missing[tab].length, withCover: rows.length - missing[tab].length };
}
console.log(JSON.stringify(counts, null, 1));
const out = ${JSON.stringify(queue)};
if (out) {
  const lead = (a) => a.split(/ feat\\.? | ft\\.? | featuring | with |, | & | x /i)[0].toLowerCase();
  const songsBy = new Map();
  for (const s of tabs.samples) songsBy.set(lead(s.artist), (songsBy.get(lead(s.artist)) ?? 0) + 1);
  // An artist's n-th song scores (songs by them here) / n: the best-known artists come first, but a
  // prolific artist's 40th song waits behind other well-known artists' first ones.
  const nth = new Map();
  const samples = [...missing.samples]
    .sort((a, b) => b.weight - a.weight)
    .map((r) => {
      const k = lead(r.artist);
      nth.set(k, (nth.get(k) ?? 0) + 1);
      return { r, score: (songsBy.get(k) ?? 0) / nth.get(k) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);
  const originals = [...missing.originals].sort((a, b) => b.weight - a.weight);
  const cut = (xs, f) => [xs.filter(f), xs.filter((x) => !f(x))];
  const [topOriginals, restOriginals] = cut(originals, (o) => o.weight >= 3);
  const seen = new Set();
  const rows = [];
  for (const [tab, list] of [["presets", missing.presets], ["midi", missing.midi], ["samples", samples.slice(0, 2000)], ["originals", topOriginals], ["samples", samples.slice(2000)], ["originals", restOriginals]])
    for (const r of list) {
      const k = (r.song + "|" + r.artist).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ tab, song: r.song, artist: r.artist, album: r.album, year: r.year });
    }
  writeFileSync(out, JSON.stringify(rows, null, 0));
  console.error(rows.length + " songs queued in " + out);
}
`;
const dir = mkdtempSync(join(tmpdir(), "cover-gaps-"));
try {
  await esbuild.build({
    stdin: { contents: entry, resolveDir: demo, loader: "ts" },
    outfile: join(dir, "gaps.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
  });
  await import(pathToFileURL(join(dir, "gaps.mjs")).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
